/** A problem found in the student's code, as reported by Python itself. */
export interface Diag {
  kind: 'syntax' | 'runtime';
  type: string; // "SyntaxError", "NameError", ...
  message: string;
  lineno: number | null;
  offset: number | null;
  endLineno: number | null;
  endOffset: number | null;
  text: string | null;
  traceback: string;
  suggestion: string | null; // Python's own "Did you mean" hint, if any
}

/** What the engine needs from Python: the browser sandbox worker, or Pyodide in Node for tests. */
export interface FixEnv {
  /** Syntax check (run: false) or syntax check plus a sandboxed run with stubbed input (run: true). */
  diagnose(code: string, opts: { run: boolean }): Promise<Diag | null>;
  scope(code: string): Promise<{ bound: string[]; builtins: string[] }>;
}

/** One proposed edit: the whole new source plus a one-line reason. */
export interface Candidate {
  code: string;
  reason: string;
  rule: string;
  /** 1-based lines (in the code before the edit) the edit touches. */
  lines: number[];
}

export interface Hunk {
  aStart: number; // half-open, 0-based, in the old lines
  aEnd: number;
  bStart: number; // half-open, 0-based, in the new lines
  bEnd: number;
}

export interface Change {
  hunk: Hunk;
  reason: string;
}

export type FixStatus =
  | 'nothing' // no errors found
  | 'fixed' // verified: the program now compiles and runs without raising
  | 'partial' // verified progress: compiles, but a runtime problem remains
  | 'none'; // could not produce a verified fix

export interface FixResult {
  status: FixStatus;
  original: string;
  code: string; // proposed code (equals original unless fixed/partial)
  changes: Change[];
  steps: { rule: string; reason: string }[];
  /** What is still wrong (for partial / none), as Python reports it. */
  remaining: Diag | null;
  /** The first problem Python reported in the original code. */
  initial: Diag | null;
  source: 'rules' | 'ai';
}
