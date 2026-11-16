/** localStorage wrappers that never throw (private windows, blocked storage, corrupt data). */
const CODE_KEY = 'pypal:code';

export function loadSaved(): string | null {
  try {
    const v = localStorage.getItem(CODE_KEY);
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function save(code: string): boolean {
  try {
    localStorage.setItem(CODE_KEY, code);
    return true;
  } catch {
    return false;
  }
}
