/** A small Python-aware lexer. It does not need to be a full tokenizer: it finds the pieces
 * the fix rules care about (names, strings, brackets, operators) with exact positions,
 * and never throws on broken code. */

export type TokType = 'name' | 'number' | 'string' | 'op' | 'comment' | 'newline';

export interface Tok {
  type: TokType;
  text: string;
  line: number; // 1-based
  col: number; // 0-based
  start: number; // absolute offsets, end exclusive
  end: number;
  depth: number; // bracket depth; an opener and its closer share the same value
  unterminated?: boolean;
}

export const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

const OPS = [
  '**=', '//=', '>>=', '<<=', '...', '->', ':=', '==', '!=', '<=', '>=', '**', '//', '+=', '-=', '*=', '/=', '%=',
  '&=', '|=', '^=', '<<', '>>', '<>',
];
const NAME_START = /[\p{L}_]/u;
const NAME_PART = /[\p{L}\p{N}_]/u;
const OPEN = '([{';
const CLOSE = ')]}';

export function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let depth = 0;
  const n = src.length;

  const push = (type: TokType, start: number, end: number, extra: Partial<Tok> = {}) => {
    toks.push({ type, text: src.slice(start, end), line, col: start - lineStart, start, end, depth, ...extra });
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      push('newline', i, i + 1);
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') {
      i++;
      continue;
    }
    if (c === '\\' && src[i + 1] === '\n') {
      i += 2;
      line++;
      lineStart = i;
      continue;
    }
    if (c === '#') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      push('comment', i, j);
      i = j;
      continue;
    }
    // strings, with optional prefix
    const sm = /^([rRbBuUfF]{1,2})?(['"])/.exec(src.slice(i, i + 3));
    if (sm) {
      const prefixLen = sm[1]?.length ?? 0;
      const q = sm[2];
      const qStart = i + prefixLen;
      const triple = src.startsWith(q.repeat(3), qStart);
      const startLine = line;
      const startCol = i - lineStart;
      let j = qStart + (triple ? 3 : 1);
      let closed = false;
      for (; j < n; j++) {
        const ch = src[j];
        if (ch === '\\') {
          if (src[j + 1] === '\n') {
            line++;
            lineStart = j + 2;
          }
          j++;
          continue;
        }
        if (triple) {
          if (ch === '\n') {
            line++;
            lineStart = j + 1;
          }
          if (src.startsWith(q.repeat(3), j)) {
            j += 3;
            closed = true;
            break;
          }
        } else {
          if (ch === '\n') break;
          if (ch === q) {
            j++;
            closed = true;
            break;
          }
        }
      }
      if (j > n) j = n;
      toks.push({
        type: 'string', text: src.slice(i, j), line: startLine, col: startCol, start: i, end: j, depth,
        ...(closed ? {} : { unterminated: true }),
      });
      i = j;
      continue;
    }
    if (NAME_START.test(c)) {
      let j = i + 1;
      while (j < n && NAME_PART.test(src[j])) j++;
      push('name', i, j);
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xXoObB][0-9a-fA-F_]+|(\d[\d_]*)?\.?\d*([eE][+-]?\d+)?[jJ]?)/.exec(src.slice(i));
      const len = Math.max(1, m ? m[0].length : 1);
      push('number', i, i + len);
      i += len;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i)) ?? c;
    if (OPEN.includes(op)) {
      push('op', i, i + 1);
      depth++;
      i++;
      continue;
    }
    if (CLOSE.includes(op)) {
      depth = Math.max(0, depth - 1);
      push('op', i, i + 1);
      i++;
      continue;
    }
    push('op', i, i + op.length);
    i += op.length;
  }
  return toks;
}

export const lineStarts = (src: string): number[] => {
  const out = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') out.push(i + 1);
  return out;
};

/**
 * Absolute offset of a 1-based line / 1-based column as Python reports them. Python counts columns in
 * code points; JavaScript strings count UTF-16 units, so an emoji earlier on the line shifts things.
 */
export function offsetOf(src: string, line: number, col1: number): number {
  const starts = lineStarts(src);
  const base = starts[Math.min(Math.max(line, 1), starts.length) - 1] ?? 0;
  const lineEnd = src.indexOf('\n', base) < 0 ? src.length : src.indexOf('\n', base);
  return base + codePointsToUnits(src.slice(base, lineEnd), Math.max(0, col1 - 1));
}

/** UTF-16 length of the first `points` code points of `text` (past the end counts as plain units). */
export function codePointsToUnits(text: string, points: number): number {
  let units = 0;
  let seen = 0;
  for (const ch of text) {
    if (seen >= points) return units;
    units += ch.length;
    seen++;
  }
  return units + Math.max(0, points - seen);
}

export const matchingCloser: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
export const matchingOpener: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/** Tokens that are not comments or newlines. */
export const codeTokens = (toks: Tok[]) => toks.filter((t) => t.type !== 'comment' && t.type !== 'newline');

/** The last non-comment token of the logical line that starts on `line` (follows open brackets across lines). */
export function logicalLineEnd(toks: Tok[], line: number): Tok | null {
  let i = toks.findIndex((t) => t.line === line && t.type !== 'newline' && t.type !== 'comment');
  if (i < 0) return null;
  let last: Tok | null = null;
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === 'newline') {
      if (t.depth === 0) break;
      continue;
    }
    if (t.type === 'comment') continue;
    last = t;
  }
  return last;
}

/** Index in `toks` of the token starting at or after a 1-based line/column. */
export function tokenAt(toks: Tok[], src: string, line: number, col1: number): number {
  const off = offsetOf(src, line, col1);
  return toks.findIndex((t) => t.end > off && t.type !== 'newline');
}

export function lineText(src: string, line: number): string {
  return src.split('\n')[line - 1] ?? '';
}

export function replaceRange(src: string, start: number, end: number, text: string): string {
  return src.slice(0, start) + text + src.slice(end);
}
