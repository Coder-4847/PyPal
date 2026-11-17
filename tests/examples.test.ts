import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { fixCode } from '../src/fix/engine';
import { nodeEnv } from './helpers/nodeEnv';

describe('starter examples', () => {
  it('there are six, with unique ids and non-empty text', () => {
    expect(EXAMPLES).toHaveLength(6);
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(6);
    for (const e of EXAMPLES) {
      expect(e.title.length).toBeGreaterThan(2);
      expect(e.code.endsWith('\n')).toBe(true);
    }
  });

  it('five run cleanly (input() stubbed) and need no fixing', async () => {
    const env = await nodeEnv();
    for (const e of EXAMPLES.filter((x) => x.id !== 'broken')) {
      expect(await env.diagnose(e.code, { run: true }), e.id).toBeNull();
    }
  }, 60_000);

  it('the broken program is fixed by PyPal, in three verified changes', async () => {
    const env = await nodeEnv();
    const broken = EXAMPLES.find((e) => e.id === 'broken')!;
    expect(await env.diagnose(broken.code, { run: false })).not.toBeNull();
    const r = await fixCode(broken.code, env);
    expect(r.status).toBe('fixed');
    expect(r.changes).toHaveLength(3);
    expect(r.code).toContain('def greet(name):');
    expect(r.code).toContain('age = int(input("How old are you? "))');
    expect(r.code).toContain('print("The total is", total)');
    expect(await env.diagnose(r.code, { run: true })).toBeNull();
  }, 60_000);
});
