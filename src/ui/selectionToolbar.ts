import type { EditorView } from '@codemirror/view';

/**
 * "Fix errors in these lines": a small toolbar that scales in beside the selection with the
 * spring, follows it as it moves or scrolls, and fades when the selection clears.
 */
export class SelectionToolbar {
  readonly el: HTMLElement;
  private button: HTMLButtonElement;
  private visible = false;
  disabled = false;

  constructor(private host: HTMLElement, private getView: () => EditorView, onClick: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'sel-toolbar';
    this.el.hidden = true;
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Selection tools');
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'sel-btn';
    this.button.textContent = 'Fix errors in these lines';
    // keep the selection: pressing the toolbar must not move focus out of the editor
    this.button.addEventListener('mousedown', (e) => e.preventDefault());
    this.button.addEventListener('click', onClick);
    this.el.append(this.button);
    host.append(this.el);
    window.addEventListener('resize', () => this.update());
  }

  /** Call from an editor update listener and on scroll. */
  update() {
    const view = this.getView();
    const sel = view.state.selection.main;
    const show = !sel.empty && !this.disabled && view.hasFocus;
    if (!show) return this.hide();
    const head = view.coordsAtPos(sel.head);
    const anchor = view.coordsAtPos(sel.anchor);
    if (!head || !anchor) return this.hide();
    const box = this.host.getBoundingClientRect();
    const endCoords = sel.head >= sel.anchor ? head : anchor;
    const w = this.el.offsetWidth || 190;
    const h = this.el.offsetHeight || 32;
    // beside the end of the selection; flip above it when there is no room on the right
    let x = endCoords.right - box.left + 10;
    let y = endCoords.top - box.top - 2;
    if (x + w > box.width - 8) {
      x = Math.max(8, Math.min(box.width - w - 8, endCoords.left - box.left));
      y = (sel.head >= sel.anchor ? anchor.top : head.top) - box.top - h - 8;
      if (y < 4) y = endCoords.bottom - box.top + 6;
    }
    y = Math.max(4, Math.min(box.height - h - 4, y));
    this.el.style.setProperty('--x', `${Math.round(x)}px`);
    this.el.style.setProperty('--y', `${Math.round(y)}px`);
    this.el.style.setProperty('--ox', x > box.width / 2 ? '100%' : '0%');
    if (!this.visible) {
      this.visible = true;
      this.el.hidden = false;
      // next frame so the entrance transition runs
      requestAnimationFrame(() => (this.el.dataset.visible = 'true'));
    }
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.el.dataset.visible = 'false';
    window.setTimeout(() => {
      if (!this.visible) this.el.hidden = true;
    }, 220 * (document.documentElement.dataset.motion === 'slow' ? 5 : 1));
  }
}
