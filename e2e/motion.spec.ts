import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, url = './') {
  await page.goto(url);
  await expect(page.locator('#run')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#splash')).toHaveClass(/gone/);
}
const setCode = (page: Page, code: string) => page.evaluate((c) => (window as any).__pypal.editor.setCode(c), code);

/** Everything that animates right now: duration, repetitions, and which properties change. */
const snapshotAnimations = (page: Page) =>
  page.evaluate(() =>
    document.getAnimations().map((a) => {
      const t = (a.effect as KeyframeEffect).getTiming();
      const props = new Set<string>();
      for (const k of (a.effect as KeyframeEffect).getKeyframes()) for (const p of Object.keys(k)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) props.add(p);
      return { name: (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'js', duration: Number(t.duration), iterations: t.iterations, props: [...props] };
    }),
  );

/** Custom properties hold unresolved calc(); read them the way the browser uses them. */
const resolveTokens = (page: Page, names: string[]) =>
  page.evaluate((ns) => ns.map((n) => { const el = document.createElement('i'); el.style.transitionDuration = `var(${n})`; document.body.append(el); const v = getComputedStyle(el).transitionDuration; el.remove(); return v; }), names);
const resolveEasing = (page: Page, names: string[]) =>
  page.evaluate((ns) => ns.map((n) => { const el = document.createElement('i'); el.style.transitionTimingFunction = `var(${n})`; document.body.append(el); const v = getComputedStyle(el).transitionTimingFunction; el.remove(); return v; }), names);

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('movement is swapped for fades: nothing slides, scales or loops', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--move').trim())).toBe('0');
    const seen: { name: string; duration: number; iterations?: number; props: string[] }[] = [];
    const sample = async () => seen.push(...(await snapshotAnimations(page)));

    await setCode(page, 'print("hi")\nprint(nope)\n');
    await page.locator('#run').click();
    await sample();
    await expect(page.locator('.err-card')).toBeVisible();
    await sample();
    await page.locator('#menu-examples').click();
    await sample();
    await page.keyboard.press('Escape');
    await page.locator('#fix-all').click();
    await sample();
    await page.waitForTimeout(400);
    await sample();

    // no endless motion at all (spinner, shimmer, caret all stop)
    expect(seen.filter((a) => a.iterations === Infinity).map((a) => a.name)).toEqual([]);
    // anything longer than a quick fade may only change opacity
    const moving = seen.filter((a) => a.duration > 130 && a.props.some((p) => !['opacity', 'visibility', 'backgroundColor', 'background-color', 'boxShadow', 'borderColor'].includes(p)));
    expect(moving, JSON.stringify(moving)).toEqual([]);
  });

  test('the theme switch is instant, not a circular reveal', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      (window as any).__vt = 0;
      const orig = (document as any).startViewTransition;
      (document as any).startViewTransition = function (...a: unknown[]) {
        (window as any).__vt++;
        return orig?.apply(document, a);
      };
    });
    await page.locator('#theme').click();
    expect(await page.evaluate(() => (window as any).__vt)).toBe(0);
  });
});

test.describe('motion=slow', () => {
  test('every duration token and JS animation runs 5x slower', async ({ page }) => {
    await open(page, './?motion=slow');
    const tokens = await resolveTokens(page, ['--dur-1', '--dur-2', '--dur-3', '--dur-4']);
    expect(tokens).toEqual(['0.6s', '1s', '1.6s', '2.4s']);
    await page.locator('#menu-examples').click();
    const anims = await snapshotAnimations(page);
    expect(anims.some((a) => a.duration === 1600)).toBe(true); // the menu's 320 ms entrance, slowed
  });

  test('normal speed uses the documented tokens', async ({ page }) => {
    await open(page);
    expect(await resolveTokens(page, ['--dur-1', '--dur-2', '--dur-3', '--dur-4'])).toEqual(['0.12s', '0.2s', '0.32s', '0.48s']);
    expect(await resolveEasing(page, ['--ease-standard', '--ease-emphasized'])).toEqual(['cubic-bezier(0.2, 0, 0, 1)', 'cubic-bezier(0.3, 0, 0, 1)']);
  });
});

test('typing and clicking are never blocked by an animation in progress', async ({ page }) => {
  await open(page, './?motion=slow'); // 5x slower makes any blocking obvious
  await setCode(page, 'x = 1\nif x\n    print(x)\n');
  await page.locator('#fix-all').click();
  await expect(page.locator('#fix-sheet')).toBeVisible();
  // while the sheet is still animating in, the editor keeps accepting keys and the page keeps responding
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('# typed during animation');
  // the 5x-slow sheet animation is still running, yet every key lands promptly
  await expect.poll(() => page.evaluate(() => (window as any).__pypal.editor.getCode()), { timeout: 3000 }).toContain('# typed during animation');
  await page.locator('#theme').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toMatch(/light|dark/);
});
