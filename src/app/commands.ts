export type CommandGroup = 'Run' | 'Fix' | 'File' | 'Examples' | 'View' | 'Help';

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  /** Shortcut in our own notation, e.g. "Mod-Enter" (shown as Ctrl or Command). */
  keys?: string;
  /** Extra words the palette also matches. */
  keywords?: string;
  hint?: string;
  enabled?(): boolean;
  run(): void | Promise<void>;
}

const isMac = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** "Mod-Shift-Enter" -> ["Ctrl", "Shift", "Enter"] (or ["⌘", "⇧", "Enter"] on a Mac). */
export function keyParts(keys: string): string[] {
  const mac = isMac();
  return keys.split('-').map((k) => {
    if (k === 'Mod') return mac ? '⌘' : 'Ctrl';
    if (k === 'Shift') return mac ? '⇧' : 'Shift';
    if (k === 'Alt') return mac ? '⌥' : 'Alt';
    return k;
  });
}

export function renderKeys(keys: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'keys';
  const spoken = document.createElement('span');
  spoken.className = 'sr-only';
  spoken.textContent = keyParts(keys).join(' plus ');
  wrap.append(spoken);
  for (const p of keyParts(keys)) {
    const k = document.createElement('kbd');
    k.className = 'kbd';
    k.textContent = p;
    k.setAttribute('aria-hidden', 'true');
    wrap.append(k);
  }
  return wrap;
}
