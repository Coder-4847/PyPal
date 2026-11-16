import type { EditorHandle } from '../editor/editor';
import { explain } from '../errors/explain';
import { askModel, verifyAiFix, type AiSettings } from '../fix/ai';
import { fixCode } from '../fix/engine';
import type { FixEnv, FixResult } from '../fix/types';
import { announce } from '../ui/announce';
import type { FixSheet } from '../ui/fixSheet';
import { toast } from '../ui/toast';

interface Deps {
  editor: EditorHandle;
  env: FixEnv;
  sheet: FixSheet;
  getAi(): AiSettings | null;
  setBusy(busy: boolean): void;
}

/**
 * Fix all / Fix selection. Tier 1 and 2 (rules + verification) run first; if they cannot produce
 * a verified fix and the student added a key, tier 3 asks the model and verifies its answer the
 * same way. Nothing is shown unless it passed verification.
 */
export class FixController {
  private busy = false;
  private abort: AbortController | null = null;

  constructor(private d: Deps) {}

  get isBusy() {
    return this.busy;
  }

  fixAll() {
    return this.run(undefined);
  }

  /** With a selection, fix just those lines; otherwise the whole file. */
  fixSelection() {
    return this.run(this.d.editor.selectedLines() ?? undefined);
  }

  private async run(scope?: { from: number; to: number }) {
    if (this.busy) return;
    this.busy = true;
    this.d.setBusy(true);
    const code = this.d.editor.getCode();
    try {
      let res: FixResult;
      try {
        res = await fixCode(code, this.d.env, { scope });
      } catch (e) {
        this.d.sheet.showFailure(
          { title: 'The checker is not ready', what: e instanceof Error ? e.message : 'PyPal could not check your code right now.', hint: 'Wait a moment and try again.', line: null },
          { lead: 'Could not check your code' },
        );
        return;
      }
      if (this.d.editor.getCode() !== code) {
        toast('Your code changed while PyPal was checking. Try again.');
        return;
      }

      if (res.status === 'nothing') {
        toast(scope ? 'No errors found in these lines.' : 'No errors found. Nothing to fix.');
        announce('No errors found.');
        return;
      }
      if (res.status === 'fixed' || res.status === 'partial') {
        this.d.sheet.showPreview(res);
        return;
      }

      // Tier 3 (optional): only when the student added a key.
      const ai = this.d.getAi();
      const diag = res.initial ?? res.remaining;
      if (ai && diag) {
        this.abort = new AbortController();
        this.d.sheet.showBusy("The built-in rules couldn't fix this one. Asking your AI provider for a suggestion…", () => this.abort?.abort());
        const reply = await askModel(ai, code, diag, undefined, this.abort.signal);
        if (this.abort.signal.aborted) return;
        const verified = reply ? await verifyAiFix(code, reply, this.d.env, scope).catch(() => null) : null;
        if (this.d.editor.getCode() !== code) return;
        if (verified) {
          this.d.sheet.showPreview(verified);
          return;
        }
      }

      // Honest failure: say what looks wrong and where.
      const stuck = res.remaining ?? res.initial;
      if (stuck) this.d.sheet.showFailure(explain(stuck));
      else this.d.sheet.showFailure({ title: 'Nothing to change', what: 'PyPal did not find a safe change to make.', hint: 'Read the error message and check the marked line.', line: null });
    } finally {
      this.busy = false;
      this.abort = null;
      this.d.setBusy(false);
    }
  }
}
