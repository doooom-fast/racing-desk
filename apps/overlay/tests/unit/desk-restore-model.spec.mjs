// Settings → Cars and the Desk page's line (modules/desk/restore-model.js): what the card says for each answer of the host,
// the switches as the settings file has them, the first run's steps in their parts, undo, and the line for the car driven last.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('../../modules/desk/restore-model.js');

const STEP = (id, part, actions, mark = null) => ({
  id, part, title: `${id} title`, heDoes: `${id}: he does`, expected: `${id}: expect`, settles: '', mark: mark ? { state: mark, at: '2026-10-02T20:00:00Z' } : null,
  actions: actions.map((a) => ({ id: a, label: `${a} label`, writes: /A2|B1/.test(a), presses: /A4/.test(a), ran: null })),
});

const ANSWER = {
  value: {
    available: true, mode: 'trial', acting: false, seq: 9, startHeight: -0.02,
    switches: { height: true, brakes: true, horizon: false },
    gate: {
      brakes: { on: true, proven: false, acts: false, needs: ['A4', 'A5', 'A6', 'B2'] },
      height: { on: true, proven: true, acts: false, needs: ['B1', 'B4', 'B5'] },
      horizon: { on: false, proven: false, acts: false, needs: ['B6'] },
    },
    lines: [
      { seq: 7, at: '2026-10-02T20:38:00.000Z', car: 'porsche963gtp', what: 'brakes', state: 'trial', text: 'Trial: would make its own …', hud: false },
      { seq: 8, at: '2026-10-02T20:38:01.000Z', car: 'porsche963gtp', what: 'brakes', state: 'trial', text: 'Trial: brakes Porsche 963 GTP · 70 kg', hud: true },
      { seq: 9, at: '2026-10-02T20:38:01.500Z', car: 'porsche963gtp', what: 'height', state: 'trial', text: 'Trial: height Porsche 963 GTP · −2.0 cm (its camera file)', hud: true },
    ],
    plan: { appIni: 'app.ini holds −2.0 cm', lines: ['Height: app.ini holds −2.0 cm, the starting height every car launches with.', 'Brakes, Porsche 963 GTP: Trial: would make …'] },
    firstRun: { steps: [STEP('0a', 'Before he sits down', ['0a']), STEP('A1', 'A · the pedals', ['A1'], 'passed'), STEP('A2', 'A · the pedals', ['A2']), STEP('A7', 'A · the pedals', ['A7', 'A7-check'])] },
    made: { switch: null, profiles: [], heights: [], appIniOriginal: null },
  },
};

test('the switches are the settings file\'s, the height and the brakes on and the horizon off by default', () => {
  expect(model.switchesFrom({})).toEqual({ height: true, brakes: true, horizon: false });
  expect(model.switchesFrom({ restoreHeight: false, restoreHorizon: true })).toEqual({ height: false, brakes: true, horizon: true });
  expect(model.SWITCHES.map((s) => s.label)).toEqual(['Put back each car’s driver height', 'A brake profile for each car', 'The horizon per car too']);
});

test('the card says trial, and under each switch what it waits for', () => {
  const view = model.card(ANSWER, { settings: { restoreHorizon: false } });
  expect(view.line).toBe(model.TRIAL);
  expect(view.ready).toBe(true);
  const [height, brakes, horizon] = view.switches;
  expect(brakes.state).toBe(`${model.TRIAL} It leaves trial once A4, A5, A6 and B2 have passed.`);
  expect(height.state).toBe('Proven by the first run (B1, B4 and B5). This build still only says what it would do; the next one acts.');
  expect(horizon.state).toBe('Off.');
  expect(view.switches.every((s) => s.enabled)).toBe(true);
  expect(view.plan).toHaveLength(2);
  // The steps in their parts, in the host's order, with his marks.
  expect(view.parts.map((p) => [p.part, p.steps.map((s) => s.id)])).toEqual([['Before he sits down', ['0a']], ['A · the pedals', ['A1', 'A2', 'A7']]]);
  expect(view.parts[1].steps[0].mark).toBe('passed');
  expect(view.parts[1].steps[2].actions.map((a) => a.id)).toEqual(['A7', 'A7-check']);
  // Nothing made yet: nothing to undo.
  expect(view.undo.map((u) => [u.cmd, u.enabled])).toEqual([['brakes', false], ['heights', false]]);
});

test('without the app, with an old host, with a host that cannot be asked or that does not put cars back, it says so and offers nothing', () => {
  expect(model.card(null, { inApp: false }).line).toBe(model.FROM_THE_APP);
  expect(model.card(null, { inApp: false }).switches.every((s) => !s.enabled)).toBe(true);
  expect(model.card({ missing: true }).line).toMatch(/older than the app/);
  expect(model.card({ error: 'Nothing is answering at http://localhost:18889.' }).line).toBe('The host could not be asked: Nothing is answering at http://localhost:18889.');
  expect(model.card({ value: { available: false, why: 'a replay' } }).line).toBe('a replay');
  for (const answer of [{ missing: true }, { error: 'x' }, { value: { available: false } }]) {
    const view = model.card(answer);
    expect(view.parts).toEqual([]);
    expect(view.undo.every((u) => !u.enabled)).toBe(true);
  }
});

test('undo is offered for what Racing Desk made, and a press under way holds every button', () => {
  const made = JSON.parse(JSON.stringify(ANSWER));
  made.value.made = { switch: { profile: 'Racing Desk', key: 'F24', bound: true }, profiles: [{ car: 'porsche963gtp' }], heights: [{ car: 'porsche963gtp' }], appIniOriginal: -0.035 };
  const view = model.card(made);
  expect(view.undo.map((u) => u.enabled)).toEqual([true, true]);
  expect(view.undo[0].hint).toMatch(/^1 car profile, the Racing Desk profile and F24\./);
  expect(view.undo[1].hint).toMatch(/^1 camera file put back as they were, and app\.ini’s height/);
  const busy = model.card(made, { busy: true });
  expect(busy.undo.every((u) => !u.enabled)).toBe(true);
  expect(busy.switches.every((s) => !s.enabled)).toBe(true);
});

test('a press that writes or presses is asked again, in words; what a press did is said under it', () => {
  const step = { id: 'A2', actions: [] };
  expect(model.confirmText({ label: 'Make it', writes: true }, step)).toBe('A2 · Make it: this writes SmartControl’s database (backed up first). Go on?');
  expect(model.confirmText({ label: 'Lower', writes: true }, { id: 'B4' })).toBe('B4 · Lower: this writes iRacing’s view files (backed up first). Go on?');
  expect(model.confirmText({ label: 'Send', presses: true }, { id: 'A4' })).toMatch(/presses F24 five seconds after you click/);
  expect(model.resultLines({ ok: false, refused: true, why: 'quit both first' })).toEqual([{ kind: 'refused', text: 'quit both first' }]);
  expect(model.resultLines({ ok: true, did: ['made'], saw: ['his rows as they were'] })).toEqual([{ kind: 'did', text: 'made' }, { kind: 'saw', text: 'his rows as they were' }]);
  expect(model.resultLines(null)).toEqual([{ kind: 'error', text: 'The app did not answer.' }]);
  const view = model.card(ANSWER, { results: { A2: { ok: true, did: ['made'] } } });
  expect(view.parts[1].steps[1].actions[0].said).toEqual([{ kind: 'did', text: 'made' }]);
});

test('the Desk page\'s line is the newest car\'s lines, as the HUD was told them', () => {
  const last = model.lastAction(ANSWER, { timeFormat: () => '2:38 PM' });
  expect(last).toEqual({ car: 'porsche963gtp', name: 'Porsche 963 GTP', trial: true, text: 'Trial · Porsche 963 GTP, 2:38 PM: brakes 70 kg · height −2.0 cm (its camera file)' });
  const noFile = { value: { available: true, lines: [{ seq: 1, at: '2026-10-02T20:00:00Z', car: 'lotus79', hud: true, text: 'Trial: no camera file for the Lotus 79 yet' }] } };
  expect(model.lastAction(noFile).text).toBe('Trial · Lotus 79: no camera file yet');
  expect(model.lastAction(noFile).name).toBe('Lotus 79');
  expect(model.lastAction({ value: { available: true, lines: [] } })).toBeNull();
  expect(model.lastAction({ error: 'x' })).toBeNull();
});
