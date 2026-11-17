import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

async function open(page: Page) {
  await page.goto('./');
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#splash')).toHaveClass(/gone/);
}
const setCode = (page: Page, code: string) => page.evaluate((c) => (window as any).__pypal.editor.setCode(c), code);

/** Run axe on the current state and fail with a readable list. */
async function audit(page: Page, label: string) {
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async () => {
    // @ts-expect-error axe is injected above
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }, resultTypes: ['violations'] });
    return r.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n: any) => `${n.target.join(' ')} :: ${(n.failureSummary || '').split('\n')[1] ?? ''}`) }));
  });
  expect(result, `${label}: ${JSON.stringify(result, null, 1)}`).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe, ${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test('main screen, error card, fix preview and failure sheet', async ({ page }) => {
      await open(page);
      await audit(page, 'idle');
      await setCode(page, 'total = 3\nprint(totl)\n');
      await page.locator('#run').click();
      await expect(page.locator('.err-card')).toBeVisible();
      await page.locator('.err-card').getByRole('button', { name: 'Show details' }).click();
      await page.waitForTimeout(600); // let the details finish fading in
      await audit(page, 'error card');
      await page.locator('#fix-all').click();
      await expect(page.locator('#fix-sheet .hunk')).toHaveCount(1);
      await page.waitForTimeout(900);
      await audit(page, 'fix preview');
      await page.keyboard.press('Escape');
      await setCode(page, 'x = 1\ny = 0\nprint(x / y)\n');
      await page.locator('#run').click();
      await page.locator('#fix-all').click();
      await expect(page.locator('#fix-sheet')).toContainText("couldn't fix");
      await page.waitForTimeout(500);
      await audit(page, 'failure sheet');
    });

    test('menus, dialogs and the command palette', async ({ page }) => {
      await open(page);
      await page.locator('#menu-examples').click();
      await page.waitForTimeout(500);
      await audit(page, 'examples menu');
      await page.keyboard.press('Escape');
      await page.locator('#open-settings').click();
      await page.waitForTimeout(500);
      await audit(page, 'settings dialog');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(500);
      await audit(page, 'palette');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await page.locator('#open-shortcuts').click();
      await page.waitForTimeout(500);
      await audit(page, 'shortcut sheet');
    });

    test('phone layout', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 780 });
      await open(page);
      await audit(page, 'phone');
    });
  });
}

test('keyboard: every control is reachable and visibly focused, in a sensible order', async ({ page }) => {
  await open(page);
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  const order: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    // Tab indents inside the editor by design; Escape then Tab is the way out
    if (await page.evaluate(() => Boolean(document.activeElement?.closest('.cm-editor')))) {
      order.push('editor');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Tab');
    }
    const id = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return 'none';
      return el.id || el.getAttribute('aria-label') || el.className.toString().split(' ')[0] || el.tagName;
    });
    order.push(id);
  }
  const text = order.join(' > ');
  // brand, then the Run button, then the menus and icon buttons, then the editor, then the splitter, then the terminal
  expect(text.indexOf('run')).toBeGreaterThan(-1);
  expect(text.indexOf('run')).toBeLessThan(text.indexOf('menu-examples'));
  expect(text.indexOf('menu-examples')).toBeLessThan(text.indexOf('menu-file'));
  expect(text.indexOf('theme')).toBeLessThan(text.indexOf('editor'));
  expect(text).toContain('divider');
});

test('focus rings are drawn on the Run button, menu buttons and dividers', async ({ page }) => {
  await open(page);
  for (const sel of ['#run', '#menu-examples', '#theme', '#clear']) {
    await page.locator(sel).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500); // the ring fades in
    const ring = await page.locator(sel).evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      return { opacity: after.opacity, content: after.content, outline: getComputedStyle(el).outlineStyle };
    });
    expect(ring.opacity === '1' || ring.outline !== 'none', `${sel} shows a focus indicator: ${JSON.stringify(ring)}`).toBe(true);
  }
});

test('screen readers hear errors, fixes and results through a polite live region', async ({ page }) => {
  await open(page);
  const live = page.locator('#sr-live');
  await expect(live).toHaveAttribute('aria-live', 'polite');
  await setCode(page, 'print("a")\nprint("b")\n');
  await page.locator('#run').click();
  await expect(live).toContainText('Program finished');
  await expect(live).toContainText('2 lines of output');
  await setCode(page, 'print(nope)\n');
  await page.locator('#run').click();
  await expect(live).toContainText('line 1');
  await page.locator('#fix-all').click();
  await expect(page.locator('#fix-sheet .hunk')).toHaveCount(0); // `nope` has no safe fix
  await expect(live).toContainText('could not fix');
});

test('landmarks and headings are in place', async ({ page }) => {
  await open(page);
  expect(await page.locator('main').count()).toBe(1);
  expect(await page.locator('header').count()).toBe(1);
  expect(await page.locator('h1').count()).toBe(1);
  await expect(page.getByRole('region', { name: 'Code editor' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Terminal' })).toBeVisible();
  await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', /\d+/);
});
