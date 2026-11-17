import { animate } from '../motion/motion';
import { parseOutput } from './outputParser';

/** Lines kept in the DOM. Older lines are dropped with a notice, so huge output stays fast. */
export const MAX_LINES = 2000;
/** Only the first lines of each frame animate, so a flood of output never janks. */
const MAX_STAGGER = 24;
/** Most characters painted in one frame. */
const MAX_PAINT_CHARS = 60_000;

type Stream = 'out' | 'err';

export class Terminal {
  private empty: HTMLElement;
  private cur: HTMLElement | null = null;
  private lastSpan: { el: HTMLElement; stream: Stream } | null = null;
  private queue: Array<{ stream: Stream; text: string }> = [];
  private frame = 0;
  private batchIndex = 0;
  private lineCount = 0;
  private trimmed = false;
  private overflow = false;
  private queuedChars = 0;
  private input: { wrap: HTMLElement; field: HTMLInputElement; resolve: (v: string | null) => void } | null = null;

  constructor(private root: HTMLElement) {
    this.empty = document.createElement('p');
    this.empty.className = 'term-empty';
    this.empty.innerHTML = 'Press <kbd>Run</kbd><span class="hint-keys"> or <kbd>Ctrl</kbd> <kbd>Enter</kbd></span> to see your program’s output here.';
    this.root.append(this.empty);
  }

  /** Queue output; it is painted once per animation frame. */
  write(stream: Stream, text: string, dropped = false) {
    if (dropped) this.overflow = true;
    this.queue.push({ stream, text });
    this.queuedChars += text.length;
    if (!this.frame) this.frame = requestAnimationFrame(() => this.paint());
  }

  private paint() {
    this.frame = 0;
    const near = this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight < 48;
    this.batchIndex = 0;
    // Under a flood, paint only the newest output: older lines would be trimmed anyway.
    while (this.queuedChars > MAX_PAINT_CHARS && this.queue.length > 1) {
      this.queuedChars -= this.queue.shift()!.text.length;
      this.overflow = true;
    }
    const q = this.queue;
    this.queue = [];
    this.queuedChars = 0;
    if (this.overflow) {
      this.overflow = false;
      this.noteTrimmed();
    }
    for (const { stream, text } of q) this.apply(stream, text);
    this.trim();
    if (near) this.root.scrollTop = this.root.scrollHeight;
  }

  private newLine(cls = '') {
    const el = document.createElement('div');
    el.className = `term-line ${cls}`.trim();
    if (this.batchIndex < MAX_STAGGER) {
      el.classList.add('enter');
      el.style.setProperty('--i', String(this.batchIndex));
      this.batchIndex++;
    }
    this.empty.remove();
    this.root.append(el);
    this.lineCount++;
    return el;
  }

  private ensureLine() {
    if (!this.cur) {
      this.cur = this.newLine();
      this.lastSpan = null;
    }
    return this.cur;
  }

  private apply(stream: Stream, text: string) {
    for (const op of parseOutput(text)) {
      if (op.kind === 'text') {
        const line = this.ensureLine();
        if (this.lastSpan && this.lastSpan.stream === stream) {
          this.lastSpan.el.append(op.text);
        } else {
          const span = document.createElement('span');
          if (stream === 'err') span.className = 'err';
          span.textContent = op.text;
          line.append(span);
          this.lastSpan = { el: span, stream };
        }
      } else if (op.kind === 'newline') {
        this.ensureLine();
        this.cur = null;
        this.lastSpan = null;
      } else {
        const line = this.ensureLine();
        line.replaceChildren();
        this.lastSpan = null;
      }
    }
  }

  private trim() {
    const excess = this.lineCount - MAX_LINES;
    if (excess <= 0) return;
    let removed = 0;
    for (const child of Array.from(this.root.children)) {
      if (removed >= excess) break;
      if (child === this.cur || child === this.input?.wrap.parentElement || child.classList.contains('notice')) continue;
      child.remove();
      removed++;
    }
    this.lineCount -= removed;
    this.noteTrimmed();
  }

  private noteTrimmed() {
    if (this.trimmed) return;
    this.trimmed = true;
    const note = document.createElement('div');
    note.className = 'term-line notice';
    note.textContent = 'Too much output: older lines were trimmed to keep PyPal fast.';
    this.root.prepend(note);
  }

  /** Append a block (an error card) after the output so far; it slides up into place. */
  addCard(card: HTMLElement) {
    this.flushNow();
    this.cur = null;
    this.lastSpan = null;
    this.empty.remove();
    this.root.append(card);
    animate(card, [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }], { duration: 'xslow', easing: 'emphasized' });
    this.root.scrollTop = this.root.scrollHeight;
  }

  /** The last few lines of output as plain text, for screen-reader announcements. */
  summary(): string {
    const lines = Array.from(this.root.querySelectorAll('.term-line:not(.status):not(.notice)'))
      .map((l) => l.textContent ?? '')
      .filter((t) => t.trim());
    if (!lines.length) return 'It printed nothing.';
    const tail = lines.slice(-3).join('. ').slice(0, 240);
    return `${lines.length} line${lines.length === 1 ? '' : 's'} of output. Last: ${tail}`;
  }

  /** A muted status line, such as "Finished in 0.1s". */
  status(text: string, kind: 'ok' | 'bad' | '' = '') {
    this.flushNow();
    this.cur = null;
    this.batchIndex = 0;
    const el = this.newLine(`status ${kind}`.trim());
    el.textContent = text;
    this.root.scrollTop = this.root.scrollHeight;
  }

  /** Paint anything queued right now (used before status lines and input). */
  flushNow() {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    if (this.queue.length) this.paint();
  }

  clear() {
    this.flushNow();
    this.cancelInput();
    this.root.replaceChildren(this.empty);
    this.cur = null;
    this.lastSpan = null;
    this.lineCount = 0;
    this.trimmed = false;
  }

  /** Show an inline prompt and caret. Resolves with the entered text, or null if cancelled. */
  readLine(prompt: string): Promise<string | null> {
    this.cancelInput();
    this.flushNow();
    this.batchIndex = 0;
    if (prompt) this.apply('out', prompt);
    const line = this.ensureLine();

    const wrap = document.createElement('span');
    wrap.className = 'term-input-wrap';
    const field = document.createElement('input');
    field.className = 'term-input';
    field.type = 'text';
    field.spellcheck = false;
    field.autocomplete = 'off';
    field.setAttribute('autocapitalize', 'off');
    field.setAttribute('aria-label', prompt ? `Answer for: ${prompt}` : 'Type your answer and press Enter');
    const caret = document.createElement('i');
    caret.className = 'term-caret';
    caret.setAttribute('aria-hidden', 'true');
    wrap.append(field, caret);
    line.append(wrap);

    const sync = () => {
      field.style.width = `${Math.max(1, field.value.length + 1)}ch`;
      wrap.style.setProperty('--pos', String(field.selectionStart ?? field.value.length));
    };
    sync();
    for (const ev of ['input', 'keyup', 'click', 'select', 'focus'] as const) field.addEventListener(ev, sync);

    return new Promise((resolve) => {
      this.input = { wrap, field, resolve };
      field.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.finishInput(field.value);
        } else if (e.key === 'c' && e.ctrlKey && field.selectionStart === field.selectionEnd) {
          e.preventDefault();
          this.finishInput(null);
        }
      });
      this.root.scrollTop = this.root.scrollHeight;
      field.focus({ preventScroll: true });
    });
  }

  private finishInput(value: string | null) {
    const inp = this.input;
    if (!inp) return;
    this.input = null;
    const echo = document.createElement('span');
    echo.className = 'user-input';
    echo.textContent = value ?? '';
    inp.wrap.replaceWith(echo);
    this.cur = null;
    this.lastSpan = null;
    inp.resolve(value);
  }

  /** Remove a pending input field without answering (the program was stopped). */
  cancelInput() {
    if (this.input) this.finishInput(null);
  }

  get awaitingInput() {
    return this.input !== null;
  }

  focusInput() {
    this.input?.field.focus();
  }
}
