import { describe, expect, it } from 'vitest';
import { parseOutput } from '../../src/ui/outputParser';

describe('parseOutput', () => {
  it('splits text and newlines', () => {
    expect(parseOutput('a\nb')).toEqual([
      { kind: 'text', text: 'a' },
      { kind: 'newline' },
      { kind: 'text', text: 'b' },
    ]);
  });

  it('treats CRLF as one newline', () => {
    expect(parseOutput('x\r\ny')).toEqual([
      { kind: 'text', text: 'x' },
      { kind: 'newline' },
      { kind: 'text', text: 'y' },
    ]);
  });

  it('turns a lone carriage return into a line reset (progress bars)', () => {
    expect(parseOutput('10%\r20%')).toEqual([
      { kind: 'text', text: '10%' },
      { kind: 'return' },
      { kind: 'text', text: '20%' },
    ]);
  });

  it('strips ANSI colour codes', () => {
    expect(parseOutput('\u001b[31mred\u001b[0m')).toEqual([{ kind: 'text', text: 'red' }]);
  });

  it('keeps unicode intact', () => {
    expect(parseOutput('héllo 🐍\n')).toEqual([{ kind: 'text', text: 'héllo 🐍' }, { kind: 'newline' }]);
  });

  it('returns nothing for empty input', () => {
    expect(parseOutput('')).toEqual([]);
  });
});
