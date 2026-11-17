import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from '../../src/app/fuzzy';

describe('fuzzy matching', () => {
  it('needs every letter, in order', () => {
    expect(fuzzyScore('rn', 'Run program')).toBeGreaterThan(0);
    expect(fuzzyScore('zz', 'Run program')).toBe(-1);
    expect(fuzzyScore('nr', 'run')).toBe(-1);
  });
  it('ranks contiguous and word-start matches first, keeping order on ties', () => {
    const items = ['Open file', 'Toggle theme', 'Download main.py', 'Copy share link'];
    expect(fuzzyFilter('theme', items, (s) => s)[0]).toBe('Toggle theme');
    expect(fuzzyFilter('dl', items, (s) => s)).toContain('Download main.py');
    expect(fuzzyFilter('', items, (s) => s)).toEqual(items);
  });
});
