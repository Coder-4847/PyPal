import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.goto('./');
  // First visit reloads once so the service worker can isolate the page.
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#splash')).toHaveClass(/gone/);
}

async function setCode(page: Page, code: string) {
  await page.evaluate((c) => (window as any).__pypal.editor.setCode(c), code);
}

const term = (page: Page) => page.locator('#term');

test('page becomes cross-origin isolated and Python loads', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  await expect(page.locator('#py-version')).toContainText('Python 3');
});

test('print, loop and the run button states', async ({ page }) => {
  await open(page);
  await setCode(page, 'print("hi")\nfor i in range(3):\n    print("n", i)\n');
  await page.locator('#run').click();
  await expect(term(page)).toContainText('hi');
  await expect(term(page)).toContainText('n 2');
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'success');
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'idle');
});

test('Ctrl+Enter runs from the editor', async ({ page }) => {
  await open(page);
  await setCode(page, 'print(6 * 7)\n');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Enter');
  await expect(term(page)).toContainText('42');
});

test('input() works inline in the terminal', async ({ page }) => {
  await open(page);
  await setCode(page, 'name = input("Name? ")\nprint("Hello,", name)\nage = int(input("Age? "))\nprint(age + 1)\n');
  await page.locator('#run').click();
  const field = page.locator('.term-input');
  await expect(field).toBeVisible();
  await field.fill('Ada');
  await field.press('Enter');
  await expect(term(page)).toContainText('Hello, Ada');
  await page.locator('.term-input').fill('36');
  await page.locator('.term-input').press('Enter');
  await expect(term(page)).toContainText('37');
});

test('an infinite loop can be stopped without freezing the page', async ({ page }) => {
  await open(page);
  await setCode(page, 'n = 0\nwhile True:\n    n += 1\n');
  await page.locator('#run').click();
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'running');
  await page.waitForTimeout(500);
  await page.locator('#run').click(); // now "Stop"
  await expect(term(page)).toContainText('Stopped.');
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'idle');
  // and it can run again
  await setCode(page, 'print("again")\n');
  await page.locator('#run').click();
  await expect(term(page)).toContainText('again');
});

test('a stuck sleep() and a print-heavy loop can be stopped', async ({ page }) => {
  await open(page);
  await setCode(page, 'import time\nprint("start")\ntime.sleep(60)\n');
  await page.locator('#run').click();
  await expect(term(page)).toContainText('start');
  await page.locator('#run').click();
  await expect(term(page)).toContainText('Stopped.');
  await setCode(page, 'while True:\n    print("spam")\n');
  await page.locator('#run').click();
  await expect(term(page)).toContainText('spam');
  await page.locator('#run').click();
  await expect(term(page)).toContainText('Stopped.');
  expect(await term(page).locator('.term-line').count()).toBeLessThan(2100);
});

test('errors show the traceback and mark the line', async ({ page }) => {
  await open(page);
  await setCode(page, 'x = 1\nprint(x)\nprint(undefined_name)\n');
  await page.locator('#run').click();
  await expect(term(page)).toContainText('NameError');
  await expect(page.locator('.cm-errorLine')).toHaveCount(1);
  await expect(page.locator('.cm-errorLine')).toContainText('undefined_name');
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'idle');
});

test('syntax errors are reported with the line marked', async ({ page }) => {
  await open(page);
  await setCode(page, 'print("a")\nif True\n    print("b")\n');
  await page.locator('#run').click();
  await expect(term(page)).toContainText('SyntaxError');
  await expect(page.locator('.cm-errorLine')).toHaveCount(1);
});

test('autosave restores code after reload', async ({ page }) => {
  await open(page);
  await setCode(page, 'print("remember me")\n');
  await expect(page.locator('#save-state')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('#splash')).toHaveClass(/gone/);
  await expect(page.locator('.cm-content')).toContainText('remember me');
});

test('theme toggle switches and persists', async ({ page }) => {
  await open(page);
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.locator('#theme').click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(before);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
});

test('the split can be resized with the keyboard', async ({ page }) => {
  await open(page);
  const divider = page.locator('#divider');
  await divider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '58');
});

test('phone layout stacks editor above terminal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await open(page);
  const e = await page.locator('.pane-editor').boundingBox();
  const t = await page.locator('.pane-terminal').boundingBox();
  expect(t!.y).toBeGreaterThan(e!.y + e!.height - 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
