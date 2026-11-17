/** Shareable links: the code is compressed into the URL hash. Nothing is sent anywhere. */

const PARAM = 'c';
/** Largest program a link may carry or expand to. Bigger payloads are rejected, so a crafted link cannot exhaust memory. */
export const MAX_SHARE_CHARS = 100_000;
const MAX_ENCODED = 200_000;

export type ShareResult = { ok: true; code: string } | { ok: false; reason: string };

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const hasStreams = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  void w.write(bytes as BufferSource);
  void w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

/** Inflate with a hard output cap (guards against decompression bombs). */
async function inflate(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array | null> {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(bytes as BufferSource).catch(() => {});
  w.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null; // corrupt data
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** The hash fragment for a program, e.g. "#c=v1.eJzL..." */
export async function encodeShare(code: string): Promise<string> {
  const raw = new TextEncoder().encode(code);
  if (hasStreams()) return `#${PARAM}=v1.${toBase64Url(await deflate(raw))}`;
  return `#${PARAM}=v0.${toBase64Url(raw)}`;
}

/** Pull the payload out of a location hash, or null if the hash is not a share link. */
export function shareHashPayload(hash: string): string | null {
  const m = new RegExp(`^#${PARAM}=(.*)$`).exec(hash);
  return m ? m[1] : null;
}

/** Decode a payload from a link. Never throws; bad or hostile data comes back as { ok: false }. */
export async function decodeShare(payload: string): Promise<ShareResult> {
  const bad = (reason: string): ShareResult => ({ ok: false, reason });
  if (!payload || payload.length > MAX_ENCODED) return bad('This link has no code in it, or it is too long.');
  const m = /^v([01])\.(.*)$/.exec(payload);
  if (!m) return bad('This link was not made by PyPal.');
  const bytes = fromBase64Url(m[2]);
  if (!bytes) return bad('This link is damaged.');
  let text: Uint8Array | null = bytes;
  if (m[1] === '1') {
    if (!hasStreams()) return bad('This browser cannot open compressed links.');
    text = await inflate(bytes, MAX_SHARE_CHARS * 4);
    if (!text) return bad('This link is damaged or too big.');
  }
  let code: string;
  try {
    code = new TextDecoder('utf-8', { fatal: true }).decode(text);
  } catch {
    return bad('This link does not contain text.');
  }
  if (code.length > MAX_SHARE_CHARS) return bad('The code in this link is too big.');
  if (code.includes('\u0000')) return bad('This link does not contain a Python program.');
  return { ok: true, code };
}
