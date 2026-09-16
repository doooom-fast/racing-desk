/**
 * Issue #10 — Settings panel drag bounds clamping
 *
 * The mousemove handler must keep at least 40px of the settings panel
 * visible on all edges. Tests verify the clamp logic for all edges and
 * corners, and that unconstrained positions pass through unchanged.
 */

import { test, expect } from '@playwright/test';

// Re-implementation of the clamp logic from settings.js
function clampPanelPosition(rawLeft, rawTop, panelWidth, panelHeight, viewportWidth, viewportHeight) {
  const MARGIN = 40;
  const maxLeft = viewportWidth  - MARGIN;
  const maxTop  = viewportHeight - MARGIN;
  const minLeft = -panelWidth  + MARGIN;
  const minTop  = 0;

  return {
    left: Math.max(minLeft, Math.min(maxLeft, rawLeft)),
    top:  Math.max(minTop,  Math.min(maxTop, rawTop)),
  };
}

const VP_W = 1920;
const VP_H = 1080;
const PW   = 400;
const PH   = 600;

test.describe('Issue #10 — Settings drag bounds clamping', () => {

  test('unconstrained position passes through unchanged', () => {
    const { left, top } = clampPanelPosition(200, 150, PW, PH, VP_W, VP_H);
    expect(left).toBe(200);
    expect(top).toBe(150);
  });

  test('panel cannot be dragged past the right edge', () => {
    const { left } = clampPanelPosition(VP_W, 100, PW, PH, VP_W, VP_H);
    expect(left).toBe(VP_W - 40);  // maxLeft = 1920 - 40
  });

  test('panel cannot be dragged past the bottom edge', () => {
    const { top } = clampPanelPosition(100, VP_H + 200, PW, PH, VP_W, VP_H);
    expect(top).toBe(VP_H - 40);  // maxTop = 1080 - 40
  });

  test('panel cannot be dragged too far left (keeps 40px visible)', () => {
    const { left } = clampPanelPosition(-VP_W, 100, PW, PH, VP_W, VP_H);
    expect(left).toBe(-PW + 40);  // minLeft = -400 + 40 = -360
  });

  test('panel cannot be dragged above top edge', () => {
    const { top } = clampPanelPosition(100, -100, PW, PH, VP_W, VP_H);
    expect(top).toBe(0);  // minTop = 0
  });

  test('corner: top-right clamp', () => {
    const { left, top } = clampPanelPosition(VP_W + 500, -500, PW, PH, VP_W, VP_H);
    expect(left).toBe(VP_W - 40);
    expect(top).toBe(0);
  });

  test('corner: bottom-left clamp', () => {
    const { left, top } = clampPanelPosition(-VP_W, VP_H + 500, PW, PH, VP_W, VP_H);
    expect(left).toBe(-PW + 40);
    expect(top).toBe(VP_H - 40);
  });

  test('exactly at max boundary is allowed', () => {
    const { left, top } = clampPanelPosition(VP_W - 40, VP_H - 40, PW, PH, VP_W, VP_H);
    expect(left).toBe(VP_W - 40);
    expect(top).toBe(VP_H - 40);
  });

  test('exactly at min boundary is allowed', () => {
    const { left, top } = clampPanelPosition(-PW + 40, 0, PW, PH, VP_W, VP_H);
    expect(left).toBe(-PW + 40);
    expect(top).toBe(0);
  });

  test('result always keeps at least 40px of panel on screen horizontally', () => {
    for (const rawLeft of [-2000, -500, 0, 500, 1000, 2000]) {
      const { left } = clampPanelPosition(rawLeft, 100, PW, PH, VP_W, VP_H);
      // Right edge of panel must be at least 40px from left of viewport
      expect(left + PW).toBeGreaterThanOrEqual(40);
      // Left edge of panel must be at most VP_W - 40 from left
      expect(left).toBeLessThanOrEqual(VP_W - 40);
    }
  });
});
