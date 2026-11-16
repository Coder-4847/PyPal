import './styles/tokens.css';
import './styles/base.css';
import { createEditor } from './editor/editor';
import { PyClient, type RunResult } from './py/client';
import { RunButton } from './ui/runButton';
import { initSplit } from './ui/split';
import { Splash } from './ui/splash';
import { Terminal } from './ui/terminal';
import { initTheme } from './ui/theme';
import { loadSaved, save } from './storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const DEFAULT_CODE = `# Welcome to PyPal. Press Run (or Ctrl+Enter) to try it.
name = input("What's your name? ")
print("Hello,", name + "!")

for i in range(1, 4):
    print("Counting:", i)
`;

const app = $('app');
app.inert = true; // nothing underneath the intro can take focus
const splash = new Splash();
const term = new Terminal($('term'));
const saveState = $('save-state');

initTheme($('theme'));
initSplit($('workspace'), $('divider'));

/* ---------- editor + autosave ---------- */
let saveTimer = 0;
const editor = createEditor({
  parent: $('editor'),
  doc: loadSaved() ?? DEFAULT_CODE,
  onChange(code) {
    saveState.textContent = 'Saving…';
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveState.textContent = save(code) ? 'Saved' : 'Not saved (storage is off)';
    }, 350);
  },
  onRun: () => runCode(),
  onStop: () => stopCode(),
});

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
  import.meta.env.BASE_URL,
);

const runBtn = new RunButton($('run') as HTMLButtonElement, { run: () => runCode(), stop: () => stopCode() });

const decimals = (ms: number) => (ms < 100 ? 3 : ms < 1000 ? 2 : 1);

async function runCode() {
  if (py.isRunning || !py.isReady) return;
  editor.markError(null);
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
    showError(result);
    runBtn.finish('error');
  } else {
    term.status(`Finished in ${secs}s`, 'ok');
    runBtn.finish('success');
  }
}

/** Phase 1: the raw traceback in the terminal and the error line marked. Friendly cards come next. */
function showError(result: RunResult) {
  const err = result.error!;
  term.write('err', err.traceback.endsWith('\n') ? err.traceback : err.traceback + '\n');
  term.flushNow();
  term.status('Stopped because of an error.', 'bad');
  if (err.lineno) editor.markError(err.lineno);
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
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    runCode();
  } else if (mod && e.key === '.') {
    e.preventDefault();
    stopCode();
  }
});

// Safety net: if Python is slow to load, show the editor anyway after a while.
window.setTimeout(() => {
  if (!booted && !py.isReady) {
    $('splash-text').textContent = 'Still downloading Python…';
  }
}, 8000);

// Handy for tests and curious people.
Object.assign(window, { __pypal: { editor, term, py } });
