import type { Friendly } from '../errors/explain';

export interface CardOptions {
  type: string; // "NameError"
  friendly: Friendly;
  traceback: string;
  onJump(line: number): void;
}

/**
 * A traceback turned into a card: what happened, where, and a hint. The whole card jumps to the
 * line in the editor; the raw traceback stays behind "Show details".
 */
export function createErrorCard(o: CardOptions): HTMLElement {
  const { friendly: f } = o;
  const card = document.createElement('div');
  card.className = 'err-card';
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', `Error: ${f.title}`);

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'err-main';
  if (f.line) main.setAttribute('aria-label', `${f.title}. Go to line ${f.line}`);
  else main.disabled = true;

  const head = document.createElement('span');
  head.className = 'err-head';
  const chip = document.createElement('span');
  chip.className = 'err-type';
  chip.textContent = o.type;
  head.append(chip);
  if (f.line) {
    const where = document.createElement('span');
    where.className = 'err-line';
    where.textContent = `Line ${f.line}`;
    head.append(where);
  }

  const title = document.createElement('strong');
  title.className = 'err-title';
  title.textContent = f.title;
  const what = document.createElement('span');
  what.className = 'err-what';
  what.textContent = f.what;
  const hint = document.createElement('span');
  hint.className = 'err-hint';
  const hintLabel = document.createElement('b');
  hintLabel.textContent = 'Hint ';
  hint.append(hintLabel, document.createTextNode(f.hint));
  main.append(head, title, what, hint);
  if (f.line) main.addEventListener('click', () => o.onJump(f.line!));

  const actions = document.createElement('div');
  actions.className = 'err-actions';
  const details = document.createElement('button');
  details.type = 'button';
  details.className = 'btn btn-quiet';
  details.textContent = 'Show details';
  details.setAttribute('aria-expanded', 'false');
  const raw = document.createElement('pre');
  raw.className = 'err-raw';
  raw.hidden = true;
  raw.textContent = o.traceback;
  raw.id = `err-raw-${Math.random().toString(36).slice(2, 8)}`;
  details.setAttribute('aria-controls', raw.id);
  details.addEventListener('click', () => {
    const open = raw.hidden;
    raw.hidden = !open;
    details.textContent = open ? 'Hide details' : 'Show details';
    details.setAttribute('aria-expanded', String(open));
  });
  actions.append(details);
  card.append(main, actions, raw);
  return card;
}
