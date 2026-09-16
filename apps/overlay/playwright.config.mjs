import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 15000,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1280, height: 600 },
    launchOptions: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  },
  projects: [
    // Primary dashboard (dashboard-build.html — vanilla TypeScript build)
    {
      name: 'dashboard',
      testDir: './tests/build',
      testMatch: /dashboard\.spec\.mjs$/,
    },
    // Vanilla build parity tests (dashboard-build.html vs gold standard)
    {
      name: 'vanilla-parity',
      testDir: './tests/build',
      testMatch: /vanilla-parity\.mjs$/,
    },
    // Non-dashboard tests (Discord OAuth, etc.)
    {
      name: 'unit',
      testDir: './tests/unit',
    },
    // Layout v2 engine — data-driven group placement (layout-v2.js)
    {
      name: 'layout-v2',
      testDir: './tests',
      testMatch: /layout-v2\.spec\.mjs$/,
    },
    // Visual-regression tests — screenshot diffs against committed baselines
    {
      name: 'visual',
      testDir: './tests/visual',
    },
    // Golden frames — real dashboard.html fed by the replay harness at pinned frames
    {
      name: 'golden',
      testDir: './tests/golden',
      timeout: 60000,
      use: { viewport: { width: 1920, height: 1080 } },
    },
    // Legacy: original dashboard.html (opt-in, not run by default)
    {
      name: 'original',
      testDir: './tests/original',
      testMatch: /dashboard\.spec\.mjs$/,
    },
  ],
});
