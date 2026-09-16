/**
 * Layout v2 engine tests (modules/js/layout-v2.js).
 *
 * Drives window.K10LayoutV2 directly against the real dashboard.html —
 * no Electron shell, so the registry is injected via setRegistry()
 * (in production it arrives over the get-layout-registry IPC). The
 * layout under test is the canonical fixture shared with the WinUI
 * host (tests/fixtures/layout-v2-settings.json).
 *
 * Anchor math contract (prodrive-windows/docs/overlay-layout-v2.md):
 * the group's anchor-pivot point lands on the target — locked groups
 * target the anchor's natural corner inset by --edge; free groups
 * target (x·vw, y·vh). getBoundingClientRect is visual px, so the
 * assertions hold identically at any zoom.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadDashboard, DASHBOARD_PATHS } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');

const registry = JSON.parse(
  fs.readFileSync(path.join(APP_DIR, 'layout-registry.json'), 'utf8'));
const fixture = JSON.parse(
  fs.readFileSync(path.join(APP_DIR, 'tests', 'fixtures', 'layout-v2-settings.json'), 'utf8'));

const load = (page) => loadDashboard(page, null, { dashboardPath: DASHBOARD_PATHS.original });

async function applyV2(page, { zoom = 100, layout = fixture.layout } = {}) {
  return page.evaluate(([reg, lay, z]) => {
    window.K10LayoutV2.setRegistry(reg);
    return window.K10LayoutV2.apply(lay, { zoom: z });
  }, [registry, layout, zoom]);
}

const groupRect = (page, id) => page.evaluate((gid) => {
  const r = document.querySelector(`#layoutV2Root [data-group-id="${gid}"]`).getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
}, id);

const pageEdge = (page) => page.evaluate(() =>
  parseInt(getComputedStyle(document.documentElement).getPropertyValue('--edge'), 10) || 10);

const viewport = (page) => page.evaluate(() =>
  ({ w: window.innerWidth, h: window.innerHeight }));

test.describe('Layout v2 engine', () => {
  test('apply() builds one container per group and reparents modules', async ({ page }) => {
    await load(page);
    expect(await applyV2(page)).toBe(true);

    const containerCount = await page.evaluate(() =>
      document.querySelectorAll('#layoutV2Root .layout-group').length);
    expect(containerCount).toBe(fixture.layout.groups.length);

    // Tacho left the dashboard shell for the mainHud container.
    const tachoHome = await page.evaluate(() =>
      document.querySelector('.tacho-block').closest('[data-group-id]')?.getAttribute('data-group-id'));
    expect(tachoHome).toBe('mainHud');

    // Stack slot: controls + pedals share one perpendicular flex slot.
    const slot = await page.evaluate(() => {
      const controls = document.querySelector('.car-controls');
      const slotEl = controls.parentElement;
      return {
        isSlot: slotEl.classList.contains('layout-slot'),
        direction: slotEl.style.flexDirection,
        siblings: Array.from(slotEl.children).map((c) =>
          c.classList.contains('car-controls') ? 'controls'
            : c.classList.contains('pedals-area') ? 'pedals' : 'other'),
      };
    });
    expect(slot.isSlot).toBe(true);
    expect(slot.direction).toBe('column'); // row group → column stack
    expect(slot.siblings).toEqual(['controls', 'pedals']);
  });

  test('rejects non-v2 layouts', async ({ page }) => {
    await load(page);
    const applied = await page.evaluate((reg) => {
      window.K10LayoutV2.setRegistry(reg);
      return window.K10LayoutV2.apply({ version: 1, groups: [] }, { zoom: 100 });
    }, registry);
    expect(applied).toBe(false);
    expect(await page.evaluate(() => !!document.getElementById('layoutV2Root'))).toBe(false);
  });

  test('locked groups pin to their anchor with the edge inset', async ({ page }) => {
    await load(page);
    await applyV2(page);
    const edge = await pageEdge(page);
    const vp = await viewport(page);

    // mainHud: locked top-right → pivot point at (vw − edge, edge).
    const main = await groupRect(page, 'mainHud');
    expect(Math.abs(main.right - (vp.w - edge))).toBeLessThan(1.5);
    expect(Math.abs(main.y - edge)).toBeLessThan(1.5);

    // secondary: locked bottom-right → (vw − edge, vh − edge).
    const sec = await groupRect(page, 'secondary');
    expect(Math.abs(sec.right - (vp.w - edge))).toBeLessThan(1.5);
    expect(Math.abs(sec.bottom - (vp.h - edge))).toBeLessThan(1.5);
  });

  test('free groups place their pivot at the normalized x/y', async ({ page }) => {
    await load(page);
    await applyV2(page);
    const vp = await viewport(page);

    // commentary: free, anchor bottom-left, x 0.012 / y 0.7 → the
    // container's bottom-left corner sits at (0.012·vw, 0.7·vh),
    // independent of the panel's current size.
    const cmt = await groupRect(page, 'commentary');
    expect(Math.abs(cmt.x - 0.012 * vp.w)).toBeLessThan(1.5);
    expect(Math.abs(cmt.bottom - 0.7 * vp.h)).toBeLessThan(1.5);
  });

  test('zoom scales groups but keeps anchor targets in visual px', async ({ page }) => {
    await load(page);
    await applyV2(page, { zoom: 165 });
    const edge = await pageEdge(page);
    const vp = await viewport(page);

    const zoomStyle = await page.evaluate(() =>
      document.querySelector('#layoutV2Root [data-group-id="mainHud"]').style.zoom);
    expect(parseFloat(zoomStyle)).toBeCloseTo(1.65, 5);

    // Visual geometry must still honor the same target point.
    const main = await groupRect(page, 'mainHud');
    expect(Math.abs(main.right - (vp.w - edge))).toBeLessThan(2.5);
    expect(Math.abs(main.y - edge)).toBeLessThan(2.5);
  });

  test('hidden modules are skipped by the flow (display:none)', async ({ page }) => {
    await load(page);
    await page.evaluate(() =>
      document.getElementById('spotterPanel').classList.add('section-hidden'));
    await applyV2(page);
    const spotter = await groupRect(page, 'spotter');
    expect(spotter.w).toBe(0);
    expect(spotter.h).toBe(0);
  });

  test('re-apply with only position changes does not rebuild group children', async ({ page }) => {
    await load(page);
    await applyV2(page);

    const before = await page.evaluate(() => ({
      placeholders: document.querySelectorAll('.main-area').length &&
        Array.from(document.querySelector('.main-area').childNodes)
          .filter((n) => n.nodeType === 8 && n.textContent.startsWith('lv2:')).length,
      left: document.querySelector('[data-group-id="mainHud"]').style.left,
    }));

    // Move mainHud free-hand; membership unchanged.
    const moved = JSON.parse(JSON.stringify(fixture.layout));
    const main = moved.groups.find((g) => g.id === 'mainHud');
    main.locked = false; main.x = 0.5; main.y = 0.25;
    await applyV2(page, { layout: moved });

    const after = await page.evaluate(() => ({
      placeholders: Array.from(document.querySelector('.main-area').childNodes)
        .filter((n) => n.nodeType === 8 && n.textContent.startsWith('lv2:')).length,
      left: document.querySelector('[data-group-id="mainHud"]').style.left,
    }));

    expect(after.placeholders).toBe(before.placeholders); // no re-adoption churn
    expect(after.left).not.toBe(before.left);             // …but it did move
  });

  test('restore() puts every module back at its exact original spot', async ({ page }) => {
    await load(page);
    await applyV2(page);
    await page.evaluate(() => window.K10LayoutV2.restore());

    const state = await page.evaluate(() => {
      const tacho = document.querySelector('.tacho-block');
      return {
        rootGone: !document.getElementById('layoutV2Root'),
        bodyClass: document.body.classList.contains('layout-v2-active'),
        tachoParent: tacho.parentElement.className,
        prevSibling: tacho.previousElementSibling?.className,
        nextSibling: tacho.nextElementSibling?.className,
        leftoverMarkers: Array.from(document.querySelector('.main-area').childNodes)
          .filter((n) => n.nodeType === 8 && n.textContent.startsWith('lv2:')).length,
      };
    });

    expect(state.rootGone).toBe(true);
    expect(state.bodyClass).toBe(false);
    expect(state.tachoParent).toContain('main-area');
    expect(state.prevSibling).toContain('pos-gaps-col'); // original DOM order
    expect(state.nextSibling).toContain('logo-col');
    expect(state.leftoverMarkers).toBe(0);
  });

  test('measure() reports visual-px metrics for modules and groups', async ({ page }) => {
    await load(page);
    await applyV2(page, { zoom: 165 });

    const metrics = await page.evaluate(() => window.K10LayoutV2.measure());
    const vp = await viewport(page);

    expect(metrics.version).toBe(2);
    expect(metrics.viewport).toEqual({ w: vp.w, h: vp.h });
    expect(metrics.zoom).toBeCloseTo(1.65, 5);
    expect(metrics.modules.tacho.w).toBeGreaterThan(0);
    expect(metrics.modules.tacho.h).toBeGreaterThan(0);
    expect(metrics.groups.mainHud.w).toBeGreaterThan(0);

    // Group rect is what getBoundingClientRect says — visual px.
    const main = await groupRect(page, 'mainHud');
    expect(metrics.groups.mainHud.x).toBeCloseTo(main.x, 1);
    expect(metrics.groups.mainHud.w).toBeCloseTo(main.w, 1);
  });
});
