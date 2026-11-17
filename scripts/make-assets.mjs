// Renders the PNG icons and the social preview image from the logo, using Chromium via Playwright.
// Run by hand when the logo changes:  node scripts/make-assets.mjs   (outputs are committed)
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'icons');
mkdirSync(out, { recursive: true });
const fontUrl = pathToFileURL(join(root, 'src/assets/fonts/inter-latin-wght-normal.woff2')).href;
const sandbox = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? (existsSync(sandbox) ? sandbox : undefined), args: ['--no-sandbox'] });

const mark = (stroke, dot, size) => `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none"><path d="M20 54V12h14c10 0 16 6 16 14s-6 14-16 14H20" stroke="${stroke}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="46" cy="50" r="3.6" fill="${dot}"/></svg>`;

async function shot(html, w, h, file) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.setContent(`<style>@font-face{font-family:Inter;src:url(${fontUrl});font-weight:100 900}*{margin:0;box-sizing:border-box}body{width:${w}px;height:${h}px;font-family:Inter,system-ui,sans-serif}</style>${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, file) });
  await page.close();
}

const tile = (size, pad, radius) =>
  `<div style="width:${size}px;height:${size}px;background:#2f5fd0;border-radius:${radius}px;display:grid;place-items:center">${mark('#fff', '#fff', size - pad * 2)}</div>`;

await shot(tile(512, 72, 112), 512, 512, 'icon-512.png');
await shot(tile(192, 27, 42), 192, 192, 'icon-192.png');
await shot(tile(180, 24, 0), 180, 180, 'apple-touch-icon.png');
await shot(tile(32, 4, 7), 32, 32, 'favicon-32.png');
// maskable: full-bleed background, logo inside the central safe zone (about 60%)
await shot(`<div style="width:512px;height:512px;background:#2f5fd0;display:grid;place-items:center">${mark('#fff', '#fff', 300)}</div>`, 512, 512, 'maskable-512.png');

const pill = (t) => `<span style="display:inline-block;padding:10px 20px;border-radius:999px;background:#fff;border:1px solid #d9d9e0;font-size:22px;font-weight:550;color:#33333b;white-space:nowrap">${t}</span>`;
await shot(
  `<div style="width:1200px;height:630px;background:#f6f6f8;display:flex;align-items:center;padding:0 96px;gap:72px">
     <div style="flex:none;width:260px;height:260px;border-radius:56px;background:#2f5fd0;display:grid;place-items:center">${mark('#fff', '#fff', 190)}</div>
     <div>
       <div style="font-size:108px;font-weight:700;letter-spacing:-0.03em;color:#1b1b20;line-height:1">PyPal</div>
       <div style="font-size:38px;font-weight:500;color:#565662;margin-top:20px;line-height:1.3;max-width:660px">Your Python pal. Runs in your browser, explains errors and fixes them in one click.</div>
       <div style="display:flex;gap:12px;margin-top:36px">${pill('Real Python')}${pill('Plain-English errors')}${pill('Free, no sign-in')}</div>
     </div>
   </div>`,
  1200,
  630,
  '../og.png',
);
await browser.close();
console.log('assets written to public/icons and public/og.png');
