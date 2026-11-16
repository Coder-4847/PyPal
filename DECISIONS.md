# Decisions

One line each. Newest at the bottom.

- Vite 8 + TypeScript, no UI framework; CodeMirror 6 for the editor; Vitest for unit tests; Playwright for e2e.
- Pyodide pinned to 0.29.5 (Python 3.13). Core files are copied from the npm package into `public/pyodide` at build time and served from our own origin; packages (numpy etc.) come from the matching jsDelivr release via `packageBaseUrl`.
- Real intro progress: the worker streams the core files itself and counts bytes against sizes in `pyodide/manifest.json`; the browser cache then serves loadPyodide.
- Cross-origin isolation via our own tiny service worker (`public/sw.js`) rather than the coi-serviceworker package, so Phase 3 can add offline caching to the same worker (only one worker per scope). `boot.js` registers it and reloads once; a sessionStorage flag prevents reload loops.
- `Stop` sets the Pyodide interrupt buffer (SIGINT); if Python has not reacted after 1.5 s, or there is no isolation, the worker is terminated and restarted.
- `input()` and `time.sleep()` are replaced in a Python harness. input blocks the worker on `Atomics.wait` over a SharedArrayBuffer; sleep waits in 40 ms slices so Stop stays instant.
- Without cross-origin isolation `input()` raises a clear RuntimeError (it cannot block); Run and Stop still work.
- Worker output is batched every 50 ms and capped; the terminal paints at most 60k characters per frame and keeps 2000 lines, so a print-heavy infinite loop cannot freeze the page.
- Each run gets a fresh `__main__` namespace; imported modules stay cached between runs.
- `time.sleep` is patched; `asyncio.sleep` and threads are out of scope.
- Fonts: Inter and JetBrains Mono variable (Latin subset), self-hosted from Fontsource files (SIL OFL), no CDN.
- One accent colour (blue). Dark and light palettes are defined as CSS tokens; the theme follows the system until the user toggles it.
- Motion tokens live in CSS (`--dur-*`, `--ease-*`, spring as `linear()` with a cubic-bezier fallback) and are mirrored in `src/motion/motion.ts`. `--move` is 0 under reduced motion so movement becomes a fade. `?motion=slow` sets `--motion-scale: 5`.
- Theme switch uses the View Transitions API with a circular clip-path reveal and falls back to an instant switch.
- Terminal caret is drawn by us (opacity animation) because native caret colour animation is not compositor-only.
- Vite `base` comes from `GITHUB_REPOSITORY` (or `BASE_PATH`), so assets load at `/<repo>/` on GitHub Pages.
- The dev server sets COOP/COEP headers itself; production relies on the service worker. e2e tests run against `vite preview` with no headers to mimic GitHub Pages.
- Playwright uses the sandbox's pre-installed Chromium when present (`/opt/pw-browsers/chromium`); CI does not run e2e in Phase 1 (unit tests, then build).
