import { readFileSync } from 'node:fs';
import { loadPyodide } from 'pyodide';
import type { Diag, FixEnv } from '../../src/fix/types';

let booted: Promise<FixEnv> | null = null;

/** The fix engine's Python environment backed by Pyodide running in Node (same diagnose.py as the browser). */
export function nodeEnv(): Promise<FixEnv> {
  booted ??= (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const py: any = await loadPyodide();
    py.runPython(readFileSync(new URL('../../src/py/diagnose.py', import.meta.url), 'utf8'));
    const analyze = py.globals.get('analyze');
    const scopeNames = py.globals.get('scope_names');
    return {
      async diagnose(code, opts) {
        return JSON.parse(analyze(code, opts.run)) as Diag | null;
      },
      async scope(code) {
        return JSON.parse(scopeNames(code));
      },
    } satisfies FixEnv;
  })();
  return booted;
}
