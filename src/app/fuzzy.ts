/** Tiny fuzzy matcher for the command palette: every query character must appear in order. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  let ti = 0;
  let score = 0;
  let prev = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    score += at === prev + 1 ? 3 : 1; // consecutive letters score higher
    if (at === 0 || t[at - 1] === ' ') score += 2; // start of a word
    prev = at;
    ti = at + 1;
  }
  if (t.includes(q)) score += 6; // contiguous match beats scattered letters
  return score - t.length * 0.01;
}

export function fuzzyFilter<T>(query: string, items: T[], text: (t: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(query, text(item)) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}
