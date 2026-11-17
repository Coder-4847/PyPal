import type { Diag } from '../fix/types';
import {
  INPUT_BUFFER_BYTES,
  INPUT_CANCEL,
  INPUT_HEADER_BYTES,
  INPUT_READY,
  SIGINT,
  type FromWorker,
  type RunError,
  type ToWorker,
} from './protocol';

export interface RunResult {
  ok: boolean;
  stopped: boolean;
  error: RunError | null;
}

export interface PyEvents {
  progress(value: number, label: string): void;
  ready(version: string): void;
  bootError(message: string): void;
  output(stream: 'out' | 'err', text: string, dropped: boolean): void;
  inputRequest(prompt: string): void;
  packages(state: 'start' | 'progress' | 'end', label: string): void;
}

/** How long Stop waits for Python to notice an interrupt before restarting the worker. */
const STOP_GRACE_MS = 1500;

/**
 * Owns the Python worker. Run streams output through the callbacks; Stop sends
 * an interrupt (SharedArrayBuffer) and, if Python does not react in time or
 * isolation is unavailable, terminates and restarts the worker.
 */
export class PyClient {
  readonly canInterrupt: boolean;
  private worker!: Worker;
  private interrupt: Uint8Array | null = null;
  private inputCtl: Int32Array | null = null;
  private inputData: Uint8Array | null = null;
  private inputSab: SharedArrayBuffer | null = null;
  private interruptSab: SharedArrayBuffer | null = null;

  private ready = false;
  private readyWaiters: Array<() => void> = [];
  private current: { id: number; resolve: (r: RunResult) => void } | null = null;
  private nextId = 1;
  private stopTimer: number | undefined;
  private analyzeWaiters = new Map<number, (d: Diag | null) => void>();
  private analyzeId = 0;

  constructor(private events: PyEvents, private base: string) {
    this.canInterrupt = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true;
    if (this.canInterrupt) {
      this.interruptSab = new SharedArrayBuffer(4);
      this.interrupt = new Uint8Array(this.interruptSab);
      this.inputSab = new SharedArrayBuffer(INPUT_HEADER_BYTES + INPUT_BUFFER_BYTES);
      this.inputCtl = new Int32Array(this.inputSab, 0, 2);
      this.inputData = new Uint8Array(this.inputSab, INPUT_HEADER_BYTES);
    }
    this.spawn();
  }

  get isReady() {
    return this.ready;
  }
  get isRunning() {
    return this.current !== null;
  }

  private spawn() {
    this.ready = false;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => {
      ev.preventDefault();
      if (!this.ready) {
        this.events.bootError(ev.message || 'Python could not start.');
        return;
      }
      // The worker died mid-run (for example out of memory): report it, start a fresh one.
      this.finish({ ok: false, stopped: false, error: crashError(ev.message) });
      this.worker.terminate();
      this.events.progress(0, 'Restarting Python');
      this.spawn();
    };
    if (this.interrupt) this.interrupt[0] = 0;
    this.post({ type: 'init', mode: 'main', base: this.base, interruptBuffer: this.interruptSab, inputBuffer: this.inputSab });
  }

  private post(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  private onMessage(msg: FromWorker) {
    switch (msg.type) {
      case 'progress':
        this.events.progress(msg.value, msg.label);
        break;
      case 'ready':
        this.ready = true;
        this.events.progress(1, 'Ready');
        this.events.ready(msg.version);
        this.readyWaiters.splice(0).forEach((f) => f());
        break;
      case 'boot-error':
        this.events.bootError(msg.message);
        break;
      case 'out':
        this.events.output(msg.stream, msg.text, msg.dropped === true);
        break;
      case 'input-request':
        this.events.inputRequest(msg.prompt);
        break;
      case 'packages':
        this.events.packages(msg.state, msg.label);
        break;
      case 'analyze-result':
        this.analyzeWaiters.get(msg.id)?.(msg.diag);
        this.analyzeWaiters.delete(msg.id);
        break;
      case 'done':
        if (this.current && this.current.id === msg.id) {
          this.finish({ ok: msg.ok, stopped: msg.stopped, error: msg.error });
        }
        if (msg.fatal) {
          // that Python is broken for good: replace it
          this.worker.terminate();
          this.events.progress(0, 'Restarting Python');
          this.spawn();
        }
        break;
    }
  }

  private finish(result: RunResult) {
    window.clearTimeout(this.stopTimer);
    const cur = this.current;
    this.current = null;
    cur?.resolve(result);
  }

  /**
   * Live syntax check using Python's own compiler. Resolves undefined when it cannot
   * check right now (Python still starting, or a program is running).
   */
  check(code: string): Promise<Diag | null | undefined> {
    if (!this.ready || this.current) return Promise.resolve(undefined);
    const id = ++this.analyzeId;
    return new Promise((resolve) => {
      this.analyzeWaiters.set(id, resolve);
      this.post({ type: 'analyze', id, code, run: false });
    });
  }

  whenReady(): Promise<void> {
    return this.ready ? Promise.resolve() : new Promise((r) => this.readyWaiters.push(r));
  }

  async run(code: string): Promise<RunResult> {
    if (this.current) throw new Error('Already running');
    const id = this.nextId++;
    const done = new Promise<RunResult>((resolve) => {
      this.current = { id, resolve };
    });
    await this.whenReady();
    const cur = this.current as { id: number } | null; // may have been cleared while we waited
    if (!cur || cur.id !== id) return done; // stopped while loading
    this.post({ type: 'run', id, code });
    return done;
  }

  /** Answer a pending input() request. */
  sendInput(text: string) {
    if (!this.inputCtl || !this.inputData) return;
    const bytes = new TextEncoder().encode(text);
    const len = Math.min(bytes.length, this.inputData.length);
    this.inputData.set(bytes.subarray(0, len));
    this.inputCtl[1] = len;
    Atomics.store(this.inputCtl, 0, INPUT_READY);
    Atomics.notify(this.inputCtl, 0);
  }

  cancelInput() {
    if (!this.inputCtl) return;
    Atomics.store(this.inputCtl, 0, INPUT_CANCEL);
    Atomics.notify(this.inputCtl, 0);
  }

  /** Stop the running program. Never freezes the page. */
  stop() {
    if (!this.current) return;
    if (this.interrupt && this.ready) {
      this.interrupt[0] = SIGINT;
      this.cancelInput();
      window.clearTimeout(this.stopTimer);
      this.stopTimer = window.setTimeout(() => this.restart(), STOP_GRACE_MS);
    } else {
      this.restart();
    }
  }

  /** Terminate the worker and start a fresh one. Used when Stop cannot interrupt. */
  restart() {
    this.worker.terminate();
    this.events.progress(0, 'Restarting Python');
    this.spawn();
    this.finish({ ok: false, stopped: true, error: null });
  }
}

function crashError(message: string): RunError {
  return {
    kind: 'runtime',
    suggestion: null,
    type: 'WorkerCrash',
    message: message || 'The Python worker stopped unexpectedly.',
    lineno: null, offset: null, endLineno: null, endOffset: null, text: null,
    traceback: message || '',
  };
}
