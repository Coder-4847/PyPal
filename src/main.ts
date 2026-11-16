import './styles/tokens.css';
import './styles/base.css';
import './styles/fix.css';
import { FixController } from './app/fixFlow';
import { createEditor, type DiagMark } from './editor/editor';
import { explain } from './errors/explain';
import { loadAiSettings } from './fix/ai';
import type { Diag } from './fix/types';
import { PyClient, type RunResult } from './py/client';
import { SandboxClient } from './py/sandbox';
import { announce } from './ui/announce';
import { createErrorCard } from './ui/errorCard';
import { FixSheet } from './ui/fixSheet';
import { RunButton } from './ui/runButton';
import { SelectionToolbar } from './ui/selectionToolbar';
import { initSettings } from './ui/settings';
import { initSplit } from './ui/split';
import { Splash } from './ui/splash';
import { Terminal } from './ui/terminal';
import { initTheme } from './ui/theme';
import { loadSaved, save } from './storage';
import { EditorView } from '@codemirror/view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const DEFAULT_CODE = `# Welcome to PyPal. Press Run (or Ctrl+Enter) to try it.
name = input("What's your name? ")
print("Hello,", name + "!")

for i in range(1, 4):
    print("Counting:", i)
`;

const BASE = import.meta.env.BASE_URL;
const app = $('app');
app.inert = true; // nothing underneath the intro can take focus
const splash = new Splash();
const term = new Terminal($('term'));
const saveState = $('save-state');

initTheme($('theme'));
initSplit($('workspace'), $('divider'));

/* ---------- problems: what Python says is wrong right now ---------- */

let syntaxDiag: Diag | null = null; // from the live check
let runDiag: Diag | null = null; // from the last run, cleared when the code changes
const sandbox = new SandboxClient(BASE);
const fixBtn = $('fix-all') as HTMLButtonElement;

function updateFixButton() {
  const show = Boolean(syntaxDiag || runDiag);
  const was = fixBtn.dataset.visible === 'true';
  fixBtn.dataset.visible = String(show);
  fixBtn.tabIndex = show ? 0 : -1;
  fixBtn.setAttribute('aria-hidden', String(!show));
  if (show) sandbox.warmUp(); // boot the checker in the background so Fix is quick
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

/* ---------- editor + autosave + live syntax check ---------- */

let saveTimer = 0;
let lintTimer = 0;
const scheduleLint = (delay = 450) => {
  window.clearTimeout(lintTimer);
  lintTimer = window.setTimeout(runLint, delay);
};

async function runLint() {
  const code = editor.getCode();
  const d = await py.check(code);
  if (d === undefined) return; // Python is busy or still starting; the next change or run retries
  if (editor.getCode() !== code) return;
  const changed = (d?.message ?? '') !== (syntaxDiag?.message ?? '') || d?.lineno !== syntaxDiag?.lineno;
  syntaxDiag = d;
  editor.setDiagnostics('syntax', d ? [toMark(d)] : [], Boolean(d) && changed);
  updateFixButton();
}

const sheetRoot = $('fix-sheet');
const toolbar = new SelectionToolbar($('editor'), () => editor.view, () => void fixes.fixSelection());
const editor = createEditor({
  parent: $('editor'),
  doc: loadSaved() ?? DEFAULT_CODE,
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
  onFix: () => void fixes.fixSelection(),
  extensions: [
    EditorView.updateListener.of((u) => {
      if (u.selectionSet || u.docChanged || u.focusChanged) toolbar.update();
      // editing the file by hand makes an open fix preview stale
      if (u.docChanged && sheet.open && !u.transactions.some((t) => t.isUserEvent('input.fix'))) sheet.close(false);
    }),
    EditorView.domEventHandlers({ scroll: () => toolbar.update() }),
  ],
});
$('editor').addEventListener('focusout', () => window.setTimeout(() => !editor.view.hasFocus && toolbar.hide(), 0));

const sheet = new FixSheet({ root: sheetRoot, editor, onClose: () => (toolbar.disabled = false) });
const fixes = new FixController({
  editor,
  env: sandbox,
  sheet,
  getAi: loadAiSettings,
  setBusy(busy) {
    fixBtn.classList.toggle('is-busy', busy);
    fixBtn.disabled = busy;
    fixBtn.querySelector('.btn-fix-label')!.textContent = busy ? 'Checking…' : 'Fix all errors';
    toolbar.disabled = busy || sheet.open;
    if (busy) toolbar.hide();
  },
});
fixBtn.addEventListener('click', () => void fixes.fixAll());
initSettings($('settings') as HTMLDialogElement, $('open-settings'), () => {});

/* ---------- Python ---------- */

const progress = $('progress');
const progressLabel = $('progress-label');
let booted = false;

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
      $('py-version').textContent = version;
      runBtn.setReady();
      scheduleLint(0);
      if (!booted) {
        booted = true;
        void splash.dismiss().then(() => {
          app.inert = false;
          editor.focus();
        });
      }
    },
    bootError(message) {
      if (!booted) splash.error(message);
      else term.status(`Python stopped: ${message}`, 'bad');
    },
    output: (stream, text, dropped) => term.write(stream, text, dropped),
    inputRequest(prompt) {
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

const runBtn = new RunButton($('run') as HTMLButtonElement, { run: () => runCode(), stop: () => stopCode() });

const decimals = (ms: number) => (ms < 100 ? 3 : ms < 1000 ? 2 : 1);

async function runCode() {
  if (py.isRunning || !py.isReady) return;
  sheet.close(false);
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
  } else if (result.error) {
    showError(result.error);
    runBtn.finish('error');
  } else {
    term.status(`Finished in ${secs}s`, 'ok');
    runBtn.finish('success');
  }
}

/** A traceback becomes a card; the line is marked in the editor and the squiggle draws in. */
function showError(err: Diag) {
  const f = explain(err);
  const card = createErrorCard({ type: err.type, friendly: f, traceback: err.traceback, onJump: (l) => editor.jumpToLine(l) });
  term.addCard(card);
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
  if (err.lineno) editor.view.dispatch({ effects: EditorView.scrollIntoView(editor.offsetAt(err.lineno, 1), { y: 'nearest', yMargin: 48 }) });
}

function stopCode() {
  if (!py.isRunning) return;
  term.cancelInput();
  py.stop();
}

/* ---------- controls ---------- */
$('clear').addEventListener('click', () => term.clear());
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && e.key === 'Enter') {
    e.preventDefault();
    void fixes.fixSelection();
  } else if (mod && e.key === 'Enter') {
    e.preventDefault();
    runCode();
  } else if (mod && e.key === '.') {
    e.preventDefault();
    stopCode();
  }
});

// Safety net: if Python is slow to load, say so.
window.setTimeout(() => {
  if (!booted && !py.isReady) $('splash-text').textContent = 'Still downloading Python…';
}, 8000);

// Handy for tests and curious people.
Object.assign(window, { __pypal: { editor, term, py, sandbox } });
