# Progress

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
- Initial JS bundle is ~420 kB (mostly CodeMirror); code splitting is scheduled for Phase 3.
