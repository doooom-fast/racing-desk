// Settings → Cars and the Desk page's line: putting back each car's height and brakes (docs/view-and-pedals-plan.md), as the
// desk shows it, over a stand-in for the app's bridge (window.racingDesk.restore, which main.js answers from the host). The
// host is in trial: the card says so, lists what trial would do, and has the first run's steps, each a button that runs only
// that step on his click — one that writes or presses a key asks first.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DESK = pathToFileURL(join(here, '..', '..', 'desk.html')).href;
const NOW = new Date('2026-10-02T21:00:00Z');
const TRIAL = 'Trial — saying what it would do; nothing is written or pressed until the first run with you at the rig.';

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

const step = (id, part, title, actions, extra = {}) => ({
  id, part, title, heDoes: `${id}: what he does`, expected: `${id}: what he should see`, settles: extra.settles ?? null,
  actions: actions.map(([aid, label, writes = false, presses = false]) => ({ id: aid, label, writes, presses, ran: null })), mark: extra.mark ?? null,
});

const LINES = [
  { seq: 40, at: '2026-10-02T20:38:00.000Z', car: 'porsche963gtp', what: 'brakes', state: 'trial', text: 'Trial: would make its own SmartControl profile …', hud: false },
  { seq: 41, at: '2026-10-02T20:38:00.500Z', car: 'porsche963gtp', what: 'brakes', state: 'trial', text: 'Trial: brakes Porsche 963 GTP · 70 kg', hud: true },
  { seq: 42, at: '2026-10-02T20:38:01.000Z', car: 'porsche963gtp', what: 'height', state: 'trial', text: 'Trial: height Porsche 963 GTP · −2.0 cm (its camera file)', hud: true },
];

const ANSWER = {
  value: {
    available: true, mode: 'trial', acting: false, seq: 42, startHeight: -0.02,
    switches: { height: true, brakes: true, horizon: false },
    gate: {
      brakes: { on: true, proven: false, acts: false, needs: ['A4', 'A5', 'A6', 'B2'] },
      height: { on: true, proven: false, acts: false, needs: ['B1', 'B4', 'B5'] },
      horizon: { on: false, proven: false, acts: false, needs: ['B6'] }, seedForce: false,
    },
    lines: LINES,
    now: null,
    cars: [],
    plan: { appIni: 'app.ini holds −2.0 cm', lines: ['Height: app.ini holds −2.0 cm, the starting height every car launches with.', 'Brakes, Porsche 963 GTP: Trial: would make its own SmartControl profile \'Porsche 963 GTP\' from Default at 70 kg (the force you last set in it), and switch to it when you get in, parked.'] },
    firstRun: {
      steps: [
        step('0a', 'Before he sits down', 'What would move', [['0a', 'Show what would move']]),
        step('0b', 'Before he sits down', 'Back up everything', [['0b', 'Back up and check the backups']]),
        step('A1', 'A · the pedals, sim closed', 'SmartControl and Live closed', [['A1', 'Check both are closed']]),
        step('A2', 'A · the pedals, sim closed', 'The Racing Desk profile and F24', [['A2', 'Make the Racing Desk profile and bind F24', true]]),
        step('A4', 'A · the pedals, sim closed', 'F24 from a program', [['A4', 'Send F24', false, true]], { settles: 'Live acts on a key a program sends (E7).' }),
        step('A7', 'A · the pedals, sim closed', 'Writing with the editor open', [['A7', 'Add a row and rewrite the Racing Desk row', true], ['A7-check', 'Check both rows are unchanged']]),
        step('B4', 'B · in the sim', 'The camera file 2 cm lower', [['B4', 'Set the 963\'s cockpit Z 2 cm lower, app.ini at S', true]]),
      ],
    },
    made: { switch: null, profiles: [], heights: [], appIniOriginal: null },
  },
};

// The app's bridge as the desk sees it: the settings file, the desk's reads (canned), and restore — read, and command, which
// for the switches writes the settings file first and then tells the host, as main.js does.
async function stubApp(page, { settings = {}, answer = ANSWER, linesAnswer = null, planned = {}, restore = true } = {}) {
  await page.addInitScript(({ settings, answer, linesAnswer, planned, session, restore }) => {
    window.__app = { commands: [], reads: 0, linesReads: 0, settings, answer, planned };
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
      read: async (opts) => {
        if (opts && opts.linesOnly) { window.__app.linesReads += 1; return copy(linesAnswer ?? window.__app.answer); }
        window.__app.reads += 1;
        return copy(window.__app.answer);
      },
      command: async (body) => {
        window.__app.commands.push(copy(body));
        if (body.switches) {
          const keys = { height: 'restoreHeight', brakes: 'restoreBrakes', horizon: 'restoreHorizon' };
          for (const [k, v] of Object.entries(body.switches)) {
            window.__app.settings[keys[k]] = v;
            window.__app.answer.value.switches[k] = v;
          }
          return { ok: true, switches: copy(window.__app.answer.value.switches) };
        }
        const key = body.step ?? (body.mark ? `mark:${body.mark}` : body.undo ? `undo:${body.undo}` : '*');
        if (body.mark) {
          const s = window.__app.answer.value.firstRun.steps.find((x) => x.id === body.mark);
          s.mark = body.state ? { state: body.state, at: '2026-10-02T21:00:00Z' } : null;
          return { ok: true, step: body.mark, state: body.state };
        }
        return copy(window.__app.planned[key] ?? { ok: true, did: [], saw: [] });
      },
    };
  }, { settings, answer, linesAnswer, planned, session: SESSION, restore });
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

test('Settings → Cars says trial, has the switches as the settings file has them, what trial would do, and the first run in its parts', async ({ page }) => {
  await stubApp(page, { settings: { restoreHorizon: false } });
  const errors = await openDesk(page, '#settings');
  const card = page.locator('#settings-restore');
  await expect(card.locator('h2')).toHaveText('Cars');
  await expect(card.locator('#restore-line')).toHaveText(TRIAL);
  await expect(card.locator('#restore-height')).toBeChecked();
  await expect(card.locator('#restore-brakes')).toBeChecked();
  await expect(card.locator('#restore-horizon')).not.toBeChecked();
  await expect(card.locator('label[for="restore-height"]')).toHaveText('Put back each car’s driver height');
  await expect(card.locator('label[for="restore-brakes"]')).toHaveText('A brake profile for each car');
  await expect(card.locator('#restore-brakes-state')).toHaveText(`${TRIAL} It leaves trial once A4, A5, A6 and B2 have passed.`);
  await expect(card.locator('#restore-height-state')).toHaveText(`${TRIAL} It leaves trial once B1, B4 and B5 have passed.`);
  await expect(card.locator('#restore-horizon-state')).toHaveText('Off.');
  // Nothing made yet: neither undo has anything to do.
  await expect(card.locator('[data-restore-undo]')).toHaveText(['Remove the brake profiles Racing Desk made', 'Undo everything Racing Desk changed']);
  await expect(card.locator('[data-restore-undo="brakes"]')).toBeDisabled();
  await expect(card.locator('[data-restore-undo="heights"]')).toBeDisabled();

  // What trial would do, folded until he opens it.
  const plan = card.locator('.restore-plan');
  await expect(plan.locator('li').first()).toBeHidden();
  await plan.locator('summary').click();
  await expect(plan.locator('li')).toHaveText(ANSWER.value.plan.lines);

  // The first run: its parts, its steps with what he does and what he should see, a button for each of the step's parts and
  // his two marks.
  const run = card.locator('.restore-first-run');
  await run.locator('summary').click();
  await expect(run.locator('h3')).toHaveText(['Before he sits down', 'A · the pedals, sim closed', 'B · in the sim']);
  await expect(run.locator('.restore-step')).toHaveCount(7);
  const a7 = run.locator('.restore-step[data-step="A7"]');
  await expect(a7.locator('.step-title')).toHaveText('A7Writing with the editor open');
  await expect(a7.locator('.expected')).toHaveText('Expect: A7: what he should see');
  await expect(a7.locator('[data-restore-step]')).toHaveText(['Add a row and rewrite the Racing Desk row', 'Check both rows are unchanged']);
  await expect(a7.locator('[data-restore-mark]')).toHaveText(['Passed', 'Failed']);
  await expect(run.locator('.restore-step[data-step="A4"] .settles')).toHaveText('Settles: Live acts on a key a program sends (E7).');
  expect(await commands(page)).toEqual([]);   // looking presses nothing
  expect(errors).toEqual([]);
});

test('a switch is written and told; a step that writes asks first, and what it did, or why it did nothing, is said under it; marks and undo', async ({ page }) => {
  await stubApp(page, {
    planned: {
      A1: { ok: false, refused: false, why: 'Quit Live from the tray icon, then check again.', did: [], saw: ['the SmartControl editor is closed', 'SmartControl Live is running'] },
      A2: { ok: true, did: ['profile \'Racing Desk\' made, a copy of Default', 'F24 · Set profile \'Racing Desk\' bound in Live\'s Default preset'], saw: ['his 6 profiles and 5 keys are as they were'] },
    },
  });
  await openDesk(page, '#settings');
  const card = page.locator('#settings-restore');
  await expect(card.locator('#restore-line')).toHaveText(TRIAL);

  await card.locator('#restore-brakes').uncheck();
  await expect.poll(() => commands(page)).toEqual([{ switches: { brakes: false } }]);
  expect(await page.evaluate(() => window.__app.settings.restoreBrakes)).toBe(false);
  await expect(card.locator('#restore-brakes')).not.toBeChecked();
  await expect(card.locator('#restore-brakes-state')).toHaveText('Off.');

  const run = card.locator('.restore-first-run');
  await run.locator('summary').click();
  // A step that writes asks first; said no, nothing is sent.
  const asked = [];
  page.once('dialog', (d) => { asked.push(d.message()); d.dismiss(); });
  await run.locator('[data-restore-step="A2"]').click();
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe('A2 · Make the Racing Desk profile and bind F24: this writes SmartControl’s database (backed up first). Go on?');
  await page.waitForTimeout(100);
  expect(await commands(page)).toHaveLength(1);
  page.once('dialog', (d) => { asked.push(d.message()); d.accept(); });
  await run.locator('[data-restore-step="A2"]').click();
  await expect.poll(() => commands(page)).toEqual([{ switches: { brakes: false } }, { step: 'A2' }]);
  const a2 = run.locator('.restore-step[data-step="A2"]');
  await expect(a2.locator('.step-said li')).toHaveText([
    'profile \'Racing Desk\' made, a copy of Default', 'F24 · Set profile \'Racing Desk\' bound in Live\'s Default preset', 'his 6 profiles and 5 keys are as they were',
  ]);

  // One that only looks goes at once, and why it did not pass is said first.
  await run.locator('[data-restore-step="A1"]').click();
  const a1 = run.locator('.restore-step[data-step="A1"]');
  await expect(a1.locator('.step-said li').first()).toHaveText('Quit Live from the tray icon, then check again.');
  await expect(a1.locator('.step-said li.said-error')).toHaveCount(1);

  // His mark, and pressed again it is taken back.
  await a1.locator('[data-mark="passed"]').click();
  await expect(a1.locator('[data-mark="passed"]')).toHaveAttribute('aria-pressed', 'true');
  await a1.locator('[data-mark="passed"]').click();
  await expect(a1.locator('[data-mark="passed"]')).toHaveAttribute('aria-pressed', 'false');
  const sent = await commands(page);
  expect(sent.slice(2)).toEqual([{ step: 'A1' }, { mark: 'A1', state: 'passed' }, { mark: 'A1', state: null }]);
});

test('undo is offered for what Racing Desk made, and asks first', async ({ page }) => {
  const made = JSON.parse(JSON.stringify(ANSWER));
  made.value.made = { switch: { profile: 'Racing Desk', key: 'F24', bound: true }, profiles: [{ car: 'porsche963gtp', profile: 'Porsche 963 GTP', base: 'Default', kg: 70, state: 'made' }], heights: [{ car: 'porsche963gtp' }], appIniOriginal: -0.035 };
  await stubApp(page, { answer: made, planned: { 'undo:brakes': { ok: true, did: ['profile \'Porsche 963 GTP\' removed'], saw: [] } } });
  await openDesk(page, '#settings');
  const card = page.locator('#settings-restore');
  await expect(card.locator('[data-restore-undo="brakes"]')).toBeEnabled();
  await expect(card.locator('.restore-undo .hint').first()).toHaveText('1 car profile, the Racing Desk profile and F24. Your own profiles, presets and keys stay. With the SmartControl editor closed.');
  const asked = [];
  page.once('dialog', (d) => { asked.push(d.message()); d.dismiss(); });
  await card.locator('[data-restore-undo="heights"]').click();
  await expect.poll(() => asked.length).toBe(1);
  page.once('dialog', (d) => { asked.push(d.message()); d.accept(); });
  await card.locator('[data-restore-undo="brakes"]').click();
  await expect.poll(() => commands(page)).toEqual([{ undo: 'brakes' }]);
  expect(asked).toEqual([
    'Put every camera file Racing Desk changed back as it was, and app.ini\'s height? iRacing must be closed.',
    'Remove every SmartControl profile Racing Desk made, its own profile and F24? Your own profiles, presets and keys stay. Close the SmartControl editor first.',
  ]);
  await expect(card.locator('.restore-undo .step-said li')).toHaveText(['profile \'Porsche 963 GTP\' removed']);
});

test('without the app the card is read-only and says so, and the Desk page has no line', async ({ page }) => {
  await stubApp(page, { restore: false });
  const errors = await openDesk(page, '#settings');
  const card = page.locator('#settings-restore');
  await expect(card.locator('#restore-line')).toHaveText('This is switched from the Racing Desk app.');
  await expect(card.locator('[data-restore-switch]:not(:disabled)')).toHaveCount(0);
  await expect(card.locator('.restore-first-run')).toHaveCount(0);
  await page.locator('a[data-page-link="desk"]').click();
  await expect(page.locator('#restore-last')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the Desk page has one line: the car driven last, and what trial would have done when he got in', async ({ page }) => {
  await stubApp(page);
  const errors = await openDesk(page, '#desk');
  const line = page.locator('#restore-last');
  await expect(line).toBeVisible();
  await expect(line).toHaveText(/^Trial · Porsche 963 GTP, .+: brakes 70 kg · height −2\.0 cm \(its camera file\)$/);
  expect(await page.evaluate(() => [window.__app.linesReads, window.__app.reads])).toEqual([1, 0]);   // the lines alone: no dry run for it
  expect(errors).toEqual([]);
});

test('the Desk page\'s line is not there while there is nothing to say', async ({ page }) => {
  const quiet = JSON.parse(JSON.stringify(ANSWER));
  quiet.value.lines = [];
  await stubApp(page, { answer: quiet });
  const errors = await openDesk(page, '#desk');
  await expect(page.locator('#freshness')).toHaveText(/^1 sessions · /);
  await expect.poll(() => page.evaluate(() => window.__app.linesReads)).toBe(1);
  await expect(page.locator('#restore-last')).toBeHidden();
  await expect(page.locator('#restore-last')).toHaveText('');
  expect(errors).toEqual([]);
});
