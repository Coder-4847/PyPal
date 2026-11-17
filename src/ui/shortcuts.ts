import { renderKeys } from '../app/commands';
import { hideDialog, showDialog, wireDialog } from './dialogs';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Run and fix',
    rows: [
      ['Run the program', 'Mod-Enter'],
      ['Stop the program', 'Mod-.'],
      ['Fix all errors (or the selected lines)', 'Mod-Shift-Enter'],
      ['Close the fix preview', 'Escape'],
    ],
  },
  {
    title: 'Editor',
    rows: [
      ['Indent the line or selection', 'Tab'],
      ['Unindent', 'Shift-Tab'],
      ['Undo', 'Mod-Z'],
      ['Redo', 'Mod-Shift-Z'],
      ['Comment or uncomment', 'Mod-/'],
      ['Show suggestions', 'Ctrl-Space'],
      ['Let Tab move focus out of the editor', 'Escape'],
    ],
  },
  {
    title: 'PyPal',
    rows: [
      ['Command palette', 'Mod-K'],
      ['Download main.py', 'Mod-S'],
      ['Show this list', '?'],
    ],
  },
];

let dialog: HTMLDialogElement | null = null;

export function openShortcuts() {
  if (!dialog) {
    const d = document.createElement('dialog');
    d.className = 'dialog';
    d.setAttribute('aria-labelledby', 'shortcuts-title');
    const body = document.createElement('div');
    body.className = 'dialog-body';
    const h = document.createElement('h2');
    h.id = 'shortcuts-title';
    h.className = 'dialog-title';
    h.textContent = 'Keyboard shortcuts';
    body.append(h);
    for (const g of GROUPS) {
      const sec = document.createElement('section');
      sec.className = 'sc-group';
      const gh = document.createElement('h3');
      gh.textContent = g.title;
      const dl = document.createElement('dl');
      for (const [label, keys] of g.rows) {
        const row = document.createElement('div');
        row.className = 'sc-row';
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.append(renderKeys(keys));
        row.append(dt, dd);
        dl.append(row);
      }
      sec.append(gh, dl);
      body.append(sec);
    }
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-primary';
    close.textContent = 'Close';
    close.autofocus = true;
    close.addEventListener('click', () => hideDialog(d));
    actions.append(document.createElement('span'), close);
    actions.firstElementChild!.className = 'spacer';
    body.append(actions);
    d.append(body);
    document.body.append(d);
    wireDialog(d);
    dialog = d;
  }
  showDialog(dialog, { focus: dialog.querySelector('button') });
}
