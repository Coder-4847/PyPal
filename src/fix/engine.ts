import { diffLines } from './diff';
import { offsetOf } from './lex';
import { generateCandidates, makeCtx } from './rules';
import type { Candidate, Change, Diag, FixEnv, FixResult, Hunk } from './types';

export const MAX_PASSES = 8;

export interface FixOptions {
  /** Restrict edits to these 1-based lines (Fix selection). */
  scope?: { from: number; to: number };
  maxPasses?: number;
}

const sameDiag = (a: Diag, b: Diag) => a.type === b.type && a.lineno === b.lineno && a.message === b.message;

/** The stretch of `after` that differs from `before` (common prefix and suffix trimmed). */
export function changedRegion(before: string, after: string): { start: number; end: number } {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return { start: p, end: after.length - s };
}

interface Verified {
  ok: boolean;
  next: Diag | null;
}

/**
 * Check one candidate with Python: it must compile and the problem it targets must be gone.
 * A candidate that merely trades one syntax error for another is accepted only if the new
 * error is not pointing at the edit itself (that would mean the edit broke something).
 */
async function verify(before: string, cand: Candidate, diag: Diag, env: FixEnv): Promise<Verified> {
  const syntax = await env.diagnose(cand.code, { run: false });
  if (diag.kind === 'syntax') {
    if (!syntax) return { ok: true, next: await env.diagnose(cand.code, { run: true }) };
    if (sameDiag(syntax, diag) && syntax.offset === diag.offset) return { ok: false, next: null };
    const pos = offsetOf(cand.code, syntax.lineno ?? 1, syntax.offset ?? 1);
    const { start, end } = changedRegion(before, cand.code);
    if (pos >= start && pos < Math.max(end, start + 1)) return { ok: false, next: null };
    return { ok: true, next: syntax };
  }
  if (syntax) return { ok: false, next: null }; // the edit broke the program
  const run = await env.diagnose(cand.code, { run: true });
  if (!run) return { ok: true, next: null };
  return sameDiag(run, diag) ? { ok: false, next: null } : { ok: true, next: run };
}

/** Carry per-line reasons through one edit step so each final change can say why. */
function carryReasons(prev: string[], next: string[], reasons: string[][], reason: string): string[][] {
  const out: string[][] = [];
  let pi = 0;
  let pending: string[] = [];
  const add = (arr: string[]) => {
    const merged = [...pending, ...arr];
    pending = [];
    out.push(merged);
  };
  for (const h of diffLines(prev, next)) {
    while (pi < h.aStart) add(reasons[pi++] ?? []);
    const carried = reasons.slice(h.aStart, h.aEnd).flat();
    const count = h.bEnd - h.bStart;
    if (count === 0) pending = [...pending, ...carried, reason];
    else for (let k = 0; k < count; k++) add([...new Set([...carried, reason])]);
    pi = h.aEnd;
  }
  while (pi < prev.length) add(reasons[pi++] ?? []);
  if (pending.length && out.length) out[out.length - 1] = [...out[out.length - 1], ...pending];
  return out;
}

export function buildChanges(original: string, fixed: string, reasons: string[][]): Change[] {
  const a = original.split('\n');
  const b = fixed.split('\n');
  return diffLines(a, b).map((hunk: Hunk) => {
    let rs = reasons.slice(hunk.bStart, hunk.bEnd).flat();
    if (!rs.length && hunk.bStart < reasons.length) rs = reasons[hunk.bStart] ?? [];
    const unique = [...new Set(rs)];
    return { hunk, reason: unique.length ? unique.join('; ') : 'Changed to fix the problem' };
  });
}

/** Too large a rewrite is never "a small fix": refuse rather than touch working code. */
export function isSmallEdit(original: string, fixed: string): boolean {
  const a = original.split('\n');
  const hunks = diffLines(a, fixed.split('\n'));
  const nonBlank = a.filter((l) => l.trim()).length;
  if (nonBlank < 6) return true;
  const touched = hunks.reduce((n, h) => n + (h.aEnd - h.aStart), 0);
  return touched <= Math.max(3, nonBlank * 0.5);
}

const makeResult = (r: Partial<FixResult> & Pick<FixResult, 'status' | 'original'>): FixResult => ({
  code: r.original, changes: [], steps: [], remaining: null, initial: null, source: 'rules', ...r,
});

/**
 * The rules tier plus the verification loop. Each pass takes the first problem Python reports,
 * proposes minimal edits, and keeps the first one that passes verification. Up to 8 passes,
 * because fixing one error often reveals the next.
 */
export async function fixCode(original: string, env: FixEnv, opts: FixOptions = {}): Promise<FixResult> {
  const maxPasses = opts.maxPasses ?? MAX_PASSES;
  const scope = opts.scope;
  const first = await env.diagnose(original, { run: true });
  if (!first) return makeResult({ status: 'nothing', original });
  const result = (r: Partial<FixResult> & Pick<FixResult, 'status' | 'original'>) => makeResult({ ...r, initial: first });

  let cur = original;
  let diag: Diag | null = first;
  let reasons: string[][] = original.split('\n').map(() => []);
  const steps: { rule: string; reason: string }[] = [];
  const seen = new Set<string>([cur]);

  for (let pass = 0; pass < maxPasses && diag; pass++) {
    const { bound, builtins } = await env.scope(cur);
    const ctx = makeCtx(cur, diag, bound, builtins);
    let chosen: Candidate | null = null;
    let next: Diag | null = null;
    for (const cand of generateCandidates(ctx)) {
      if (seen.has(cand.code)) continue;
      if (scope && !cand.lines.every((l) => l >= scope.from && l <= scope.to)) continue;
      const v = await verify(cur, cand, diag, env);
      if (v.ok) {
        chosen = cand;
        next = v.next;
        break;
      }
    }
    if (!chosen) break;
    reasons = carryReasons(cur.split('\n'), chosen.code.split('\n'), reasons, chosen.reason);
    steps.push({ rule: chosen.rule, reason: chosen.reason });
    cur = chosen.code;
    seen.add(cur);
    diag = next;
  }

  if (cur === original) return result({ status: 'none', original, remaining: diag ?? first });
  if (!isSmallEdit(original, cur)) return result({ status: 'none', original, remaining: first });

  const changes = buildChanges(original, cur, reasons);
  if (!diag) return result({ status: 'fixed', original, code: cur, changes, steps });

  // Something still fails. Offer the progress only if the program still compiles
  // (or, for Fix selection, if the problem left in the selected lines is gone).
  if (scope) {
    const outside = diag.lineno !== null && (diag.lineno < scope.from || diag.lineno > scope.to);
    return outside
      ? result({ status: 'partial', original, code: cur, changes, steps, remaining: diag })
      : result({ status: 'none', original, remaining: diag });
  }
  if (diag.kind === 'syntax') return result({ status: 'none', original, remaining: diag });
  return result({ status: 'partial', original, code: cur, changes, steps, remaining: diag });
}
