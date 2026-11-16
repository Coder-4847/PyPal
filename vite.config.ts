import { defineConfig } from 'vitest/config';

// Assets must load at https://<user>.github.io/<repo>/ on GitHub Pages, so the
// base comes from the repository name (set automatically in Actions).
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.BASE_PATH ?? (repo ? `/${repo}/` : '/');

// Only the dev server sets isolation headers. In production the service worker
// (public/sw.js) adds them, because GitHub Pages cannot.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  base,
  server: { headers: isolation },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['tests/unit/**/*.test.ts', 'tests/**/*.test.ts'], environment: 'node' },
});
