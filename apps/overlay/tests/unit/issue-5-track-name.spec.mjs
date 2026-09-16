/**
 * Issue #5 — Track name fallback logic
 *
 * The track name should use RaceCorProDrive.Plugin.TrackMap.TrackName
 * (guaranteed to match the saved map) and fall back to
 * DataCorePlugin.GameData.TrackName when the plugin property is absent.
 */

import { test, expect } from '@playwright/test';

// Re-implementation of the track name resolution from poll-engine.js
function resolveTrackName(props) {
  return props['RaceCorProDrive.Plugin.TrackMap.TrackName']
      || props['DataCorePlugin.GameData.TrackName']
      || '';
}

test.describe('Issue #5 — Track name resolution', () => {

  test('uses plugin TrackMap.TrackName when available', () => {
    const name = resolveTrackName({
      'RaceCorProDrive.Plugin.TrackMap.TrackName': 'Spa-Francorchamps',
      'DataCorePlugin.GameData.TrackName': 'spa',
    });
    expect(name).toBe('Spa-Francorchamps');
  });

  test('falls back to GameData.TrackName when plugin property is empty string', () => {
    const name = resolveTrackName({
      'RaceCorProDrive.Plugin.TrackMap.TrackName': '',
      'DataCorePlugin.GameData.TrackName': 'spa',
    });
    expect(name).toBe('spa');
  });

  test('falls back to GameData.TrackName when plugin property is absent', () => {
    const name = resolveTrackName({
      'DataCorePlugin.GameData.TrackName': 'silverstone',
    });
    expect(name).toBe('silverstone');
  });

  test('returns empty string when both properties are missing', () => {
    expect(resolveTrackName({})).toBe('');
  });

  test('returns empty string when both properties are empty', () => {
    const name = resolveTrackName({
      'RaceCorProDrive.Plugin.TrackMap.TrackName': '',
      'DataCorePlugin.GameData.TrackName': '',
    });
    expect(name).toBe('');
  });

  test('plugin property wins over GameData even with unusual track names', () => {
    const name = resolveTrackName({
      'RaceCorProDrive.Plugin.TrackMap.TrackName': 'Road America - Full Course',
      'DataCorePlugin.GameData.TrackName': 'roadamerica',
    });
    expect(name).toBe('Road America - Full Course');
  });

  test('null plugin property falls through to GameData', () => {
    const name = resolveTrackName({
      'RaceCorProDrive.Plugin.TrackMap.TrackName': null,
      'DataCorePlugin.GameData.TrackName': 'monza',
    });
    expect(name).toBe('monza');
  });
});
