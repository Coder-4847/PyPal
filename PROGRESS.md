# Progress

## Phase 3: Polish, examples and offline (complete)

Live: https://coder-4847.github.io/PyPal/ (deploy run 5 green: https://github.com/Coder-4847/PyPal/actions/runs/44013045225). Verified on the live URL in Chromium: all 55 Playwright tests pass (features, offline, install assets, share links, axe audits in both themes, reduced motion, slow flag); Lighthouse desktop (two runs): performance 99, accessibility 100, best practices 100, SEO 100 (LCP 0.4-0.5 s, TBT 0 ms, CLS 0.001).

Done
- **Motion pass** (moments 7 and 8): menus, dialogs, toasts, the palette, panel resize (keyboard steps glide) and animated focus rings all use the shared tokens; every control has hover and press states. Reviewed frame by frame at `?motion=slow`; two things fixed: the squiggle draw-in used to clip the code text (the underline is now its own layer), and the Run button's label colour changed before its background (now transitions together). Reduced motion: nothing slides, scales or loops (asserted by an e2e test); `?motion=slow` scales tokens and script animations 5x (asserted).
- **Content and sharing:** six starter examples (the sixth is broken and Fix all repairs it in three verified changes), share link in the URL hash (compressed, size-capped, UTF-8 and NUL checked, previous code restorable, `hashchange` handled), download `main.py` (Ctrl/Cmd+S), open `.py` (button or drag and drop, 1 MB cap, binary refused), shortcut sheet on `?`, command palette on Ctrl/Cmd+K, Examples and File menus.
- **Offline and install:** generated service worker caches the app shell, the pinned Pyodide core and any package wheel once used; works with the network cut (e2e cuts it for the page and the worker). Web app manifest, PNG icons (incl. maskable), install entry when the browser offers it, Offline chip.
- **Accessibility:** one `h1`, landmarks, labelled regions, correct ARIA on menus, dialogs, palette (combobox/listbox) and separator; Escape then Tab leaves the editor; focus order tested; results, errors, fixes and input prompts announced through one polite live region (terminal log itself is `aria-live="off"` so a print flood cannot flood a screen reader); axe-core finds no violations on the main screen, error card, fix preview, failure sheet, menus, settings, palette, shortcut sheet and phone layout, in light and dark.
- **Mobile and speed:** phone layout reviewed (icon-only menus, preview sheet fixed to the bottom of the screen, touch hint without Ctrl). Code splitting: entry 18 kB gzip; editor, fix engine, AI client, settings, palette and shortcuts are lazy chunks preloaded when idle. `npm run build` enforces a bundle budget (`scripts/check-budget.mjs`).
- **Finishing touches:** empty states (terminal, editor placeholder, palette), 404 page with the correct base path, favicon set, social preview image and meta tags (absolute URLs derived from the repository name in CI).
- Bugs found by the new tests and fixed: Run clicked while the spinner lingered did nothing; Escape did not close a menu opened with the mouse; the fix sheet moved focus after a 60 ms delay (could swallow keystrokes of someone already typing); error card's accessible name did not contain its visible text; menus were outside any landmark; keyboard hints were mislabelled for screen readers; the service worker missed cached files because of a `Vary: Origin` header; `vite preview` sent isolation headers and hid the service-worker path from local tests.
- Tests: 150 Vitest tests; 55 Playwright tests (phase 1, 2, 3, accessibility, motion).

Next
- Phase 4 (final review on Opus): test everything in Chromium, Firefox, WebKit and a phone viewport; grow the fixture corpus to 150+ (multiple errors in one file, tabs, unicode, long files, code to refuse); edge cases (huge output, recursion, memory, rapid Run/Stop, worker crash, first visit offline, corrupted localStorage, bad share data); security (escaping, key handling, CSP, dependency audit); motion audit with frame times; cleanup and README screenshots.

Known issues and limits
- Only Chromium has been run so far. Firefox and WebKit are untested (View Transitions for the theme switch fall back to an instant switch; `CompressionStream` is required for compressed share links, older browsers use plain links).
- A first visit while offline cannot work (nothing is cached yet); the page says so.
- Packages that were never loaded online cannot be loaded offline.
- The AI tier is only tested with a mocked provider (no real key was used).
- No Content-Security-Policy yet (Phase 4).

## Phase 2: Friendly errors and the fix engine (complete)

Live: https://coder-4847.github.io/PyPal/ (deploy green: https://github.com/Coder-4847/PyPal/actions/runs/43929071589). Verified on the live URL in Chromium: all 24 Playwright tests pass (Phase 1 and Phase 2, including Fix all, Fix selection, undo, honest failure, settings and the verified AI tier with a mocked provider); Lighthouse desktop 100 / 100 / 100 (performance, accessibility, best practices).

Done
- **Friendly errors:** every traceback becomes a card (what happened, where, hint); clicking it jumps to the line; raw traceback behind *Show details*. Explanations cover syntax variants, IndentationError/TabError, NameError, TypeError, ValueError, ZeroDivisionError, IndexError, KeyError, AttributeError, ModuleNotFoundError, RecursionError (`src/errors/explain.ts`).
- **Live syntax check** (debounced 450 ms, Python's own compiler): squiggle draws in, hover gives a plain-English message, gutter dot pulses once.
- **Fix engine** (`src/fix/`): local rules (colons, brackets, quotes, commas, indentation and tabs, `=` vs `==`, misspelled keywords/builtins/names, wrong case, Python 2 print, curly quotes, missing imports, `input()` as a number, text + number, off-by-one ranges, module typos), verification with `ast.parse` + `compile` and a sandboxed re-run (stubbed `input()`, step limit), up to 8 passes. A result that still fails to compile is never offered; otherwise PyPal says what looks wrong and where.
- **Fix all errors** button and **Fix selection** floating toolbar (also Ctrl/Cmd+Shift+Enter), diff preview with one reason per changed line, per-change accept/skip, accept all, reject, Escape, Undo (one step).
- **Optional AI tier:** Settings dialog (Anthropic or OpenAI key, stored in localStorage, sent only to the provider, never logged, hidden with no key). The model's answer goes through the same verification and small-edit check.
- Motion moments 4 (card slides up, gutter pulse, squiggle draws in), 5 (broken lines shimmer, diff cards unfold, changed characters highlight, green wipe on accept, card collapses), 6 (toolbar springs in beside the selection, follows it, fades out).
- Tests: 135 Vitest tests, including a corpus of 96 fixtures in `fixtures/broken/` (89 fix cases, 7 must-not-touch cases): 100% pass; 24 Playwright tests. The AI tier is tested with a mocked provider only (no real key was used). In e2e, mock it with `context.route`, because the service worker issues the fetch and `page.route` cannot see it.

Next
- Phase 3: motion pass (moments 7 and 8, slow flag and reduced-motion checks), examples (six, one broken), share link, download/open `.py`, shortcut sheet, command palette, offline service worker + install, accessibility pass, mobile and speed, 404 page and meta.

Known issues
- The live check is skipped while a program is running (that worker is blocked); it resumes afterwards.
- Fix selection needs the whole file to be fixable: if an earlier problem outside the selection cannot be fixed, nothing is offered for the selection.
- Where an indented block is missing after `for`/`if`/`while`, only the first body line is indented (ambiguous otherwise); after `def`/`class` the lines up to the first blank line are.
- The sandbox worker is a second Pyodide instance (extra memory); it starts only once a problem is detected.

## Phase 1: Foundation (complete)

Live: https://coder-4847.github.io/PyPal/ (deploy run green: https://github.com/Coder-4847/PyPal/actions/runs/43920374168)

Done
- Vite + TypeScript scaffold, CSS tokens (spacing, radii, colours, motion), light and dark themes.
- App layout: top bar (logo, Run/Stop, theme toggle), editor and terminal in a resizable split (mouse, touch, keyboard), stacked on phones.
- CodeMirror 6 editor: highlighting, auto-indent, bracket matching, line numbers, light autocomplete, shortcuts, autosave.
- Pyodide 0.29.5 in a Web Worker: Run (Ctrl/Cmd+Enter), Stop (Ctrl/Cmd+.), streamed stdout/stderr, inline `input()`, packages load automatically when imported.
- Basic error display: raw traceback in the terminal, error line tinted and marked in the gutter.
- Motion: intro (logo draws with real load progress, UI rises in), Run button morph (play, ring, stop, check, shake), terminal line reveal with 20 ms stagger and a softly blinking caret, theme circular reveal, `?motion=slow`.
- GitHub Actions deploy workflow, README, DECISIONS.

Verified on the live URL (Chromium): 13 Playwright tests pass (print, loops, Ctrl+Enter, inline input(), Stop on an infinite loop / sleep / print flood, errors, autosave, theme, split, phone layout, numpy auto-load); 6 Vitest tests; Lighthouse desktop performance 100, accessibility 100, best practices 100 (LCP 0.5 s, TBT 0 ms, CLS 0.001). Run the same suite with `E2E_URL=<live url> npm run test:e2e`.

Next
- Phase 2: friendly error cards, live syntax check, fix engine with verification, Fix all / Fix selection, diff preview, optional AI tier.

Known issues
- Package loading (numpy etc.) shows an indeterminate bar: Pyodide does not expose byte counts for wheels.
- `asyncio.sleep` and threads are not patched for Stop; the 1.5 s restart fallback covers them.
- Initial JS bundle is ~490 kB (mostly CodeMirror); code splitting is scheduled for Phase 3.
