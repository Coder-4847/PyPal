import { DEFAULT_MODELS, PROVIDER_HOSTS, loadAiSettings, saveAiSettings, type Provider } from '../fix/ai';
import { animate } from '../motion/motion';

/** The Settings dialog: the optional AI key. It stays in this browser and goes only to the provider. */
export function initSettings(dialog: HTMLDialogElement, opener: HTMLElement, onChange: () => void) {
  const provider = dialog.querySelector<HTMLSelectElement>('#ai-provider')!;
  const key = dialog.querySelector<HTMLInputElement>('#ai-key')!;
  const model = dialog.querySelector<HTMLInputElement>('#ai-model')!;
  const host = dialog.querySelector<HTMLElement>('#ai-host')!;
  const status = dialog.querySelector<HTMLElement>('#ai-status')!;
  const remove = dialog.querySelector<HTMLButtonElement>('#ai-remove')!;
  const closeBtn = dialog.querySelector<HTMLButtonElement>('#settings-close')!;
  const form = dialog.querySelector<HTMLFormElement>('form')!;

  const refresh = () => {
    const p = provider.value as Provider;
    host.textContent = PROVIDER_HOSTS[p];
    model.placeholder = DEFAULT_MODELS[p];
    const saved = loadAiSettings();
    status.textContent = saved ? `AI help is on (${saved.provider}). Your key is saved in this browser.` : 'AI help is off. The built-in fixes work without it.';
    remove.hidden = !saved;
  };

  const load = () => {
    const s = loadAiSettings();
    provider.value = s?.provider ?? 'anthropic';
    key.value = s?.apiKey ?? '';
    model.value = s?.model && s.model !== DEFAULT_MODELS[s.provider] ? s.model : '';
    refresh();
  };

  const closeAnimated = () => {
    if (!dialog.open) return;
    const a = animate(dialog, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8px) scale(.98)' }], { duration: 'base', easing: 'standard' });
    a.onfinish = () => {
      dialog.close();
      opener.focus();
    };
  };

  opener.addEventListener('click', () => {
    load();
    dialog.showModal();
    animate(dialog, [{ opacity: 0, transform: 'translateY(12px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 'slow', easing: 'spring' });
    key.focus();
  });
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeAnimated();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeAnimated(); // click on the backdrop
  });
  closeBtn.addEventListener('click', closeAnimated);
  provider.addEventListener('change', () => {
    host.textContent = PROVIDER_HOSTS[provider.value as Provider];
    model.placeholder = DEFAULT_MODELS[provider.value as Provider];
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const k = key.value.trim();
    if (!k) {
      saveAiSettings(null);
    } else {
      const p = provider.value as Provider;
      saveAiSettings({ provider: p, apiKey: k, model: model.value.trim() || DEFAULT_MODELS[p] });
    }
    refresh();
    onChange();
    status.textContent = k ? 'Saved. AI help is on.' : 'Key removed. AI help is off.';
  });
  remove.addEventListener('click', () => {
    saveAiSettings(null);
    key.value = '';
    refresh();
    onChange();
    status.textContent = 'Key removed. AI help is off.';
  });
}
