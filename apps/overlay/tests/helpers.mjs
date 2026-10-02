/**
 * Test helpers for The Racing Desk dashboard tests.
 *
 * Provides mock telemetry data and a page-setup utility that loads
 * dashboard.html with fetch() intercepted so no real HTTP server is needed.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');

export const DASHBOARD_PATHS = {
  original: `file://${path.resolve(APP_DIR, 'dashboard.html')}`,
  build: `file://${path.resolve(APP_DIR, 'dashboard-build.html')}`,
  react: `file://${path.resolve(APP_DIR, 'dashboard-react.html')}`,
};

/** @deprecated Use DASHBOARD_PATHS.original */
export const DASHBOARD_PATH = DASHBOARD_PATHS.original;

/** Realistic mid-race telemetry snapshot */
export const MOCK_TELEMETRY = {
  'DataCorePlugin.GameRunning': 1,
  'RacingDesk.Plugin.DemoMode': 0,
  'DataCorePlugin.GameData.Gear': '4',
  'DataCorePlugin.GameData.Rpms': 6842,
  'DataCorePlugin.GameData.CarSettings_MaxRPM': 8500,
  'DataCorePlugin.GameData.SpeedMph': 127,
  'DataCorePlugin.GameData.Throttle': 0.82,
  'DataCorePlugin.GameData.Brake': 0.0,
  'DataCorePlugin.GameData.Clutch': 0.0,
  'DataCorePlugin.GameData.Fuel': 28.4,
  'DataCorePlugin.GameData.MaxFuel': 60.0,
  'DataCorePlugin.Computed.Fuel_LitersPerLap': 3.12,
  'DataCorePlugin.GameData.RemainingLaps': 14,
  'DataCorePlugin.GameData.TyreTempFrontLeft': 196,
  'DataCorePlugin.GameData.TyreTempFrontRight': 203,
  'DataCorePlugin.GameData.TyreTempRearLeft': 188,
  'DataCorePlugin.GameData.TyreTempRearRight': 191,
  // Tread remaining, 0..100 %, 100 = new, as the host and the plugin send it (root CLAUDE.md, Tyre wear)
  'DataCorePlugin.GameData.TyreWearFrontLeft': 91,
  'DataCorePlugin.GameData.TyreWearFrontRight': 88,
  'DataCorePlugin.GameData.TyreWearRearLeft': 94,
  'DataCorePlugin.GameData.TyreWearRearRight': 93,
  'DataCorePlugin.GameRawData.Telemetry.dcBrakeBias': 56.2,
  'DataCorePlugin.GameRawData.Telemetry.dcTractionControl': 4,
  'DataCorePlugin.GameRawData.Telemetry.dcABS': 3,
  'DataCorePlugin.GameData.Position': 5,
  'DataCorePlugin.GameData.CurrentLap': 8,
  'DataCorePlugin.GameData.BestLapTime': 92.347,
  'DataCorePlugin.GameData.CarModel': 'Porsche 911 GT3 R',
  'IRacingExtraProperties.iRacing_DriverInfo_IRating': 2847,
  'IRacingExtraProperties.iRacing_DriverInfo_SafetyRating': 3.41,
  'IRacingExtraProperties.iRacing_Opponent_Ahead_Gap': 1.3,
  'IRacingExtraProperties.iRacing_Opponent_Behind_Gap': 2.1,
  // Other drivers are characters (packages/pseudonyms), on the wire and in every fixture.
  'IRacingExtraProperties.iRacing_Opponent_Ahead_Name': 'J. van Dyne',
  'IRacingExtraProperties.iRacing_Opponent_Behind_Name': 'T. Iommi',
  'IRacingExtraProperties.iRacing_Opponent_Ahead_IRating': 3210,
  'IRacingExtraProperties.iRacing_Opponent_Behind_IRating': 2530,
  'RacingDesk.Plugin.CommentaryVisible': 0,
  'RacingDesk.Plugin.CommentaryText': '',
  'RacingDesk.Plugin.CommentaryTopicTitle': '',
  'RacingDesk.Plugin.CommentaryTopicId': '',
  'RacingDesk.Plugin.CommentaryCategory': '',
  'RacingDesk.Plugin.CommentarySentimentColor': '',
  'RacingDesk.Plugin.CommentarySeverity': 0,
  'RacingDesk.Plugin.TrackMap.Ready': 0,
  'RacingDesk.Plugin.Grid.SessionState': 4,
  'RacingDesk.Plugin.GameId': 'iracing',
  'RacingDesk.Plugin.SessionTypeName': 'Race',
  'RacingDesk.Plugin.DS.FuelPct': 47.3,
  'RacingDesk.Plugin.DS.FuelLapsRemaining': 9.1,
};

/** Demo mode telemetry — uses Demo.* keys instead */
export const MOCK_DEMO = {
  ...MOCK_TELEMETRY,
  'RacingDesk.Plugin.DemoMode': 1,
  'RacingDesk.Plugin.Demo.Gear': '3',
  'RacingDesk.Plugin.Demo.Rpm': 5400,
  'RacingDesk.Plugin.Demo.MaxRpm': 7500,
  'RacingDesk.Plugin.Demo.SpeedMph': 98,
  'RacingDesk.Plugin.Demo.Throttle': 0.65,
  'RacingDesk.Plugin.Demo.Brake': 0.12,
  'RacingDesk.Plugin.Demo.Clutch': 0.0,
  'RacingDesk.Plugin.Demo.Fuel': 18.0,
  'RacingDesk.Plugin.Demo.MaxFuel': 60.0,
  'RacingDesk.Plugin.Demo.FuelPerLap': 3.5,
  'RacingDesk.Plugin.Demo.RemainingLaps': 10,
  'RacingDesk.Plugin.Demo.TyreTempFL': 210,
  'RacingDesk.Plugin.Demo.TyreTempFR': 215,
  'RacingDesk.Plugin.Demo.TyreTempRL': 195,
  'RacingDesk.Plugin.Demo.TyreTempRR': 198,
  // The demo's tread is the same percent remaining the live keys are
  'RacingDesk.Plugin.Demo.TyreWearFL': 80,
  'RacingDesk.Plugin.Demo.TyreWearFR': 75,
  'RacingDesk.Plugin.Demo.TyreWearRL': 85,
  'RacingDesk.Plugin.Demo.TyreWearRR': 83,
  'RacingDesk.Plugin.Demo.BrakeBias': 54.0,
  'RacingDesk.Plugin.Demo.TC': 6,
  'RacingDesk.Plugin.Demo.ABS': 2,
  'RacingDesk.Plugin.Demo.Position': 3,
  'RacingDesk.Plugin.Demo.CurrentLap': 12,
  'RacingDesk.Plugin.Demo.BestLapTime': 88.921,
  'RacingDesk.Plugin.Demo.CarModel': 'BMW M4 GT3',
  'RacingDesk.Plugin.Demo.IRating': 3150,
  'RacingDesk.Plugin.Demo.SafetyRating': 3.88,
  'RacingDesk.Plugin.Demo.GapAhead': 0.8,
  'RacingDesk.Plugin.Demo.GapBehind': 3.5,
  'RacingDesk.Plugin.Demo.DriverAhead': 'J. van Dyne',
  'RacingDesk.Plugin.Demo.DriverBehind': 'D. Gately',
  'RacingDesk.Plugin.Demo.IRAhead': 3500,
  'RacingDesk.Plugin.Demo.IRBehind': 2100,
  'RacingDesk.Plugin.Demo.Grid.SessionState': 4,
};

/**
 * Load the dashboard in a Playwright page with mock fetch.
 * The mock data is served for every fetch() call so the polling loop
 * populates the dashboard without a real HTTP server.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [data] - Override mock telemetry data (merged with MOCK_TELEMETRY)
 * @param {object} [opts] - Options
 * @param {string} [opts.dashboardPath] - Override the dashboard path (default: DASHBOARD_PATH)
 * @returns {Promise<void>}
 */
export async function loadDashboard(page, data, opts = {}) {
  const mockData = data ? { ...MOCK_TELEMETRY, ...data } : MOCK_TELEMETRY;
  const dashPath = opts.dashboardPath || DASHBOARD_PATH;

  // Intercept all fetch requests to the plugin server and serve mock data
  await page.route(/doooom/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockData),
    });
  });

  await page.goto(dashPath, { waitUntil: 'load' });

  // Wait for at least 2 poll cycles to populate data
  await page.waitForTimeout(200);
}

/**
 * Update mock data mid-test by re-routing fetch.
 */
export async function updateMockData(page, data) {
  await page.unroute(/doooom/);
  await page.route(/doooom/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...MOCK_TELEMETRY, ...data }),
    });
  });
  // Wait for a poll cycle
  await page.waitForTimeout(100);
}
