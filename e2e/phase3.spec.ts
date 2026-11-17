import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

async function open(page: Page, url = './') {
  await page.goto(url);
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#splash')).toHaveClass(/gone/);
}
const setCode = (page: Page, code: string) => page.evaluate((c) => (window as any).__pypal.editor.setCode(c), code);
const getCode = (page: Page) => page.evaluate(() => (window as any).__pypal.editor.getCode() as string);
const term = (page: Page) => page.locator('#term');

/** Cut the network for the page AND its service worker. */
async function goOffline(ctx: BrowserContext) {
  await ctx.route('**/*', (route) => route.abort('internetdisconnected'));
}

test.describe('examples and menus', () => {
  test('the Examples menu lists six starters and loads one, with Undo', async ({ page }) => {
    await open(page);
    await setCode(page, 'print("my own code")\n');
    await page.locator('#menu-examples').click();
    const items = page.getByRole('menuitem');
    await expect(items).toHaveCount(6);
    await items.filter({ hasText: 'Loops' }).click();
    expect(await getCode(page)).toContain('for i in range(1, 6):');
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await getCode(page)).toBe('print("my own code")\n');
  });

  test('the broken example can be fixed in one click', async ({ page }) => {
    await open(page);
    await page.locator('#menu-examples').click();
    await page.getByRole('menuitem').filter({ hasText: 'Broken program' }).click();
    await expect(page.locator('#fix-all')).toHaveAttribute('data-visible', 'true');
    await page.locator('#fix-all').click();
    await expect(page.locator('#fix-sheet .hunk')).toHaveCount(3);
    await page.locator('#fix-sheet').getByRole('button', { name: 'Accept all' }).click();
    await page.locator('#run').click();
    await expect(term(page)).toContainText('Hello, Ada!');
    await page.locator('.term-input').fill('20');
    await page.locator('.term-input').press('Enter');
    await expect(term(page)).toContainText('You are a teenager or older.');
    await expect(term(page)).toContainText('The total is 6');
  });

  test('menu keyboard: arrows move, Escape closes and returns focus', async ({ page }) => {
    await open(page);
    const btn = page.locator('#menu-file');
    await btn.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem').nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    await expect(btn).toBeFocused();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('files and sharing', () => {
  test('download gives main.py with the code', async ({ page }) => {
    await open(page);
    await setCode(page, 'print("download me")\n');
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
    expect(download.suggestedFilename()).toBe('main.py');
    const path = await download.path();
    expect(readFileSync(path!, 'utf8')).toBe('print("download me")\n');
  });

  test('open a .py file replaces the code (undoable); binary files are refused', async ({ page }) => {
    await open(page);
    await setCode(page, 'print("old")\n');
    await page.locator('#file-input').setInputFiles({ name: 'hello.py', mimeType: 'text/x-python', buffer: Buffer.from('print("from a file")\n') });
    await expect.poll(() => getCode(page)).toBe('print("from a file")\n');
    await page.locator('#file-input').setInputFiles({ name: 'x.py', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 0, 3]) });
    await expect(page.locator('.toast').last()).toContainText("doesn't look like a text file");
    expect(await getCode(page)).toBe('print("from a file")\n');
  });

  test('share link round-trips through the URL hash and keeps the previous code restorable', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page);
    await setCode(page, 'print("shared \u{1F40D}")\n');
    await page.locator('#menu-file').click();
    await page.getByRole('menuitem', { name: 'Copy share link' }).click();
    await expect(page.locator('.toast').last()).toContainText('Link copied');
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toContain('#c=v1.');

    const page2 = await context.newPage();
    await page2.goto('./'); // a different person with their own code
    await expect(page2.locator('#splash')).toHaveClass(/gone/);
    await page2.evaluate(() => (window as any).__pypal.editor.setCode('print("theirs")\n'));
    await expect.poll(() => page2.evaluate(() => localStorage.getItem('pypal:code'))).toBe('print("theirs")\n');
    await page2.goto(url);
    await expect(page2.locator('#splash')).toHaveClass(/gone/);
    expect(await getCode(page2)).toBe('print("shared \u{1F40D}")\n');
    expect(new URL(page2.url()).hash).toBe(''); // the hash is cleaned up
    await page2.getByRole('button', { name: 'Restore mine' }).click();
    expect(await getCode(page2)).toBe('print("theirs")\n');
  });

  test('a damaged share link is refused politely and leaves the saved code alone', async ({ page }) => {
    await open(page);
    await setCode(page, 'print("keep me")\n');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('pypal:code'))).toBe('print("keep me")\n');
    for (const bad of ['#c=v1.%%%%', '#c=garbage', '#c=v1.AAAA', '#c=v0.' + 'A'.repeat(30)]) {
      await page.goto('./' + bad);
      await expect(page.locator('#splash')).toHaveClass(/gone/);
      expect(await getCode(page)).toBe('print("keep me")\n');
      await expect(page.locator('.toast').last()).toContainText('Your own code is untouched');
    }
  });

  test('a hostile payload is shown as text, never run as HTML', async ({ page }) => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>\n# </textarea></style>\n';
    const payload = deflateRawSync(Buffer.from(evil)).toString('base64url');
    await page.goto(`./#c=v1.${payload}`);
    await expect(page.locator('#splash')).toHaveClass(/gone/);
    expect(await getCode(page)).toBe(evil);
    await expect(page.locator('.cm-content')).toContainText('<img src=x');
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
    expect(await page.locator('.cm-content img, .cm-content script').count()).toBe(0);
  });
});

test.describe('command palette and shortcuts', () => {
  test('Ctrl+K opens the palette; typing filters; Enter runs the command', async ({ page }) => {
    await open(page);
    await setCode(page, 'print("palette")\n');
    await page.keyboard.press('Control+k');
    const input = page.getByRole('combobox', { name: 'Search commands' });
    await expect(input).toBeFocused();
    await expect(page.getByRole('option').first()).toBeVisible();
    await input.fill('run');
    await expect(page.getByRole('option').first()).toContainText('Run the program');
    await page.keyboard.press('Enter');
    await expect(term(page)).toContainText('palette');
  });

  test('the palette can load an example, and Escape closes it', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('functions');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect.poll(() => getCode(page)).toContain('def greet(name):');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeHidden();
  });

  test('? opens the shortcut sheet (but typing ? in the editor does not)', async ({ page }) => {
    await open(page);
    await page.locator('.cm-content').click();
    await page.keyboard.type('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
    expect(await getCode(page)).toContain('?');
    await page.locator('#open-shortcuts').focus();
    await page.keyboard.press('Escape');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('?');
    const dlg = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText('Command palette');
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });

  test('Escape then Tab leaves the editor instead of trapping focus', async ({ page }) => {
    await open(page);
    await setCode(page, 'x = 1\n');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Tab');
    expect(await getCode(page)).toBe('x = 1\n    '); // Tab indents
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    const inEditor = await page.evaluate(() => Boolean(document.activeElement?.closest('.cm-editor')));
    expect(inEditor).toBe(false);
  });
});

test.describe('offline and install', () => {
  test('after the first visit PyPal works with no network, including packages used before', async ({ page, context }) => {
    await open(page);
    // use numpy once while online so its wheel is cached
    await setCode(page, 'import numpy as np\nprint(np.arange(5).sum())\n');
    await page.locator('#run').click();
    await expect(term(page)).toContainText('10', { timeout: 80_000 });
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('pypal-')).length)).toBeGreaterThanOrEqual(3);
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

    await goOffline(context);
    await page.reload();
    await expect(page.locator('#run')).toHaveAttribute('data-state', 'idle', { timeout: 60_000 });
    await expect(page.locator('#net-chip')).toBeHidden(); // route-level offline: the browser still says online
    await setCode(page, 'print("offline ok")\n');
    await page.locator('#run').click();
    await expect(term(page)).toContainText('offline ok');
    await setCode(page, 'import numpy as np\nprint(np.arange(5).sum() * 2)\n');
    await page.locator('#run').click();
    await expect(term(page)).toContainText('20', { timeout: 60_000 });
    // Fix works offline too
    await setCode(page, 'for i in range(2)\n    print(i)\n');
    await page.locator('#fix-all').click();
    await expect(page.locator('#fix-sheet .hunk')).toHaveCount(1);
  });

  test('the offline chip appears when the browser goes offline', async ({ page, context }) => {
    await open(page);
    await context.setOffline(true);
    await expect(page.locator('#net-chip')).toBeVisible();
    await context.setOffline(false);
    await expect(page.locator('#net-chip')).toBeHidden();
  });

  test('manifest, icons, social image and the 404 page are served', async ({ page, request }) => {
    await open(page);
    const m = await (await request.get('manifest.webmanifest')).json();
    expect(m.display).toBe('standalone');
    for (const icon of m.icons) expect((await request.get(icon.src)).status()).toBe(200);
    expect((await request.get('og.png')).status()).toBe(200);
    const html = await page.content();
    expect(html).toContain('property="og:title"');
    expect(html).toContain('rel="manifest"');
    expect(await page.locator('h1').first().textContent()).toContain('PyPal');
  });
});
