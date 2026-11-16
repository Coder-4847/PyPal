# PyPal

**Your Python pal.** A free Python editor that runs entirely in your browser. Real Python (Pyodide), no sign-in, no backend, no ads.

Phase 1 (this release): editor, real Python in a Web Worker, Run/Stop, inline `input()`, automatic package loading, resizable layout, light/dark theme, autosave. Friendly errors and one-click fixes arrive in Phase 2.

## Develop

```bash
npm ci
npm run dev        # http://localhost:5173 (dev server sets the isolation headers)
npm test           # Vitest
npm run build      # type-check + production build into dist/
npm run test:e2e   # Playwright (builds and serves dist/ like GitHub Pages does)
```

`npm run prepare:pyodide` (run automatically before `dev` and `build`) copies the pinned Pyodide core into `public/pyodide`.

## How it works

- **Editor:** CodeMirror 6 with Python highlighting, auto-indent, bracket matching and light autocomplete.
- **Python:** Pyodide 0.29.5 in a module Web Worker. Output streams to the terminal; `input()` blocks the worker on a `SharedArrayBuffer` until you answer inline.
- **Stop:** sets Pyodide's interrupt buffer. If Python does not react within 1.5 s (or the page is not cross-origin isolated) the worker is restarted.
- **Isolation on GitHub Pages:** Pages cannot send COOP/COEP headers, so `public/sw.js` adds them (the page reloads once on the first visit).
- **Packages:** `import numpy` (and other Pyodide packages) loads automatically from the matching jsDelivr release.

## Deploy

Push to `main`. `.github/workflows/deploy.yml` installs, tests, builds and publishes to GitHub Pages (set **Settings → Pages → Source** to *GitHub Actions* once).

See `PROGRESS.md` for status and `DECISIONS.md` for design decisions. Fonts: Inter and JetBrains Mono, SIL Open Font License.
