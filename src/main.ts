import './styles/tokens.css';
import './styles/base.css';
import './styles/fix.css';
import './styles/app.css';
import type { Command } from './app/commands';
import type { FixFeature } from './app/fixFeature';
import type { DiagMark, EditorHandle } from './editor/editor';
import { explain } from './errors/explain';
import { EXAMPLES, type Example } from './examples';
import { readFile, downloadPy } from './files';
import type { Diag } from './fix/types';
import { PyClient, type RunResult } from './py/client';
import { decodeShare, encodeShare, shareHashPayload } from './share';
import { loadSaved, save } from './storage';
import { announce } from './ui/announce';
import { createErrorCard } from './ui/errorCard';
import { Menu, type MenuItem } from './ui/menu';
import { RunButton } from './ui/runButton';
import { SelectionToolbar } from './ui/selectionToolbar';
import { initSplit } from './ui/split';
import { Splash } from './ui/splash';
import { Terminal } from './ui/terminal';
import { initTheme, effectiveTheme } from './ui/theme';
import { toast } from './ui/toast';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const DEFAULT_CODE = `# Welcome to PyPal. Press Run (or Ctrl+Enter) to try it.
name = input("What's your name? ")
print("Hello,", name + "!")

for i in range(1, 4):
    print("Counting:", i)
`;
const PREVIOUS_KEY = 'pypal:previous';
const BASE = import.meta.env.BASE_URL;

const app = $('app');
app.inert = true; // nothing underneath the intro can take focus
const splash = new Splash();
const term = new Terminal($('term'));
const saveState = $('save-state');
const fixBtn = $('fix-all') as HTMLButtonElement;
const sheetRoot = $('fix-sheet');

initTheme($('theme'));
initSplit($('workspace'), $('divider'));

let editor!: EditorHandle;
let toolbar!: SelectionToolbar;
let fix: FixFeature | null = null;
let syntaxDiag: Diag | null = null; // from the live check
let runDiag: Diag | null = null; // from the last run, cleared when the code changes

/* ============================ Python (starts immediately) ============================ */

const progress = $('progress');
const progressLabel = $('progress-label');
let pyReady = false;
let booted = false;
let resolveEditor!: () => void;
const editorReady = new Promise<void>((r) => (resolveEditor = r));

const py = new PyClient(
  {
    progress(value, label) {
      if (!booted) splash.progress(value, label);
      else if (value === 0) {
        runBtn.setLoading();
        $('py-version').textContent = label + '…';
      }
    },
    ready(version) {
      pyReady = true;
      $('py-version').textContent = version;
      runBtn.setReady();
      void editorReady.then(() => {
        scheduleLint(0);
        if (!booted) {
          booted = true;
          void splash.dismiss().then(() => {
            app.inert = false;
            editor.focus();
            preloadWhenIdle();
          });
        }
      });
    },
    bootError(message) {
      if (!booted) {
        splash.error(
          navigator.onLine
            ? `PyPal couldn't download Python. Check your internet connection, then reload. (Details: ${message})`
            : "You're offline and Python hasn't been downloaded yet. Connect once and reload; after that PyPal works offline too.",
        );
      }
      else term.status(`Python stopped: ${message}`, 'bad');
    },
    output: (stream, text, dropped) => term.write(stream, text, dropped),
    inputRequest(prompt) {
      announce(prompt ? `The program asks: ${prompt}. Type your answer and press Enter.` : 'The program is waiting for your input. Type it and press Enter.');
      void term.readLine(prompt).then((answer) => {
        if (answer === null) {
          if (py.isRunning) stopCode();
        } else {
          py.sendInput(answer);
        }
      });
    },
    packages(state, label) {
      progress.hidden = progressLabel.hidden = state === 'end';
      progressLabel.textContent = state === 'start' ? 'Checking which packages your program needs…' : label;
    },
  },
  BASE,
);
const runBtn = new RunButton($('run') as HTMLButtonElement, { run: () => runCode(), stop: () => stopCode(), isRunning: () => py.isRunning, isReady: () => py.isReady });

/** Warm the lazy chunks once the page is idle, so Fix, the palette and dialogs open instantly. */
function preloadWhenIdle() {
  const run = () => {
    void import('./app/fixFeature');
    void import('./ui/palette');
    void import('./ui/shortcuts');
    void import('./ui/settings');
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 2000);
}

/* ============================ the editor (loads in parallel) ============================ */

/**
 * A share link (#c=...) wins over the saved code, but the student's own code is kept so it can be
 * restored. Returns the shared code (if the link was good) and a toast to show once the editor exists.
 */
async function readShareLink(current: string | null): Promise<{ code: string | null; notice: () => void } | null> {
  const payload = shareHashPayload(location.hash);
  if (payload === null) return null;
  const r = await decodeShare(payload);
  history.replaceState(null, '', location.pathname + location.search); // so a reload does not re-apply it
  if (!r.ok) return { code: null, notice: () => toast(`${r.reason} Your own code is untouched.`, { timeout: 7000 }) };
  if (current && current !== r.code) {
    try { localStorage.setItem(PREVIOUS_KEY, current); } catch { /* storage off */ }
  }
  const restore = current && current !== r.code ? { action: { label: 'Restore mine', run: () => editor.replaceDoc(current) }, timeout: 12000 } : {};
  return { code: r.code, notice: () => toast('Opened the code from the link.', restore) };
}

async function start() {
  let initial = loadSaved() ?? DEFAULT_CODE;
  const shared = await readShareLink(loadSaved());
  if (shared?.code != null) initial = shared.code;
  const sharedNotice = shared?.notice ?? null;

  const { createEditor } = await import('./editor/editor');
  let saveTimer = 0;
  toolbar = new SelectionToolbar($('editor'), () => editor.view, () => void runFix(true));
  editor = createEditor({
    parent: $('editor'),
    doc: initial,
    onChange(code) {
      saveState.textContent = 'Saving…';
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        saveState.textContent = save(code) ? 'Saved' : 'Not saved (storage is off)';
      }, 350);
      runDiag = null;
      updateFixButton();
      scheduleLint();
    },
    onRun: () => runCode(),
    onStop: () => stopCode(),
    onFix: () => void runFix(true),
    onNote: announce,
    extensions: [
      (await import('@codemirror/view')).EditorView.updateListener.of((u) => {
        if (u.selectionSet || u.docChanged || u.focusChanged) toolbar.update();
        // editing the file by hand makes an open fix preview stale
        if (u.docChanged && fix?.sheet.open && !u.transactions.some((t) => t.isUserEvent('input.fix'))) fix.sheet.close(false);
      }),
      (await import('@codemirror/view')).EditorView.domEventHandlers({ scroll: () => toolbar.update() }),
    ],
  });
  $('editor').addEventListener('focusout', () => window.setTimeout(() => !editor.view.hasFocus && toolbar.hide(), 0));
  if (initial !== loadSaved()) save(initial);
  initDragAndDrop();
  // pasting a share link into a tab that is already open only changes the hash
  window.addEventListener('hashchange', async () => {
    const s = await readShareLink(editor.getCode());
    if (!s) return;
    if (s.code != null) editor.replaceDoc(s.code);
    s.notice();
  });
  resolveEditor();
  sharedNotice?.();
  Object.assign(window, { __pypal: { editor, term, py } });
}

/* ============================ problems: squiggles, Fix button ============================ */

function updateFixButton() {
  const show = Boolean(syntaxDiag || runDiag);
  const was = fixBtn.dataset.visible === 'true';
  fixBtn.dataset.visible = String(show);
  fixBtn.tabIndex = show ? 0 : -1;
  fixBtn.setAttribute('aria-hidden', String(!show));
  if (show) void getFix().then((f) => f.warmUp()); // load the engine and boot the checker in the background
  if (show && !was) announce('PyPal found a problem in your code. A Fix all errors button is available.');
}

/** Where to underline: Python's own range for syntax problems, the whole line for runtime ones. */
function toMark(d: Diag): DiagMark {
  const code = editor.getCode();
  const f = explain(d);
  const line = d.lineno ?? 1;
  let from: number;
  let to: number;
  if (d.kind === 'syntax' && d.offset) {
    from = editor.offsetAt(line, d.offset);
    to = d.endLineno && d.endOffset ? editor.offsetAt(d.endLineno, d.endOffset) : editor.lineEnd(line);
    if (to <= from) to = Math.min(editor.lineEnd(line), from + 1);
    if (to <= from) from = Math.max(0, from - 1);
  } else {
    const start = editor.offsetAt(line, 1);
    const text = code.slice(start, editor.lineEnd(line));
    from = start + (text.length - text.trimStart().length);
    to = editor.lineEnd(line);
  }
  return { from, to, title: f.title, what: f.what, hint: f.hint };
}

let lintTimer = 0;
const scheduleLint = (delay = 450) => {
  window.clearTimeout(lintTimer);
  lintTimer = window.setTimeout(runLint, delay);
};

async function runLint() {
  if (!editor || !pyReady) return;
  const code = editor.getCode();
  const d = await py.check(code);
  if (d === undefined) return; // Python is busy; the next change or run retries
  if (editor.getCode() !== code) return;
  const changed = (d?.message ?? '') !== (syntaxDiag?.message ?? '') || d?.lineno !== syntaxDiag?.lineno;
  syntaxDiag = d;
  editor.setDiagnostics('syntax', d ? [toMark(d)] : [], Boolean(d) && changed);
  updateFixButton();
}

/* ============================ fixing (engine loads on demand) ============================ */

let fixPromise: Promise<FixFeature> | null = null;
function getFix(): Promise<FixFeature> {
  fixPromise ??= import('./app/fixFeature').then((m) => {
    fix = m.createFixFeature({
      editor,
      sheetRoot,
      base: BASE,
      onSheetClose: () => (toolbar.disabled = false),
      setBusy: setFixBusy,
    });
    return fix;
  });
  return fixPromise;
}

function setFixBusy(busy: boolean) {
  fixBtn.classList.toggle('is-busy', busy);
  fixBtn.disabled = busy;
  fixBtn.querySelector('.btn-fix-label')!.textContent = busy ? 'Checking…' : 'Fix all errors';
  toolbar.disabled = busy || Boolean(fix?.sheet.open);
  if (busy) toolbar.hide();
}

async function runFix(useSelection: boolean) {
  if (!editor) return;
  setFixBusy(true);
  try {
    const f = await getFix();
    await (useSelection ? f.controller.fixSelection() : f.controller.fixAll());
  } finally {
    setFixBusy(false);
  }
}
fixBtn.addEventListener('click', () => void runFix(false));

/* ============================ running ============================ */

const decimals = (ms: number) => (ms < 100 ? 3 : ms < 1000 ? 2 : 1);

async function runCode() {
  if (!editor || py.isRunning || !py.isReady) return;
  fix?.sheet.close(false);
  runDiag = null;
  editor.setDiagnostics('run', [], false);
  term.clear();
  runBtn.start();
  const t0 = performance.now();
  let result: RunResult;
  try {
    result = await py.run(editor.getCode());
  } catch (e) {
    term.status(String(e), 'bad');
    runBtn.finish('error');
    return;
  }
  term.cancelInput();
  progress.hidden = progressLabel.hidden = true;
  const secs = ((performance.now() - t0) / 1000).toFixed(decimals(performance.now() - t0));
  if (result.stopped) {
    term.status('Stopped.');
    runBtn.finish('stopped');
    announce('Program stopped.');
  } else if (result.error) {
    showError(result.error);
    runBtn.finish('error');
  } else {
    term.status(`Finished in ${secs}s`, 'ok');
    runBtn.finish('success');
    announce(`Program finished in ${secs} seconds. ${term.summary()}`);
  }
}

/** A traceback becomes a card; the line is marked in the editor and the squiggle draws in. */
function showError(err: Diag) {
  const f = explain(err);
  term.addCard(createErrorCard({ type: err.type, friendly: f, traceback: err.traceback, onJump: (l) => editor.jumpToLine(l) }));
  const mark = toMark(err);
  if (err.kind === 'syntax') {
    syntaxDiag = err;
    editor.setDiagnostics('syntax', [mark], true);
  } else {
    runDiag = err;
    editor.setDiagnostics('run', [mark], true);
  }
  updateFixButton();
  announce(`${f.title}${f.line ? `, on line ${f.line}` : ''}. ${f.hint}`);
  if (err.lineno) {
    void import('@codemirror/view').then(({ EditorView }) =>
      editor.view.dispatch({ effects: EditorView.scrollIntoView(editor.offsetAt(err.lineno!, 1), { y: 'nearest', yMargin: 48 }) }),
    );
  }
}

function stopCode() {
  if (!py.isRunning) return;
  term.cancelInput();
  py.stop();
}

/* ============================ examples, files, sharing ============================ */

function loadText(text: string, message: string) {
  editor.replaceDoc(text);
  editor.focus();
  announce(message);
  toast(message, { action: { label: 'Undo', run: () => editor.undo() }, timeout: 7000 });
}

function loadExample(e: Example) {
  if (editor.getCode() === e.code) return toast(`“${e.title}” is already open.`);
  loadText(e.code, `Loaded “${e.title}”.`);
}

async function openFile(file: File) {
  const r = await readFile(file);
  if (!r.ok) return toast(r.reason, { timeout: 7000 });
  loadText(r.text, `Opened ${r.name}.`);
}

const fileInput = $('file-input') as HTMLInputElement;
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (f) void openFile(f);
});

function initDragAndDrop() {
  const host = $('editor');
  let depth = 0;
  const hasFile = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  host.addEventListener('dragenter', (e) => {
    if (!hasFile(e)) return;
    depth++;
    host.classList.add('drop-target');
  });
  host.addEventListener('dragover', (e) => {
    if (hasFile(e)) e.preventDefault();
  });
  host.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) host.classList.remove('drop-target');
  });
  host.addEventListener('drop', (e) => {
    if (!hasFile(e)) return;
    e.preventDefault();
    depth = 0;
    host.classList.remove('drop-target');
    const f = e.dataTransfer?.files?.[0];
    if (f) void openFile(f);
  });
}

function download() {
  downloadPy(editor.getCode());
  announce('Downloaded main.py.');
  toast('Downloaded main.py');
}

async function shareLink() {
  const hash = await encodeShare(editor.getCode());
  const url = `${location.origin}${location.pathname}${hash}`;
  const long = url.length > 8000;
  try {
    await navigator.clipboard.writeText(url);
    announce('Share link copied.');
    toast(long ? 'Link copied. It is long, so some apps may cut it off.' : 'Link copied. Anyone with it can open this code.', { timeout: 5000 });
  } catch {
    (await import('./ui/shareDialog')).showShareLink(url, long);
  }
}

/* ============================ install, offline ============================ */

type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
let installEvent: InstallEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e as InstallEvent;
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  toast('PyPal is installed.');
});
async function installApp() {
  if (!installEvent) return;
  const ev = installEvent;
  installEvent = null;
  await ev.prompt();
}

const netChip = $('net-chip');
const syncNet = () => {
  netChip.hidden = navigator.onLine;
  if (!navigator.onLine) announce('You are offline. PyPal still works.');
};
window.addEventListener('online', syncNet);
window.addEventListener('offline', syncNet);
syncNet();

/* ============================ settings, shortcuts, palette (lazy) ============================ */

let settingsApi: { open(): void } | null = null;
async function openSettings() {
  if (!settingsApi) {
    const { initSettings } = await import('./ui/settings');
    settingsApi = initSettings($('settings') as HTMLDialogElement, $('open-settings'), () => {});
  }
  settingsApi.open();
}
$('open-settings').addEventListener('click', () => void openSettings());
const openShortcutsDialog = async () => (await import('./ui/shortcuts')).openShortcuts();
$('open-shortcuts').addEventListener('click', () => void openShortcutsDialog());

const commands = (): Command[] => [
  { id: 'run', title: 'Run the program', group: 'Run', keys: 'Mod-Enter', keywords: 'start execute play', run: () => runCode() },
  { id: 'stop', title: 'Stop the program', group: 'Run', keys: 'Mod-.', keywords: 'halt cancel', enabled: () => py.isRunning, run: () => stopCode() },
  { id: 'fix', title: 'Fix all errors', group: 'Fix', keys: 'Mod-Shift-Enter', keywords: 'repair mistakes', run: () => runFix(false) },
  { id: 'fix-sel', title: 'Fix errors in the selected lines', group: 'Fix', keys: 'Mod-Shift-Enter', enabled: () => Boolean(editor?.selectedLines()), run: () => runFix(true) },
  { id: 'open', title: 'Open a .py file…', group: 'File', keywords: 'upload import', run: () => fileInput.click() },
  { id: 'download', title: 'Download main.py', group: 'File', keys: 'Mod-S', keywords: 'save export', run: download },
  { id: 'share', title: 'Copy share link', group: 'File', keywords: 'url send', run: shareLink },
  ...EXAMPLES.map<Command>((e) => ({ id: `ex-${e.id}`, title: `Load example: ${e.title}`, group: 'Examples', hint: e.blurb, run: () => loadExample(e) })),
  { id: 'theme', title: effectiveTheme() === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme', group: 'View', keywords: 'dark light mode', run: () => $('theme').click() },
  { id: 'clear', title: 'Clear the terminal', group: 'View', run: () => term.clear() },
  { id: 'settings', title: 'Settings (AI key)', group: 'Help', keywords: 'api key ai', run: () => openSettings() },
  { id: 'shortcuts', title: 'Keyboard shortcuts', group: 'Help', keys: '?', run: openShortcutsDialog },
  { id: 'install', title: 'Install PyPal as an app', group: 'Help', enabled: () => installEvent !== null, run: installApp },
];
const openPalette = async () => (await import('./ui/palette')).openPalette(commands);

const examplesMenu = (): MenuItem[] => EXAMPLES.map((e) => ({ id: e.id, label: e.title, hint: e.blurb, run: () => loadExample(e) }));
const fileMenu = (): MenuItem[] => [
  { id: 'open', label: 'Open .py file…', run: () => fileInput.click() },
  { id: 'download', label: 'Download main.py', keys: 'Mod-S', run: download },
  { id: 'share', label: 'Copy share link', run: () => void shareLink() },
  ...(installEvent ? [{ id: 'install', label: 'Install PyPal as an app', separator: true, run: () => void installApp() }] : []),
];
new Menu($('menu-examples'), examplesMenu, 'end');
new Menu($('menu-file'), fileMenu, 'end');

/* ============================ keyboard ============================ */

const typingTarget = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest('input, textarea, select, [contenteditable="true"], .cm-editor'));
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && e.shiftKey && e.key === 'Enter') {
    e.preventDefault();
    void runFix(true);
  } else if (mod && e.key === 'Enter') {
    e.preventDefault();
    void runCode();
  } else if (mod && e.key === '.') {
    e.preventDefault();
    stopCode();
  } else if (mod && k === 'k') {
    e.preventDefault();
    void openPalette();
  } else if (mod && k === 's') {
    e.preventDefault();
    if (editor) download();
  } else if (e.key === '?' && !mod && !typingTarget(e.target)) {
    e.preventDefault();
    void openShortcutsDialog();
  }
});
$('clear').addEventListener('click', () => term.clear());

// Safety net: if Python is slow to load, say so.
window.setTimeout(() => {
  if (!booted && !pyReady) $('splash-text').textContent = 'Still downloading Python…';
}, 8000);

void start();
