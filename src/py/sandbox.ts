import type { Diag, FixEnv } from '../fix/types';
import type { FromWorker, ToWorker } from './protocol';

/** Wall-clock limit for one sandboxed test run. The step limit in Python normally ends it sooner. */
const RUN_TIMEOUT_MS = 8000;

/** null = the sandbox failed (boot error or crash); 'timeout' = the test run hit the wall-clock limit. */
type Reply = FromWorker | 'timeout' | null;

interface Job {
  msg: ToWorker;
  run: boolean;
  resolve: (v: Reply) => void;
}

/**
 * A second Python worker used only by the fix engine: it checks candidate fixes with
 * ast.parse/compile and test-runs them with a stubbed input() under a timeout, so a
 * student's own running program is never disturbed. Started lazily.
 */
export class SandboxClient implements FixEnv {
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private jobs: Job[] = [];
  private busy = false;
  private nextId = 1;
  private current: { id: number; resolve: (v: Reply) => void } | null = null;

  constructor(private base: string) {}

  /** Begin booting in the background (e.g. as soon as an error is detected). */
  warmUp() {
    void this.boot();
  }

  private boot(): Promise<boolean> {
    if (this.ready) return this.ready;
    this.ready = new Promise<boolean>((resolve) => {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker = w;
      w.onmessage = (ev: MessageEvent<FromWorker>) => {
        const m = ev.data;
        if (m.type === 'ready') resolve(true);
        else if (m.type === 'boot-error') resolve(false);
        else if ((m.type === 'analyze-result' || m.type === 'scope-result') && this.current && this.current.id === m.id) {
          const c = this.current;
          this.current = null;
          c.resolve(m);
        }
      };
      w.onerror = (e) => {
        e.preventDefault();
        resolve(false);
        this.fail();
      };
      w.postMessage({ type: 'init', mode: 'sandbox', base: this.base, interruptBuffer: null, inputBuffer: null } satisfies ToWorker);
    });
    return this.ready;
  }

  /** Throw the worker away (timeout or crash); the next job boots a fresh one. */
  private fail(reason: 'crash' | 'timeout' = 'crash') {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    const c = this.current;
    this.current = null;
    c?.resolve(reason === 'timeout' ? 'timeout' : null);
  }

  private enqueue(msg: ToWorker, run: boolean): Promise<Reply> {
    return new Promise((resolve) => {
      this.jobs.push({ msg, run, resolve });
      void this.pump();
    });
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let job = this.jobs.shift(); job; job = this.jobs.shift()) {
        const ok = await this.boot();
        if (!ok || !this.worker) {
          job.resolve(null);
          continue;
        }
        const reply = await new Promise<Reply>((resolve) => {
          const id = this.nextId++;
          this.current = { id, resolve };
          const timer = window.setTimeout(() => {
            if (this.current?.id === id) this.fail('timeout'); // a hung test run: restart the sandbox
          }, job.run ? RUN_TIMEOUT_MS : 4000);
          this.current.resolve = (v) => {
            window.clearTimeout(timer);
            resolve(v);
          };
          this.worker!.postMessage({ ...job.msg, id } as ToWorker);
        });
        job.resolve(reply);
      }
    } finally {
      this.busy = false;
    }
  }

  /**
   * Null means "checked, nothing wrong". A sandbox that fails throws instead, so a failed
   * check can never be mistaken for a verified fix. A test run that hits the time limit is
   * inconclusive rather than an error (an infinite loop is not the bug being fixed).
   */
  async diagnose(code: string, opts: { run: boolean }): Promise<Diag | null> {
    const r = await this.enqueue({ type: 'analyze', id: 0, code, run: opts.run }, opts.run);
    if (r === 'timeout') return null;
    if (r && r.type === 'analyze-result') return r.diag;
    throw new Error('The checker could not start. Check your connection and try again.');
  }

  async scope(code: string): Promise<{ bound: string[]; builtins: string[] }> {
    const r = await this.enqueue({ type: 'scope', id: 0, code }, false);
    if (r && r !== 'timeout' && r.type === 'scope-result') return { bound: r.bound, builtins: r.builtins };
    throw new Error('The checker could not start. Check your connection and try again.');
  }
}
