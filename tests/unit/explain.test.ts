import { describe, expect, it } from 'vitest';
import { explain } from '../../src/errors/explain';

const e = (type: string, message: string, lineno: number | null = 3, suggestion: string | null = null) => explain({ type, message, lineno, suggestion });

describe('explain', () => {
  it('missing colon', () => {
    const f = e('SyntaxError', "expected ':'");
    expect(f.title).toMatch(/colon/i);
    expect(f.line).toBe(3);
  });
  it('unclosed bracket, extra bracket, mismatch', () => {
    expect(e('SyntaxError', "'(' was never closed").what).toMatch(/\)/);
    expect(e('SyntaxError', "unmatched ')'").title).toMatch(/extra/i);
    expect(e('SyntaxError', "closing parenthesis ']' does not match opening parenthesis '('").hint).toMatch(/\)/);
  });
  it('strings and print', () => {
    expect(e('SyntaxError', 'unterminated string literal (detected at line 2)').title).toMatch(/quote/);
    expect(e('SyntaxError', "Missing parentheses in call to 'print'. Did you mean print(...)?").title).toMatch(/print/);
  });
  it('= versus ==', () => {
    expect(e('SyntaxError', "invalid syntax. Maybe you meant '==' or ':=' instead of '='?").title).toMatch(/==/);
  });
  it('indentation variants', () => {
    expect(e('IndentationError', "expected an indented block after 'if' statement on line 2").title).toMatch(/indented/);
    expect(e('IndentationError', 'unexpected indent').title).toMatch(/too far/);
    expect(e('IndentationError', 'unindent does not match any outer indentation level').title).toMatch(/line up/);
    expect(e('TabError', 'inconsistent use of tabs and spaces in indentation').title).toMatch(/Tabs/);
  });
  it('generic invalid syntax falls back kindly', () => {
    const f = e('SyntaxError', 'invalid syntax');
    expect(f.what).toMatch(/comma|bracket|quote/);
  });
  it('NameError uses the suggestion', () => {
    const f = e('NameError', "name 'pritn' is not defined", 2, 'print');
    expect(f.title).toContain('pritn');
    expect(f.hint).toContain('print');
  });
  it('TypeError variants', () => {
    expect(e('TypeError', 'can only concatenate str (not "int") to str').hint).toMatch(/str\(/);
    expect(e('TypeError', "'>' not supported between instances of 'str' and 'int'").hint).toMatch(/int\(\)/);
    expect(e('TypeError', "'int' object is not callable").title).toMatch(/function/);
    expect(e('TypeError', 'greet() missing 1 required positional argument: \'name\'').title).toMatch(/greet/);
  });
  it('ValueError, ZeroDivisionError, IndexError, KeyError', () => {
    expect(e('ValueError', "invalid literal for int() with base 10: 'abc'").title).toMatch(/whole number/);
    expect(e('ZeroDivisionError', 'division by zero').title).toMatch(/zero/);
    expect(e('IndexError', 'list index out of range').what).toMatch(/0/);
    expect(e('KeyError', "'bob'").what).toContain("'bob'");
  });
  it('AttributeError and ModuleNotFoundError', () => {
    expect(e('AttributeError', "'str' object has no attribute 'uper'", 1, 'upper').hint).toContain('upper');
    expect(e('ModuleNotFoundError', "No module named 'requests'").title).toContain('requests');
  });
  it('RecursionError and unknown errors never throw', () => {
    expect(e('RecursionError', 'maximum recursion depth exceeded').title).toMatch(/itself/);
    const f = e('WeirdError', 'something odd');
    expect(f.title).toContain('WeirdError');
    expect(f.what).toBe('something odd');
  });
  it('plain-English output contains no raw jargon like "traceback"', () => {
    for (const f of [e('SyntaxError', 'invalid syntax'), e('NameError', "name 'x' is not defined")]) {
      expect(`${f.title} ${f.what} ${f.hint}`).not.toMatch(/traceback|stack/i);
    }
  });
});
