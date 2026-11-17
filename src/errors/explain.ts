/** Turns Python's error info into plain English: what happened, where, and a hint. Pure and unit-tested. */

export interface ErrorInfo {
  type: string;
  message: string;
  lineno: number | null;
  suggestion?: string | null;
}

export interface Friendly {
  title: string; // short headline
  what: string; // what happened, in plain words
  hint: string; // what to try
  line: number | null;
}

const q = (s: string) => `‘${s}’`; // typographic quotes keep code-ish bits readable in prose

type Pattern = [RegExp, (m: RegExpExecArray, e: ErrorInfo) => { title: string; what: string; hint: string }];

const SYNTAX: Pattern[] = [
  [/expected ':'/, () => ({
    title: 'A colon is missing',
    what: 'Python expects a colon (:) at the end of this line, right before the indented block that belongs to it.',
    hint: 'Add a : at the end of the line, like  if x > 3:  or  for i in range(5):',
  })],
  [/^'(.)' was never closed/, (m) => ({
    title: `A ${m[1]} is never closed`,
    what: `A ${m[1]} was opened here, but there is no matching ${{ '(': ')', '[': ']', '{': '}' }[m[1]] ?? 'closing bracket'} to close it.`,
    hint: 'Brackets always come in pairs. Add the missing one where the expression ends.',
  })],
  [/^unmatched '(.)'/, (m) => ({
    title: `An extra ${m[1]}`,
    what: `There is a ${m[1]} with no matching opening bracket before it.`,
    hint: 'Delete the extra bracket, or add the opening one where it belongs.',
  })],
  [/closing parenthesis '(.)' does not match opening parenthesis '(.)'/, (m) => ({
    title: 'Brackets do not match',
    what: `A ${m[2]} was opened, but it is closed with a ${m[1]}.`,
    hint: `Close it with ${{ '(': ')', '[': ']', '{': '}' }[m[2]] ?? 'the matching bracket'} instead.`,
  })],
  [/unterminated triple-quoted string/, () => ({
    title: 'A long string never ends',
    what: 'A string that started with three quotes is never closed.',
    hint: 'Finish it with the same three quotes.',
  })],
  [/unterminated string literal/, () => ({
    title: 'A string is missing its closing quote',
    what: 'Text in quotes starts here but never ends on the same line.',
    hint: 'Add the closing quote (" or \') at the end of the text. Both quotes must match.',
  })],
  [/Missing parentheses in call to 'print'/, () => ({
    title: 'print needs parentheses',
    what: 'In Python 3, print is used like a function, so what you want to show goes inside ( ).',
    hint: 'Write  print("hello")  instead of  print "hello".',
  })],
  [/Maybe you meant '==' or ':='/, () => ({
    title: 'One = stores, two == compares',
    what: 'A single = puts a value into a variable. To check whether two values are equal, Python uses ==.',
    hint: 'Change the = to == in this condition.',
  })],
  [/forgot a comma/, () => ({
    title: 'A comma is missing',
    what: 'Two items sit next to each other without a comma between them.',
    hint: 'Put a comma between the items, like  [1, 2, 3].',
  })],
  [/expected an indented block after (.+?)( on line (\d+))?$/, (m) => ({
    title: 'This line needs to be indented',
    what: `After ${m[1]}, Python expects the next line to be pushed in (indented) to show it belongs inside.`,
    hint: 'Press Tab at the start of the line, or add 4 spaces.',
  })],
  [/unexpected indent/, () => ({
    title: 'This line is indented too far',
    what: 'This line starts further in than the line before it, but nothing opened a block here.',
    hint: 'Remove the extra spaces so it lines up with the line above.',
  })],
  [/unindent does not match/, () => ({
    title: 'The indentation does not line up',
    what: 'This line steps back to a position that no earlier line uses.',
    hint: 'Line it up with the block it belongs to (same number of spaces as a line above).',
  })],
  [/inconsistent use of tabs and spaces/, () => ({
    title: 'Tabs and spaces are mixed',
    what: 'Some lines are indented with tabs and others with spaces, which Python cannot compare.',
    hint: 'Use spaces everywhere (4 per level).',
  })],
  [/invalid (non-printable )?character/, () => ({
    title: 'A strange character snuck in',
    what: 'This looks like a curly quote or another special character, often from pasting text from a document.',
    hint: 'Retype it with the plain keyboard version (" or \').',
  })],
  [/'(return|break|continue)' (outside|not properly)/, (m) => ({
    title: `${m[1]} is in the wrong place`,
    what: m[1] === 'return' ? "'return' only works inside a function." : `'${m[1]}' only works inside a loop.`,
    hint: 'Check the indentation: it needs to be inside the function or loop.',
  })],
  [/cannot assign to (.+?)( here| \()/, (m) => ({
    title: "That can't be assigned to",
    what: `You can only store a value in a name, not in ${m[1]}.`,
    hint: 'Put the variable name on the left of the =, and the value on the right.',
  })],
  [/invalid syntax/, () => ({
    title: "Python can't read this line",
    what: 'Something here does not follow Python’s rules. The usual causes are a missing comma, bracket or quote, or a misspelled word.',
    hint: 'Look closely at this line and the one before it.',
  })],
];

const RUNTIME: Pattern[] = [
  [/name '(.+?)' is not defined/, (m, e) => ({
    title: `Python doesn't know ${q(m[1])}`,
    what: `The name ${q(m[1])} is used before it exists. It was never created, or it is spelled differently.`,
    hint: e.suggestion
      ? `Did you mean ${q(e.suggestion)}? Check the spelling and capital letters.`
      : `Create ${q(m[1])} first (for example  ${m[1]} = 0 ), or check the spelling and capital letters.`,
  })],
  [/can only concatenate str \(not "(\w+)"\) to str/, (m) => ({
    title: "Text and numbers can't be joined with +",
    what: `You tried to add a ${m[1] === 'int' ? 'whole number' : m[1]} to text.`,
    hint: 'Turn the number into text with str(), like  "Age: " + str(age).',
  })],
  [/unsupported operand type\(s\) for ([^:]+): '(\w+)' and '(\w+)'/, (m) => ({
    title: "These two values can't be combined that way",
    what: `The ${m[1]} sign doesn't work between a ${plain(m[2])} and a ${plain(m[3])}.`,
    hint: m[2] === 'str' || m[3] === 'str'
      ? 'Text and numbers are different. Convert with int() / float() to use text as a number, or str() to use a number as text.'
      : 'Check that both sides are the kind of value you expect.',
  })],
  [/'(<|>|<=|>=)' not supported between instances of '(\w+)' and '(\w+)'/, (m) => ({
    title: "These values can't be compared",
    what: `You compared a ${plain(m[2])} with a ${plain(m[3])} using ${m[1]}.`,
    hint: 'If one of them came from input(), it is text. Convert it with int() or float() first.',
  })],
  [/'str' object cannot be interpreted as an integer/, () => ({
    title: 'Text where a number is needed',
    what: 'A piece of text was used where Python needs a whole number (like in range()).',
    hint: 'Convert it with int(), for example  range(int(n)).',
  })],
  [/can't multiply sequence by non-int of type '(\w+)'/, () => ({
    title: "Text can't be multiplied by a decimal",
    what: 'A text value was multiplied by a decimal number.',
    hint: 'If the text is really a number (from input()), convert it with float() first.',
  })],
  [/'(\w+)' object is not callable/, (m) => ({
    title: `A ${plain(m[1])} was used like a function`,
    what: `You put ( ) after something that is a ${plain(m[1])}, not a function.`,
    hint: 'Check for a variable that has the same name as a function, or a missing operator like *.',
  })],
  [/'(\w+)' object is not subscriptable/, (m) => ({
    title: `Can't pick items out of a ${plain(m[1])}`,
    what: `You used [ ] on a ${plain(m[1])}, which does not hold items by position.`,
    hint: m[1] === 'NoneType' ? 'The value is None, often because a function did not return anything.' : 'Check that this is a list, string or dictionary.',
  })],
  [/'(\w+)' object is not iterable/, (m) => ({
    title: `Can't loop over a ${plain(m[1])}`,
    what: `A for loop needs something it can go through item by item, and a ${plain(m[1])} is not that.`,
    hint: m[1] === 'int' ? 'To repeat something several times, use  for i in range(n):' : 'Loop over a list, string or range instead.',
  })],
  [/(\w+)\(\) missing (\d+) required positional argument/, (m, e) => ({
    title: `${m[1]}() needs more information`,
    what: `The function ${m[1]} needs ${m[2]} more value${m[2] === '1' ? '' : 's'} than you gave it.`,
    hint: `Check the call on line ${e.lineno ?? '?'} and compare it to how ${m[1]} was defined.`,
  })],
  [/(\w+)\(\) takes (\d+) positional arguments? but (\d+) (was|were) given/, (m) => ({
    title: `${m[1]}() got the wrong number of values`,
    what: `${m[1]} takes ${m[2]} value${m[2] === '1' ? '' : 's'}, but ${m[3]} ${m[3] === '1' ? 'was' : 'were'} given.`,
    hint: 'Count the values in the call and compare with the definition.',
  })],
  [/invalid literal for int\(\) with base 10: (.+)/, (m) => ({
    title: "That text isn't a whole number",
    what: `int() was given ${m[1]}, which can't be turned into a whole number.`,
    hint: 'Make sure the text only contains digits (no spaces, letters or decimals). For decimals use float().',
  })],
  [/could not convert string to float: (.+)/, (m) => ({
    title: "That text isn't a number",
    what: `float() was given ${m[1]}, which can't be turned into a number.`,
    hint: 'Check that the text only contains a number like 3.5.',
  })],
  [/math domain error/, () => ({ title: 'That math is not allowed', what: 'A math function was given a value it cannot handle (like the square root of a negative number).', hint: 'Check the value you pass in.' })],
  [/too many values to unpack|not enough values to unpack/, () => ({
    title: "The number of values doesn't match",
    what: 'You tried to split a group of values into names, but the counts differ.',
    hint: 'Make the number of names on the left equal the number of values on the right.',
  })],
  [/division by zero|modulo by zero|divide by zero/, () => ({
    title: "You can't divide by zero",
    what: 'Something was divided by 0, which has no answer.',
    hint: 'Check the value you divide by. An  if  that tests for 0 first can help.',
  })],
  [/list index out of range|string index out of range|tuple index out of range/, () => ({
    title: "That position doesn't exist",
    what: 'You asked for an item at a position beyond the end. Positions start at 0, so a list of 3 items has positions 0, 1 and 2.',
    hint: 'Check the number you use in [ ]. The last item is at len(items) - 1.',
  })],
];

const plain = (t: string) => ({ str: 'text', int: 'whole number', float: 'decimal number', NoneType: 'None', list: 'list', dict: 'dictionary', tuple: 'tuple', bool: 'True/False value' } as Record<string, string>)[t] ?? t;

export function explain(e: ErrorInfo): Friendly {
  const line = e.lineno;

  if (e.type === 'IndentationError' || e.type === 'TabError' || e.type === 'SyntaxError') {
    for (const [re, build] of SYNTAX) {
      const m = re.exec(e.message);
      if (m) return { ...build(m, e), line };
    }
    return { title: "Python can't read this line", what: e.message, hint: 'Look closely at this line and the one before it.', line };
  }

  switch (e.type) {
    case 'NameError':
    case 'UnboundLocalError': {
      const unbound = /local variable '(.+?)'/.exec(e.message);
      if (unbound) {
        return {
          title: `${q(unbound[1])} is used before it has a value`,
          what: `Inside this function, ${q(unbound[1])} is used before anything is stored in it.`,
          hint: 'Give it a value earlier in the function, or pass it in as a parameter.',
          line,
        };
      }
      break;
    }
    case 'ModuleNotFoundError':
    case 'ImportError': {
      const m = /No module named '(.+?)'/.exec(e.message);
      const name = m?.[1] ?? 'that module';
      return {
        title: `PyPal can't find ${q(name)}`,
        what: `There is no module called ${q(name)} here. It may be misspelled, or it is a package that isn't available in the browser.`,
        hint: 'Check the spelling. Standard modules like math, random and time work, and so do popular packages like numpy.',
        line,
      };
    }
    case 'AttributeError': {
      const m = /'(\w+)' object has no attribute '(.+?)'/.exec(e.message) ?? /module '(.+?)' has no attribute '(.+?)'/.exec(e.message);
      if (m) {
        const what = e.message.startsWith('module')
          ? `The module ${q(m[1])} has nothing called ${q(m[2])}.`
          : `A ${plain(m[1])} doesn't have anything called ${q(m[2])}.`;
        return {
          title: `No ${q(m[2])} here`,
          what,
          hint: e.suggestion ? `Did you mean ${q(e.suggestion)}? Check spelling and capital letters.` : 'Check the spelling and capital letters, and that the value is what you expect.',
          line,
        };
      }
      break;
    }
    case 'RecursionError':
      return {
        title: 'A function kept calling itself',
        what: 'A function called itself again and again without ever stopping.',
        hint: 'Make sure there is a case where the function returns without calling itself.',
        line,
      };
    case 'PythonCrash':
    case 'WorkerCrash':
    case 'InternalError':
      return {
        title: 'Python itself crashed',
        what: 'Something in the program made Python stop completely, usually very deep recursion or a huge amount of data. PyPal has started a fresh Python for you.',
        hint: 'Look for a function that keeps calling itself, a loop that keeps growing a list, or a very large number. Then press Run again.',
        line,
      };
    case 'EOFError':
      return { title: 'input() had nothing to read', what: 'The program asked for input but none was given.', hint: 'Type an answer in the terminal and press Enter.', line };
    case 'MemoryError':
      return { title: 'The program used too much memory', what: 'It tried to build something bigger than the browser can hold.', hint: 'Use smaller numbers or avoid growing a list forever.', line };
    case 'ZeroDivisionError':
    case 'IndexError':
    case 'KeyError':
    case 'ValueError':
    case 'TypeError':
    default:
      break;
  }

  for (const [re, build] of RUNTIME) {
    const m = re.exec(e.message);
    if (m) return { ...build(m, e), line };
  }
  if (e.type === 'KeyError') {
    return { title: 'No entry with that name', what: `The dictionary has no key ${e.message}.`, hint: 'Check the spelling, or use  d.get(key)  to avoid an error when it is missing.', line };
  }
  if (e.type === 'TypeError') {
    return { title: 'A value is the wrong kind', what: 'An operation was used on a kind of value it does not work with.', hint: 'Check what kinds of values are on this line (text, numbers, lists).', line };
  }
  return { title: `Python stopped with ${e.type}`, what: e.message || e.type, hint: 'Read the message and check the line marked in your code.', line };
}
