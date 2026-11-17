import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Checks the generated files of the last `npm run build` (skipped when there is no build yet).
const sw = 'dist/sw.js';
describe.skipIf(!existsSync(sw))('build output', () => {
  it('the generated service worker is valid JavaScript with its placeholders filled', () => {
    const src = readFileSync(sw, 'utf8');
    expect(src).not.toMatch(/__(VERSION|PRECACHE|CSP|PYODIDE_VERSION)__/);
    expect(() => new Function(src)).not.toThrow(); // parse only
    expect(src).toContain("frame-ancestors 'none'");
  });
  it('index.html carries the CSP meta tag', () => {
    expect(readFileSync('dist/index.html', 'utf8')).toMatch(/http-equiv="Content-Security-Policy"/);
  });
});
