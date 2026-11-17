// README screenshots from a served build:  node scripts/screenshots.mjs [url]
import { existsSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = 'docs/screenshots';
const sandbox = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? (existsSync(sandbox) ? sandbox : undefined), args: ['--no-sandbox'] });

async function page(opts) {
  const p = await (await browser.newContext({ deviceScaleFactor: 2, ...opts })).newPage();
  await p.goto(url);
  await p.waitForSelector('#run[data-state=idle]', { timeout: 90000 });
  await p.waitForSelector('#splash.gone', { state: 'attached' });
  await p.waitForTimeout(800);
  return p;
}
const desktop = { viewport: { width: 1280, height: 760 } };

// 1. a friendly error card, with the line marked and Fix all errors offered
let p = await page({ ...desktop, colorScheme: 'light' });
await p.evaluate(() => window.__pypal.editor.setCode('# Add up some scores\nscores = [7, 9, 4]\ntotal = 0\nfor s in scores:\n    total = total + s\nprint("Average:", totl / len(scores))\n'));
await p.click('#run');
await p.waitForSelector('.err-card');
await p.waitForTimeout(1200);
await p.mouse.move(0, 0);
await p.screenshot({ path: `${out}/error-card.png` });

// 2. the fix preview, with a reason for every change
await p.evaluate(() => window.__pypal.editor.setCode('# This program has a few mistakes\ndef greet(name)\n    print("Hello, " + name + "!")\n\ngreet("Ada")\nage = input("How old are you? ")\nif age > 12:\n    print("Teenager or older")\npritn("Done")\n'));
await p.click('#clear');
await p.waitForTimeout(900);
await p.click('#fix-all');
await p.waitForSelector('.hunk');
await p.waitForTimeout(1600);
await p.screenshot({ path: `${out}/fix-preview.png` });
await p.close();

// 3. dark theme, running a program that asks a question
p = await page({ ...desktop, colorScheme: 'dark' });
await p.click('#menu-examples');
await p.getByRole('menuitem').filter({ hasText: 'Asking questions' }).click();
await p.waitForTimeout(600);
await p.click('#run');
await p.waitForSelector('.term-input');
await p.keyboard.type('Ada');
await p.keyboard.press('Enter');
await p.waitForSelector('.term-input');
await p.keyboard.type('12');
await p.keyboard.press('Enter');
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/dark-input.png` });
await p.close();

// 4. phone
p = await page({ ...devices['Pixel 7'], deviceScaleFactor: 2, colorScheme: 'light' });
await p.evaluate(() => window.__pypal.editor.setCode('for i in range(3)\n    print("Hello", i)\n'));
await p.waitForTimeout(900);
await p.tap('#fix-all');
await p.waitForSelector('.hunk');
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/phone.png` });
await browser.close();
console.log('screenshots written to', out);
