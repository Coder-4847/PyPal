import { test as base } from '@playwright/test';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * In the cloud sandbox, HTTPS goes through a proxy whose CA Firefox does not know. When
 * PW_FIREFOX_PROFILE points at an NSS profile that trusts it (a profile holding only that
 * certificate database, never one that has visited the site), Firefox tests run in a fresh copy of
 * that profile (a persistent context), with the same options a normal context would get.
 * Everywhere else this is the stock Playwright `context`.
 */
export const test = base.extend({
  context: async (
    { browserName, playwright, viewport, colorScheme, reducedMotion, baseURL, permissions, acceptDownloads, locale, hasTouch, isMobile, userAgent, deviceScaleFactor, serviceWorkers, bypassCSP, context },
    use,
  ) => {
    const profile = process.env.PW_FIREFOX_PROFILE;
    if (browserName !== 'firefox' || !profile) {
      await use(context);
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'pypal-ff-'));
    cpSync(profile, dir, { recursive: true });
    const ctx = await playwright.firefox.launchPersistentContext(dir, {
      viewport, colorScheme, reducedMotion, baseURL, permissions, acceptDownloads, locale, hasTouch, isMobile, userAgent, deviceScaleFactor, serviceWorkers, bypassCSP,
    });
    await use(ctx);
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});

export { expect } from '@playwright/test';
export type { BrowserContext, Page } from '@playwright/test';
