import { describe, expect, it } from 'vitest';
import { MAX_SHARE_CHARS, decodeShare, encodeShare, shareHashPayload } from '../../src/share';
import { MAX_FILE_BYTES, validateBytes } from '../../src/files';

const payloadOf = async (code: string) => shareHashPayload(await encodeShare(code))!;

describe('share links', () => {
  it('round-trips ordinary, unicode and empty-ish programs', async () => {
    for (const code of ['print("hi")\n', 'nombre = "José 🐍 日本語"\nprint(nombre)\n', 'x = 1', 'a\r\nb']) {
      const r = await decodeShare(await payloadOf(code));
      expect(r).toEqual({ ok: true, code });
    }
  });
  it('compresses repetitive code well below its size', async () => {
    const code = 'print("hello world")\n'.repeat(200);
    expect((await payloadOf(code)).length).toBeLessThan(code.length / 5);
  });
  it('round-trips a large program', async () => {
    const code = Array.from({ length: 2000 }, (_, i) => `value_${i} = ${i} * 3  # line ${i}`).join('\n');
    expect(await decodeShare(await payloadOf(code))).toEqual({ ok: true, code });
  });
  it('only recognises #c= hashes', () => {
    expect(shareHashPayload('#c=v1.abc')).toBe('v1.abc');
    expect(shareHashPayload('#other=1')).toBeNull();
    expect(shareHashPayload('')).toBeNull();
  });
  it('rejects bad data without throwing', async () => {
    const good = await payloadOf('print("hello there, this is a longer program")\n'.repeat(5));
    for (const bad of ['', 'garbage', 'v2.abc', 'v1.', 'v1.!!!', 'v1.AAAA', `v1.${good.slice(3, 20)}`, `${good.slice(0, 30)}***`, 'v0.%%%']) {
      const r = await decodeShare(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(5);
    }
  });
  it('rejects data that is not text, or contains NUL', async () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd]);
    const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect((await decodeShare(`v0.${b64}`)).ok).toBe(false);
    expect((await decodeShare(await payloadOf('a\u0000b'))).ok).toBe(false);
  });
  it('rejects decompression bombs and oversized links', async () => {
    const bomb = await payloadOf('0'.repeat(MAX_SHARE_CHARS * 6));
    const r = await decodeShare(bomb);
    expect(r.ok).toBe(false);
    expect((await decodeShare('v1.' + 'A'.repeat(300_000))).ok).toBe(false);
  });
  it('never treats the payload as HTML or code: it only ever returns text', async () => {
    const evil = '<img src=x onerror=alert(1)>\n"><script>alert(1)</script>';
    const r = await decodeShare(await payloadOf(evil));
    expect(r).toEqual({ ok: true, code: evil }); // returned verbatim as a string; the app only puts it in the editor
  });
});

describe('opening .py files', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it('accepts UTF-8 text, strips a BOM and normalises line endings', () => {
    expect(validateBytes(enc('﻿print(1)\r\nprint(2)\r'), 'a.py')).toEqual({ ok: true, text: 'print(1)\nprint(2)\n', name: 'a.py' });
  });
  it('rejects binary, non-UTF-8 and oversized files', () => {
    expect(validateBytes(new Uint8Array([1, 0, 2]), 'x').ok).toBe(false);
    expect(validateBytes(new Uint8Array([0xc3, 0x28]), 'x').ok).toBe(false);
    expect(validateBytes(new Uint8Array(MAX_FILE_BYTES + 1).fill(65), 'x').ok).toBe(false);
  });
});
