import { animate } from '../motion/motion';

export interface ToastOptions {
  action?: { label: string; run(): void };
  timeout?: number;
}

/** A small message at the bottom of the screen. Enters and leaves with the shared motion tokens. */
export function toast(message: string, opts: ToastOptions = {}) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  el.append(text);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const a = animate(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px)' }], { duration: 'base', easing: 'standard' });
    a.onfinish = () => el.remove();
  };
  if (opts.action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = opts.action.label;
    b.addEventListener('click', () => {
      opts.action!.run();
      close();
    });
    el.append(b);
  }
  host.append(el);
  animate(el, [{ opacity: 0, transform: 'translateY(12px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 'slow', easing: 'spring' });
  const slow = document.documentElement.dataset.motion === 'slow' ? 5 : 1;
  window.setTimeout(close, (opts.timeout ?? (opts.action ? 8000 : 3500)) * slow);
}
