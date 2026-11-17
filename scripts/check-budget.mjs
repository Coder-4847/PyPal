// Fails the build if the app grows past its budget (gzip sizes, as users download them).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = 'dist';
const kb = (n) => (n / 1024).toFixed(1);
const gz = (file) => gzipSync(readFileSync(file)).length;

const BUDGET = {
  entryJs: 30 * 1024, // the code needed before anything can be shown
  anyJsChunk: 100 * 1024, // the largest lazy chunk (the code editor)
  totalJs: 300 * 1024, // all JavaScript, including the Python worker glue
  css: 14 * 1024,
};

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entry = /<script type="module"[^>]*src="[^"]*\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
const assets = readdirSync(join(dist, 'assets'));
const js = assets.filter((f) => f.endsWith('.js')).map((f) => ({ f, size: gz(join(dist, 'assets', f)) }));
const css = assets.filter((f) => f.endsWith('.css')).reduce((n, f) => n + gz(join(dist, 'assets', f)), 0);
const total = js.reduce((n, x) => n + x.size, 0);
const entrySize = js.find((x) => `assets/${x.f}` === entry)?.size ?? 0;
const biggest = js.reduce((a, b) => (b.size > a.size ? b : a));

const rows = [
  ['entry JS (loaded first)', entrySize, BUDGET.entryJs],
  [`largest JS chunk (${biggest.f})`, biggest.size, BUDGET.anyJsChunk],
  ['all JS', total, BUDGET.totalJs],
  ['CSS', css, BUDGET.css],
];
let failed = false;
for (const [name, size, limit] of rows) {
  const ok = size <= limit;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'OVER'} ${name}: ${kb(size)} kB gzip (budget ${kb(limit)} kB)`);
}
if (failed) {
  console.error('Bundle budget exceeded.');
  process.exit(1);
}
