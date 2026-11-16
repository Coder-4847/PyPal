// Copies the pinned Pyodide core files out of node_modules into public/pyodide
// so they are served from our own origin (fast, cacheable, offline-friendly),
// and writes a manifest of byte sizes used for real download progress.
import { cpSync, mkdirSync, statSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'pyodide');
const out = join(root, 'public', 'pyodide');
if (!existsSync(src)) throw new Error('pyodide is not installed: run npm ci first');

const files = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
mkdirSync(out, { recursive: true });
const sizes = {};
for (const f of files) {
  cpSync(join(src, f), join(out, f));
  sizes[f] = statSync(join(out, f)).size;
}
const { version } = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8'));
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ version, sizes }, null, 2));
console.log(`pyodide ${version}: copied ${files.length} files to public/pyodide`);
