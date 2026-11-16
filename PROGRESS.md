# Progress

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
