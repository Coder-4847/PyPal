import { describe, expect, it } from 'vitest';
import { fixCode } from '../src/fix/engine';
import { nodeEnv } from './helpers/nodeEnv';

const code = 'for i in range(2)\n    print(i)\nif True\n    print("yes")\nx = (1 + 2\nprint(x)\n';

describe('Fix selection (scoped fix)', () => {
  it('fixes only the selected lines even when an earlier problem exists', async () => {
    const env = await nodeEnv();
    const r = await fixCode(code, env, { scope: { from: 3, to: 4 } });
    expect(r.status).toBe('partial'); // problems outside the selection remain
    expect(r.code).toBe('for i in range(2)\n    print(i)\nif True:\n    print("yes")\nx = (1 + 2\nprint(x)\n');
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0].reason).toMatch(/colon/);
  }, 60_000);

  it('can fix a later selection and an earlier one independently', async () => {
    const env = await nodeEnv();
    const first = await fixCode(code, env, { scope: { from: 1, to: 2 } });
    expect(first.code.split('\n')[0]).toBe('for i in range(2):');
    expect(first.code.split('\n')[2]).toBe('if True'); // untouched
    const last = await fixCode(code, env, { scope: { from: 5, to: 6 } });
    expect(last.code.split('\n')[4]).toBe('x = (1 + 2)');
    expect(last.code.split('\n')[0]).toBe('for i in range(2)'); // untouched
  }, 60_000);

  it('offers nothing when the selected lines have no problem', async () => {
    const env = await nodeEnv();
    const r = await fixCode(code, env, { scope: { from: 2, to: 2 } });
    expect(r.status).toBe('none');
    expect(r.code).toBe(code);
    expect(r.changes).toEqual([]);
  }, 60_000);

  it('says nothing to fix when the whole file is fine', async () => {
    const env = await nodeEnv();
    const r = await fixCode('print(1)\n', env, { scope: { from: 1, to: 1 } });
    expect(r.status).toBe('nothing');
  }, 60_000);
});
