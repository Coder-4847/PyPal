# PyPal

**Your Python pal.** A free Python editor that runs entirely in your browser. Real Python (Pyodide), no sign-in, no backend, no ads.

**Features so far**

- Editor, real Python in a Web Worker, Run/Stop, inline `input()`, automatic package loading, resizable layout, light/dark theme, autosave.
- **Friendly errors:** every traceback becomes a card (what happened, where, a hint). Click it to jump to the line; the raw traceback is behind *Show details*.
- **Live syntax check:** problems are underlined as you type; hover for a plain-English message.
- **One-click fixes:** *Fix all errors* (or select lines and use *Fix errors in these lines*). Every change in the diff preview has a one-line reason; accept all, accept one, or reject, and Undo works afterwards.
- **Honest by design:** a fix is only offered if Python verifies it. Otherwise PyPal says what looks wrong and where.
- **Optional AI help:** add your own key in Settings. It is stored only in your browser and sent only to the provider; there is no shared key and no PyPal server.

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

## The fix engine

Fixes run in tiers and stop at the first verified result:

1. **Local rules** (`src/fix/rules.ts`): missing colons, brackets, quotes and commas, indentation, `=` vs `==`, misspelled keywords and names, wrong case, Python 2 `print`, `input()` used as a number, text plus number, and more. They only propose small edits.
2. **Verification** (`src/fix/engine.ts`): each candidate is checked with `ast.parse` and `compile`; runtime fixes are re-run in a sandbox worker with a stubbed `input()` and a step limit. Up to 8 passes, because one fix often reveals the next.
3. **AI (optional)**: if the rules cannot produce a verified fix and a key is set, the model's answer goes through the same verification.

Tests live in `tests/` and `fixtures/broken/` (`name.broken.py` + `name.fixed.py`, or `name.keep.py` for code that must be left alone). The Vitest runner boots Pyodide in Node, so the same `src/py/diagnose.py` is used in tests and in the browser.

## Deploy

Push to `main`. `.github/workflows/deploy.yml` installs, tests, builds and publishes to GitHub Pages (set **Settings → Pages → Source** to *GitHub Actions* once).

See `PROGRESS.md` for status and `DECISIONS.md` for design decisions. Fonts: Inter and JetBrains Mono, SIL Open Font License.
