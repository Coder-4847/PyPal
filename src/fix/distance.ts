/** Optimal string alignment distance (Levenshtein plus adjacent swaps, so "pritn" is 1 from "print"). */
export function editDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[n][m];
}

/** How far apart two names may be and still count as a typo: short names get less slack. */
export function maxTypoDistance(len: number): number {
  if (len <= 2) return 0;
  if (len <= 4) return 1;
  return 2;
}

/** Closest names to `word`, nearest first (ties keep the order of `pool`). Excludes exact matches. */
export function nearest(word: string, pool: Iterable<string>, limit = 3): { name: string; dist: number }[] {
  const max = maxTypoDistance(word.length);
  const out: { name: string; dist: number; i: number }[] = [];
  let i = 0;
  for (const name of pool) {
    i++;
    if (name === word) continue;
    if (Math.abs(name.length - word.length) > max) continue;
    const dist = editDistance(word, name);
    if (dist <= max) out.push({ name, dist, i });
  }
  out.sort((x, y) => x.dist - y.dist || x.i - y.i);
  return out.slice(0, limit).map(({ name, dist }) => ({ name, dist }));
}
