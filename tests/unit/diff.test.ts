import { describe, expect, it } from 'vitest';
import { applyHunks, charDiff, diffLines } from '../../src/fix/diff';
import { editDistance, nearest } from '../../src/fix/distance';
import { tokenize } from '../../src/fix/lex';

describe('diffLines / applyHunks', () => {
  const roundTrip = (a: string, b: string) => {
    const hunks = diffLines(a.split('\n'), b.split('\n'));
    expect(applyHunks(a, b, hunks)).toBe(b);
    return hunks;
  };
  it('replace, insert, delete and mixed edits round-trip', () => {
    roundTrip('a\nb\nc\n', 'a\nB\nc\n');
    roundTrip('a\nb\nc\n', 'a\nb\nx\nc\n');
    roundTrip('a\nb\nc\n', 'a\nc\n');
    roundTrip('a\nb\nc\nd\ne\n', 'a\nB\nc\nD\ne\n');
    roundTrip('x', 'x\ny');
    roundTrip('x\ny', 'x');
    roundTrip('', 'a');
  });
  it('finds separate hunks and applies them independently', () => {
    const a = 'a\nb\nc\nd\ne';
    const b = 'a\nB\nc\nD\ne';
    const hunks = diffLines(a.split('\n'), b.split('\n'));
    expect(hunks).toHaveLength(2);
    expect(applyHunks(a, b, [hunks[1]])).toBe('a\nb\nc\nD\ne');
    expect(applyHunks(a, b, [hunks[0]])).toBe('a\nB\nc\nd\ne');
  });
  it('charDiff isolates the changed middle', () => {
    expect(charDiff('if x > 3', 'if x > 3:')).toEqual({ prefix: 8, oldEnd: 8, newEnd: 9 });
    expect(charDiff('pritn(1)', 'print(1)')).toMatchObject({ prefix: 3 });
  });
});

describe('edit distance', () => {
  it('counts a swap as one edit', () => {
    expect(editDistance('pritn', 'print')).toBe(1);
    expect(editDistance('whlie', 'while')).toBe(1);
    expect(editDistance('abc', 'abc')).toBe(0);
  });
  it('nearest respects typo limits', () => {
    expect(nearest('totl', ['total', 'count'])[0].name).toBe('total');
    expect(nearest('i', ['j', 'k'])).toEqual([]);
  });
});

describe('lexer', () => {
  it('handles strings, comments, brackets and never throws on broken code', () => {
    const toks = tokenize('print("a # not comment") # real\nx = (1,\n 2');
    expect(toks.find((t) => t.type === 'comment')?.text).toBe('# real');
    expect(toks.filter((t) => t.type === 'string')).toHaveLength(1);
    expect(tokenize('s = "oops').some((t) => t.unterminated)).toBe(true);
    expect(tokenize('"""never closed\nstill').some((t) => t.unterminated)).toBe(true);
    expect(() => tokenize('$ ? “hi” `')).not.toThrow();
  });
  it('tracks bracket depth', () => {
    const toks = tokenize('f(a, [b])');
    expect(toks.find((t) => t.text === 'b')?.depth).toBe(2);
  });
});
