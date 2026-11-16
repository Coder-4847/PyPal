import { animate } from '../motion/motion';

/** The intro: the logo draws itself as Python really loads, then the UI rises into place. */
export class Splash {
  private root = document.getElementById('splash')!;
  private text = document.getElementById('splash-text')!;
  private pct = document.getElementById('splash-pct')!;
  private shownAt = performance.now();
  private dismissed = false;

  progress(value: number, label: string) {
    if (this.dismissed) return;
    const v = Math.max(0, Math.min(1, value));
    this.root.style.setProperty('--p', String(v));
    this.text.textContent = label;
    this.pct.textContent = v < 1 ? `${Math.round(v * 100)}%` : '';
    if (v >= 1) this.root.classList.add('complete');
  }

  error(message: string) {
    document.getElementById('splash-error')!.hidden = false;
    document.getElementById('splash-error-text')!.textContent = message;
    document.getElementById('splash-reload')!.addEventListener('click', () => location.reload());
    this.text.textContent = 'Python could not start';
    this.pct.textContent = '';
  }

  /** Finish the drawing (so it always reads as complete), then settle the UI in. */
  async dismiss() {
    if (this.dismissed) return;
    this.dismissed = true;
    this.root.style.setProperty('--p', '1');
    this.root.classList.add('complete');
    const held = performance.now() - this.shownAt;
    const scale = document.documentElement.dataset.motion === 'slow' ? 5 : 1;
    await new Promise((r) => setTimeout(r, Math.max(0, 560 - held) * scale + 320 * scale));
    this.root.classList.add('leaving');
    document.querySelectorAll<HTMLElement>('[data-rise]').forEach((el, i) => {
      animate(el, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], {
        duration: 'xslow',
        easing: 'emphasized',
        delay: 80 + i * 70,
        fill: 'backwards',
      });
    });
    await new Promise((r) => setTimeout(r, 320 * scale));
    this.root.classList.add('gone');
    this.root.setAttribute('aria-hidden', 'true');
  }
}
