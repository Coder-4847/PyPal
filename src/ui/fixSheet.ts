import type { EditorHandle } from '../editor/editor';
import type { Friendly } from '../errors/explain';
import { charDiff, diffLines, hunkEdits, splitHunks } from '../fix/diff';
import type { FixResult, Hunk } from '../fix/types';
import { animate } from '../motion/motion';
import { announce } from './announce';
import { toast } from './toast';

interface Deps {
  root: HTMLElement;
  editor: EditorHandle;
  /** Called when the sheet closes so the host can restore focus and the toolbar. */
  onClose(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function button(label: string, cls: string, act: string) {
  const b = el('button', cls, label);
  b.type = 'button';
  b.dataset.act = act;
  return b;
}

/**
 * The fix preview: a sheet over the editor listing every change with a one-line reason.
 * Accept all, accept one, or reject. Edits go in as one undoable change.
 */
export class FixSheet {
  private res: FixResult | null = null;
  private body!: HTMLElement;
  private title!: HTMLElement;
  private count!: HTMLElement;
  private note!: HTMLElement;
  private actions!: HTMLElement;
  open = false;

  constructor(private d: Deps) {
    const r = d.root;
    r.hidden = true;
    r.setAttribute('role', 'region');
    r.tabIndex = -1;
    const head = el('div', 'sheet-head');
    this.title = el('h3', 'sheet-title');
    this.count = el('span', 'sheet-count');
    this.actions = el('div', 'sheet-actions');
    head.append(this.title, this.count, this.actions);
    this.note = el('p', 'sheet-note');
    this.body = el('div', 'sheet-body');
    r.replaceChildren(head, this.note, this.body);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open && !e.defaultPrevented) {
        e.preventDefault();
        this.reject();
      }
    });
  }

  /* ---------- opening and closing ---------- */

  private show(label: string) {
    const r = this.d.root;
    r.setAttribute('aria-label', label);
    if (this.open) return;
    this.open = true;
    r.hidden = false;
    animate(r, [{ opacity: 0, transform: 'translateY(20px)' }, { opacity: 1, transform: 'none' }], { duration: 'slow', easing: 'emphasized' });
  }

  close(restoreFocus = true) {
    if (!this.open) return;
    this.open = false;
    const r = this.d.root;
    this.res = null;
    this.d.editor.showShimmer([]);
    const a = animate(r, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(16px)' }], { duration: 'base', easing: 'standard' });
    a.onfinish = () => {
      if (!this.open) r.hidden = true;
    };
    this.d.onClose();
    if (restoreFocus) this.d.editor.focus();
  }

  /* ---------- states ---------- */

  showBusy(message: string, onCancel?: () => void) {
    this.res = null;
    this.title.textContent = 'Working on it';
    this.count.textContent = '';
    this.note.textContent = message;
    this.note.hidden = false;
    this.actions.replaceChildren();
    if (onCancel) {
      const c = button('Cancel', 'btn', 'cancel');
      c.addEventListener('click', () => {
        onCancel();
        this.close();
      });
      this.actions.append(c);
    }
    const spin = el('div', 'sheet-busy');
    spin.append(el('span', 'spinner'), el('span', undefined, 'This usually takes a moment.'));
    this.body.replaceChildren(spin);
    this.show('Fix in progress');
  }

  /** Honest failure: what looks wrong and where, with a way to jump there. */
  showFailure(f: Friendly, opts: { lead?: string } = {}) {
    this.res = null;
    this.title.textContent = opts.lead ?? "I couldn't fix this one safely";
    this.count.textContent = '';
    this.note.hidden = true;
    this.actions.replaceChildren();
    const close = button('Close', 'btn', 'close');
    close.addEventListener('click', () => this.close());
    this.actions.append(close);

    const card = el('div', 'sheet-fail');
    card.append(el('strong', 'err-title', f.title));
    if (f.line) card.append(el('span', 'err-line', `Line ${f.line}`));
    card.append(el('p', 'err-what', f.what), el('p', 'err-hint', `Hint: ${f.hint}`));
    if (f.line) {
      const go = button(`Go to line ${f.line}`, 'btn', 'jump');
      go.addEventListener('click', () => {
        this.d.editor.jumpToLine(f.line!);
      });
      card.append(go);
    }
    this.body.replaceChildren(card);
    this.show('Fix could not be made');
    announce(`PyPal could not fix this safely. ${f.title}${f.line ? ` on line ${f.line}` : ''}.`);
    this.focusFirst();
  }

  showPreview(res: FixResult) {
    this.res = res;
    this.title.textContent = res.status === 'partial' ? 'Part of the fix' : 'Fix preview';
    this.note.hidden = !(res.status === 'partial' || res.source === 'ai');
    const notes: string[] = [];
    if (res.source === 'ai') notes.push('Suggested by your AI provider and checked by PyPal: it compiles and runs.');
    if (res.status === 'partial' && res.remaining) notes.push('This fixes part of the problem. Something else is still wrong after it.');
    this.note.textContent = notes.join(' ');
    this.render(true);
    this.show('Fix preview');
    const n = this.currentHunks().length;
    announce(`Fix preview: ${n} change${n === 1 ? '' : 's'}. Use Accept all, or review each change.`);
    this.focusFirst();
  }

  private focusFirst() {
    const first = this.actions.querySelector<HTMLElement>('[data-act="accept-all"], [data-act="close"]');
    window.setTimeout(() => first?.focus({ preventScroll: true }), 60);
  }

  /* ---------- the preview list ---------- */

  private currentHunks(): Hunk[] {
    if (!this.res) return [];
    const a = this.d.editor.getCode().split('\n');
    const b = this.res.code.split('\n');
    return splitHunks(diffLines(a, b), a, b);
  }

  private reasonFor(h: Hunk): string {
    const cs = this.res!.changes;
    const hit =
      cs.find((c) => (c.hunk.bEnd > c.hunk.bStart && h.bEnd > h.bStart ? c.hunk.bStart < h.bEnd && h.bStart < c.hunk.bEnd : c.hunk.bStart === h.bStart)) ?? cs[0];
    return hit?.reason ?? 'Changed to fix the problem';
  }

  private render(animateIn: boolean) {
    const res = this.res;
    if (!res) return;
    const cur = this.d.editor.getCode().split('\n');
    const prop = res.code.split('\n');
    const hunks = splitHunks(diffLines(cur, prop), cur, prop);
    if (!hunks.length) return this.close();

    this.count.textContent = `${hunks.length} change${hunks.length === 1 ? '' : 's'}`;
    this.actions.replaceChildren();
    const reject = button('Reject', 'btn', 'reject');
    reject.addEventListener('click', () => this.reject());
    const all = button(hunks.length > 1 ? 'Accept all' : 'Accept', 'btn btn-primary', 'accept-all');
    all.addEventListener('click', () => this.acceptAll());
    this.actions.append(reject, all);

    this.d.editor.showShimmer(hunks.flatMap((h) => Array.from({ length: Math.max(1, h.aEnd - h.aStart) }, (_, i) => h.aStart + 1 + i)));

    const cards = hunks.map((h) => this.card(h, cur, prop, hunks.length > 1));
    this.body.replaceChildren(...cards);
    if (animateIn) {
      cards.forEach((c, i) =>
        animate(
          c,
          [
            { opacity: 0, transform: 'translateY(10px)', clipPath: 'inset(0 0 100% 0)' },
            { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' },
          ],
          { duration: 'xslow', easing: 'emphasized', delay: 120 + i * 70 },
        ),
      );
    }
  }

  private card(h: Hunk, cur: string[], prop: string[], single: boolean): HTMLElement {
    const card = el('article', 'hunk');
    const head = el('header', 'hunk-head');
    const lineLabel = h.aEnd > h.aStart ? (h.aEnd - h.aStart > 1 ? `Lines ${h.aStart + 1}–${h.aEnd}` : `Line ${h.aStart + 1}`) : `New line after ${h.aStart}`;
    head.append(el('span', 'hunk-line', lineLabel), el('span', 'hunk-reason', this.reasonFor(h)));
    const diff = el('div', 'diff');
    const oldL = cur.slice(h.aStart, h.aEnd);
    const newL = prop.slice(h.bStart, h.bEnd);
    const pair = oldL.length === newL.length;
    oldL.forEach((t, i) => diff.append(this.row('del', t, pair ? charDiff(t, newL[i]) : null, 'old')));
    newL.forEach((t, i) => diff.append(this.row('add', t, pair ? charDiff(oldL[i], t) : null, 'new')));
    card.append(head, diff);
    if (single) {
      const foot = el('footer', 'hunk-actions');
      const skip = button('Skip', 'btn btn-quiet', 'skip');
      skip.setAttribute('aria-label', `Skip this change: ${this.reasonFor(h)}`);
      skip.addEventListener('click', () => this.skip(h, card));
      const acc = button('Accept', 'btn', 'accept-one');
      acc.setAttribute('aria-label', `Accept this change: ${this.reasonFor(h)}`);
      acc.addEventListener('click', () => this.acceptOne(h, card));
      foot.append(skip, acc);
      card.append(foot);
    }
    return card;
  }

  private row(kind: 'add' | 'del', text: string, cd: { prefix: number; oldEnd: number; newEnd: number } | null, side: 'old' | 'new') {
    const row = el('div', `diff-row ${kind}`);
    const sign = el('span', 'diff-sign', kind === 'add' ? '+' : '−');
    sign.setAttribute('aria-hidden', 'true');
    const sr = el('span', 'sr-only', kind === 'add' ? 'Added: ' : 'Removed: ');
    const code = el('code');
    if (cd) {
      const end = side === 'old' ? cd.oldEnd : cd.newEnd;
      code.append(text.slice(0, cd.prefix));
      if (end > cd.prefix) code.append(el('mark', 'chg', text.slice(cd.prefix, end)));
      code.append(text.slice(end));
    } else code.textContent = text || ' ';
    row.append(sign, sr, code);
    return row;
  }

  /* ---------- decisions ---------- */

  private reject() {
    if (this.res) announce('Fix discarded. Nothing changed.');
    this.close();
  }

  private acceptAll() {
    const res = this.res;
    if (!res) return;
    const cur = this.d.editor.getCode().split('\n');
    const prop = res.code.split('\n');
    const hunks = splitHunks(diffLines(cur, prop), cur, prop);
    this.d.editor.applyEdits(hunkEdits(cur, prop, hunks));
    this.d.editor.wipe(hunks.filter((h) => h.bEnd > h.bStart).map((h) => ({ from: h.bStart + 1, to: h.bEnd })));
    this.afterApply(hunks.length);
    this.close();
  }

  private acceptOne(h: Hunk, card: HTMLElement) {
    const res = this.res;
    if (!res) return;
    const cur = this.d.editor.getCode().split('\n');
    const prop = res.code.split('\n');
    this.d.editor.applyEdits(hunkEdits(cur, prop, [h]));
    if (h.bEnd > h.bStart) this.d.editor.wipe([{ from: h.aStart + 1, to: h.aStart + (h.bEnd - h.bStart) }]);
    this.afterApply(1);
    this.collapse(card, 'accepted', () => this.render(false));
  }

  private skip(h: Hunk, card: HTMLElement) {
    const res = this.res;
    if (!res) return;
    // Skipping removes this change from the proposal; the others stay.
    const prop = res.code.split('\n');
    const cur = this.d.editor.getCode().split('\n');
    prop.splice(h.bStart, h.bEnd - h.bStart, ...cur.slice(h.aStart, h.aEnd));
    this.res = { ...res, code: prop.join('\n'), changes: res.changes };
    announce('Change skipped.');
    this.collapse(card, 'skipped', () => this.render(false));
  }

  private collapse(card: HTMLElement, why: 'accepted' | 'skipped', done: () => void) {
    const a = animate(
      card,
      [
        { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' },
        { opacity: 0, transform: why === 'accepted' ? 'translateX(12px)' : 'translateX(-12px)', clipPath: 'inset(0 0 100% 0)' },
      ],
      { duration: 'slow', easing: 'emphasized' },
    );
    a.onfinish = done;
  }

  private afterApply(n: number) {
    announce(`Applied ${n} change${n === 1 ? '' : 's'}.`);
    toast(`Applied ${n} change${n === 1 ? '' : 's'}`, {
      action: { label: 'Undo', run: () => { this.d.editor.undo(); announce('Undone.'); } },
    });
  }
}
