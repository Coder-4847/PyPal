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

## Phase 2
- The fix engine is plain TypeScript (`src/fix/`) that talks to Python only through a small `FixEnv` interface, so the same engine runs in a browser worker and in Vitest against Pyodide in Node. `src/py/diagnose.py` is the single Python-side source of truth for both.
- Rules propose minimal token-level edits; Python decides. Every candidate is checked with `ast.parse` + `compile`, and runtime fixes are re-run in a sandbox with a stubbed `input()` (returns "1") and a 400k-line step limit (`sys.settrace`). A test run that hits the limit counts as inconclusive, not as an error.
- A candidate that only swaps one syntax error for another is accepted only if the new error is not located inside the edited region (so an edit that breaks itself is rejected). Tokenizer errors can surface before parser errors, so "later line" is not required.
- Up to 8 passes; each pass keeps the first verified candidate. Offered results: `fixed` (compiles and runs clean) or `partial` (compiles, a runtime problem remains). A result that still fails to compile is never offered; the engine explains what is wrong and where instead.
- Edits larger than half the file's non-blank lines are refused as "not a small fix" (also applied to AI answers). Code that raises nothing is never touched: logic bugs are out of scope.
- `print(Word)` is quoted only when the name starts with an uppercase letter; `print(banana)` is explained, not rewritten.
- Where an indented block is missing after `def`/`class`, the contiguous lines up to the first blank line are indented; after other headers only the first body line is.
- Live syntax check runs in the main worker when idle (debounced 450 ms). It is skipped while a program runs because that worker is blocked.
- The fix engine uses a second, lazily started worker (`SandboxClient`) so a running program is never disturbed and infinite loops in test runs can be killed. A failed sandbox throws; it is never treated as "verified".
- Squiggles, hover tooltips and gutter dots are our own CodeMirror extensions (no `@codemirror/lint`), so the squiggle can draw in. Run-error marks clear when the code changes; syntax marks stay (mapped) until the next check.
- The diff preview is a sheet over the editor. Accept-one recomputes the diff against the current document, so remaining changes stay valid. All edits are applied as one transaction tagged `input.fix`, so Ctrl+Z (or the toast's Undo) reverses an accept in one step.
- AI tier: Anthropic or OpenAI, called directly from the browser with the user's key (stored in `localStorage` key `pypal:ai`). The model must answer JSON `{code, notes}`; the answer goes through the same verification and the same small-edit check. With no key the tier is invisible. Default models: `claude-haiku-5-5` and `gpt-4o-mini`.
- Fix selection restricts candidates to edits inside the selected lines; a partial result is accepted when the problem left over is outside the selection.
- Shortcuts added: Ctrl/Cmd+Shift+Enter fixes the selection, or the whole file when nothing is selected.
- Fixture format: `name.broken.py` + `name.fixed.py` (exact expected output) and `name.keep.py` for code the engine must leave untouched. Phase 2 corpus: 96 cases; Phase 4 grows it to 150+.
