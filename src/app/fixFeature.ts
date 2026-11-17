import type { EditorHandle } from '../editor/editor';
import { loadAiSettings } from '../fix/ai';
import { SandboxClient } from '../py/sandbox';
import { FixSheet } from '../ui/fixSheet';
import { FixController } from './fixFlow';

export interface FixFeature {
  controller: FixController;
  sheet: FixSheet;
  warmUp(): void;
}

/** Everything behind "Fix": the engine, the sandbox worker and the preview sheet. Loaded on demand. */
export function createFixFeature(deps: { editor: EditorHandle; sheetRoot: HTMLElement; base: string; onSheetClose(): void; setBusy(busy: boolean): void }): FixFeature {
  const sandbox = new SandboxClient(deps.base);
  const sheet = new FixSheet({ root: deps.sheetRoot, editor: deps.editor, onClose: deps.onSheetClose });
  const controller = new FixController({ editor: deps.editor, env: sandbox, sheet, getAi: loadAiSettings, setBusy: deps.setBusy });
  return { controller, sheet, warmUp: () => sandbox.warmUp() };
}
