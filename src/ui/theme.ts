import { EASE, DURATION, motionScale, prefersReducedMotion } from '../motion/motion';

const KEY = 'pypal:theme';

export function effectiveTheme(): 'light' | 'dark' {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
}

/** Theme toggle with a circular reveal from the button (crossfade when unsupported). */
export function initTheme(button: HTMLElement) {
  const label = () => button.setAttribute('aria-label', effectiveTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  label();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', label);

  button.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    if (!doc.startViewTransition || prefersReducedMotion()) {
      apply(next);
      label();
      return;
    }
    const r = button.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const t = doc.startViewTransition(() => {
      apply(next);
      label();
    });
    t.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: DURATION.xslow * motionScale(),
          easing: EASE.emphasized,
          pseudoElement: '::view-transition-new(root)',
        },
      );
    }).catch(() => { /* transition skipped */ });
  });
}
