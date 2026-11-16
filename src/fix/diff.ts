import type { Hunk } from './types';

/** Line diff: common prefix/suffix trimmed, then LCS for the middle. Returns hunks in order. */
export function diffLines(a: string[], b: string[]): Hunk[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  if (start === endA && start === endB) return [];
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0 || n * m > 4_000_000) return [{ aStart: start, aEnd: endA, bStart: start, bEnd: endB }];

  // LCS table over the differing middle.
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = a[start + i] === b[start + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let cur: Hunk | null = null;
  const flush = () => {
    if (cur) hunks.push(cur);
    cur = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i === n || t[i * w + j + 1] >= t[(i + 1) * w + j])) {
      cur ??= { aStart: start + i, aEnd: start + i, bStart: start + j, bEnd: start + j };
      j++;
      cur.bEnd = start + j;
    } else {
      cur ??= { aStart: start + i, aEnd: start + i, bStart: start + j, bEnd: start + j };
      i++;
      cur.aEnd = start + i;
    }
  }
  flush();
  return hunks;
}

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** Offsets of each line start in `text` split on "\n". */
function lineOffsets(lines: string[]): number[] {
  const out: number[] = [];
  let o = 0;
  for (const l of lines) {
    out.push(o);
    o += l.length + 1;
  }
  out.push(o); // one past the end
  return out;
}

/** Character edits that turn `oldLines` into `newLines` for the given hunks (applied together). */
export function hunkEdits(oldLines: string[], newLines: string[], hunks: Hunk[]): TextEdit[] {
  const off = lineOffsets(oldLines);
  const docLen = oldLines.join('\n').length;
  return hunks.map((h) => {
    const inserted = newLines.slice(h.bStart, h.bEnd);
    if (h.aEnd < oldLines.length) {
      return { from: off[h.aStart], to: off[h.aEnd], insert: inserted.length ? inserted.join('\n') + '\n' : '' };
    }
    if (h.aStart > 0) {
      return { from: off[h.aStart] - 1, to: docLen, insert: inserted.length ? '\n' + inserted.join('\n') : '' };
    }
    return { from: 0, to: docLen, insert: inserted.join('\n') };
  });
}

/** Apply a subset of hunks to old text. */
export function applyHunks(oldText: string, newText: string, hunks: Hunk[]): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const edits = hunkEdits(oldLines, newLines, hunks).sort((x, y) => y.from - x.from);
  let out = oldText;
  for (const e of edits) out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  return out;
}

/** For one replaced line pair, the changed middle: [prefix length, old tail start, new tail start]. */
export function charDiff(oldLine: string, newLine: string): { prefix: number; oldEnd: number; newEnd: number } {
  let p = 0;
  while (p < oldLine.length && p < newLine.length && oldLine[p] === newLine[p]) p++;
  let oe = oldLine.length;
  let ne = newLine.length;
  while (oe > p && ne > p && oldLine[oe - 1] === newLine[ne - 1]) {
    oe--;
    ne--;
  }
  return { prefix: p, oldEnd: oe, newEnd: ne };
}
