import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { fixCode } from '../src/fix/engine';
import type { FixEnv } from '../src/fix/types';
import { nodeEnv } from './helpers/nodeEnv';

const dir = join(__dirname, '..', 'fixtures', 'broken');
const files = readdirSync(dir);
const read = (f: string) => readFileSync(join(dir, f), 'utf8');
const broken = files.filter((f) => f.endsWith('.broken.py')).map((f) => f.replace('.broken.py', ''));
const fixedOutputs = files.filter((f) => f.endsWith('.fixed.py')).map(read);
const keeps = files.filter((f) => f.endsWith('.keep.py')).map(read);

/** Characters that carry meaning (whitespace removed). */
const solid = (s: string) => s.replace(/\s+/g, '');
/** Words (names, numbers, keywords) removed by a fix, counted with multiplicity. */
function removedWords(before: string, after: string): number {
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (const w of s.match(/[\p{L}\p{N}_]+/gu) ?? []) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  };
  const a = count(before);
  const b = count(after);
  let n = 0;
  for (const [w, k] of a) n += Math.max(0, k - (b.get(w) ?? 0));
  return n;
}
/** Comment text: a fix must never drop a student's comment. */
const comments = (s: string) => s.split('\n').map((l) => /#.*$/.exec(l)?.[0]).filter(Boolean) as string[];

let env: FixEnv;
beforeAll(async () => {
  env = await nodeEnv();
}, 120_000);

describe('the engine never rewrites code that already works', () => {
  it('every expected fix, every must-not-touch case and every starter example is left alone', async () => {
    const working = [...fixedOutputs, ...EXAMPLES.filter((e) => e.id !== 'broken').map((e) => e.code)];
    for (const code of working) {
      const r = await fixCode(code, env);
      expect(r.status, code.slice(0, 80)).toBe('nothing');
      expect(r.code).toBe(code);
    }
    for (const code of keeps) {
      const r = await fixCode(code, env);
      expect(r.code, code.slice(0, 80)).toBe(code);
      expect(r.changes).toEqual([]);
    }
  }, 120_000);
});

describe('the engine never silently deletes student code', () => {
  it.each(broken)('%s: comments kept, nothing meaningful removed beyond what each change explains', async (name) => {
    const before = read(`${name}.broken.py`);
    const r = await fixCode(before, env);
    if (r.status !== 'fixed' && r.status !== 'partial') return;
    for (const c of comments(before)) expect(r.code).toContain(c);
    // Each change may replace at most a word or two (a typo fixed, "+ 1" removed); nothing else disappears.
    expect(removedWords(before, r.code)).toBeLessThanOrEqual(2 * r.changes.length); // e.g. `else if` -> `elif`
    expect(Math.max(0, solid(before).length - solid(r.code).length)).toBeLessThanOrEqual(12 * r.changes.length);
    for (const ch of r.changes) expect(ch.reason.length).toBeGreaterThan(8);
    // and it is verified: offered code always compiles
    const syntax = await env.diagnose(r.code, { run: false });
    expect(syntax).toBeNull();
  }, 60_000);
});

/** Deterministic pseudo-random numbers, so failures are reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

describe('robustness: random damage to working programs', () => {
  it('never offers code that fails to compile, never drops comments, never deletes much', async () => {
    const rand = rng(42);
    const programs = EXAMPLES.filter((e) => e.id !== 'broken').map((e) => e.code);
    let offered = 0;
    for (let i = 0; i < 120; i++) {
      const src = programs[i % programs.length];
      const at = Math.floor(rand() * src.length);
      const kind = i % 3;
      // delete a character, duplicate one, or swap two neighbours
      const damaged = kind === 0 ? src.slice(0, at) + src.slice(at + 1) : kind === 1 ? src.slice(0, at) + src[at] + src.slice(at) : src.slice(0, at) + (src[at + 1] ?? '') + src[at] + src.slice(at + 2);
      const r = await fixCode(damaged, env);
      expect(['nothing', 'fixed', 'partial', 'none']).toContain(r.status);
      if (r.status === 'none' || r.status === 'nothing') {
        expect(r.code).toBe(damaged);
        continue;
      }
      offered++;
      expect(await env.diagnose(r.code, { run: false }), damaged).toBeNull();
      for (const c of comments(damaged)) expect(r.code).toContain(c);
      expect(removedWords(damaged, r.code), damaged).toBeLessThanOrEqual(2 * r.changes.length);
    }
    expect(offered).toBeGreaterThan(20); // the engine actually repairs a good share of random damage
  }, 300_000);
});
