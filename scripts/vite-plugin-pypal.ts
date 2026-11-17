import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** The public URL of the site, for absolute links in social previews. Empty for local builds. */
function siteUrl(): string {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/?$/, '/');
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return '';
  const [owner, name] = repo.split('/');
  return `https://${owner.toLowerCase()}.github.io/${name}/`;
}

/**
 * Build-time extras: fills in the absolute social-preview URLs, writes dist/404.html, and generates
 * dist/sw.js with the list of files to precache and a version derived from their contents.
 */
export function pypalBuild(): Plugin {
  let outDir = 'dist';
  let base = '/';
  return {
    name: 'pypal-build',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
      base = c.base;
    },
    transformIndexHtml: {
      order: 'post', // after Vite has handled the asset links, so these are left alone
      handler: (html) => {
        const site = siteUrl();
        return {
          html: html.replaceAll('__SITE_URL__', site || base),
          tags: site ? [{ tag: 'link', attrs: { rel: 'canonical', href: site }, injectTo: 'head' as const }] : [],
        };
      },
    },
    closeBundle() {
      const files = walk(outDir).map((f) => relative(outDir, f).split(sep).join('/'));
      const shell = files.filter((f) => f !== 'sw.js' && f !== '404.html' && !f.startsWith('pyodide/'));
      const hash = createHash('sha1');
      for (const f of [...shell].sort()) hash.update(f).update(readFileSync(join(outDir, f)));
      const pyManifest = existsSync(join(outDir, 'pyodide/manifest.json')) ? JSON.parse(readFileSync(join(outDir, 'pyodide/manifest.json'), 'utf8')) : { version: 'none' };
      hash.update(String(pyManifest.version));

      const sw = readFileSync('sw-src/sw.template.js', 'utf8')
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__PYODIDE_VERSION__', String(pyManifest.version))
        .replace('__PRECACHE__', JSON.stringify(shell));
      writeFileSync(join(outDir, 'sw.js'), sw);
      writeFileSync(join(outDir, '404.html'), readFileSync('sw-src/404.template.html', 'utf8').replaceAll('__BASE__', base));
    },
  };
}
