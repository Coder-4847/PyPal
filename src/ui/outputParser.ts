/** Turns raw program output into simple terminal operations. Pure, so it is unit-tested. */

export type OutOp =
  | { kind: 'text'; text: string }
  | { kind: 'newline' }
  | { kind: 'return' }; // lone carriage return: the next text overwrites the line

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export function parseOutput(chunk: string): OutOp[] {
  const ops: OutOp[] = [];
  const text = chunk.replace(ANSI, '').replace(/\r\n/g, '\n');
  let buf = '';
  const flush = () => {
    if (buf) ops.push({ kind: 'text', text: buf });
    buf = '';
  };
  for (const ch of text) {
    if (ch === '\n') {
      flush();
      ops.push({ kind: 'newline' });
    } else if (ch === '\r') {
      flush();
      ops.push({ kind: 'return' });
    } else {
      buf += ch;
    }
  }
  flush();
  return ops;
}
