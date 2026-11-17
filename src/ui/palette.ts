import { fuzzyFilter } from '../app/fuzzy';
import { renderKeys, type Command } from '../app/commands';
import { hideDialog, showDialog, wireDialog } from './dialogs';
import { announce } from './announce';

let dialog: HTMLDialogElement | null = null;

/** The command palette (Ctrl/Cmd+K): type to filter, arrows to choose, Enter to run. */
export function openPalette(getCommands: () => Command[]) {
  if (!dialog) dialog = build();
  const d = dialog;
  const input = d.querySelector<HTMLInputElement>('input')!;
  const list = d.querySelector<HTMLElement>('[role="listbox"]')!;
  const status = d.querySelector<HTMLElement>('.palette-status')!;
  let shown: Command[] = [];
  let active = 0;

  const render = () => {
    const all = getCommands().filter((c) => !c.enabled || c.enabled());
    shown = fuzzyFilter(input.value, all, (c) => `${c.title} ${c.group} ${c.keywords ?? ''}`);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.replaceChildren();
    let lastGroup = '';
    shown.forEach((c, i) => {
      if (!input.value.trim() && c.group !== lastGroup) {
        lastGroup = c.group;
        const g = document.createElement('div');
        g.className = 'palette-group';
        g.setAttribute('role', 'presentation');
        g.textContent = c.group;
        list.append(g);
      }
      const li = document.createElement('div');
      li.className = 'palette-item';
      li.id = `pal-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === active));
      const t = document.createElement('span');
      t.className = 'palette-title';
      t.textContent = c.title;
      li.append(t);
      if (c.hint) {
        const h = document.createElement('span');
        h.className = 'palette-hint';
        h.textContent = c.hint;
        li.append(h);
      }
      if (c.keys) li.append(renderKeys(c.keys));
      li.addEventListener('mousemove', () => select(i, false));
      li.addEventListener('click', () => run(i));
      list.append(li);
    });
    if (!shown.length) {
      const none = document.createElement('div');
      none.className = 'palette-empty';
      none.textContent = 'Nothing matches that. Try another word.';
      list.append(none);
    }
    input.setAttribute('aria-activedescendant', shown.length ? `pal-${active}` : '');
    status.textContent = shown.length ? `${shown.length} command${shown.length === 1 ? '' : 's'}` : 'No commands found';
  };

  const select = (i: number, scroll = true) => {
    if (!shown.length) return;
    active = (i + shown.length) % shown.length;
    list.querySelectorAll('[role="option"]').forEach((el, k) => el.setAttribute('aria-selected', String(k === active)));
    input.setAttribute('aria-activedescendant', `pal-${active}`);
    if (scroll) list.querySelector(`#pal-${active}`)?.scrollIntoView({ block: 'nearest' });
  };

  const run = (i: number) => {
    const c = shown[i];
    if (!c) return;
    hideDialog(d);
    // run after the dialog has handed focus back, so commands can move focus themselves
    window.setTimeout(() => void c.run(), 60);
  };

  input.value = '';
  active = 0;
  render();
  input.oninput = () => {
    active = 0;
    render();
  };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); select(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
    else if (e.key === 'Home') { e.preventDefault(); select(0); }
    else if (e.key === 'End') { e.preventDefault(); select(shown.length - 1); }
  };
  showDialog(d, { focus: input });
  announce('Command palette. Type to search, use the arrow keys to choose.');
}

function build(): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.className = 'dialog palette';
  d.setAttribute('aria-label', 'Command palette');
  d.innerHTML = `
    <div class="palette-body">
      <input class="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Type a command…" aria-label="Search commands" />
      <div class="palette-list" id="palette-list" role="listbox" aria-label="Commands"></div>
      <p class="palette-status sr-only" role="status"></p>
    </div>`;
  document.body.append(d);
  wireDialog(d);
  return d;
}
