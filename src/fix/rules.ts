import { editDistance, maxTypoDistance, nearest } from './distance';
import {
  KEYWORDS, codeTokens, logicalLineEnd, matchingCloser, offsetOf, replaceRange, tokenize, type Tok,
} from './lex';
import type { Candidate, Diag } from './types';

/** Everything a rule may look at. Rules only propose edits; the engine verifies them with Python. */
export interface Ctx {
  code: string;
  lines: string[];
  toks: Tok[];
  ct: Tok[]; // code tokens only (no comments / newlines)
  diag: Diag;
  bound: Set<string>;
  builtins: Set<string>;
}

type Rule = (ctx: Ctx) => Candidate[];

export function makeCtx(code: string, diag: Diag, bound: string[], builtins: string[]): Ctx {
  const toks = tokenize(code);
  return { code, lines: code.split('\n'), toks, ct: codeTokens(toks), diag, bound: new Set(bound), builtins: new Set(builtins) };
}

/* ---------------- helpers ---------------- */

const lineOf = (code: string, off: number) => {
  let n = 1;
  for (let i = 0; i < off && i < code.length; i++) if (code[i] === '\n') n++;
  return n;
};

function edit(ctx: Ctx, start: number, end: number, text: string, reason: string, rule: string, extraLines: number[] = []): Candidate {
  const code = replaceRange(ctx.code, start, end, text);
  const first = lineOf(ctx.code, start);
  const last = lineOf(ctx.code, Math.max(start, end - 1));
  const lines = new Set<number>([first, last, ...extraLines]);
  return { code, reason, rule, lines: [...lines] };
}

/** Several edits in one candidate (offsets refer to the original code; applied back to front). */
function multiEdit(ctx: Ctx, edits: { start: number; end: number; text: string }[], reason: string, rule: string): Candidate {
  let code = ctx.code;
  const lines = new Set<number>();
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    code = replaceRange(code, e.start, e.end, e.text);
    lines.add(lineOf(ctx.code, e.start));
  }
  return { code, reason, rule, lines: [...lines] };
}

const lineTokens = (ctx: Ctx, line: number) => ctx.ct.filter((t) => t.line === line);
const firstTokOfLine = (ctx: Ctx, line: number) => lineTokens(ctx, line)[0];
const isName = (t: Tok | undefined, text?: string) => !!t && t.type === 'name' && (text === undefined || t.text === text);
const isOp = (t: Tok | undefined, text: string) => !!t && t.type === 'op' && t.text === text;
const leadingWs = (s: string) => /^[ \t]*/.exec(s)![0];
const isBlank = (s: string) => s.trim() === '';

function detectUnit(lines: string[]): string {
  for (const l of lines) {
    const ws = leadingWs(l);
    if (ws && !isBlank(l)) return ws.includes('\t') ? '\t' : ' '.repeat(Math.min(8, Math.max(2, ws.length)));
  }
  return '    ';
}

function setIndent(ctx: Ctx, lineNo: number, indent: string, reason: string, rule: string): Candidate | null {
  const text = ctx.lines[lineNo - 1];
  if (text === undefined || isBlank(text)) return null;
  const ws = leadingWs(text);
  if (ws === indent) return null;
  const lines = [...ctx.lines];
  lines[lineNo - 1] = indent + text.slice(ws.length);
  return { code: lines.join('\n'), reason, rule, lines: [lineNo] };
}

/** Index in ctx.ct of the bracket that closes the opener at index i, or -1. */
function matchClose(ct: Tok[], i: number): number {
  let d = 0;
  for (let k = i; k < ct.length; k++) {
    if (ct[k].type !== 'op') continue;
    if ('([{'.includes(ct[k].text)) d++;
    else if (')]}'.includes(ct[k].text)) {
      d--;
      if (d === 0) return k;
    }
  }
  return -1;
}
function matchOpen(ct: Tok[], i: number): number {
  let d = 0;
  for (let k = i; k >= 0; k--) {
    if (ct[k].type !== 'op') continue;
    if (')]}'.includes(ct[k].text)) d++;
    else if ('([{'.includes(ct[k].text)) {
      d--;
      if (d === 0) return k;
    }
  }
  return -1;
}

/* ---------------- syntax rules ---------------- */

const COMPOUND = new Set(['if', 'elif', 'else', 'for', 'while', 'def', 'class', 'try', 'except', 'finally', 'with']);

const ruleElseIf: Rule = (ctx) => {
  const { diag, ct } = ctx;
  if (diag.kind !== 'syntax' || !diag.lineno) return [];
  const out: Candidate[] = [];
  for (let i = 0; i + 1 < ct.length; i++) {
    if (ct[i].line === diag.lineno && isName(ct[i], 'else') && isName(ct[i + 1], 'if') && ct[i + 1].line === diag.lineno) {
      out.push(edit(ctx, ct[i].start, ct[i + 1].end, 'elif', "Changed 'else if' to 'elif', which is how Python spells it", 'else-if'));
    }
  }
  return out;
};

const ruleColon: Rule = (ctx) => {
  const { diag, toks } = ctx;
  if (diag.kind !== 'syntax' || !diag.lineno) return [];
  const first = firstTokOfLine(ctx, diag.lineno);
  const expectsColon = /expected ':'/.test(diag.message);
  const looksLikeHeader = diag.message === 'invalid syntax' && first && COMPOUND.has(first.text) && first.type === 'name';
  if (!expectsColon && !looksLikeHeader) return [];
  const last = logicalLineEnd(toks, diag.lineno);
  if (!last || isOp(last, ':')) return [];
  const kw = first && COMPOUND.has(first.text) ? first.text : 'this line';
  const reason = `Added the missing colon after '${kw}'`;
  const out: Candidate[] = [];
  // a one-line statement (`for x in xs print(x)`): the colon goes where Python points, before the body
  if (diag.offset) {
    const at = offsetOf(ctx.code, diag.lineno, diag.offset);
    const tok = ctx.ct.find((t) => t.start === at && t.line === diag.lineno);
    if (tok && tok !== first && tok.start < last.start) {
      const prev = ctx.ct[ctx.ct.indexOf(tok) - 1];
      if (prev && !isOp(prev, ':')) out.push(edit(ctx, prev.end, prev.end, ':', reason, 'colon'));
    }
  }
  out.push(edit(ctx, last.end, last.end, ':', reason, 'colon'));
  return out;
};

const ruleBrackets: Rule = (ctx) => {
  const { diag, ct, code } = ctx;
  if (diag.kind !== 'syntax' || !diag.lineno || !diag.offset) return [];
  const out: Candidate[] = [];
  const at = offsetOf(code, diag.lineno, diag.offset);

  const never = /^'(.)' was never closed/.exec(diag.message);
  if (never) {
    const closer = matchingCloser[never[1]];
    if (!closer) return [];
    const lastLine = ctx.lines.length;
    for (let L = diag.lineno; L <= Math.min(lastLine, diag.lineno + 8); L++) {
      const toks = ctx.ct.filter((t) => t.line === L && t.start >= (L === diag.lineno ? at : 0));
      const t = toks[toks.length - 1];
      if (!t) continue;
      const pos = isOp(t, ':') ? t.start : t.end;
      out.push(edit(ctx, pos, pos, closer, `Added the missing '${closer}' to close the '${never[1]}'`, 'bracket-close'));
    }
    return out;
  }

  // `if (x > 3:`  - the colon shows up while a bracket is still open
  const atTok = ct.find((t) => t.start === at);
  if (atTok && atTok.type === 'op' && atTok.text === ':' && atTok.depth > 0) {
    const stack: string[] = [];
    for (const t of ct) {
      if (t.start >= atTok.start) break;
      if (t.line < diag.lineno - 3) continue;
      if (t.type === 'op' && '([{'.includes(t.text)) stack.push(t.text);
      else if (t.type === 'op' && ')]}'.includes(t.text)) stack.pop();
    }
    if (stack.length) {
      const closers = stack.reverse().map((o) => matchingCloser[o]).join('');
      return [edit(ctx, atTok.start, atTok.start, closers, `Added the missing '${closers}' before the colon`, 'bracket-before-colon')];
    }
  }

  const unmatched = /^unmatched '(.)'/.exec(diag.message);
  if (unmatched) {
    const tok = ct.find((t) => t.start === at && t.text === unmatched[1]);
    if (tok) out.push(edit(ctx, tok.start, tok.end, '', `Removed an extra '${tok.text}' that had no matching opening bracket`, 'bracket-extra'));
    return out;
  }

  const mismatch = /closing parenthesis '(.)' does not match opening parenthesis '(.)'/.exec(diag.message);
  if (mismatch) {
    const tok = ct.find((t) => t.start === at && t.text === mismatch[1]);
    const want = matchingCloser[mismatch[2]];
    if (tok && want) out.push(edit(ctx, tok.start, tok.end, want, `Changed '${tok.text}' to '${want}' so it matches the '${mismatch[2]}'`, 'bracket-mismatch'));
  }
  return out;
};

const ruleQuotes: Rule = (ctx) => {
  const { diag, toks, code } = ctx;
  if (diag.kind !== 'syntax' || !diag.lineno || !diag.offset) return [];
  const out: Candidate[] = [];
  if (/unterminated triple-quoted string/.test(diag.message)) {
    const at = offsetOf(code, diag.lineno, diag.offset);
    const tok = toks.find((t) => t.type === 'string' && t.unterminated && t.start <= at && at < t.end + 1);
    const body = tok ? tok.text.replace(/^[rRbBuUfF]*/, '') : '"""';
    const q = body.slice(0, 3);
    const end = code.trimEnd().length;
    out.push(edit(ctx, end, end, q, 'Closed the triple-quoted string', 'quote-triple'));
    return out;
  }
  if (!/unterminated string literal/.test(diag.message)) return [];
  const at = offsetOf(code, diag.lineno, diag.offset);
  const tok = toks.find((t) => t.type === 'string' && t.unterminated && t.line === diag.lineno && t.start <= at && at <= t.end);
  if (!tok) return [];
  const body = tok.text.replace(/^[rRbBuUfF]*/, '');
  const q = body[0];
  const reason = `Closed the string with a matching ${q}`;
  const trimmed = tok.text.replace(/\s+$/, '');
  // the other kind of quote at the end: 'hello"  ->  'hello'
  const other = q === '"' ? "'" : '"';
  if (trimmed.length > 1 && trimmed.endsWith(other)) {
    out.push(edit(ctx, tok.start + trimmed.length - 1, tok.start + trimmed.length, q, `Changed the ending ${other} to ${q} so it matches the opening quote`, 'quote-swap'));
  }
  // before trailing closing brackets and a trailing comment: print("hi)  ->  print("hi")
  const m = /([)\]}]+)(\s*#.*)?\s*$/.exec(trimmed);
  if (m && m.index > 0) out.push(edit(ctx, tok.start + m.index, tok.start + m.index, q, reason, 'quote-before-closers'));
  const noComment = trimmed.replace(/\s*#.*$/, '');
  out.push(edit(ctx, tok.start + noComment.length, tok.start + noComment.length, q, reason, 'quote-end'));
  return out;
};

const VALUE_END = (t: Tok) => t.type === 'number' || t.type === 'string' || (t.type === 'name' && (!KEYWORDS.has(t.text) || ['None', 'True', 'False'].includes(t.text))) || (t.type === 'op' && ')]}'.includes(t.text));
const VALUE_START = (t: Tok) => t.type === 'number' || t.type === 'string' || (t.type === 'name' && (!KEYWORDS.has(t.text) || ['None', 'True', 'False', 'lambda', 'not'].includes(t.text))) || (t.type === 'op' && '([{'.includes(t.text));

const ruleComma: Rule = (ctx) => {
  const { diag, ct, code } = ctx;
  if (diag.kind !== 'syntax' || !diag.lineno || !diag.offset) return [];
  if (!/forgot a comma/.test(diag.message)) return [];
  const from = offsetOf(code, diag.lineno, diag.offset);
  const to = diag.endLineno && diag.endOffset ? offsetOf(code, diag.endLineno, diag.endOffset) : code.length;
  const out: Candidate[] = [];
  for (let i = 0; i + 1 < ct.length; i++) {
    const a = ct[i];
    const b = ct[i + 1];
    if (a.start < from || b.end > to) continue;
    if (VALUE_END(a) && VALUE_START(b) && a.depth >= 1) {
      out.push(edit(ctx, a.end, a.end, ',', 'Added the missing comma between items', 'comma'));
    }
  }
  return out;
};

const ruleIndent: Rule = (ctx) => {
  const { diag, lines } = ctx;
  if (diag.kind !== 'syntax') return [];
  const L = diag.lineno ?? 0;
  const unit = detectUnit(lines);
  const out: Candidate[] = [];

  const block = /expected an indented block after (.+?) on line (\d+)|expected an indented block after (.+)$/.exec(diag.message);
  if (block) {
    const hdr = block[2] ? Number(block[2]) : Math.max(1, L - 1);
    const hdrText = lines[hdr - 1] ?? '';
    const want = leadingWs(hdrText) + unit;
    const body = L > hdr ? lines[L - 1] : undefined; // Python points at the header itself when the file ends
    const addPass = () => {
      const copy = [...lines];
      copy.splice(hdr, 0, want + 'pass');
      return { code: copy.join('\n'), reason: "Added 'pass' so the empty block has a body", rule: 'indent-pass', lines: [hdr] };
    };
    // A blank line between the header and the next code suggests that code was meant to come after the block.
    const gap = L > hdr + 1 && lines.slice(hdr, L - 1).every(isBlank);
    if (gap) out.push(addPass());
    if (body !== undefined && !isBlank(body) && L > hdr) {
      const isDef = /^\s*(def|class)\b/.test(hdrText);
      const one = setIndent(ctx, L, want, 'Indented this line so it sits inside the block', 'indent-body');
      let many: Candidate | null = null;
      if (isDef) {
        const copy = [...lines];
        const base = leadingWs(body);
        const defName = /^\s*(?:def|class)\s+([A-Za-z_]\w*)/.exec(hdrText)?.[1];
        const callsIt = defName ? new RegExp(`(^|[^\\w.])${defName}\\s*\\(`) : null;
        for (let k = L - 1; k < copy.length; k++) {
          const t = copy[k];
          if (isBlank(t) || leadingWs(t).length < base.length) break; // a blank line ends the block
          if (leadingWs(t) === base && /^(def|class)\b/.test(t.trim()) && k > L - 1) break;
          if (k > L - 1 && callsIt && callsIt.test(t)) break; // a call of the function is not part of its body
          copy[k] = want + t.slice(base.length);
        }
        many = { code: copy.join('\n'), reason: 'Indented the lines of the block so they sit inside it', rule: 'indent-block', lines: [L] };
      }
      if (many) out.push(many);
      if (one) out.push(one);
    }
    if (!gap && (body === undefined || isBlank(body) || L > lines.length)) out.push(addPass());
    return out;
  }

  if (/unexpected indent/.test(diag.message) && L) {
    let p = L - 2;
    while (p >= 0 && isBlank(lines[p])) p--;
    const prevIndent = p >= 0 ? leadingWs(lines[p]) : '';
    const c = setIndent(ctx, L, prevIndent, 'Removed the extra indentation so this line lines up with the one above', 'indent-unexpected');
    if (c) out.push(c);
    const cur = leadingWs(lines[L - 1] ?? '');
    if (cur.endsWith(unit)) {
      const c2 = setIndent(ctx, L, cur.slice(0, cur.length - unit.length), 'Removed one level of indentation', 'indent-unexpected');
      if (c2) out.push(c2);
    }
    return out;
  }

  if (/unindent does not match/.test(diag.message) && L) {
    const levels = new Set<string>(['']);
    for (let k = 0; k < L - 1; k++) if (!isBlank(lines[k])) levels.add(leadingWs(lines[k]));
    const cur = leadingWs(lines[L - 1] ?? '').length;
    let p = L - 2;
    while (p >= 0 && isBlank(lines[p])) p--;
    const prev = p >= 0 ? leadingWs(lines[p]) : '';
    const word = (lines[L - 1] ?? '').trim().split(/[\s:(]/)[0];
    const preferred: string[] = [];
    if (['else', 'elif', 'except', 'finally'].includes(word)) {
      // line up with the if / try / for / while this branch belongs to
      for (let k = L - 2; k >= 0; k--) {
        const t = lines[k].trim();
        if (/^(if|elif|try|for|while|except)\b/.test(t) && leadingWs(lines[k]).length < prev.length) {
          preferred.push(leadingWs(lines[k]));
          break;
        }
      }
    }
    const rest = [...levels].sort((a, b) => Math.abs(a.length - cur) - Math.abs(b.length - cur));
    for (const lv of [...new Set([...preferred, prev, ...rest])]) {
      const c = setIndent(ctx, L, lv, 'Lined this line up with the block it belongs to', 'indent-unindent');
      if (c) out.push(c);
    }
    return out;
  }

  // `else:` indented like the body it follows: line it up with its `if` (or try / for / while)
  const branch = L ? /^(\s*)(else|elif|except|finally)\b/.exec(lines[L - 1] ?? '') : null;
  if (branch && diag.message === 'invalid syntax') {
    const cur = branch[1].length;
    for (let k = L - 2; k >= 0; k--) {
      const t = lines[k];
      if (isBlank(t)) continue;
      const ind = leadingWs(t);
      if (ind.length < cur && /^(if|elif|try|except|for|while)\b/.test(t.trim())) {
        const c = setIndent(ctx, L, ind, `Lined up '${branch[2]}' with the '${t.trim().split(/[\s:(]/)[0]}' it belongs to`, 'indent-branch');
        if (c) out.push(c);
        break;
      }
      if (ind.length < cur) break;
    }
  }

  if (diag.type === 'TabError' || /inconsistent use of tabs/.test(diag.message)) {
    const fixed = lines.map((l) => {
      const ws = leadingWs(l);
      return ws.replace(/\t/g, '    ') + l.slice(ws.length);
    });
    if (fixed.join('\n') !== ctx.code) {
      out.push({ code: fixed.join('\n'), reason: 'Replaced tabs with spaces so the indentation is consistent', rule: 'indent-tabs', lines: lines.map((_, i) => i + 1).filter((i) => fixed[i - 1] !== lines[i - 1]) });
    }
  }
  return out;
};

const ruleEqualsInCondition: Rule = (ctx) => {
  const { diag, ct } = ctx;
  if (diag.kind !== 'syntax' || !diag.lineno) return [];
  const hint = /Maybe you meant '==' or ':='/.test(diag.message);
  const first = firstTokOfLine(ctx, diag.lineno);
  const cond = first && ['if', 'elif', 'while'].includes(first.text) && first.type === 'name';
  if (!hint && !(cond && diag.message === 'invalid syntax')) return [];
  const out: Candidate[] = [];
  const lineToks = ct.filter((t) => t.line === diag.lineno);
  const colonIdx = lineToks.findIndex((t) => isOp(t, ':') && t.depth === 0);
  const scan = colonIdx >= 0 ? lineToks.slice(0, colonIdx) : lineToks;
  for (const t of scan) {
    if (isOp(t, '=')) out.push(edit(ctx, t.start, t.end, '==', "Used == to compare; a single = would store a value instead", 'equals'));
  }
  return out;
};

const STATEMENT_KW = ['if', 'elif', 'else', 'for', 'while', 'def', 'class', 'try', 'except', 'finally', 'with', 'return', 'import', 'from', 'pass', 'break', 'continue', 'raise', 'global', 'del', 'assert', 'yield'];
const INFIX_KW = ['in', 'is', 'and', 'or', 'not', 'as', 'else', 'if', 'for', 'import', 'from', 'lambda'];
const LOWER_KW = [...KEYWORDS].filter((k) => !['True', 'False', 'None'].includes(k));

const ruleKeywordTypos: Rule = (ctx) => {
  const { diag, ct } = ctx;
  if (diag.kind !== 'syntax' || !diag.lineno) return [];
  const lineSet = new Set([diag.lineno, diag.lineno - 1].filter((n) => n >= 1));
  const scored: { c: Candidate; dist: number; plausible: number; pos: number }[] = [];
  for (const [i, t] of ct.entries()) {
    if (t.type !== 'name' || !lineSet.has(t.line) || KEYWORDS.has(t.text)) continue;
    if (ct[i - 1] && isOp(ct[i - 1], '.')) continue;
    if (ctx.bound.has(t.text) || ctx.builtins.has(t.text)) continue;
    const isFirst = !ct[i - 1] || ct[i - 1].line !== t.line;
    for (const kw of LOWER_KW) {
      const sameWord = t.text.toLowerCase() === kw;
      const dist = sameWord ? 0 : editDistance(t.text, kw);
      if (!sameWord && (t.text.length < 3 || dist > maxTypoDistance(Math.max(t.text.length, kw.length)))) continue;
      const plausible = (isFirst && STATEMENT_KW.includes(kw)) || (!isFirst && INFIX_KW.includes(kw)) ? 0 : 1;
      const reason = sameWord
        ? `Python keywords are written in lowercase: '${kw}'`
        : `Fixed the spelling of '${kw}'`;
      scored.push({ c: edit(ctx, t.start, t.end, kw, reason, sameWord ? 'keyword-case' : 'keyword-typo'), dist, plausible, pos: Math.abs(t.line - diag.lineno) });
    }
  }
  scored.sort((a, b) => a.dist - b.dist || a.plausible - b.plausible || a.pos - b.pos);
  return scored.slice(0, 8).map((s) => s.c);
};

const rulePython2Print: Rule = (ctx) => {
  const { diag, ct, code } = ctx;
  if (diag.kind !== 'syntax' || !diag.lineno) return [];
  if (!/Missing parentheses in call to 'print'/.test(diag.message)) return [];
  const toks = ct.filter((t) => t.line === diag.lineno);
  const i = toks.findIndex((t) => isName(t, 'print'));
  if (i < 0 || i + 1 >= toks.length) return [];
  const rest = toks.slice(i + 1);
  const last = rest[rest.length - 1];
  const next = code.slice(0, last.end) + ')' + code.slice(last.end);
  const withOpen = next.slice(0, toks[i].end) + '(' + next.slice(rest[0].start);
  return [{ code: withOpen, reason: 'Added parentheses: in Python 3, print is a function', rule: 'print2', lines: [diag.lineno] }];
};

const SMART: Record<string, string> = { '“': '"', '”': '"', '‘': "'", '’': "'", '–': '-', '—': '-', ' ': ' ' };
const ruleSpecialChars: Rule = (ctx) => {
  const { diag, toks } = ctx;
  if (diag.kind !== 'syntax' || !/invalid (non-printable )?character/.test(diag.message)) return [];
  const edits = toks.filter((t) => t.type === 'op' && SMART[t.text]).map((t) => ({ start: t.start, end: t.end, text: SMART[t.text] }));
  if (!edits.length) return [];
  return [multiEdit(ctx, edits, 'Replaced curly quotes and special characters with plain ones', 'special-chars')];
};

/* ---------------- runtime rules ---------------- */

const KNOWN_MODULES = ['math', 'random', 'time', 'datetime', 'os', 'sys', 'json', 're', 'string', 'collections', 'itertools', 'statistics', 'numpy', 'pandas', 'matplotlib', 'scipy', 'turtle'];
const MODULE_ALIASES: Record<string, string> = { np: 'import numpy as np', pd: 'import pandas as pd', plt: 'import matplotlib.pyplot as plt' };
const FROM_IMPORTS: Record<string, string> = {
  sqrt: 'math', floor: 'math', ceil: 'math', pi: 'math', sin: 'math', cos: 'math', tan: 'math', factorial: 'math', log: 'math',
  randint: 'random', choice: 'random', shuffle: 'random', randrange: 'random', sleep: 'time',
};
const PY2_NAMES: Record<string, string> = { raw_input: 'input', xrange: 'range', unicode: 'str', unichr: 'chr' };

function importInsertLine(lines: string[]): number {
  let i = 0;
  while (i < lines.length && (isBlank(lines[i]) || lines[i].trim().startsWith('#'))) i++;
  const first = lines[i]?.trim() ?? '';
  const triple = /^[rRuU]?("""|''')/.exec(first);
  if (triple) {
    const q = triple[1];
    if (first.indexOf(q, triple[0].length) >= 0) i++;
    else {
      i++;
      while (i < lines.length && !lines[i].includes(q)) i++;
      i++;
    }
  }
  let last = i;
  let j = i;
  while (j < lines.length) {
    const t = lines[j].trim();
    if (/^(import|from)\s/.test(t)) {
      last = j + 1;
      j++;
    } else if (isBlank(t) || t.startsWith('#')) j++;
    else break;
  }
  return last;
}

function nameOccurrences(ctx: Ctx, name: string, line: number): Tok[] {
  const { ct } = ctx;
  const out: Tok[] = [];
  for (const [i, t] of ct.entries()) {
    if (t.line !== line || t.type !== 'name' || t.text !== name) continue;
    if (isOp(ct[i - 1], '.')) continue;
    if (isOp(ct[i + 1], '=') && t.depth > 0 && (isOp(ct[i - 1], '(') || isOp(ct[i - 1], ','))) continue; // keyword argument
    out.push(t);
  }
  return out;
}

function replaceAll(ctx: Ctx, toks: Tok[], text: string, reason: string, rule: string): Candidate | null {
  if (!toks.length) return null;
  return multiEdit(ctx, toks.map((t) => ({ start: t.start, end: t.end, text })), reason, rule);
}

const ruleNameError: Rule = (ctx) => {
  const { diag } = ctx;
  if (diag.type !== 'NameError' || !diag.lineno) return [];
  const m = /name '(.+?)' is not defined/.exec(diag.message);
  if (!m) return [];
  const X = m[1];
  const occ = nameOccurrences(ctx, X, diag.lineno);
  if (!occ.length) return [];
  const out: Candidate[] = [];
  const push = (c: Candidate | null) => c && out.push(c);

  if (PY2_NAMES[X]) push(replaceAll(ctx, occ, PY2_NAMES[X], `Python 3 calls this '${PY2_NAMES[X]}'`, 'py2-name'));
  const consts: Record<string, string> = { true: 'True', false: 'False', none: 'None', null: 'None' };
  const lower = X.toLowerCase();
  if (consts[lower]) push(replaceAll(ctx, occ, consts[lower], `Capital letters matter in Python: it's '${consts[lower]}'`, 'case'));

  const pool = [...ctx.bound, ...[...ctx.builtins].filter((b) => /^[a-z]/.test(b) || b === 'True')];
  for (const name of pool) {
    if (name !== X && name.toLowerCase() === lower) push(replaceAll(ctx, occ, name, `Capital letters matter in Python: it's '${name}'`, 'case'));
  }
  // The typo may be where the name is created (`tottal = 0`, then `total` used everywhere after):
  // then fix that one spot instead of "fixing" every correct use to match it.
  const uses = (n: string) => ctx.ct.filter((t, i) => t.type === 'name' && t.text === n && !isOp(ctx.ct[i - 1], '.')).length;
  for (const { name: B } of nearest(X, [...ctx.bound], 2)) {
    if (uses(X) > uses(B)) {
      const defs = ctx.ct.filter((t, i) => t.type === 'name' && t.text === B && !isOp(ctx.ct[i - 1], '.'));
      push(multiEdit(ctx, defs.map((t) => ({ start: t.start, end: t.end, text: X })), `Changed '${B}' to '${X}' so it matches the name used later`, 'typo-definition'));
    }
  }
  if (diag.suggestion && diag.suggestion !== X) push(replaceAll(ctx, occ, diag.suggestion, `Changed '${X}' to '${diag.suggestion}' (spelling)`, 'typo'));
  for (const { name } of nearest(X, pool, 4)) push(replaceAll(ctx, occ, name, `Changed '${X}' to '${name}' (spelling)`, 'typo'));

  const insertAt = importInsertLine(ctx.lines);
  const addLine = (text: string, reason: string) => {
    const copy = [...ctx.lines];
    copy.splice(insertAt, 0, text);
    out.push({ code: copy.join('\n'), reason, rule: 'import', lines: [Math.max(1, insertAt)] });
  };
  if (KNOWN_MODULES.includes(X)) addLine(`import ${X}`, `Added 'import ${X}' because the program uses ${X}`);
  if (MODULE_ALIASES[X]) addLine(MODULE_ALIASES[X], `Added '${MODULE_ALIASES[X]}' because the program uses ${X}`);
  if (FROM_IMPORTS[X]) addLine(`from ${FROM_IMPORTS[X]} import ${X}`, `Added 'from ${FROM_IMPORTS[X]} import ${X}' because the program uses ${X}`);

  // print(Hello) -> print("Hello"): a word that was probably meant as text
  const at = ctx.ct.findIndex((t) => t === occ[0]);
  if (/^[A-Z]/.test(X) && isOp(ctx.ct[at - 1], '(') && isName(ctx.ct[at - 2], 'print') && isOp(ctx.ct[at + 1], ')')) {
    push(edit(ctx, occ[0].start, occ[0].end, `"${X}"`, `Put quotes around ${X} so Python treats it as text`, 'quote-word'));
  }
  return out;
};

const STR_METHODS = ['upper', 'lower', 'strip', 'lstrip', 'rstrip', 'split', 'join', 'replace', 'find', 'startswith', 'endswith', 'title', 'capitalize', 'format', 'count', 'index', 'isdigit', 'isalpha'];
const LIST_METHODS = ['append', 'extend', 'insert', 'remove', 'pop', 'sort', 'reverse', 'index', 'count', 'copy', 'clear'];
const DICT_METHODS = ['keys', 'values', 'items', 'get', 'update', 'pop', 'setdefault', 'clear', 'copy'];

const ruleAttributeError: Rule = (ctx) => {
  const { diag, ct } = ctx;
  if (diag.type !== 'AttributeError' || !diag.lineno) return [];
  const m = /object has no attribute '(.+?)'|module '.+?' has no attribute '(.+?)'/.exec(diag.message);
  const attr = m?.[1] ?? m?.[2];
  if (!attr) return [];
  const typeName = /^'(\w+)' object/.exec(diag.message)?.[1];
  const pool = typeName === 'str' ? STR_METHODS : typeName === 'list' ? LIST_METHODS : typeName === 'dict' ? DICT_METHODS : [];
  const names: string[] = [];
  if (diag.suggestion) names.push(diag.suggestion);
  for (const p of pool) if (p.toLowerCase() === attr.toLowerCase()) names.push(p);
  for (const n of nearest(attr, pool, 3)) names.push(n.name);
  const out: Candidate[] = [];
  const toks = ct.filter((t, i) => t.line === diag.lineno && t.type === 'name' && t.text === attr && isOp(ct[i - 1], '.'));
  for (const name of [...new Set(names)]) {
    for (const t of toks) out.push(edit(ctx, t.start, t.end, name, `Changed '.${attr}' to '.${name}' (spelling)`, 'attr-typo'));
  }
  return out;
};

const ruleModuleNotFound: Rule = (ctx) => {
  const { diag, ct } = ctx;
  if (diag.type !== 'ModuleNotFoundError' || !diag.lineno) return [];
  const m = /No module named '(.+?)'/.exec(diag.message);
  if (!m) return [];
  const top = m[1].split('.')[0];
  const out: Candidate[] = [];
  for (const near of nearest(top, KNOWN_MODULES, 2)) {
    for (const t of ct.filter((x) => x.line === diag.lineno && x.type === 'name' && x.text === top)) {
      out.push(edit(ctx, t.start, t.end, near.name, `Changed the module name '${top}' to '${near.name}' (spelling)`, 'module-typo'));
    }
  }
  return out;
};

/* ----- text vs number ----- */

function primaryEnd(ct: Tok[], i: number): number {
  const t = ct[i];
  if (!t) return -1;
  let j: number;
  if (t.type === 'name' && !KEYWORDS.has(t.text) || t.type === 'number' || t.type === 'string' || (t.type === 'name' && ['None', 'True', 'False'].includes(t.text))) j = i + 1;
  else if (t.type === 'op' && '([{'.includes(t.text)) {
    const c = matchClose(ct, i);
    if (c < 0) return -1;
    j = c + 1;
  } else return -1;
  for (;;) {
    const n = ct[j];
    if (n && isOp(n, '.') && ct[j + 1]?.type === 'name') j += 2;
    else if (n && (isOp(n, '(') || isOp(n, '['))) {
      const c = matchClose(ct, j);
      if (c < 0) break;
      j = c + 1;
    } else break;
  }
  return j;
}
const MULT = new Set(['*', '/', '//', '%', '**']);

function operandAfter(ct: Tok[], plus: number): [number, number] | null {
  let i = plus + 1;
  if (isOp(ct[i], '-')) i++;
  let end = primaryEnd(ct, i);
  if (end < 0) return null;
  const start = isOp(ct[plus + 1], '-') ? plus + 1 : i;
  while (ct[end] && ct[end].type === 'op' && MULT.has(ct[end].text)) {
    const e2 = primaryEnd(ct, end + 1);
    if (e2 < 0) break;
    end = e2;
  }
  return [start, end - 1];
}

function primaryStart(ct: Tok[], k: number): number {
  let i = k;
  for (;;) {
    const t = ct[i];
    if (!t) return -1;
    if (t.type === 'op' && ')]}'.includes(t.text)) {
      const o = matchOpen(ct, i);
      if (o < 0) return -1;
      const prev = ct[o - 1];
      if (prev && ((prev.type === 'name' && !KEYWORDS.has(prev.text)) || (prev.type === 'op' && ')]'.includes(prev.text))) && !isOp(ct[o], '{')) {
        i = o - 1;
        continue;
      }
      return o;
    }
    if (t.type === 'name' || t.type === 'number' || t.type === 'string') {
      if (i >= 2 && isOp(ct[i - 1], '.') && (ct[i - 2].type === 'name' || (ct[i - 2].type === 'op' && ')]'.includes(ct[i - 2].text)))) {
        i -= 2;
        continue;
      }
      return i;
    }
    return -1;
  }
}

function operandBefore(ct: Tok[], plus: number): [number, number] | null {
  let s = primaryStart(ct, plus - 1);
  if (s < 0) return null;
  while (s >= 2 && ct[s - 1].type === 'op' && MULT.has(ct[s - 1].text)) {
    const s2 = primaryStart(ct, s - 2);
    if (s2 < 0) break;
    s = s2;
  }
  return [s, plus - 1];
}

const isStringLiteral = (ct: Tok[], [a, b]: [number, number]) => a === b && ct[a].type === 'string';

const ruleTextPlusNumber: Rule = (ctx) => {
  const { diag, ct } = ctx;
  if (diag.type !== 'TypeError' || !diag.lineno) return [];
  const msg = diag.message;
  let sides: Array<'left' | 'right'> | null = null;
  if (/can only concatenate str \(not "(int|float|bool)"\) to str/.test(msg)) sides = ['right'];
  else {
    const m = /unsupported operand type\(s\) for \+: '(\w+)' and '(\w+)'/.exec(msg);
    if (m && m[2] === 'str' && m[1] !== 'str') sides = ['left'];
    else if (m && m[1] === 'str' && m[2] !== 'str') sides = ['right'];
    else if (/must be str, not/.test(msg)) sides = ['right'];
  }
  if (!sides) return [];
  const out: Candidate[] = [];
  for (const [i, t] of ct.entries()) {
    if (t.line !== diag.lineno || !isOp(t, '+')) continue;
    for (const side of sides) {
      const span = side === 'left' ? operandBefore(ct, i) : operandAfter(ct, i);
      if (!span || isStringLiteral(ct, span)) continue;
      const first = ct[span[0]];
      const last = ct[span[1]];
      if (isName(first, 'str') && isOp(ct[span[0] + 1], '(')) continue; // already wrapped
      const text = ctx.code.slice(first.start, last.end);
      out.push(edit(ctx, first.start, last.end, `str(${text})`, `Wrapped ${text.length > 24 ? 'the number' : text} in str() so it can be joined to text`, 'text-plus-number'));
    }
  }
  return out;
};

const FLOATISH = /price|cost|height|weight|temp|rate|salary|amount|money|balance|average|gpa|percent|distance|speed|score|grade/i;

const ruleInputAsNumber: Rule = (ctx) => {
  const { diag, ct, lines } = ctx;
  if (diag.kind !== 'runtime' || !diag.lineno) return [];
  const msg = diag.message;
  const concat = /can only concatenate str \(not "(int|float)"\) to str/.test(msg);
  const relevant =
    concat ||
    /'(<|>|<=|>=)' not supported between instances of '(str|int|float)' and '(str|int|float)'/.test(msg) ||
    /unsupported operand type\(s\) for (\+|-|\*|\/|%|\*\*|\/\/): '(str|int|float)' and '(str|int|float)'/.test(msg) ||
    /can't multiply sequence by non-int of type 'float'/.test(msg) ||
    /'str' object cannot be interpreted as an integer/.test(msg) ||
    /not supported between instances of 'str'/.test(msg);
  if (!relevant) return [];

  // names assigned straight from input()
  const fromInput = new Map<string, number>();
  lines.forEach((l, i) => {
    const m = /^\s*([A-Za-z_]\w*)\s*=\s*input\s*\(/.exec(l);
    if (m) fromInput.set(m[1], i + 1);
  });
  const wrapTargets: { line: number; why: string }[] = [];
  const errLine = ct.filter((t) => t.line === diag.lineno);
  for (const [k, t] of errLine.entries()) {
    if (t.type !== 'name' || !fromInput.has(t.text)) continue;
    // "text" + number only counts when an input() variable is directly added to a number
    if (concat && !(isOp(errLine[k + 1], '+') && errLine[k + 2]?.type === 'number')) continue;
    wrapTargets.push({ line: fromInput.get(t.text)!, why: t.text });
  }
  // a direct input() call on the error line
  for (const [i, t] of ct.entries()) {
    if (!concat && t.line === diag.lineno && isName(t, 'input') && isOp(ct[i + 1], '(') && !(isOp(ct[i - 1], '(') && ['int', 'float', 'str'].includes(ct[i - 2]?.text ?? ''))) {
      wrapTargets.push({ line: diag.lineno, why: 'input()' });
    }
  }
  const out: Candidate[] = [];
  const seen = new Set<number>();
  for (const { line, why } of wrapTargets) {
    if (seen.has(line)) continue;
    seen.add(line);
    const idx = ct.findIndex((t, i) => t.line === line && isName(t, 'input') && isOp(ct[i + 1], '('));
    if (idx < 0) continue;
    const close = matchClose(ct, idx + 1);
    if (close < 0) continue;
    const text = lines[line - 1] + (lines[diag.lineno - 1] ?? '');
    const floatFirst = /\d+\.\d+/.test(text) || FLOATISH.test(why) || FLOATISH.test(lines[line - 1].split('=')[0]);
    const kinds = floatFirst ? ['float', 'int'] : ['int', 'float'];
    for (const kind of kinds) {
      out.push(
        multiEdit(
          ctx,
          [
            { start: ct[idx].start, end: ct[idx].start, text: `${kind}(` },
            { start: ct[close].end, end: ct[close].end, text: ')' },
          ],
          `input() always gives text, so wrapped it in ${kind}() to use it as a number`,
          'input-number',
        ),
      );
    }
  }
  return out;
};

const ruleIndexError: Rule = (ctx) => {
  const { diag, ct } = ctx;
  if (diag.type !== 'IndexError') return [];
  const out: Candidate[] = [];
  for (let i = 0; i + 8 < ct.length; i++) {
    const w = ct.slice(i, i + 9).map((t) => t.text);
    if (w[0] === 'range' && w[1] === '(' && w[2] === 'len' && w[3] === '(' && w[5] === ')' && w[6] === '+' && w[7] === '1' && w[8] === ')') {
      out.push(edit(ctx, ct[i + 5].end, ct[i + 7].end, '', `Changed range(len(${w[4]}) + 1) to range(len(${w[4]})): list positions stop at len - 1`, 'range-off-by-one'));
    }
  }
  if (diag.lineno) {
    for (let i = 0; i + 6 < ct.length; i++) {
      const t = ct[i];
      if (t.line !== diag.lineno || t.type !== 'name') continue;
      const [a, b, c, d, e, f] = ct.slice(i + 1, i + 7);
      if (isOp(a, '[') && isName(b, 'len') && isOp(c, '(') && isName(d, t.text) && isOp(e, ')') && isOp(f, ']')) {
        out.push(edit(ctx, e.end, e.end, ' - 1', `The last item of ${t.text} is at position len(${t.text}) - 1`, 'last-index'));
      }
    }
  }
  return out;
};

/** Order matters: the engine tries candidates in this order and keeps the first that verifies. */
const RULES: Rule[] = [
  ruleSpecialChars,
  ruleElseIf,
  rulePython2Print,
  ruleEqualsInCondition,
  ruleColon,
  ruleBrackets,
  ruleQuotes,
  ruleComma,
  ruleIndent,
  ruleKeywordTypos,
  ruleNameError,
  ruleAttributeError,
  ruleModuleNotFound,
  ruleInputAsNumber,
  ruleTextPlusNumber,
  ruleIndexError,
];

export function generateCandidates(ctx: Ctx): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>([ctx.code]);
  for (const rule of RULES) {
    for (const c of rule(ctx)) {
      if (seen.has(c.code)) continue;
      seen.add(c.code);
      out.push(c);
    }
  }
  return out;
}
