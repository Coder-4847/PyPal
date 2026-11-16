/** Polite screen-reader announcements (errors found, fixes offered and applied). */
export function announce(message: string) {
  const el = document.getElementById('sr-live');
  if (!el) return;
  el.textContent = '';
  // a short delay makes repeated identical messages announce again
  window.setTimeout(() => (el.textContent = message), 30);
}
