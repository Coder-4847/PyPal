import { applyHunks, diffLines, splitHunks } from './diff';
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
  return splitHunks(diffLines(a, b), a, b).map((hunk: Hunk) => {
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
  if (opts.scope) return fixSelection(original, env, opts.scope, opts.maxPasses);
  return fixWhole(original, env, opts);
}

const overlaps = (h: Hunk, scope: { from: number; to: number }) =>
  h.aEnd > h.aStart ? h.aStart + 1 <= scope.to && h.aEnd >= scope.from : h.aStart >= scope.from - 1 && h.aStart <= scope.to;

/**
 * Fix selection. Python reports one problem at a time, and an earlier problem outside the selection
 * would hide the ones inside it. So the whole file is fixed first, then only the changes that touch the
 * selected lines are kept, and the result is verified again: nothing may still be wrong inside the selection.
 */
async function fixSelection(original: string, env: FixEnv, scope: { from: number; to: number }, maxPasses?: number): Promise<FixResult> {
  const full = await fixWhole(original, env, { maxPasses });
  if (full.status === 'nothing') return full;
  const none = (remaining: Diag | null): FixResult => makeResult({ status: 'none', original, remaining: remaining ?? full.remaining, initial: full.initial });
  if (full.status === 'none') return none(null);

  const mine = full.changes.filter((c) => overlaps(c.hunk, scope));
  if (!mine.length) return none(null);
  const subset = applyHunks(original, full.code, mine.map((c) => c.hunk));
  const left = await env.diagnose(subset, { run: true });
  const inside = left && left.lineno !== null && left.lineno >= scope.from && left.lineno <= scope.to + (subset.split('\n').length - original.split('\n').length);
  if (inside) return none(left);
  if (!isSmallEdit(original, subset)) return none(null);

  // re-express the kept changes against the original
  const oLines = original.split('\n');
  const sLines = subset.split('\n');
  const kept = splitHunks(diffLines(oLines, sLines), oLines, sLines);
  const reasonFor = (h: Hunk) => mine.find((c) => c.hunk.aStart === h.aStart && c.hunk.aEnd === h.aEnd)?.reason ?? mine.find((c) => c.hunk.aStart < h.aEnd && h.aStart < c.hunk.aEnd)?.reason ?? 'Changed to fix the problem';
  const changes: Change[] = kept.map((hunk) => ({ hunk, reason: reasonFor(hunk) }));
  return makeResult({ status: left ? 'partial' : 'fixed', original, code: subset, changes, steps: full.steps, remaining: left, initial: full.initial });
}

async function fixWhole(original: string, env: FixEnv, opts: FixOptions): Promise<FixResult> {
  const maxPasses = opts.maxPasses ?? MAX_PASSES;
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

  // Something still fails. Offer the progress only if the program still compiles.
  if (diag.kind === 'syntax') return result({ status: 'none', original, remaining: diag });
  return result({ status: 'partial', original, code: cur, changes, steps, remaining: diag });
}
