import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// In the cloud sandbox a Chromium is pre-installed at a fixed path; elsewhere Playwright finds its own.
const sandboxChromium = '/opt/pw-browsers/chromium';
const executablePath = process.env.PW_CHROMIUM ?? (existsSync(sandboxChromium) ? sandboxChromium : undefined);
const external = process.env.E2E_URL; // e.g. the live GitHub Pages URL

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 45_000 },
  retries: 0,
  workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : 2,
  reporter: [['list']],
  use: {
    baseURL: external ?? 'http://localhost:4173/',
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath, args: ['--no-sandbox'] } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions: { executablePath, args: ['--no-sandbox'] } } },
  ],
  // Served by `vite preview` WITHOUT isolation headers, exactly like GitHub Pages,
  // so the tests exercise the service-worker path.
  webServer: external
    ? undefined
    : { command: 'npm run build && npm run preview -- --port 4173 --strictPort', url: 'http://localhost:4173/', reuseExistingServer: true, timeout: 120_000 },
});
