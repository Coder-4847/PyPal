export type RunState = 'loading' | 'idle' | 'running' | 'success' | 'error';

/** The Run button. One element morphs between play, ring, stop, check and a gentle shake. */
export class RunButton {
  private state: RunState = 'loading';
  private timer = 0;
  private startedAt = 0;
  private static MIN_RUNNING_MS = 420;
  private static RESULT_MS = 900;

  constructor(
    readonly el: HTMLButtonElement,
    private handlers: { run(): void; stop(): void; isRunning(): boolean; isReady(): boolean },
  ) {
    el.addEventListener('click', () => {
      // the spinner can linger briefly after a program ends: only a real run means "Stop"
      if (this.state === 'running' && this.handlers.isRunning()) this.handlers.stop();
      else if (this.state === 'running' || this.state === 'idle' || this.state === 'success' || this.state === 'error') this.handlers.run();
    });
    this.apply('loading');
  }

  private apply(state: RunState) {
    // never show "Run" while Python is (re)starting: a click would do nothing
    if (state === 'idle' && !this.handlers.isReady()) state = 'loading';
    this.state = state;
    this.el.dataset.state = state;
    // each name starts with the word on screen (the accessible name must contain the visible text)
    const labels: Record<RunState, string> = {
      loading: 'Loading Python',
      idle: 'Run the program',
      running: 'Stop the program',
      success: 'Done, finished without errors',
      error: 'Error, the program stopped with an error',
    };
    this.el.setAttribute('aria-label', labels[state]);
    this.el.setAttribute('aria-busy', String(state === 'loading' || state === 'running'));
    this.el.setAttribute('aria-disabled', String(state === 'loading'));
  }

  setReady() {
    window.clearTimeout(this.timer);
    this.apply('idle');
  }

  setLoading() {
    window.clearTimeout(this.timer);
    this.apply('loading');
  }


  start() {
    window.clearTimeout(this.timer);
    this.startedAt = performance.now();
    this.apply('running');
  }

  /** Settle after a run. Keeps the spinner visible long enough to read as a state change. */
  finish(outcome: 'success' | 'error' | 'stopped') {
    const wait = Math.max(0, RunButton.MIN_RUNNING_MS - (performance.now() - this.startedAt));
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (outcome === 'stopped') return this.apply('idle');
      this.apply(outcome);
      this.timer = window.setTimeout(() => this.apply('idle'), RunButton.RESULT_MS * (document.documentElement.dataset.motion === 'slow' ? 5 : 1));
    }, outcome === 'stopped' ? 0 : wait);
  }
}
