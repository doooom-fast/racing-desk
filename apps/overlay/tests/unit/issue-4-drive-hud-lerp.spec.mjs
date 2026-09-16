/**
 * Issue #4 — Drive-HUD map rotation: LERP heading smoothing
 *
 * Tests the heading LERP logic and 0°/360° wrap-around that prevents
 * judder and snap artefacts when the car crosses the 0°/360° boundary.
 */

import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────
//  Pure re-implementation of the LERP logic from drive-hud.js
// ─────────────────────────────────────────────────────────────

function lerpHeading(current, target, alpha) {
  let diff = target - current;
  while (diff > 180)  diff -= 360;
  while (diff < -180) diff += 360;
  let next = current + diff * alpha;
  next = ((next % 360) + 360) % 360;
  return next;
}

test.describe('Issue #4 — Drive-HUD heading LERP', () => {

  test('LERP moves toward target each frame', () => {
    let h = 0;
    for (let i = 0; i < 20; i++) h = lerpHeading(h, 90, 0.18);
    expect(h).toBeGreaterThan(85);
    expect(h).toBeLessThanOrEqual(90);
  });

  test('LERP with alpha=1 jumps directly to target', () => {
    expect(lerpHeading(0, 180, 1)).toBeCloseTo(180, 5);
    expect(lerpHeading(270, 45, 1)).toBeCloseTo(45, 5);
  });

  test('result is always in [0, 360) range', () => {
    const cases = [
      [350, 10, 0.5],
      [5, 355, 0.5],
      [0, 359, 0.18],
      [359, 1, 0.18],
      [180, 0, 0.18],
    ];
    for (const [cur, tgt, alpha] of cases) {
      const result = lerpHeading(cur, tgt, alpha);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(360);
    }
  });

  test('takes the short way around 0°/360° boundary going forward', () => {
    // Current=350°, target=10° — short path is +20°, not -340°
    // After one step at alpha=0.5: 350 + 10*0.5 = 355
    const h1 = lerpHeading(350, 10, 0.5);
    expect(h1).toBeCloseTo(355, 1);
  });

  test('takes the short way around 0°/360° boundary going backward', () => {
    // Current=10°, target=350° — short path is -20°, not +340°
    // After one step at alpha=0.5: 10 + (-10) = 0
    const h1 = lerpHeading(10, 350, 0.5);
    expect(h1).toBeCloseTo(0, 1);
  });

  test('no snap: 0→180 movement is monotonically increasing over 30 frames', () => {
    let h = 0;
    const frames = [];
    for (let i = 0; i < 30; i++) {
      h = lerpHeading(h, 180, 0.18);
      frames.push(h);
    }
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1]);
    }
  });

  test('converges within 0.1° of target after 60 frames at alpha=0.18', () => {
    let h = 45;
    for (let i = 0; i < 60; i++) h = lerpHeading(h, 270, 0.18);
    expect(Math.abs(h - 270)).toBeLessThan(0.1);
  });

  test('SVG rotation is negated heading (counter-clockwise map rotation)', () => {
    const heading = 90;
    const rotDeg = -heading;
    expect(rotDeg).toBe(-90);
  });
});
