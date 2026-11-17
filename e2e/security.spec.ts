import { expect, test, type Page } from './fixtures';

async function open(page: Page) {
  await page.goto('./');
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#splash')).toHaveClass(/gone/);
}
const setCode = (page: Page, code: string) => page.evaluate((c) => (window as any).__pypal.editor.setCode(c), code);

test('the Content-Security-Policy is in force and nothing PyPal does violates it', async ({ page }) => {
  test.setTimeout(240_000); // the first numpy download can be slow
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|Content-Security-Policy|CSP/i.test(m.text())) violations.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      ((window as any).__csp ??= []).push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  await open(page);
  const header = await page.evaluate(async () => (await fetch(location.href)).headers.get('content-security-policy'));
  expect(header ?? '').toContain("frame-ancestors 'none'");
  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').count()).toBe(1);

  // exercise everything: run, input, a package from the CDN, an error, a fix, menus, palette, settings, theme
  await setCode(page, 'import numpy as np\nprint(np.arange(3).sum())\nname = input("Name? ")\nprint(name)\n');
  await page.locator('#run').click();
  await page.locator('.term-input').fill('Ada', { timeout: 80_000 });
  await page.locator('.term-input').press('Enter');
  await expect(page.locator('#term')).toContainText('Ada');
  await setCode(page, 'total = 1\nprint(totl)\n');
  await page.locator('#run').click();
  await page.locator('#fix-all').click();
  await expect(page.locator('#fix-sheet .hunk')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await page.locator('#open-settings').click();
  await page.keyboard.press('Escape');
  await page.locator('#theme').click();
  await page.waitForTimeout(800);
  const events = await page.evaluate(() => (window as any).__csp ?? []);
  expect([...events, ...violations]).toEqual([]);
});

test('error messages and program output are shown as text, never as HTML', async ({ page }) => {
  await open(page);
  await setCode(page, 'print("<b id=injected>bold?</b>")\nraise ValueError("<img id=evil src=x onerror=\\"window.__pwned=1\\">")\n');
  await page.locator('#run').click();
  await expect(page.locator('.err-card')).toBeVisible();
  await expect(page.locator('#term')).toContainText('<b id=injected>bold?</b>');
  expect(await page.locator('#injected, #evil').count()).toBe(0);
  await page.locator('.err-card').getByRole('button', { name: 'Show details' }).click();
  await expect(page.locator('.err-raw')).toContainText('<img id=evil');
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
});

test('the AI key is stored only locally and only sent to the provider', async ({ page, context }) => {
  await open(page);
  const seen: { url: string; hasKey: boolean }[] = [];
  page.on('request', (r) => {
    const h = r.headers();
    seen.push({ url: r.url(), hasKey: JSON.stringify(h).includes('sk-secret-123') || (r.postData() ?? '').includes('sk-secret-123') });
  });
  await context.route('https://api.anthropic.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ content: [{ text: '{"code": null, "notes": []}' }] }) }),
  );
  await page.locator('#open-settings').click();
  await page.locator('#ai-key').fill('sk-secret-123');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.keyboard.press('Escape');
  await setCode(page, 'print(zzqq)\n');
  await page.locator('#run').click();
  await page.locator('#fix-all').click();
  await expect(page.locator('#fix-sheet')).toContainText("couldn't fix");
  const withKey = seen.filter((s) => s.hasKey).map((s) => new URL(s.url).host);
  expect(withKey.every((h) => h === 'api.anthropic.com')).toBe(true);
  // the key never appears in the page, in a share link, or in the URL
  expect(await page.content()).not.toContain('sk-secret-123');
  expect(page.url()).not.toContain('sk-secret');
});
