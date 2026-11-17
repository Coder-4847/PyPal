// Motion audit: records frame times while each animated moment plays, and lists which CSS
// properties are animated. Run against a served build:
//   node scripts/motion-audit.mjs [url]          (default http://localhost:4173/)
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';
const sandbox = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? (existsSync(sandbox) ? sandbox : undefined), args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

await page.addInitScript(() => {
  const w = window;
  w.__frames = [];
  w.__props = new Set();
  const tick = (t) => {
    w.__frames.push(t);
    for (const a of document.getAnimations()) {
      const kf = a.effect?.getKeyframes?.() ?? [];
      for (const k of kf) for (const p of Object.keys(k)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) w.__props.add(p);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

async function measure(name, action, settleMs = 900) {
  await page.evaluate(() => (window.__frames = []));
  await action();
  await page.waitForTimeout(settleMs);
  const f = await page.evaluate(() => window.__frames);
  const d = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
  const p95 = d[Math.floor(d.length * 0.95)] ?? 0;
  const long = d.filter((x) => x > 50).length;
  console.log(`${name.padEnd(28)} frames ${String(d.length).padStart(3)}  median ${(d[d.length >> 1] ?? 0).toFixed(1)} ms  p95 ${p95.toFixed(1)} ms  >50ms ${long}`);
  return { name, p95, long };
}

const results = [];
results.push(await measure('intro (load to settled)', async () => {
  await page.goto(url);
  await page.waitForSelector('#splash.gone', { state: 'attached', timeout: 90000 });
}, 600));
const set = (c) => page.evaluate((x) => window.__pypal.editor.setCode(x), c);
await set('print("hi")\n');
results.push(await measure('run button morph', () => page.click('#run'), 1600));
results.push(await measure('menu open', () => page.click('#menu-examples')));
await page.keyboard.press('Escape');
results.push(await measure('palette open', () => page.keyboard.press('Control+k')));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await set('total = 3\nprint(totl)\n');
results.push(await measure('error card + squiggle', () => page.click('#run'), 1200));
results.push(await measure('fix preview unfold', async () => { await page.click('#fix-all'); await page.waitForSelector('.hunk'); }, 1200));
results.push(await measure('accept: wipe + toast', () => page.click('#fix-sheet [data-act="accept-all"]'), 1200));
results.push(await measure('theme switch reveal', () => page.click('#theme'), 1000));
results.push(await measure('typing 40 characters', async () => {
  await page.locator('.cm-content').click();
  await page.keyboard.type('# typing should never stutter at all ok');
}, 300));
const props = await page.evaluate(() => [...window.__props].sort());
console.log('\nanimated properties:', props.join(', '));
await browser.close();
const bad = results.filter((r) => r.long > 2);
if (bad.length) console.log('\nmoments with more than 2 long frames:', bad.map((b) => b.name).join(', '));
