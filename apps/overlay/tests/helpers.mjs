/**
 * Test helpers for K10 Motorsports dashboard tests.
 *
 * Provides mock telemetry data and a page-setup utility that loads
 * dashboard.html with fetch() intercepted so no real HTTP server is needed.
 */

import path from 'path';
import fs from 'fs';
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
  'RaceCorProDrive.Plugin.DemoMode': 0,
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
  'DataCorePlugin.GameData.TyreWearFrontLeft': 0.91,
  'DataCorePlugin.GameData.TyreWearFrontRight': 0.88,
  'DataCorePlugin.GameData.TyreWearRearLeft': 0.94,
  'DataCorePlugin.GameData.TyreWearRearRight': 0.93,
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
  'IRacingExtraProperties.iRacing_Opponent_Ahead_Name': 'M. Broadbent',
  'IRacingExtraProperties.iRacing_Opponent_Behind_Name': 'S. Leclerc',
  'IRacingExtraProperties.iRacing_Opponent_Ahead_IRating': 3210,
  'IRacingExtraProperties.iRacing_Opponent_Behind_IRating': 2530,
  'RaceCorProDrive.Plugin.CommentaryVisible': 0,
  'RaceCorProDrive.Plugin.CommentaryText': '',
  'RaceCorProDrive.Plugin.CommentaryTopicTitle': '',
  'RaceCorProDrive.Plugin.CommentaryTopicId': '',
  'RaceCorProDrive.Plugin.CommentaryCategory': '',
  'RaceCorProDrive.Plugin.CommentarySentimentColor': '',
  'RaceCorProDrive.Plugin.CommentarySeverity': 0,
  'RaceCorProDrive.Plugin.TrackMap.Ready': 0,
  'RaceCorProDrive.Plugin.Grid.SessionState': 4,
  'RaceCorProDrive.Plugin.GameId': 'iracing',
  'RaceCorProDrive.Plugin.SessionTypeName': 'Race',
  'RaceCorProDrive.Plugin.DS.FuelPct': 47.3,
  'RaceCorProDrive.Plugin.DS.FuelLapsRemaining': 9.1,
};

/** Demo mode telemetry — uses Demo.* keys instead */
export const MOCK_DEMO = {
  ...MOCK_TELEMETRY,
  'RaceCorProDrive.Plugin.DemoMode': 1,
  'RaceCorProDrive.Plugin.Demo.Gear': '3',
  'RaceCorProDrive.Plugin.Demo.Rpm': 5400,
  'RaceCorProDrive.Plugin.Demo.MaxRpm': 7500,
  'RaceCorProDrive.Plugin.Demo.SpeedMph': 98,
  'RaceCorProDrive.Plugin.Demo.Throttle': 0.65,
  'RaceCorProDrive.Plugin.Demo.Brake': 0.12,
  'RaceCorProDrive.Plugin.Demo.Clutch': 0.0,
  'RaceCorProDrive.Plugin.Demo.Fuel': 18.0,
  'RaceCorProDrive.Plugin.Demo.MaxFuel': 60.0,
  'RaceCorProDrive.Plugin.Demo.FuelPerLap': 3.5,
  'RaceCorProDrive.Plugin.Demo.RemainingLaps': 10,
  'RaceCorProDrive.Plugin.Demo.TyreTempFL': 210,
  'RaceCorProDrive.Plugin.Demo.TyreTempFR': 215,
  'RaceCorProDrive.Plugin.Demo.TyreTempRL': 195,
  'RaceCorProDrive.Plugin.Demo.TyreTempRR': 198,
  'RaceCorProDrive.Plugin.Demo.TyreWearFL': 0.80,
  'RaceCorProDrive.Plugin.Demo.TyreWearFR': 0.75,
  'RaceCorProDrive.Plugin.Demo.TyreWearRL': 0.85,
  'RaceCorProDrive.Plugin.Demo.TyreWearRR': 0.83,
  'RaceCorProDrive.Plugin.Demo.BrakeBias': 54.0,
  'RaceCorProDrive.Plugin.Demo.TC': 6,
  'RaceCorProDrive.Plugin.Demo.ABS': 2,
  'RaceCorProDrive.Plugin.Demo.Position': 3,
  'RaceCorProDrive.Plugin.Demo.CurrentLap': 12,
  'RaceCorProDrive.Plugin.Demo.BestLapTime': 88.921,
  'RaceCorProDrive.Plugin.Demo.CarModel': 'BMW M4 GT3',
  'RaceCorProDrive.Plugin.Demo.IRating': 3150,
  'RaceCorProDrive.Plugin.Demo.SafetyRating': 3.88,
  'RaceCorProDrive.Plugin.Demo.GapAhead': 0.8,
  'RaceCorProDrive.Plugin.Demo.GapBehind': 3.5,
  'RaceCorProDrive.Plugin.Demo.DriverAhead': 'J. Smith',
  'RaceCorProDrive.Plugin.Demo.DriverBehind': 'A. Johnson',
  'RaceCorProDrive.Plugin.Demo.IRAhead': 3500,
  'RaceCorProDrive.Plugin.Demo.IRBehind': 2100,
  'RaceCorProDrive.Plugin.Demo.Grid.SessionState': 4,
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
  await page.route(/k10motorsports/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockData),
    });
  });

  await page.goto(dashPath, { waitUntil: 'load' });

  // Inject car logo SVGs — Chromium blocks fetch() on file:// protocol,
  // so loadCarLogos() silently fails. Load them from disk and inject directly.
  // Must happen before polls so setCarLogo() finds the SVG content.
  const logosDir = path.resolve(APP_DIR, 'images', 'logos');
  try {
    const logoFiles = fs.readdirSync(logosDir).filter(f => f.endsWith('.svg'));
    const logoMap = {};
    for (const f of logoFiles) {
      logoMap[f.replace('.svg', '')] = fs.readFileSync(path.resolve(logosDir, f), 'utf-8');
    }
    await page.evaluate((logos) => {
      if (typeof carLogos !== 'undefined') {
        Object.assign(carLogos, logos);
        // Reset last-car tracking so the next poll cycle re-applies the logo
        if (typeof _lastCarModel !== 'undefined') _lastCarModel = null;
        if (typeof _currentCarLogo !== 'undefined') _currentCarLogo = '';
      }
    }, logoMap);
  } catch {
    // logos dir may not exist for all dashboard variants — that's fine
  }

  // Wait for at least 2 poll cycles to populate data
  await page.waitForTimeout(200);
}

/**
 * Update mock data mid-test by re-routing fetch.
 */
export async function updateMockData(page, data) {
  await page.unroute(/k10motorsports/);
  await page.route(/k10motorsports/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...MOCK_TELEMETRY, ...data }),
    });
  });
  // Wait for a poll cycle
  await page.waitForTimeout(100);
}
