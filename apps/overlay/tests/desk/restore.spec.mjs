// Settings → Cars: putting back each car's seat height and brakes (docs/view-and-pedals-plan.md), as the desk shows it, over a
// stand-in for the app's bridge (window.racingDesk.restore, which main.js answers from the host). Two rows, each a switch and
// how its part stands in a sentence, and one undo that asks first. Nothing of a trial or a first run.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DESK = pathToFileURL(join(here, '..', '..', 'desk.html')).href;
const NOW = new Date('2026-10-02T21:00:00Z');

test.beforeAll(() => {
  execFileSync(process.execPath, [join(here, '..', '..', '..', '..', 'packages', 'calc', 'build.mjs')], { stdio: 'pipe' });
});

const SESSION = {
  id: 1, source: 'live', ibt_path: null, session_num: 0, subsession_id: 0, session_id: 0, series_id: 0, season_id: 0, race_week: 0,
  event_type: 'Test', session_type: 'Offline Testing', official: 0, category: 'SportsCar', track_id: 432, track_name: 'oulton fosters',
  track_display_name: 'Oulton Park Circuit', track_config: null, track_length_km: 4.3, car_path: 'porsche963gtp', car_id: 167,
  car_screen_name: 'Porsche 963 GTP', car_class_id: 0, started_at: '2026-10-02T20:30:00.000Z', duration_s: 900, irating: 1500, license: 'C 2.50',
  safety_rating: 2.5, laps_completed: 5, best_lap_s: 98.2, incidents: 0, start_position: 0, finish_position: 0, finish_position_in_class: 0, field_size: 1, sof: 0,
};

const BRAKES_WORKING = 'Working: the last brakes it put on were the Porsche 963 GTP\'s.';
const HEIGHT_WAITING = 'Waiting for iRacing to close, to put the seat heights you chose before into the cars\' camera files.';

const ANSWER = {
  value: {
    available: true,
    switches: { brakes: true, height: true },
    status: { brakes: { state: 'working', text: BRAKES_WORKING }, height: { state: 'waiting', text: HEIGHT_WAITING } },
    undo: true,
    cars: [],
  },
};

// The app's bridge as the desk sees it: the settings file, the desk's reads (canned), and restore — read, and command, which
// for a switch changes what the host says, as the host does.
async function stubApp(page, { answer = ANSWER, undone = { ok: true, did: [], saw: [] }, restore = true } = {}) {
  await page.addInitScript(({ answer, undone, session, restore }) => {
    window.__app = { commands: [], reads: 0, settings: {}, answer, undone };
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
    if (!restore) return;
    window.racingDesk.restore = {
      read: async () => { window.__app.reads += 1; return copy(window.__app.answer); },
      command: async (body) => {
        window.__app.commands.push(copy(body));
        const v = window.__app.answer.value;
        if (body.switches) {
          for (const [k, on] of Object.entries(body.switches)) {
            v.switches[k] = on;
            v.status[k] = on ? { state: 'working', text: 'Working.' } : { state: 'off', text: 'Off.' };
          }
          return { ok: true, switches: copy(v.switches) };
        }
        if (body.keys === 'undo') {
          v.keys = { state: 'undone', text: 'F1, F2, F3, F4 set 30, 50, 80, 100 kg; Up adds 5 kg; Down takes off 5 kg.', restart: 'Restart SmartControl Live (or the PC) to use F1–F4 for brake force again.', said: null, undo: false, move: true };
          return { ok: true, action: 'keys', did: ['the brake-force keys are on F1–F4 again, as before Racing Desk moved them'], saw: ['Restart SmartControl Live (or the PC) to use F1–F4 for brake force again.'] };
        }
        v.switches = { brakes: false, height: false };
        v.status = { brakes: { state: 'off', text: 'Off.' }, height: { state: 'off', text: 'Off.' } };
        v.undo = false;
        return copy(window.__app.undone);
      },
    };
  }, { answer, undone, session: SESSION, restore });
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

test('Settings → Cars: two rows, each a switch and how it stands in a sentence, and one undo', async ({ page }) => {
  await stubApp(page);
  const errors = await openDesk(page, '#settings');
  const card = page.locator('#settings-restore');
  await expect(card.locator('h2')).toHaveText('Cars');
  await expect(card.locator('label.name')).toHaveText(['Brakes put back for each car', 'Seat height put back for each car']);
  await expect(card.locator('#restore-brakes')).toBeChecked();
  await expect(card.locator('#restore-height')).toBeChecked();
  await expect(card.locator('#restore-brakes-state')).toHaveText(BRAKES_WORKING);
  await expect(card.locator('#restore-height-state')).toHaveText(HEIGHT_WAITING);
  await expect(card.locator('#restore-undo')).toHaveText('Undo what Racing Desk changed');
  await expect(card.locator('#restore-undo')).toBeEnabled();
  await expect(card.locator('#restore-line')).toHaveCount(0);
  // Nothing of a trial or a first run, and no step codes.
  const words = await card.innerText();
  expect(words).not.toMatch(/\btrial\b/i);
  expect(words).not.toMatch(/\b(0a|0b|[ABC]\d{1,2})\b/);
  await expect(card.locator('details, [data-restore-step], [data-restore-mark]')).toHaveCount(0);
  expect(await commands(page)).toEqual([]);   // looking changes nothing
  expect(errors).toEqual([]);
});

test('a switch is sent to the host, and the row says what the host says after it', async ({ page }) => {
  await stubApp(page);
  await openDesk(page, '#settings');
  const card = page.locator('#settings-restore');
  await expect(card.locator('#restore-brakes-state')).toHaveText(BRAKES_WORKING);
  await card.locator('#restore-brakes').uncheck();
  await expect.poll(() => commands(page)).toEqual([{ switches: { brakes: false } }]);
  await expect(card.locator('#restore-brakes')).not.toBeChecked();
  await expect(card.locator('#restore-brakes-state')).toHaveText('Off.');
  await expect(card.locator('#restore-height')).toBeChecked();
  // The host keeps the switches: nothing of them goes into the settings file.
  expect(await page.evaluate(() => window.__app.settings)).toEqual({});
});

test('a part that turned itself off says why, under its switch', async ({ page }) => {
  const stopped = JSON.parse(JSON.stringify(ANSWER));
  stopped.value.switches.height = false;
  stopped.value.status.height = { state: 'stopped', text: 'Turned itself off: app.ini\'s seat height was −1.5 cm when iRacing started, not the −2.0 cm Racing Desk left there, so something else writes it; each car\'s camera file was put back.' };
  await stubApp(page, { answer: stopped });
  await openDesk(page, '#settings');
  const state = page.locator('#restore-height-state');
  await expect(state).toHaveText(stopped.value.status.height.text);
  await expect(state).toHaveAttribute('data-state', 'stopped');
  await expect(page.locator('#restore-height')).not.toBeChecked();
});

test('undo asks first, and says what it did under it', async ({ page }) => {
  await stubApp(page, {
    undone: {
      ok: true,
      did: ['the F24 key taken out of SmartControl Live', 'Porsche 963 GTP: its camera file\'s cockpit Z is 0.0 cm again, as before Racing Desk'],
      saw: ['To finish, pick one of your own profiles in SmartControl, then delete the profile \'Racing Desk: Porsche 963 GTP\' there'],
    },
  });
  await openDesk(page, '#settings');
  const card = page.locator('#settings-restore');
  const asked = [];
  page.once('dialog', (d) => { asked.push(d.message()); d.dismiss(); });
  await card.locator('#restore-undo').click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe('This turns both off, takes Racing Desk’s profiles (one for each car, with anything you changed in them, and the one F24 switches) and its F24 key out of SmartControl, and puts back the seat heights it kept in app.ini and the cars’ camera files. Close iRacing and the SmartControl editor first. Go on?');
  await page.waitForTimeout(100);
  expect(await commands(page)).toEqual([]);

  page.once('dialog', (d) => d.accept());
  await card.locator('#restore-undo').click();
  await expect.poll(() => commands(page)).toEqual([{ undo: 'all' }]);
  await expect(card.locator('.restore-undo li')).toHaveText([
    'the F24 key taken out of SmartControl Live.',
    'Porsche 963 GTP: its camera file\'s cockpit Z is 0.0 cm again, as before Racing Desk.',
    'To finish, pick one of your own profiles in SmartControl, then delete the profile \'Racing Desk: Porsche 963 GTP\' there.',
  ]);
  await expect(card.locator('#restore-brakes')).not.toBeChecked();
  await expect(card.locator('#restore-height')).not.toBeChecked();
  await expect(card.locator('#restore-undo')).toBeDisabled();
});

test('his brake-force keys: one line says which set the force now and to restart Live, and Undo asks first and puts them back', async ({ page }) => {
  const moved = JSON.parse(JSON.stringify(ANSWER));
  moved.value.keys = {
    state: 'moved', text: 'F1, F2, F3, F4 set 30, 50, 80, 100 kg; Up adds 5 kg; Down takes off 5 kg.',
    restart: 'Restart SmartControl Live (or the PC) to use Right Ctrl + F1–F4 for brake force.', said: null, undo: true, move: false,
  };
  await stubApp(page, { answer: moved });
  const errors = await openDesk(page, '#settings');
  const row = page.locator('#settings-restore #restore-keys');
  await expect(row.locator('.name')).toHaveText('Brake force keys');
  await expect(row.locator('#restore-keys-state')).toContainText('F1, F2, F3, F4 set 30, 50, 80, 100 kg; Up adds 5 kg; Down takes off 5 kg.');
  await expect(row.locator('#restore-keys-restart')).toHaveText('Restart SmartControl Live (or the PC) to use Right Ctrl + F1–F4 for brake force.');
  await expect(row.locator('#restore-keys-undo')).toHaveText('Undo');
  await expect(row.locator('#restore-keys-move')).toHaveCount(0);
  expect(await commands(page)).toEqual([]);

  const asked = [];
  page.once('dialog', (d) => { asked.push(d.message()); d.dismiss(); });
  await row.locator('#restore-keys-undo').click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe('This puts SmartControl Live’s brake-force keys back on F1–F4 alone, as they were before Racing Desk moved them. Close the SmartControl editor first. Go on?');
  await page.waitForTimeout(100);
  expect(await commands(page)).toEqual([]);

  page.once('dialog', (d) => d.accept());
  await row.locator('#restore-keys-undo').click();
  await expect.poll(() => commands(page)).toEqual([{ keys: 'undo' }]);
  await expect(page.locator('#settings-restore .restore-keys-done li')).toHaveText([
    'the brake-force keys are on F1–F4 again, as before Racing Desk moved them.',
  ]);
  await expect(row.locator('#restore-keys-restart')).toHaveText('Restart SmartControl Live (or the PC) to use F1–F4 for brake force again.');
  await expect(row.locator('#restore-keys-undo')).toHaveCount(0);
  await expect(row.locator('#restore-keys-move')).toHaveText('Move to Right Ctrl');
  await expect(page.locator('#restore-brakes')).toBeChecked();      // the keys' undo is its own: the switches stay
  expect(errors).toEqual([]);
});

test('without the app the card is read-only and says so, and the Desk page has no line of it', async ({ page }) => {
  await stubApp(page, { restore: false });
  const errors = await openDesk(page, '#settings');
  const card = page.locator('#settings-restore');
  await expect(card.locator('#restore-line')).toHaveText('This is switched from the Racing Desk app.');
  await expect(card.locator('[data-restore-switch]:not(:disabled)')).toHaveCount(0);
  await expect(card.locator('#restore-undo')).toBeDisabled();
  await page.locator('a[data-page-link="desk"]').click();
  await expect(page.locator('#restore-last, #restore-settled')).toHaveCount(0);
  expect(errors).toEqual([]);
});
