/** Open and download .py files. Everything stays in the browser. */

export const MAX_FILE_BYTES = 1_000_000;

export type ReadResult = { ok: true; text: string; name: string } | { ok: false; reason: string };

/** Accept only plain UTF-8 text that is not too big. */
export function validateBytes(bytes: Uint8Array, name: string): ReadResult {
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, reason: 'That file is bigger than 1 MB, which is too big for PyPal.' };
  if (bytes.includes(0)) return { ok: false, reason: "That doesn't look like a text file." };
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '').replace(/\r\n?/g, '\n'), name };
  } catch {
    return { ok: false, reason: "That file isn't plain text (UTF-8), so PyPal can't open it." };
  }
}

export async function readFile(file: File): Promise<ReadResult> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, reason: 'That file is bigger than 1 MB, which is too big for PyPal.' };
  return validateBytes(new Uint8Array(await file.arrayBuffer()), file.name);
}

export function downloadPy(code: string, name = 'main.py') {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/x-python;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
