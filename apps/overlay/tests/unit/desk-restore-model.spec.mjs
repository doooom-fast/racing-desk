// Settings → Cars (modules/desk/restore-model.js): two rows, each a switch and how its part stands in a sentence, and one undo —
// what the card says for each answer of the host.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('../../modules/desk/restore-model.js');

const ANSWER = {
  value: {
    available: true,
    switches: { brakes: true, height: false },
    status: {
      brakes: { state: 'waiting', text: 'Starts working the next time SmartControl Live starts: quit it from its tray icon and start it again, or restart the PC.' },
      height: { state: 'stopped', text: 'Turned itself off: app.ini\'s seat height was −1.5 cm when iRacing started, not the −2.0 cm Racing Desk left there, so something else writes it; each car\'s camera file was put back.' },
    },
    undo: true,
    cars: [],
  },
};

test('two rows in sentence case, each with its switch and how it stands, as the host says', () => {
  const view = model.card(ANSWER);
  expect(view.line).toBeNull();
  expect(view.ready).toBe(true);
  expect(view.rows.map((r) => r.label)).toEqual(['Brakes put back for each car', 'Seat height put back for each car']);
  expect(view.rows.map((r) => [r.key, r.value, r.state, r.enabled])).toEqual([['brakes', true, 'waiting', true], ['height', false, 'stopped', true]]);
  expect(view.rows[0].status).toBe(ANSWER.value.status.brakes.text);
  expect(view.rows[1].status).toBe(ANSWER.value.status.height.text);
  expect(view.undo).toEqual({ label: 'Undo what Racing Desk changed', enabled: true });
  expect(view.undone).toEqual([]);
});

test('undo is offered only when there is something to undo, and nothing is while a command runs', () => {
  const nothing = JSON.parse(JSON.stringify(ANSWER));
  nothing.value.undo = false;
  expect(model.card(nothing).undo.enabled).toBe(false);
  const busy = model.card(ANSWER, { busy: true });
  expect(busy.undo.enabled).toBe(false);
  expect(busy.rows.every((r) => !r.enabled)).toBe(true);
});

test('without the app, or without an answer, the card says why and nothing can be switched', () => {
  const away = model.card(null, { inApp: false });
  expect(away.line).toBe('This is switched from the Racing Desk app.');
  expect(away.rows.every((r) => !r.enabled && r.status === '')).toBe(true);
  expect(away.undo.enabled).toBe(false);
  expect(model.card(null).line).toBe('Asking the host…');
  expect(model.card({ missing: true }).line).toBe('This host is older than the app: it does not put cars back yet.');
  expect(model.card({ error: 'Nothing is answering at 127.0.0.1:18889.' }).line).toBe('The host could not be asked: Nothing is answering at 127.0.0.1:18889.');
  expect(model.card({ value: { available: false, why: 'this host does not put cars\' seat heights and brakes back (a replay, or a host from before it)' } }).line)
    .toBe('this host does not put cars\' seat heights and brakes back (a replay, or a host from before it)');
});

test('what undo did is said under it, a sentence a line: what is left for him first if it did not all go', () => {
  const view = model.card(ANSWER, {
    undone: {
      ok: true,
      did: ['the F24 key taken out of SmartControl Live', 'Porsche 963 GTP: its camera file\'s cockpit Z is 0.0 cm again, as before Racing Desk'],
      saw: ['To finish, pick one of your own profiles in SmartControl, then delete the profile \'Racing Desk – Porsche 963 GTP\' there'],
    },
  });
  expect(view.undone).toEqual([
    { kind: 'did', text: 'the F24 key taken out of SmartControl Live.' },
    { kind: 'did', text: 'Porsche 963 GTP: its camera file\'s cockpit Z is 0.0 cm again, as before Racing Desk.' },
    { kind: 'saw', text: 'To finish, pick one of your own profiles in SmartControl, then delete the profile \'Racing Desk – Porsche 963 GTP\' there.' },
  ]);
  expect(model.resultLines({ ok: false, why: null, did: [], saw: ['SmartControl was left as it is: close the SmartControl editor, then press undo again'] }))
    .toEqual([{ kind: 'error', text: 'SmartControl was left as it is: close the SmartControl editor, then press undo again.' }]);
  expect(model.resultLines({ ok: false, error: 'Racing Desk is busy with another command: wait for it to finish, then try again' }))
    .toEqual([{ kind: 'error', text: 'Racing Desk is busy with another command: wait for it to finish, then try again.' }]);
  expect(model.resultLines(null)).toEqual([{ kind: 'error', text: 'The app did not answer.' }]);
});

test('the words: plain, no trial, no step codes', () => {
  const all = [model.UNDO, model.UNDO_ASK, model.FROM_THE_APP, ...model.SWITCHES.map((s) => s.label)];
  for (const s of all) {
    expect(s, s).not.toMatch(/\btrial\b/i);
    expect(s, s).not.toMatch(/\b(0a|0b|[ABC]\d{1,2})\b/);
  }
  expect(model.UNDO_ASK).toBe('This turns both off, takes Racing Desk’s profile and its F24 key out of SmartControl, and puts back the seat heights it kept in app.ini and the cars’ camera files. Close iRacing and the SmartControl editor first. Go on?');
});
