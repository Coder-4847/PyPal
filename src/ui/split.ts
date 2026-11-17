/** Resizable editor/terminal split. Mouse, touch and keyboard (arrow keys). */
const KEY = 'pypal:split';

export function initSplit(workspace: HTMLElement, divider: HTMLElement) {
  const mobile = matchMedia('(max-width: 760px)');
  let value = 55;
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (saved >= 20 && saved <= 80) value = saved;
  } catch { /* storage unavailable */ }

  const set = (v: number, persist = false) => {
    value = Math.min(80, Math.max(20, v));
    workspace.style.setProperty('--split', String(value));
    workspace.style.setProperty('--split-v', String(value));
    divider.setAttribute('aria-valuenow', String(Math.round(value)));
    divider.setAttribute('aria-orientation', mobile.matches ? 'horizontal' : 'vertical');
    if (persist) {
      try { localStorage.setItem(KEY, String(Math.round(value))); } catch { /* ignore */ }
    }
  };
  set(value);
  mobile.addEventListener('change', () => set(value));

  divider.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('dragging');
    document.body.classList.add('resizing');
    const rect = workspace.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const pct = mobile.matches ? ((ev.clientY - rect.top) / rect.height) * 100 : ((ev.clientX - rect.left) / rect.width) * 100;
      set(pct);
    };
    const up = () => {
      divider.classList.remove('dragging');
      document.body.classList.remove('resizing');
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
      divider.removeEventListener('pointercancel', up);
      set(value, true);
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
    divider.addEventListener('pointercancel', up);
  });

  const glide = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    workspace.classList.add('gliding');
    window.setTimeout(() => workspace.classList.remove('gliding'), 260 * (document.documentElement.dataset.motion === 'slow' ? 5 : 1));
  };
  divider.addEventListener('keydown', (e) => {
    glide();
    // Left/Up shrink the first pane and Right/Down grow it, whichever way the panes are stacked
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') set(value - 3, true);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') set(value + 3, true);
    else if (e.key === 'Home') set(20, true);
    else if (e.key === 'End') set(80, true);
    else return;
    e.preventDefault();
  });
}
