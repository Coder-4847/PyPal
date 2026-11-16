import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { fixCode } from '../src/fix/engine';
import type { FixEnv } from '../src/fix/types';
import { nodeEnv } from './helpers/nodeEnv';

const dir = join(__dirname, '..', 'fixtures', 'broken');
const files = readdirSync(dir);
const read = (f: string) => readFileSync(join(dir, f), 'utf8');

const fixes = files.filter((f) => f.endsWith('.broken.py')).map((f) => f.replace('.broken.py', ''));
const keeps = files.filter((f) => f.endsWith('.keep.py')).map((f) => f.replace('.keep.py', ''));

let env: FixEnv;
beforeAll(async () => {
  env = await nodeEnv();
}, 120_000);

describe('fixtures/broken: broken snippet -> expected fix', () => {
  it('has a healthy corpus', () => {
    expect(fixes.length + keeps.length).toBeGreaterThanOrEqual(50);
  });

  it.each(fixes)('%s', async (name) => {
    const broken = read(`${name}.broken.py`);
    const expected = read(`${name}.fixed.py`);
    const r = await fixCode(broken, env);
    expect({ status: r.status, code: r.code }).toEqual({ status: 'fixed', code: expected });
    // never shown unverified: the fixed code compiles and runs clean in the sandbox
    expect(await env.diagnose(r.code, { run: true })).toBeNull();
    expect(r.changes.length).toBeGreaterThan(0);
    for (const c of r.changes) expect(c.reason.length).toBeGreaterThan(5);
  }, 60_000);

  it.each(keeps)('leaves %s alone', async (name) => {
    const code = read(`${name}.keep.py`);
    const r = await fixCode(code, env);
    expect(['nothing', 'none']).toContain(r.status);
    expect(r.code).toBe(code);
    expect(r.changes).toEqual([]);
  }, 60_000);
});
