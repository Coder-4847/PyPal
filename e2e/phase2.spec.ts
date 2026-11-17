import { expect, test, type Page } from './fixtures';

async function open(page: Page) {
  await page.goto('./');
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#splash')).toHaveClass(/gone/);
}
const setCode = (page: Page, code: string) => page.evaluate((c) => (window as any).__pypal.editor.setCode(c), code);
const getCode = (page: Page) => page.evaluate(() => (window as any).__pypal.editor.getCode() as string);
const term = (page: Page) => page.locator('#term');
const fixAllBtn = (page: Page) => page.locator('#fix-all');
const sheet = (page: Page) => page.locator('#fix-sheet');

test('a traceback becomes a friendly card with details behind a toggle', async ({ page }) => {
  await open(page);
  await setCode(page, 'total = 10\nprint(totl)\n');
  await page.locator('#run').click();
  const card = page.locator('.err-card');
  await expect(card).toBeVisible();
  await expect(card.locator('.err-title')).toContainText('totl');
  await expect(card).toContainText('Hint');
  await expect(card).toContainText('Line 2');
  // raw traceback stays hidden until asked for
  await expect(card.locator('.err-raw')).toBeHidden();
  await card.getByRole('button', { name: 'Show details' }).click();
  await expect(card.locator('.err-raw')).toContainText('Traceback');
  // clicking the card jumps to the line
  await page.locator('.cm-content').click();
  await card.locator('.err-main').click();
  const sel = await page.evaluate(() => {
    const e = (window as any).__pypal.editor;
    const s = e.view.state.selection.main;
    return e.view.state.sliceDoc(s.from, s.to);
  });
  expect(sel).toBe('print(totl)');
  await expect(page.locator('.cm-errorLine')).toHaveCount(1);
  await expect(page.locator('.cm-err-dot').filter({ visible: true })).toHaveCount(1);
});

test('live syntax check underlines the problem and explains it on hover', async ({ page }) => {
  await open(page);
  await setCode(page, 'x = 5\nif x > 3\n    print("big")\n');
  await expect(page.locator('.cm-squiggle').first()).toBeVisible();
  await page.locator('.cm-squiggle').first().hover();
  await expect(page.locator('.cm-diag-tip')).toContainText('colon');
  await expect(fixAllBtn(page)).toHaveAttribute('data-visible', 'true');
  // fixing the code clears the squiggle and hides the button
  await setCode(page, 'x = 5\nif x > 3:\n    print("big")\n');
  await expect(page.locator('.cm-squiggle')).toHaveCount(0);
  await expect(fixAllBtn(page)).toHaveAttribute('data-visible', 'false');
});

test('Fix all: preview with reasons, accept all, run, then undo', async ({ page }) => {
  await open(page);
  const broken = 'x = 5\nif x > 3\n    print("big")\nelse\n    print("small")\n';
  await setCode(page, broken);
  await expect(fixAllBtn(page)).toHaveAttribute('data-visible', 'true');
  await fixAllBtn(page).click();
  await expect(sheet(page)).toBeVisible();
  const hunks = sheet(page).locator('.hunk');
  await expect(hunks).toHaveCount(2);
  await expect(hunks.first().locator('.hunk-reason')).toContainText('colon');
  await expect(hunks.first().locator('.diff-row.del')).toContainText('if x > 3');
  await expect(hunks.first().locator('.diff-row.add')).toContainText('if x > 3:');
  await expect(hunks.first().locator('.chg')).toHaveText(':');
  await expect(page.locator('.cm-fix-shimmer').first()).toBeVisible();
  // nothing changes until accepted
  expect(await getCode(page)).toBe(broken);
  await sheet(page).getByRole('button', { name: 'Accept all' }).click();
  await expect(sheet(page)).toBeHidden();
  expect(await getCode(page)).toBe('x = 5\nif x > 3:\n    print("big")\nelse:\n    print("small")\n');
  await page.locator('#run').click();
  await expect(term(page)).toContainText('big');
  // Undo restores the original in one step
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await getCode(page)).toBe(broken);
});

test('Fix all handles a runtime error (typo) found by running', async ({ page }) => {
  await open(page);
  await setCode(page, 'total = 3\npritn(total)\n');
  await page.locator('#run').click();
  await expect(page.locator('.err-card')).toBeVisible();
  await expect(fixAllBtn(page)).toHaveAttribute('data-visible', 'true');
  await fixAllBtn(page).click();
  const hunk = sheet(page).locator('.hunk');
  await expect(hunk).toHaveCount(1);
  await expect(hunk.locator('.hunk-reason')).toContainText('print');
  await sheet(page).getByRole('button', { name: 'Accept' }).first().click();
  expect(await getCode(page)).toBe('total = 3\nprint(total)\n');
});

test('Reject leaves the code untouched; Escape also closes', async ({ page }) => {
  await open(page);
  const broken = 'for i in range(3)\n    print(i)\n';
  await setCode(page, broken);
  await fixAllBtn(page).click();
  await expect(sheet(page)).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Reject' }).click();
  await expect(sheet(page)).toBeHidden();
  expect(await getCode(page)).toBe(broken);
  await fixAllBtn(page).click();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  expect(await getCode(page)).toBe(broken);
});

test('accept one change at a time', async ({ page }) => {
  await open(page);
  // two separate problems: a typo (line 2) and a missing colon (line 5)
  await setCode(page, 'n = 2\nprint(nn)\nx = 1\nprint(x)\nif x > 0\n    print("pos")\n');
  await expect(fixAllBtn(page)).toHaveAttribute('data-visible', 'true');
  await fixAllBtn(page).click();
  const hunks = sheet(page).locator('.hunk');
  await expect(hunks).toHaveCount(2);
  await hunks.first().getByRole('button', { name: /^Accept this change/ }).click();
  await expect(hunks).toHaveCount(1);
  expect(await getCode(page)).toContain('if x > 0\n');
  expect(await getCode(page)).toContain('print(n)');
  await sheet(page).getByRole('button', { name: 'Accept' }).last().click();
  expect(await getCode(page)).toContain('if x > 0:');
});

test('Fix selection: toolbar follows the selection and fixes only those lines', async ({ page }) => {
  await open(page);
  const broken = 'for i in range(2)\n    print(i)\nif True\n    print("yes")\n';
  await setCode(page, broken);
  // select the second problem (lines 3-4)
  await page.evaluate(() => {
    const e = (window as any).__pypal.editor;
    const doc = e.view.state.doc;
    e.view.focus();
    e.view.dispatch({ selection: { anchor: doc.line(3).from, head: doc.line(4).to } });
  });
  const toolbar = page.locator('.sel-toolbar');
  await expect(toolbar).toHaveAttribute('data-visible', 'true');
  await expect(toolbar.getByRole('button')).toHaveText('Fix errors in these lines');
  await toolbar.getByRole('button').click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('.hunk')).toHaveCount(1);
  await expect(sheet(page).locator('.hunk-line')).toContainText('Line 3');
  await sheet(page).getByRole('button', { name: 'Accept' }).first().click();
  expect(await getCode(page)).toBe('for i in range(2)\n    print(i)\nif True:\n    print("yes")\n');
  // clearing the selection fades the toolbar out
  await page.evaluate(() => {
    const e = (window as any).__pypal.editor;
    e.view.dispatch({ selection: { anchor: 0 } });
  });
  await expect(toolbar).toBeHidden();
});

test('when PyPal cannot fix something it says so and explains where', async ({ page }) => {
  await open(page);
  const code = 'x = 10\ny = 0\nprint(x / y)\n';
  await setCode(page, code);
  await page.locator('#run').click();
  await expect(page.locator('.err-card')).toContainText('divide by zero');
  await fixAllBtn(page).click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page)).toContainText("couldn't fix");
  await expect(sheet(page)).toContainText('Line 3');
  await expect(sheet(page).locator('.hunk')).toHaveCount(0);
  await sheet(page).getByRole('button', { name: 'Go to line 3' }).click();
  expect(await getCode(page)).toBe(code);
});

test('settings: the key is stored locally, removable, and the AI tier is hidden without it', async ({ page }) => {
  await open(page);
  await page.locator('#open-settings').click();
  const dlg = page.locator('#settings');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('only to');
  await dlg.locator('#ai-key').fill('sk-test-123');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg.locator('#ai-status')).toContainText('on');
  expect(await page.evaluate(() => localStorage.getItem('pypal:ai'))).toContain('sk-test-123');
  await dlg.getByRole('button', { name: 'Remove key' }).click();
  expect(await page.evaluate(() => localStorage.getItem('pypal:ai'))).toBeNull();
  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(dlg).toBeHidden();
  // no key: an unfixable error never mentions AI
  await setCode(page, 'print(banana)\n');
  await page.locator('#run').click();
  await fixAllBtn(page).click();
  await expect(sheet(page)).toContainText("couldn't fix");
  await expect(sheet(page)).not.toContainText(/AI/);
});

test('AI tier: answers are verified before they are shown', async ({ page }) => {
  await open(page);
  await page.evaluate(() => localStorage.setItem('pypal:ai', JSON.stringify({ provider: 'anthropic', apiKey: 'sk-test', model: 'm' })));
  let calls = 0;
  await page.context().route('https://api.anthropic.com/**', async (route) => {
    calls++;
    const code = calls === 1 ? 'banana = "yellow"\nprint(banana)\n' : 'print(banana\n'; // 2nd answer does not compile
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ code, notes: [{ line: 1, reason: 'Created banana before using it' }] }) }] }),
    });
  });
  await setCode(page, 'print(banana)\n');
  await page.locator('#run').click();
  await expect(page.locator('.err-card')).toBeVisible();
  await fixAllBtn(page).click();
  await expect(sheet(page)).toContainText('AI provider');
  await expect(sheet(page).locator('.hunk-reason').first()).toContainText('banana');
  await sheet(page).getByRole('button', { name: 'Reject' }).click();
  // second time the model returns code that does not compile: nothing unverified is shown
  await fixAllBtn(page).click();
  await expect(sheet(page)).toContainText("couldn't fix");
  await expect(sheet(page).locator('.hunk')).toHaveCount(0);
  expect(calls).toBe(2);
});

test('neighbouring fixes are separate changes, each with its own reason', async ({ page }) => {
  await open(page);
  await setCode(page, 'name = "Ada"\nfor i in range(3)\n    print("hi", nmae)\nif i > 1\n    print("done")\n');
  await expect(fixAllBtn(page)).toHaveAttribute('data-visible', 'true');
  await fixAllBtn(page).click();
  const reasons = sheet(page).locator('.hunk .hunk-reason');
  await expect(reasons).toHaveCount(3);
  await expect(reasons.nth(0)).toContainText("colon after 'for'");
  await expect(reasons.nth(1)).toContainText("'nmae' to 'name'");
  await expect(reasons.nth(2)).toContainText("colon after 'if'");
});
