/// <reference lib="webworker" />
import diagnose from './diagnose.py?raw';
import harness from './harness.py?raw';
import {
  INPUT_CANCEL,
  INPUT_HEADER_BYTES,
  INPUT_IDLE,
  INPUT_READY,
  SIGINT,
  type FromWorker,
  type RunError,
  type ToWorker,
} from './protocol';

declare const self: DedicatedWorkerGlobalScope;

/* Pyodide is pinned (see package.json) and served from our own origin, with
 * packages such as numpy fetched from the matching jsDelivr release. */
const PYODIDE_VERSION = '0.29.5';
const PACKAGE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pyodide = any;

let pyodide: Pyodide;
let mode: 'main' | 'sandbox' = 'main';
let interrupt: Uint8Array | null = null;
let inputCtl: Int32Array | null = null;
let inputBytes: Uint8Array | null = null;
let inputSab: SharedArrayBuffer | null = null;

const post = (msg: FromWorker) => self.postMessage(msg);

/* ---------- output: batched and capped, so a print-heavy loop cannot flood the page ---------- */
const FLUSH_EVERY_MS = 50;
const MAX_PENDING = 512 * 1024; // characters held between flushes
const KEEP_PENDING = 128 * 1024; // what survives when the cap is hit (the newest output)
const decoders = { out: new TextDecoder(), err: new TextDecoder() };
const pending = { out: '', err: '' };
let dropped = false;
let lastFlush = 0;

function flush() {
  for (const stream of ['out', 'err'] as const) {
    if (pending[stream]) {
      post({ type: 'out', stream, text: pending[stream], dropped });
      pending[stream] = '';
      dropped = false;
    }
  }
  lastFlush = performance.now();
}

function sink(stream: 'out' | 'err') {
  return {
    write(buf: Uint8Array) {
      let text = pending[stream] + decoders[stream].decode(buf, { stream: true });
      if (text.length > MAX_PENDING) {
        text = text.slice(-KEEP_PENDING);
        dropped = true;
      }
      pending[stream] = text;
      if (performance.now() - lastFlush > FLUSH_EVERY_MS) flush();
      return buf.length;
    },
  };
}

/* ---------- loading with real progress ---------- */
async function prefetchCore(base: string): Promise<string> {
  const root = new URL(`${base}pyodide/`, self.location.origin).href;
  const manifest = (await (await fetch(`${root}manifest.json`)).json()) as { sizes: Record<string, number> };
  const files = Object.keys(manifest.sizes).filter((f) => !f.endsWith('.mjs'));
  const total = files.reduce((n, f) => n + manifest.sizes[f], 0);
  let got = 0;
  // Download in parallel; the browser cache then serves the same bytes to loadPyodide.
  await Promise.all(
    files.map(async (f) => {
      const res = await fetch(root + f, { cache: 'force-cache' });
      if (!res.ok || !res.body) throw new Error(`Could not download ${f} (${res.status})`);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.byteLength;
        post({ type: 'progress', value: Math.min(0.9, (got / total) * 0.9), label: 'Downloading Python' });
      }
    }),
  );
  return root;
}

async function boot(base: string) {
  const root = await prefetchCore(base);
  post({ type: 'progress', value: 0.9, label: 'Starting Python' });
  const mod = await import(/* @vite-ignore */ `${root}pyodide.mjs`);
  pyodide = await mod.loadPyodide({ indexURL: root, packageBaseUrl: PACKAGE_CDN });
  post({ type: 'progress', value: 0.97, label: 'Starting Python' });

  pyodide.runPython(diagnose);
  if (mode === 'sandbox') {
    // The sandbox only test-runs code for the fix engine: output is thrown away.
    pyodide.setStdout({ write: (b: Uint8Array) => b.length });
    pyodide.setStderr({ write: (b: Uint8Array) => b.length });
    return;
  }
  pyodide.setStdout(sink('out'));
  pyodide.setStderr(sink('err'));
  if (interrupt) pyodide.setInterruptBuffer(interrupt);

  pyodide.registerJsModule('pypal_bridge', { read_input: readInput, sleep });
  pyodide.runPython(harness);
}

/* ---------- input() and sleep(): block on shared memory ---------- */
function readInput(prompt: string): string | null {
  flush();
  if (!inputCtl || !inputBytes || !inputSab) {
    throw new Error(
      "input() needs this page to be cross-origin isolated. Reload the page once and try again.",
    );
  }
  Atomics.store(inputCtl, 0, INPUT_IDLE);
  post({ type: 'input-request', prompt });
  Atomics.wait(inputCtl, 0, INPUT_IDLE);
  const state = Atomics.load(inputCtl, 0);
  const len = inputCtl[1];
  Atomics.store(inputCtl, 0, INPUT_IDLE);
  if (state === INPUT_CANCEL) return null;
  if (state !== INPUT_READY) return null;
  // TextDecoder refuses SharedArrayBuffer views, so copy first.
  return new TextDecoder().decode(inputBytes.slice(0, len));
}

const napBuf = new Int32Array(new SharedArrayBuffer(4));
/** Sleeps in short slices so Stop stays responsive. Returns true if interrupted. */
function sleep(seconds: number): boolean {
  flush();
  const end = performance.now() + seconds * 1000;
  for (;;) {
    if (interrupt && interrupt[0] === SIGINT) {
      interrupt[0] = 0; // consumed here: Python raises KeyboardInterrupt itself
      return true;
    }
    const left = end - performance.now();
    if (left <= 0) return false;
    Atomics.wait(napBuf, 0, 0, Math.min(left, 40));
  }
}

/* ---------- running code ---------- */
async function run(id: number, code: string) {
  try {
    if (interrupt) interrupt[0] = 0;
    pending.out = pending.err = '';
    dropped = false;

    // Load any packages the program imports (numpy and friends), then run.
    try {
      const names: string[] = pyodide.pyodide_py.code.find_imports(code).toJs();
      const missing = names.filter((n) => !isLoadedModule(n));
      if (missing.length) {
        post({ type: 'packages', state: 'start', label: 'Looking for packages' });
        await pyodide.loadPackagesFromImports(code, {
          messageCallback: (m: string) => post({ type: 'packages', state: 'progress', label: m }),
          errorCallback: (m: string) => post({ type: 'packages', state: 'progress', label: m }),
        });
        post({ type: 'packages', state: 'end', label: '' });
      }
    } catch (e) {
      post({ type: 'packages', state: 'end', label: '' });
      // A missing package is reported by Python itself as ModuleNotFoundError.
      void e;
    }

    const raw: string = pyodide.globals.get('run_user_code')(code);
    flush();
    const r = JSON.parse(raw) as { ok: boolean; stopped: boolean; error: RunError | null };
    post({ type: 'done', id, ...r });
  } catch (e) {
    flush();
    if (interrupt) interrupt[0] = 0;
    if (String(e instanceof Error ? e.message : e).includes('KeyboardInterrupt')) {
      // Stop landed while the harness itself was finishing: still just a stop.
      post({ type: 'done', id, ok: false, stopped: true, error: null });
      return;
    }
    // After some crashes (a WebAssembly stack overflow, running out of memory) this Python can no
    // longer run anything. Say so, so the page can start a fresh one.
    let fatal = false;
    try {
      pyodide.runPython('1');
    } catch {
      fatal = true;
    }
    const err: RunError = {
      kind: 'runtime',
      type: fatal ? 'PythonCrash' : 'InternalError',
      message: e instanceof Error ? e.message : String(e),
      lineno: null, offset: null, endLineno: null, endOffset: null, text: null, suggestion: null,
      traceback: e instanceof Error ? (e.stack ?? e.message) : String(e),
    };
    post({ type: 'done', id, ok: false, stopped: false, error: err, fatal });
  }
}

function isLoadedModule(name: string): boolean {
  try {
    return Boolean(pyodide.runPython(`import sys; ${JSON.stringify(name)} in sys.modules`));
  } catch {
    return false;
  }
}

/** Syntax check, plus (sandbox only) a test run with stubbed input() and a step limit. */
async function analyze(id: number, code: string, runIt: boolean) {
  try {
    if (runIt && mode === 'sandbox') {
      try {
        await pyodide.loadPackagesFromImports(code);
      } catch {
        /* a missing package shows up as ModuleNotFoundError when the code runs */
      }
    }
    const raw: string = pyodide.globals.get('analyze')(code, runIt && mode === 'sandbox');
    post({ type: 'analyze-result', id, diag: JSON.parse(raw) });
  } catch {
    post({ type: 'analyze-result', id, diag: null });
  }
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    mode = msg.mode;
    if (msg.interruptBuffer) interrupt = new Uint8Array(msg.interruptBuffer);
    if (msg.inputBuffer) {
      inputSab = msg.inputBuffer;
      inputCtl = new Int32Array(inputSab, 0, 2);
      inputBytes = new Uint8Array(inputSab, INPUT_HEADER_BYTES);
    }
    boot(msg.base).then(
      () => post({ type: 'ready', version: 'Python ' + String(pyodide.runPython('import sys; ".".join(map(str, sys.version_info[:3]))')) }),
      (e) => post({ type: 'boot-error', message: e instanceof Error ? e.message : String(e) }),
    );
  } else if (msg.type === 'run') {
    void run(msg.id, msg.code);
  } else if (msg.type === 'analyze') {
    void analyze(msg.id, msg.code, msg.run);
  } else if (msg.type === 'scope') {
    const r = JSON.parse(pyodide.globals.get('scope_names')(msg.code)) as { bound: string[]; builtins: string[] };
    post({ type: 'scope-result', id: msg.id, ...r });
  }
};
