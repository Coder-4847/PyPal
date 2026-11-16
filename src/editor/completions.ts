import { completeFromList, type Completion } from '@codemirror/autocomplete';

const kw = (label: string): Completion => ({ label, type: 'keyword' });
const fn = (label: string): Completion => ({ label, type: 'function', apply: `${label}(` });

const keywords = [
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
];
export const builtinNames = [
  'abs', 'all', 'any', 'bin', 'bool', 'chr', 'dict', 'dir', 'divmod', 'enumerate', 'filter', 'float', 'format',
  'input', 'int', 'isinstance', 'len', 'list', 'map', 'max', 'min', 'next', 'open', 'ord', 'pow', 'print', 'range',
  'repr', 'reversed', 'round', 'set', 'sorted', 'str', 'sum', 'tuple', 'type', 'zip',
];

/** Light autocomplete: Python keywords and the builtins beginners use most. */
export const pythonWords = completeFromList([...keywords.map(kw), ...builtinNames.map(fn)]);
