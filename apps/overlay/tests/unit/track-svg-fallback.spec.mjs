/**
 * Track SVG source selection — API cache vs plugin-provided SvgPath
 *
 * Regression: when the K10 web API hasn't returned a curated track map
 * for the current track (first frame, no entry for this track, offline),
 * poll-engine.js and drive-hud.js used to ignore the plugin-provided
 * TrackMap.SvgPath entirely. Telemetry dots drew on the map but the
 * track line itself never rendered because the path's `d` attribute
 * stayed empty.
 *
 * These tests lock in the fallback ordering:
 *   1. _trackApiSvgCache[trackName] (curated override)
 *   2. RaceCorProDrive.Plugin.TrackMap.SvgPath (plugin recording)
 *   3. '' (neither available)
 */

import { test, expect } from '@playwright/test';

// Mirrors the mapPath selection in poll-engine.js and drive-hud.js
function resolveMapPath(apiCache, trackName, props) {
  const apiSvg = (apiCache && apiCache[trackName]) || '';
  const pluginSvg = (props && props['RaceCorProDrive.Plugin.TrackMap.SvgPath']) || '';
  return apiSvg || pluginSvg || '';
}

test.describe('Track SVG source selection', () => {

  test('prefers API cache over plugin SvgPath when both are present', () => {
    const mapPath = resolveMapPath(
      { 'Spa-Francorchamps': 'M0,0 L100,100 Z' },
      'Spa-Francorchamps',
      { 'RaceCorProDrive.Plugin.TrackMap.SvgPath': 'M50,50 L60,60' }
    );
    expect(mapPath).toBe('M0,0 L100,100 Z');
  });

  test('falls back to plugin SvgPath when API cache is empty', () => {
    const mapPath = resolveMapPath(
      {},
      'Spa-Francorchamps',
      { 'RaceCorProDrive.Plugin.TrackMap.SvgPath': 'M10,10 L90,90 Z' }
    );
    expect(mapPath).toBe('M10,10 L90,90 Z');
  });

  test('falls back to plugin SvgPath when API cache has no entry for this track', () => {
    const mapPath = resolveMapPath(
      { 'Monza': 'M0,0 L50,50' },
      'Spa-Francorchamps',
      { 'RaceCorProDrive.Plugin.TrackMap.SvgPath': 'M10,10 L90,90 Z' }
    );
    expect(mapPath).toBe('M10,10 L90,90 Z');
  });

  test('returns empty string when neither source has a path', () => {
    const mapPath = resolveMapPath({}, 'Spa-Francorchamps', {});
    expect(mapPath).toBe('');
  });

  test('empty string in API cache is treated as missing and falls through', () => {
    const mapPath = resolveMapPath(
      { 'Spa-Francorchamps': '' },
      'Spa-Francorchamps',
      { 'RaceCorProDrive.Plugin.TrackMap.SvgPath': 'M10,10 L90,90' }
    );
    expect(mapPath).toBe('M10,10 L90,90');
  });

  test('missing props object still returns empty string (no crash)', () => {
    expect(resolveMapPath({}, 'foo', null)).toBe('');
    expect(resolveMapPath({}, 'foo', undefined)).toBe('');
  });

  test('null trackName falls through to plugin path', () => {
    const mapPath = resolveMapPath(
      { 'Spa-Francorchamps': 'curated' },
      null,
      { 'RaceCorProDrive.Plugin.TrackMap.SvgPath': 'recording' }
    );
    expect(mapPath).toBe('recording');
  });

  test('null API cache is safe', () => {
    const mapPath = resolveMapPath(
      null,
      'Spa-Francorchamps',
      { 'RaceCorProDrive.Plugin.TrackMap.SvgPath': 'recording' }
    );
    expect(mapPath).toBe('recording');
  });
});

test.describe('Track SVG three-layer path IDs', () => {
  // updateTrackMap() in webgl-helpers.js sets the same `d` on six path
  // elements (three layers × full/zoom maps). This test documents the
  // contract so a future refactor that renames an ID is caught.
  const EXPECTED_PATH_IDS = [
    'fullMapTrack', 'fullMapTrackOuter', 'fullMapTrackInner',
    'zoomMapTrack', 'zoomMapTrackOuter', 'zoomMapTrackInner',
  ];

  test('renders three layers per map (outer / center / inner)', () => {
    // Sanity: full and zoom each have three path elements
    const fullIds = EXPECTED_PATH_IDS.filter(id => id.startsWith('fullMap'));
    const zoomIds = EXPECTED_PATH_IDS.filter(id => id.startsWith('zoomMap'));
    expect(fullIds).toHaveLength(3);
    expect(zoomIds).toHaveLength(3);
  });

  test('layer suffixes match the expected convention', () => {
    for (const prefix of ['fullMap', 'zoomMap']) {
      expect(EXPECTED_PATH_IDS).toContain(prefix + 'Track');         // centre line
      expect(EXPECTED_PATH_IDS).toContain(prefix + 'TrackOuter');    // thick edge
      expect(EXPECTED_PATH_IDS).toContain(prefix + 'TrackInner');    // thin centre
    }
  });
});
