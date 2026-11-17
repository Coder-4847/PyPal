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

## Phase 3
- **Share links:** `#c=v1.<base64url(deflate-raw)>` (falls back to `v0.` plain base64url where `CompressionStream` is missing). Decoding never throws: it caps the expanded size (guards against decompression bombs), requires valid UTF-8 and no NUL, and returns text only; the app puts it in the editor and nowhere else. The link's hash is removed after loading so a reload does not re-apply it. A share link never silently overwrites work: the previous code is kept (`pypal:previous`) and a toast offers "Restore mine". `hashchange` is handled too (pasting a link into an open tab).
- **Files:** Download is `main.py` (Ctrl/Cmd+S, because autosave already makes "save" meaningless). Open accepts plain UTF-8 text up to 1 MB (also by drag and drop), normalises line endings and strips a BOM. Loading an example or file replaces the whole file as one undoable change with an Undo toast.
- **Examples:** six; the last is deliberately broken and has a test that Fix all repairs it in exactly three verified changes.
- **Menus and palette:** one command list feeds the palette; menus (Examples, File) are small dropdowns with full keyboard support. The palette and shortcut sheet are native `<dialog>`s sharing one open/close animation.
- **Keyboard:** Tab indents inside the editor, so Escape then Tab leaves it (announced to screen readers). `?` opens the shortcut sheet only when focus is not in a text field.
- **Offline:** `sw-src/sw.template.js` becomes `dist/sw.js` at build time with a content-hashed version and the precache list. App shell: cache-first for hashed assets, network-first (4 s) for pages. Pyodide core: cache-first in a cache named after the Pyodide version, so app updates do not re-download 12 MB. Package wheels from the Pyodide CDN are kept once used. The previous shell cache is kept for one update so an already-open tab can still lazy-load its old chunks. Cached files are matched ignoring `Vary` (a `Vary: Origin` response made script loads miss the cache).
- **Isolation on first visit** still comes from the same service worker; `vite preview` no longer sends isolation headers, so local previews and tests behave like GitHub Pages.
- **Install:** web app manifest, PNG icons (rendered from the logo by `scripts/make-assets.mjs`, outputs committed), a maskable icon, and an "Install PyPal" entry that appears only when the browser offers it. An "Offline" chip shows when the browser reports no connection.
- **Code splitting:** the editor (CodeMirror), the fix engine plus sandbox, the AI client, settings, palette and shortcut sheet are separate lazy chunks; the entry chunk is about 18 kB gzip. `scripts/check-budget.mjs` (part of `npm run build`) fails the build if the entry chunk exceeds 30 kB, any chunk 100 kB, all JS 300 kB or CSS 14 kB (gzip). Lazy chunks are preloaded when the page is idle.
- **Run button:** a click while the spinner lingers after a program has ended starts a new run instead of doing nothing (only a real running program means "Stop").
- **Accessibility:** one `h1`, landmarks, labelled regions; the terminal log is `aria-live="off"` and results, errors, fixes and input prompts are announced through one polite live region instead (a print-heavy loop would otherwise flood a screen reader). The error card's accessible name is its visible text. axe-core runs in e2e on every main screen, menu and dialog in both themes.
- **Motion:** menus, dialogs, toasts, the palette, panel resize (keyboard steps glide) and focus rings all use the same tokens; every control has hover and press states. Under reduced motion nothing slides, scales or loops (an e2e test asserts it); `?motion=slow` scales every token and every script-driven animation 5x (also asserted).
- **Social preview and 404:** `og.png` and meta tags use an absolute URL derived from the repository name in CI; `404.html` is generated with the correct base path.

## Phase 4
- Four e2e projects (Chromium, Firefox, WebKit, Pixel 7 phone). Firefox and WebKit were installed into the shared Playwright browser directory. In the cloud sandbox, Firefox runs in a profile whose NSS store trusts the HTTPS proxy's CA (`PW_FIREFOX_PROFILE`, via the `e2e/fixtures.ts` context override); TLS verification is never disabled.
- Playwright cannot intercept requests from a service-worker-controlled page in Firefox/WebKit, so the AI mock patches `fetch` inside the page, and the offline test uses route-blocking in Chromium and the browser's offline mode elsewhere.
- The worker no longer touches `SharedArrayBuffer` at load: without isolation it crashed before Python could start (Run must still work without isolation, and now does; `sleep()` falls back to a plain wait, Stop to a restart).
- Each run is acknowledged by the worker at once; no acknowledgement within 4 s means the worker died silently, so it is replaced and the student is told. A Pyodide fatal error is detected after the run (`runPython('1')` fails) and also triggers a fresh worker.
- The Run button never shows "Run" while Python is (re)starting (a click would do nothing).
- Engine: prefers a candidate that fully resolves the problem over one that merely moves the error forward; Python columns are code points (converted to UTF-16 offsets for both the engine and the editor squiggles); an indented `def` body stops at a call of that function; `else`/`elif`/`except` indented like the body is lined up with its header; an empty block at end of file gets `pass`; a blank line before the next code also prefers `pass`; a typo in a variable's *definition* is fixed there instead of renaming every correct use; one-line headers (`for x in xs print(x)`) get the colon where Python points.
- Invariant tests: every expected fix, every must-not-touch case and every working example is left untouched (`nothing`); offered fixes keep every comment, remove at most two words per change and always compile; 120 random edits of working programs never produce an unverified fix.
- CSP (meta + service-worker header, see README). Inline styles are allowed because CodeMirror injects style rules; scripts are not. `'wasm-unsafe-eval'` is needed for Python; `'unsafe-eval'` is not.
- Motion audit: no long frames in any animated moment (Chromium, software rendering). Animations use transform, opacity, clip-path and stroke-dashoffset (the logo and check draw); hover/state colour changes and focus-ring box-shadows are short transitions on small controls that move nothing. The browser's default root view-transition animation (size, backdrop-filter) is switched off; the gutter pulse no longer animates box-shadow.
