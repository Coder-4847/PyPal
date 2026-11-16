import { describe, expect, it, vi } from 'vitest';
import { askModel, parseAiReply, verifyAiFix, type AiSettings } from '../../src/fix/ai';
import type { Diag, FixEnv } from '../../src/fix/types';
import { nodeEnv } from '../helpers/nodeEnv';

const diag: Diag = { kind: 'runtime', type: 'NameError', message: "name 'x' is not defined", lineno: 1, offset: null, endLineno: null, endOffset: null, text: null, traceback: '', suggestion: null };
const settings: AiSettings = { provider: 'anthropic', apiKey: 'sk-test-secret', model: 'm' };

describe('parseAiReply', () => {
  it('parses plain and fenced JSON, rejects junk', () => {
    expect(parseAiReply('{"code":"print(1)\\n","notes":[{"line":1,"reason":"ok"}]}')?.notes).toHaveLength(1);
    expect(parseAiReply('```json\n{"code":"a=1","notes":[]}\n```')?.code).toBe('a=1');
    expect(parseAiReply('{"code":null,"notes":[]}')).toBeNull();
    expect(parseAiReply('sorry, no')).toBeNull();
  });
});

describe('askModel', () => {
  it('sends the key only to the provider and never includes it in the prompt', async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      expect(String(init.body)).not.toContain('sk-test-secret');
      return new Response(JSON.stringify({ content: [{ text: '{"code":"x = 1\\nprint(x)\\n","notes":[{"line":1,"reason":"Defined x"}]}' }] }), { status: 200 });
    });
    const r = await askModel(settings, 'print(x)\n', diag, fetchFn);
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
    expect(r?.code).toContain('x = 1');
  });
  it('returns null on HTTP errors and network failures', async () => {
    expect(await askModel(settings, 'a', diag, async () => new Response('no', { status: 401 }))).toBeNull();
    expect(await askModel(settings, 'a', diag, async () => { throw new Error('boom sk-test-secret'); })).toBeNull();
  });
  it('supports the OpenAI response shape', async () => {
    const r = await askModel({ ...settings, provider: 'openai' }, 'a', diag, async (url) => {
      expect(url).toContain('api.openai.com');
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"code":"b = 2\\n","notes":[]}' } }] }), { status: 200 });
    });
    expect(r?.code).toBe('b = 2\n');
  });
});

describe('verifyAiFix: same verification as the rules tier', () => {
  it('accepts a verified small fix and labels it as AI', async () => {
    const env = await nodeEnv();
    const r = await verifyAiFix('x = 1\nprint(y)\n', { code: 'x = 1\nprint(x)\n', notes: [{ line: 2, reason: 'y was never defined; used x' }] }, env);
    expect(r?.status).toBe('fixed');
    expect(r?.source).toBe('ai');
    expect(r?.changes[0].reason).toBe('y was never defined; used x');
  }, 60_000);
  it('rejects code that does not compile, and fixes that still fail', async () => {
    const env: FixEnv = await nodeEnv();
    expect(await verifyAiFix('print(1)\n', { code: 'print(1\n', notes: [] }, env)).toBeNull();
    const partial = await verifyAiFix('print(y)\n', { code: 'print(z)\n', notes: [] }, env);
    expect(partial?.status).toBe('partial');
  }, 60_000);
  it('refuses large rewrites (never silently delete or rewrite student code)', async () => {
    const env = await nodeEnv();
    const big = Array.from({ length: 12 }, (_, i) => `v${i} = ${i}`).join('\n') + '\nprint(oops)\n';
    expect(await verifyAiFix(big, { code: 'print("hi")\n', notes: [] }, env)).toBeNull();
  }, 60_000);
});
