/* Runs before anything else (classic script, no bundling).
 * 1. Applies the saved theme before first paint, so there is no flash.
 * 2. Gets the page cross-origin isolated via the service worker, once. */
(function () {
  try {
    var t = localStorage.getItem('pypal:theme');
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  } catch (e) {}
  try {
    if (/[?&]motion=slow\b/.test(location.search)) document.documentElement.dataset.motion = 'slow';
  } catch (e) {}

  if (window.crossOriginIsolated || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  var tried = false;
  try { tried = sessionStorage.getItem('pypal:coi') === '1'; } catch (e) {}
  if (tried) return; // never loop: Run still works, Stop falls back to restarting
  var url = new URL('sw.js', document.currentScript ? document.currentScript.src : location.href);
  navigator.serviceWorker.register(url.href).then(function (reg) {
    var go = function () {
      try { sessionStorage.setItem('pypal:coi', '1'); } catch (e) {}
      location.reload();
    };
    if (reg.active && !navigator.serviceWorker.controller) return go();
    var w = reg.installing || reg.waiting;
    if (w) w.addEventListener('statechange', function () { if (w.state === 'activated') go(); });
  }).catch(function () {});
})();
