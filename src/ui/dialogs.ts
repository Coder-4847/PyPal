import { animate } from '../motion/motion';

/** Shared open/close for every <dialog>: same tokens, same spring, focus returns to where it was. */
export function showDialog(d: HTMLDialogElement, opts: { opener?: HTMLElement | null; focus?: HTMLElement | null } = {}) {
  if (d.open) return;
  (d as HTMLDialogElement & { _opener?: HTMLElement | null })._opener = opts.opener ?? (document.activeElement as HTMLElement | null);
  d.showModal();
  animate(d, [{ opacity: 0, transform: 'translateY(12px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 'slow', easing: 'spring' });
  (opts.focus ?? d.querySelector<HTMLElement>('[autofocus], input, button, select'))?.focus();
}

export function hideDialog(d: HTMLDialogElement) {
  if (!d.open) return;
  const opener = (d as HTMLDialogElement & { _opener?: HTMLElement | null })._opener;
  const a = animate(d, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px) scale(.98)' }], { duration: 'base', easing: 'standard' });
  a.onfinish = () => {
    if (d.open) d.close();
    if (opener && document.contains(opener)) opener.focus();
  };
}

/** Escape and a click on the backdrop close the dialog with the exit animation. */
export function wireDialog(d: HTMLDialogElement) {
  d.addEventListener('cancel', (e) => {
    e.preventDefault();
    hideDialog(d);
  });
  d.addEventListener('mousedown', (e) => {
    if (e.target === d) hideDialog(d);
  });
}
