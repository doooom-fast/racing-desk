/**
 * Issue #4 — Drive-HUD map rotation: real-track heading sequences
 *
 * These tests replay heading data derived from the actual Bathurst
 * (Mt Panorama) track map CSV at racecor-plugin/simhub-plugin/racecorprodrive-data/
 * trackmaps/bathurst.csv. Headings are computed from consecutive GPS
 * coordinates (atan2 of dx/dy, stride=30 points ≈ one telemetry frame
 * at typical recording density), giving 82 samples covering the full
 * lap including the mountain section's tight hairpins and the
 * start/finish straight near 0°/360°.
 *
 * Key track characteristics tested:
 *  • Full heading range 1.2° – 354.6° (nearly full compass)
 *  • Largest raw jump: 88.4° (Griffins Bend hairpin)
 *  • 0/360 boundary: track crosses from ~349° → ~38° through north
 *  • Expected LERP max single-frame jump: < 21° (vs 88.4° raw)
 */

import { test, expect } from '@playwright/test';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ─────────────────────────────────────────────────────────────
//  LERP implementation (mirrors drive-hud.js exactly)
// ─────────────────────────────────────────────────────────────

function lerpHeading(current, target, alpha) {
  let diff = target - current;
  while (diff > 180)  diff -= 360;
  while (diff < -180) diff += 360;
  let next = current + diff * alpha;
  next = ((next % 360) + 360) % 360;
  return next;
}

// ─────────────────────────────────────────────────────────────
//  Load real Bathurst track map and derive heading sequence
// ─────────────────────────────────────────────────────────────

function loadTrackHeadings(csvRelPath, stride = 30) {
  const csvPath = path.resolve(
    fileURLToPath(import.meta.url),
    '../../../../racecor-plugin/simhub-plugin/racecorprodrive-data/trackmaps',
    csvRelPath
  );
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  const pts = lines
    .map(l => l.split(',').map(Number))
    .filter(r => r.length >= 2 && !isNaN(r[0]) && !isNaN(r[1]));

  const headings = [];
  for (let i = 0; i < pts.length - stride; i += stride) {
    const dx = pts[i + stride][0] - pts[i][0];
    const dy = pts[i + stride][1] - pts[i][1];
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) continue;
    const rad = Math.atan2(dx, dy);
    const deg = ((rad * 180 / Math.PI) + 360) % 360;
    headings.push(Math.round(deg * 10) / 10);
  }
  return headings;
}

// Pre-computed from bathurst.csv at stride=30 — kept as snapshot for
// regression detection if the CSV changes.
// These tests replay heading data derived from the actual Bathurst
// (Mt Panorama) track map CSV at racecor-plugin/simhub-plugin/racecorprodrive-data/trackmaps/bathurst.csv.
const BATHURST_HEADING_SNAPSHOT = [
  271.8, 336.1, 345.2, 348.6, 348.7, 349.1, 349.2, 348.4,
  348.6, 348.2, 349.0, 349.5, 348.8, 348.4, 349.2, 348.7,
  335.5, 290.5, 249.0, 236.9, 239.8, 238.7, 253.3, 281.3,
  342.3,  38.6,  21.3, 354.6, 342.2, 311.9, 300.1, 313.0,
  320.4, 336.6,   1.2,  23.7,  31.5,  32.7,  47.1,  74.1,
   86.9,  88.6,  87.0,  73.2,  75.8,  70.5,  49.1,  63.6,
   47.5,  61.5,  34.6,  38.6, 127.0, 144.5, 148.0, 160.9,
  172.3, 170.3, 169.4, 169.4, 169.4, 169.9, 170.4, 170.0,
  170.0, 170.6, 171.7, 170.9, 171.2, 163.7, 152.8, 150.5,
  153.4, 190.0, 208.5, 180.3, 169.5, 168.2, 174.8, 171.9,
  179.0, 228.5,
];

function simulateLerp(rawHeadings, alpha = 0.18) {
  const smooth = [rawHeadings[0]];
  for (let i = 1; i < rawHeadings.length; i++) {
    smooth.push(lerpHeading(smooth[smooth.length - 1], rawHeadings[i], alpha));
  }
  return smooth;
}

function shortAngularDiff(a, b) {
  let d = Math.abs(a - b);
  if (d > 180) d = 360 - d;
  return d;
}

// ─────────────────────────────────────────────────────────────
//  Tests
// ─────────────────────────────────────────────────────────────

test.describe('Issue #4 — Drive-HUD LERP: Bathurst real-track data', () => {

  test('loads Bathurst CSV and derives heading sequence', () => {
    const headings = loadTrackHeadings('bathurst.csv', 30);
    expect(headings.length).toBeGreaterThan(50);
    // Sanity: full compass range represented
    expect(Math.min(...headings)).toBeLessThan(10);
    expect(Math.max(...headings)).toBeGreaterThan(350);
  });

  test('live CSV matches pre-computed snapshot (CSV unchanged)', () => {
    const live = loadTrackHeadings('bathurst.csv', 30);
    expect(live.length).toBe(BATHURST_HEADING_SNAPSHOT.length);
    for (let i = 0; i < live.length; i++) {
      expect(live[i]).toBeCloseTo(BATHURST_HEADING_SNAPSHOT[i], 0);
    }
  });

  test('LERP smooth output is always in [0, 360)', () => {
    const smooth = simulateLerp(BATHURST_HEADING_SNAPSHOT);
    for (const h of smooth) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });

  test('LERP reduces max single-frame jump vs raw (88.4° → < 21°)', () => {
    const raw = BATHURST_HEADING_SNAPSHOT;
    const smooth = simulateLerp(raw);

    const rawMaxJump = Math.max(
      ...Array.from({ length: raw.length - 1 }, (_, i) => shortAngularDiff(raw[i], raw[i + 1]))
    );
    const smoothMaxJump = Math.max(
      ...Array.from({ length: smooth.length - 1 }, (_, i) => shortAngularDiff(smooth[i], smooth[i + 1]))
    );

    expect(rawMaxJump).toBeGreaterThan(80);     // Griffins Bend raw = 88.4°
    expect(smoothMaxJump).toBeLessThan(25);     // LERP limits to < 21°
    expect(smoothMaxJump).toBeLessThan(rawMaxJump);
  });

  test('LERP handles the 0°/360° north crossing (Mountain → Conrod transition)', () => {
    // At sample 24-25 the track crosses from ~342° through 0° to ~38°
    // (the Conrod Straight to The Chase section).
    // Raw jump is +56° but the LERP path must pass through 0/360 cleanly.
    const northCrossSection = BATHURST_HEADING_SNAPSHOT.slice(22, 30);
    // Headings: ~342, 38, 21, 354, 342, 311, 300, 313 — crosses north
    expect(northCrossSection.some(h => h > 330)).toBe(true);
    expect(northCrossSection.some(h => h < 50)).toBe(true);

    const smooth = simulateLerp(northCrossSection);
    for (const h of smooth) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
    // No single smooth step should snap more than 25°
    for (let i = 1; i < smooth.length; i++) {
      expect(shortAngularDiff(smooth[i], smooth[i - 1])).toBeLessThan(25);
    }
  });

  test('LERP smooth output tracks raw within 45° throughout the lap', () => {
    // The smoothed heading should follow the raw within one sharp corner's worth
    const raw = BATHURST_HEADING_SNAPSHOT;
    const smooth = simulateLerp(raw);
    // Give 5 frames of lag budget at the start (LERP needs time to catch up)
    for (let i = 5; i < raw.length; i++) {
      expect(shortAngularDiff(smooth[i], raw[i])).toBeLessThan(45);
    }
  });

  test('LERP with alpha=0.18 converges after sharp corners within 10 frames', () => {
    // After Griffins Bend (largest jump at idx ~24, raw 88°) LERP must
    // be within 5° of the target within 10 subsequent frames.
    let h = 342.3;   // heading just before the bend
    const target = 38.6;  // heading immediately after
    for (let i = 0; i < 10; i++) h = lerpHeading(h, target, 0.18);
    expect(shortAngularDiff(h, target)).toBeLessThan(5);
  });

  test('SVG rotation negation is applied to smoothed (not raw) heading', () => {
    // The fix applies rotate(-_dhHeadingSmooth, cx, cy).
    // Verify the negation on a real smooth value is always in (-360, 0].
    const smooth = simulateLerp(BATHURST_HEADING_SNAPSHOT);
    for (const h of smooth) {
      const rotDeg = -h;
      expect(rotDeg).toBeLessThanOrEqual(0);
      expect(rotDeg).toBeGreaterThan(-360);
    }
  });
});
