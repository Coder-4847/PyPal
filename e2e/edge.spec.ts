import { expect, test, type Page } from './fixtures';

async function open(page: Page) {
  await page.goto('./');
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#splash')).toHaveClass(/gone/);
}
const setCode = (page: Page, code: string) => page.evaluate((c) => (window as any).__pypal.editor.setCode(c), code);
const term = (page: Page) => page.locator('#term');
const run = async (page: Page) => {
  await expect(page.locator('#run')).not.toHaveAttribute('data-state', 'running');
  await page.locator('#run').click();
};

test('huge output is capped with a notice and the page stays responsive', async ({ page }) => {
  await open(page);
  await setCode(page, 'for i in range(300000):\n    print("line", i)\n');
  await run(page);
  await expect(term(page)).toContainText('Finished', { timeout: 80_000 });
  await expect(term(page).locator('.notice')).toContainText('older lines were trimmed');
  expect(await term(page).locator('.term-line').count()).toBeLessThan(2100);
  await expect(term(page)).toContainText('line 299999');
  await page.locator('#theme').click(); // still responsive
});

test('a runaway recursion becomes a friendly RecursionError card', async ({ page }) => {
  await open(page);
  await setCode(page, 'def f(n):\n    return f(n + 1)\n\nf(0)\n');
  await run(page);
  await expect(page.locator('.err-card')).toContainText('A function kept calling itself');
  await setCode(page, 'print("still fine")\n');
  await run(page);
  await expect(term(page)).toContainText('still fine');
});

test('a crash deep inside Python restarts it, and the next run works', async ({ page }) => {
  await open(page);
  // raising the recursion limit lets Python overflow the real (WebAssembly) stack
  await setCode(page, 'import sys\nsys.setrecursionlimit(10**6)\ndef f(n):\n    return f(n + 1)\nf(0)\n');
  await run(page);
  await expect(page.locator('.err-card, .term-line.status')).not.toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'idle', { timeout: 60_000 });
  await setCode(page, 'print(6 * 7)\n');
  await run(page);
  await expect(term(page)).toContainText('42', { timeout: 60_000 });
});

test('memory-hungry code fails politely', async ({ page }) => {
  await open(page);
  await setCode(page, 'x = [0] * (10 ** 12)\n');
  await run(page);
  await expect(page.locator('.err-card')).toContainText(/memory|MemoryError/i);
  await setCode(page, 'print("ok after memory")\n');
  await run(page);
  await expect(term(page)).toContainText('ok after memory', { timeout: 60_000 });
});

test('input() inside a loop asks each time', async ({ page }) => {
  await open(page);
  await setCode(page, 'total = 0\nfor i in range(3):\n    total += int(input(f"Number {i + 1}? "))\nprint("Sum:", total)\n');
  await run(page);
  for (const n of ['4', '5', '6']) {
    const field = page.locator('.term-input');
    await expect(field).toBeVisible();
    await field.fill(n);
    await field.press('Enter');
  }
  await expect(term(page)).toContainText('Sum: 15');
});

test('rapid Run/Stop clicking leaves PyPal in a working state', async ({ page }) => {
  await open(page);
  await setCode(page, 'while True:\n    pass\n');
  for (let i = 0; i < 12; i++) {
    await page.locator('#run').click({ force: true });
    await page.waitForTimeout(40 + (i % 3) * 30);
  }
  // end in a known state
  if ((await page.locator('#run').getAttribute('data-state')) === 'running') await page.locator('#run').click();
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'idle', { timeout: 30_000 });
  await setCode(page, 'print("calm again")\n');
  await run(page);
  await expect(term(page)).toContainText('calm again', { timeout: 30_000 });
});

test('Stop while the program waits for input', async ({ page }) => {
  await open(page);
  await setCode(page, 'name = input("Name? ")\nprint(name)\n');
  await run(page);
  await expect(page.locator('.term-input')).toBeVisible();
  await page.locator('#run').click(); // Stop
  await expect(term(page)).toContainText('Stopped.');
  await expect(page.locator('.term-input')).toHaveCount(0);
  await setCode(page, 'print("next")\n');
  await run(page);
  await expect(term(page)).toContainText('next');
});

test('if Python cannot be downloaded, the intro says so plainly and offers a reload', async ({ page, context }) => {
  await context.route(/\/pyodide\//, (r) => r.abort('internetdisconnected'));
  await page.goto('./');
  await expect(page.locator('#splash-error')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#splash-error')).toContainText(/connection/i);
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
});

test('corrupted saved settings are ignored safely', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('pypal:theme', 'purple');
    localStorage.setItem('pypal:split', 'NaN');
    localStorage.setItem('pypal:ai', '{not json');
    localStorage.setItem('pypal:code', '');
  });
  await open(page);
  expect(await page.evaluate(() => (window as any).__pypal.editor.getCode())).toContain('Welcome to PyPal');
  await expect(page.locator('#divider')).toHaveAttribute('aria-valuenow', '55');
  await page.locator('#open-settings').click();
  await expect(page.locator('#ai-status')).toContainText('off');
});

test('with storage blocked, PyPal still runs and says it cannot save', async ({ page }) => {
  await page.addInitScript(() => {
    const boom = () => { throw new DOMException('blocked', 'SecurityError'); };
    Storage.prototype.getItem = boom;
    Storage.prototype.setItem = boom;
    Storage.prototype.removeItem = boom;
  });
  await open(page);
  await setCode(page, 'print("no storage")\n');
  await expect(page.locator('#save-state')).toContainText('storage is off');
  await run(page);
  await expect(term(page)).toContainText('no storage');
});
