import { animate } from '../motion/motion';
import { renderKeys } from '../app/commands';

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
  keys?: string;
  disabled?: boolean;
  /** A thin line is drawn above this item. */
  separator?: boolean;
  run(): void;
}

let openMenu: { close(): void } | null = null;

/**
 * A dropdown menu on a button. Keyboard: Enter / Space / Arrow Down open it, arrows, Home, End and
 * letters move, Escape closes and returns focus. Opens with the shared spring, closes with a fade.
 */
export class Menu {
  private panel: HTMLElement;
  private items: HTMLButtonElement[] = [];
  private isOpen = false;

  constructor(private button: HTMLElement, private getItems: () => MenuItem[], private align: 'start' | 'end' = 'end') {
    const id = `menu-${Math.random().toString(36).slice(2, 8)}`;
    this.panel = document.createElement('div');
    this.panel.className = 'menu';
    this.panel.id = id;
    this.panel.setAttribute('role', 'menu');
    this.panel.hidden = true;
    (document.querySelector('main') ?? document.body).append(this.panel);
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', id);

    button.addEventListener('click', () => (this.isOpen ? this.close() : this.open(false)));
    button.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.close();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.open(true, e.key === 'ArrowUp');
      }
    });
    this.panel.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('mousedown', (e) => {
      if (this.isOpen && !this.panel.contains(e.target as Node) && !button.contains(e.target as Node)) this.close(false);
    });
    window.addEventListener('resize', () => this.isOpen && this.place());
  }

  private build() {
    this.panel.replaceChildren();
    this.items = [];
    for (const it of this.getItems()) {
      if (it.separator) {
        const hr = document.createElement('div');
        hr.className = 'menu-sep';
        hr.setAttribute('role', 'separator');
        this.panel.append(hr);
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.setAttribute('role', 'menuitem');
      b.tabIndex = -1;
      b.disabled = Boolean(it.disabled);
      const text = document.createElement('span');
      text.className = 'menu-text';
      const label = document.createElement('span');
      label.className = 'menu-label';
      label.textContent = it.label;
      text.append(label);
      if (it.hint) {
        const hint = document.createElement('span');
        hint.className = 'menu-hint';
        hint.textContent = it.hint;
        text.append(hint);
      }
      b.append(text);
      if (it.keys) b.append(renderKeys(it.keys));
      b.addEventListener('click', () => {
        this.close();
        it.run();
      });
      this.panel.append(b);
      this.items.push(b);
    }
  }

  private place() {
    const r = this.button.getBoundingClientRect();
    const p = this.panel;
    p.style.top = `${Math.round(r.bottom + 6)}px`;
    const w = p.offsetWidth;
    let left = this.align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    p.style.left = `${Math.round(left)}px`;
    p.style.transformOrigin = this.align === 'end' ? 'top right' : 'top left';
    p.style.setProperty('--ox', `${Math.round(r.left + r.width / 2 - left)}px`);
  }

  open(focus: boolean, last = false) {
    openMenu?.close();
    this.build();
    this.panel.hidden = false;
    this.place();
    this.isOpen = true;
    openMenu = this;
    this.button.setAttribute('aria-expanded', 'true');
    animate(this.panel, [{ opacity: 0, transform: 'translateY(-6px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 'slow', easing: 'spring' });
    const enabled = this.items.filter((i) => !i.disabled);
    if (focus) (last ? enabled[enabled.length - 1] : enabled[0])?.focus();
  }

  close(restoreFocus = true) {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (openMenu === this) openMenu = null;
    this.button.setAttribute('aria-expanded', 'false');
    const a = animate(this.panel, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-4px)' }], { duration: 'fast', easing: 'standard' });
    a.onfinish = () => {
      if (!this.isOpen) this.panel.hidden = true;
    };
    if (restoreFocus) this.button.focus();
  }

  private onKey(e: KeyboardEvent) {
    const enabled = this.items.filter((i) => !i.disabled);
    const idx = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (i: number) => enabled[(i + enabled.length) % enabled.length]?.focus();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); focusAt(idx + 1); break;
      case 'ArrowUp': e.preventDefault(); focusAt(idx - 1); break;
      case 'Home': e.preventDefault(); focusAt(0); break;
      case 'End': e.preventDefault(); focusAt(enabled.length - 1); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); this.close(); break;
      case 'Tab': this.close(false); break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey) {
          const k = e.key.toLowerCase();
          const start = idx + 1;
          const order = [...enabled.slice(start), ...enabled.slice(0, start)];
          order.find((i) => (i.querySelector('.menu-label')?.textContent ?? '').toLowerCase().startsWith(k))?.focus();
        }
    }
  }
}
