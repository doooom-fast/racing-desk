/**
 * One layout, modules on or off.
 *
 * The HUD has a single arrangement, placed by the position setting, with each module toggled by its show*
 * setting. The group-layout engine the WinUI host's editor drove (layout v2) was removed; settings files it
 * wrote still carry its `layout` block, and that block must change nothing.
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { MOCK_TELEMETRY } from '../helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = pathToFileURL(path.resolve(__dirname, '..', '..', 'dashboard.html')).href;

// What a settings file left behind by the group editor looks like: its block, plus the ordinary settings.
const SETTINGS = {
  layoutPosition: 'bottom-right',
  zoom: 100,
  showLeaderboard: false,
  showSpotter: false,
  showDatastream: true,
  layout: {
    version: 2,
    groups: [
      { id: 'g1', anchor: 'top-left', x: 0.1, y: 0.1, locked: false, members: [{ module: 'tacho' }, { module: 'pedals' }] },
      { id: 'g2', anchor: 'bottom-center', x: 0.5, y: 0.9, locked: true, members: [{ module: 'spotter' }] },
    ],
  },
};

async function openWith(page, settings) {
  await page.addInitScript((s) => {
    const known = { getSettings: async () => s };
    window.k10 = new Proxy(known, { get: (t, k) => (k in t ? t[k] : () => Promise.resolve(null)) });
  }, settings);
  await page.route(/^https?:\/\//, (route) => {
    if (/:8889\//.test(route.request().url())) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TELEMETRY) });
    }
    return route.abort();
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(DASHBOARD, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
}

test.describe('single layout with on/off modules', () => {
  test('a leftover group-layout block in settings changes nothing', async ({ page }) => {
    await openWith(page, SETTINGS);
    await expect(page.locator('.layout-group')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/layout-v2-active/);
    await expect(page.locator('.dashboard .main-row')).toBeVisible();
  });

  test('show* settings turn modules off, and only those', async ({ page }) => {
    await openWith(page, SETTINGS);
    await expect(page.locator('#leaderboardPanel')).toHaveClass(/section-hidden/);
    await expect(page.locator('#spotterPanel')).toHaveClass(/section-hidden/);
    await expect(page.locator('.tacho-block').first()).not.toHaveClass(/section-hidden/);
    await expect(page.locator('.pedals-area').first()).not.toHaveClass(/section-hidden/);
  });

  test('the car logo loads from the bundled files, even from file://', async ({ page }) => {
    await openWith(page, SETTINGS);
    // The mock car is a Porsche; the logo slot holds its mark, never the text "undefined".
    await expect(page.locator('#carLogoIcon img')).toHaveCount(1);
    await expect(page.locator('#carLogoIcon img')).toHaveAttribute('src', /images\/logos\/[a-z_]+\.svg$/);
    await expect(page.locator('#carLogoIcon')).not.toContainText('undefined');
    const loaded = await page.locator('#carLogoIcon img').evaluate((img) => img.complete && img.naturalWidth > 0);
    expect(loaded).toBe(true);
  });
});
