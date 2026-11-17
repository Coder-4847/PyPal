import { hideDialog, showDialog, wireDialog } from './dialogs';

let dialog: HTMLDialogElement | null = null;

/** Shown when the clipboard is not available: the link in a box, ready to copy by hand. */
export function showShareLink(url: string, long: boolean) {
  if (!dialog) {
    const d = document.createElement('dialog');
    d.className = 'dialog';
    d.setAttribute('aria-labelledby', 'share-title');
    d.innerHTML = `
      <div class="dialog-body">
        <h2 id="share-title" class="dialog-title">Share link</h2>
        <p class="dialog-lead">Anyone with this link can open a copy of your code. It is stored in the link itself, not on a server.</p>
        <label class="field"><span>Link</span><input id="share-url" type="text" readonly /></label>
        <p class="dialog-status" id="share-note"></p>
        <div class="dialog-actions"><span class="spacer"></span><button type="button" class="btn" id="share-close">Close</button><button type="button" class="btn btn-primary" id="share-copy">Copy link</button></div>
      </div>`;
    document.body.append(d);
    wireDialog(d);
    d.querySelector('#share-close')!.addEventListener('click', () => hideDialog(d));
    d.querySelector('#share-copy')!.addEventListener('click', async () => {
      const input = d.querySelector<HTMLInputElement>('#share-url')!;
      input.select();
      let ok = false;
      try {
        await navigator.clipboard.writeText(input.value);
        ok = true;
      } catch {
        ok = document.execCommand?.('copy') ?? false;
      }
      d.querySelector('#share-note')!.textContent = ok ? 'Copied.' : 'Press Ctrl+C (or Cmd+C) to copy.';
    });
    dialog = d;
  }
  const input = dialog.querySelector<HTMLInputElement>('#share-url')!;
  input.value = url;
  dialog.querySelector('#share-note')!.textContent = long ? 'This link is long, so some apps may cut it off.' : '';
  showDialog(dialog, { focus: input });
  input.select();
}
