// Settings → Sound: iRacing's LFE off while the sound bar is the speakers, as the desk shows it, over a stand-in for the app's
// bridge (window.racingDesk.soundBar, which main.js answers from the host). A switch, the choice of the sound bar among the
// playback devices, and one sentence on what was done last and when.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DESK = pathToFileURL(join(here, '..', '..', 'desk.html')).href;
const NOW = new Date('2026-10-07T15:00:00Z');

test.beforeAll(() => {
  execFileSync(process.execPath, [join(here, '..', '..', '..', '..', 'packages', 'calc', 'build.mjs')], { stdio: 'pipe' });
});

const BAR = { id: '{0.0.0.00000000}.{sound-bar}', name: 'Speakers (SineAudio DS6301M Plus V1.23)' };
const PODS = { id: '{0.0.0.00000000}.{air-pods}', name: 'Headphones (Kevin\'s AirPods Max)' };

const ANSWER = {
  value: {
    available: true,
    enabled: true,
    device: { ...BAR, connected: true },
    devices: [BAR, PODS],
    onSoundBar: true,
    status: { state: 'working', last: 'Turned iRacing\'s LFE off for the sound bar.', lastAtUtc: '2026-10-07T14:30:00.000Z', waiting: null, problem: null },
  },
};

const SESSION = {
  id: 1, source: 'live', ibt_path: null, session_num: 0, subsession_id: 0, session_id: 0, series_id: 0, season_id: 0, race_week: 0,
  event_type: 'Test', session_type: 'Offline Testing', official: 0, category: 'SportsCar', track_id: 432, track_name: 'oulton fosters',
  track_display_name: 'Oulton Park Circuit', track_config: null, track_length_km: 4.3, car_path: 'porsche963gtp', car_id: 167,
  car_screen_name: 'Porsche 963 GTP', car_class_id: 0, started_at: '2026-10-02T20:30:00.000Z', duration_s: 900, irating: 1500, license: 'C 2.50',
  safety_rating: 2.5, laps_completed: 5, best_lap_s: 98.2, incidents: 0, start_position: 0, finish_position: 0, finish_position_in_class: 0, field_size: 1, sof: 0,
};

// The app's bridge as the desk sees it: the settings file, the desk's reads (canned), and soundBar — read, and command, which
// changes what the host says, as the host does. A device the host does not list is refused.
async function stubApp(page, { answer = ANSWER, soundBar = true } = {}) {
  await page.addInitScript(({ answer, session, soundBar }) => {
    window.__app = { commands: [], reads: 0, settings: {}, answer };
    const copy = (v) => JSON.parse(JSON.stringify(v));
    window.racingDesk = {
      getSettings: async () => copy(window.__app.settings),
      saveSettings: async (s) => { window.__app.settings = s; return true; },
      desk: {
        read: async (name) => {
          if (name === 'status') return { value: { schemaVersion: 9, sessions: 1, laps: 5, lastSessionAt: session.started_at, lastIngestAt: null } };
          if (name === 'sessions') return { value: [session] };
          if (name === 'schedule') return { value: { season: null, series: [] } };
          return { value: { session: [session], laps: [], incidents: [], grid: [] } };
        },
      },
    };
    if (!soundBar) return;
    window.racingDesk.soundBar = {
      read: async () => { window.__app.reads += 1; return copy(window.__app.answer); },
      command: async (body) => {
        window.__app.commands.push(copy(body));
        const v = window.__app.answer.value;
        if ('enabled' in body) {
          v.enabled = body.enabled;
          return { ok: true, enabled: v.enabled };
        }
        const found = v.devices.find((d) => d.id === body.device);
        if (!found) return { ok: false, why: 'Windows doesn\'t list that device now', enabled: v.enabled };
        v.device = { ...found, connected: true };
        return { ok: true, enabled: v.enabled };
      },
    };
  }, { answer, session: SESSION, soundBar });
}

async function openDesk(page, query) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.route(/^https?:\/\//, (route) => route.abort());   // Typekit, and anything else: the desk asks for nothing itself
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${DESK}?host=${encodeURIComponent('http://127.0.0.1:18889')}${query}`);
  return errors;
}

const commands = (page) => page.evaluate(() => window.__app.commands);

test('Settings → Sound: the switch, the sound bar among the playback devices, and one sentence', async ({ page }) => {
  await stubApp(page);
  const errors = await openDesk(page, '#settings');
  const card = page.locator('#settings-soundbar');
  await expect(card.locator('h2')).toHaveText('Sound');
  await expect(card.locator('label.name')).toHaveText(['Turn iRacing\'s LFE off on the sound bar', 'Sound bar']);
  await expect(card.locator('#soundbar-switch')).toBeChecked();
  await expect(card.locator('#soundbar-device option')).toHaveText([BAR.name, PODS.name]);
  await expect(card.locator('#soundbar-device')).toHaveValue(BAR.id);
  await expect(card.locator('#soundbar-state')).toHaveText(/^Turned iRacing's LFE off for the sound bar, (today|yesterday) at .+\.$/);
  await expect(card.locator('#soundbar-state')).toHaveAttribute('data-state', 'working');
  await expect(card.locator('#soundbar-line')).toHaveCount(0);
  const words = await card.innerText();
  expect(words).not.toMatch(/\btrial\b/i);
  expect(words).not.toMatch(/xa2_mixToLFE|LFEEnabled|app\.ini/);
  expect(await commands(page)).toEqual([]);   // looking changes nothing
  expect(errors).toEqual([]);
});

test('the switch is sent to the host, and the sentence follows what the host says', async ({ page }) => {
  await stubApp(page);
  await openDesk(page, '#settings');
  const card = page.locator('#settings-soundbar');
  await expect(card.locator('#soundbar-switch')).toBeChecked();
  await card.locator('#soundbar-switch').uncheck();
  await expect.poll(() => commands(page)).toEqual([{ enabled: false }]);
  await expect(card.locator('#soundbar-switch')).not.toBeChecked();
  await card.locator('#soundbar-switch').check();
  await expect.poll(() => commands(page)).toEqual([{ enabled: false }, { enabled: true }]);
  await expect(card.locator('#soundbar-switch')).toBeChecked();
  // The host keeps the switch: nothing of it goes into the settings file.
  expect(await page.evaluate(() => window.__app.settings)).toEqual({});
});

test('another playback device chosen as the sound bar is sent as its id', async ({ page }) => {
  await stubApp(page);
  await openDesk(page, '#settings');
  const card = page.locator('#settings-soundbar');
  await card.locator('#soundbar-device').selectOption(PODS.id);
  await expect.poll(() => commands(page)).toEqual([{ device: PODS.id }]);
  await expect(card.locator('#soundbar-device')).toHaveValue(PODS.id);
});

test('what it waits for and what went wrong are the sentence', async ({ page }) => {
  const waiting = JSON.parse(JSON.stringify(ANSWER));
  waiting.value.status = { state: 'waiting', last: null, lastAtUtc: null, waiting: 'Waiting for iRacing to close, to turn its LFE off for the sound bar.', problem: null };
  await stubApp(page, { answer: waiting });
  await openDesk(page, '#settings');
  await expect(page.locator('#soundbar-state')).toHaveText('Waiting for iRacing to close, to turn its LFE off for the sound bar.');
  await expect(page.locator('#soundbar-state')).toHaveAttribute('data-state', 'waiting');
});

test('a sound bar that is not listed offers a prompt and says what to do', async ({ page }) => {
  const away = JSON.parse(JSON.stringify(ANSWER));
  away.value.devices = [PODS];
  away.value.device = null;
  away.value.onSoundBar = false;
  away.value.status = { state: 'idle', last: null, lastAtUtc: null, waiting: null, problem: null };
  await stubApp(page, { answer: away });
  await openDesk(page, '#settings');
  const card = page.locator('#settings-soundbar');
  await expect(card.locator('#soundbar-device option')).toHaveText(['Choose the sound bar', PODS.name]);
  await expect(card.locator('#soundbar-hint')).toHaveText('Windows doesn\'t list the sound bar right now. Choose it from the list once it is connected.');
  await expect(card.locator('#soundbar-state')).toHaveText('Nothing changed yet: iRacing\'s LFE goes off when the sound bar becomes your speakers.');
});

test('without the app the card is read-only and says so', async ({ page }) => {
  await stubApp(page, { soundBar: false });
  const errors = await openDesk(page, '#settings');
  const card = page.locator('#settings-soundbar');
  await expect(card.locator('#soundbar-line')).toHaveText('This is switched from the Racing Desk app.');
  await expect(card.locator('#soundbar-switch')).toBeDisabled();
  await expect(card.locator('#soundbar-device')).toBeDisabled();
  expect(errors).toEqual([]);
});
