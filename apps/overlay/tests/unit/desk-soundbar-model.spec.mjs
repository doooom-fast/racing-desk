// Settings → Sound (modules/desk/soundbar-model.js): one switch, the choice of the sound bar, and one sentence on what was done
// last and when — what the card says for each answer of the host.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('../../modules/desk/soundbar-model.js');

const BAR = { id: '{0.0.0.00000000}.{sound-bar}', name: 'Speakers (SineAudio DS6301M Plus V1.23)' };
const PODS = { id: '{0.0.0.00000000}.{air-pods}', name: 'Headphones (Kevin\'s AirPods Max)' };

// Local times, so the words do not depend on the machine's zone.
const NOW = new Date(2026, 9, 7, 15, 0, 0);
const at = (y, m, d, h, min) => new Date(y, m, d, h, min, 0).toISOString();
const FORMAT = { time: (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`, date: (d) => `${d.getDate()} Oct` };

const ANSWER = {
  value: {
    available: true,
    enabled: true,
    device: { ...BAR, connected: true },
    devices: [BAR, PODS],
    onSoundBar: true,
    status: { state: 'working', last: 'Turned iRacing\'s LFE off for the sound bar.', lastAtUtc: at(2026, 9, 7, 14, 30), waiting: null, problem: null },
  },
};

const card = (answer, extra = {}) => model.card(answer, { now: NOW, format: FORMAT, ...extra });

test('the switch is on by default and worded as he asked; the sentence says what was done last and when', () => {
  const view = card(ANSWER);
  expect(view.title).toBe('Sound');
  expect(view.line).toBeNull();
  expect(view.ready).toBe(true);
  expect(view.switch).toEqual({ label: 'Turn iRacing\'s LFE off on the sound bar', value: true, enabled: true });
  expect(view.status).toEqual({ state: 'working', text: 'Turned iRacing\'s LFE off for the sound bar, today at 14:30.' });
});

test('the device list is the active playback devices, with the sound bar picked', () => {
  const view = card(ANSWER);
  expect(view.device.label).toBe('Sound bar');
  expect(view.device.options).toEqual([
    { id: BAR.id, label: BAR.name, selected: true, disabled: false },
    { id: PODS.id, label: PODS.name, selected: false, disabled: false },
  ]);
  expect(view.device.note).toBe('');
  expect(view.device.enabled).toBe(true);
});

test('a sound bar that is away is still his choice, said as not connected; none found offers a prompt and says what to do', () => {
  const away = JSON.parse(JSON.stringify(ANSWER));
  away.value.devices = [PODS];
  away.value.device.connected = false;
  const view = card(away);
  expect(view.device.options.map((o) => [o.label, o.selected])).toEqual([[PODS.name, false], [`${BAR.name} (not connected)`, true]]);
  expect(view.device.note).toBe('');

  const none = JSON.parse(JSON.stringify(ANSWER));
  none.value.devices = [PODS];
  none.value.device = null;
  const lost = card(none);
  expect(lost.device.options[0]).toEqual({ id: '', label: 'Choose the sound bar', selected: true, disabled: true });
  expect(lost.device.options).toHaveLength(2);
  expect(lost.device.note).toBe('Windows doesn\'t list the sound bar right now. Choose it from the list once it is connected.');
});

test('the sentence: a problem first, then what it waits for, then the last thing with its day, then why nothing yet', () => {
  const withStatus = (status, enabled = true) => {
    const a = JSON.parse(JSON.stringify(ANSWER));
    a.value.enabled = enabled;
    a.value.status = { state: 'idle', last: null, lastAtUtc: null, waiting: null, problem: null, ...status };
    return card(a).status;
  };
  expect(withStatus({ problem: 'iRacing\'s LFE couldn\'t be changed: the backup could not be made.', waiting: 'Waiting for iRacing to close, to turn its LFE off for the sound bar.', state: 'problem' }))
    .toEqual({ state: 'problem', text: 'iRacing\'s LFE couldn\'t be changed: the backup could not be made.' });
  expect(withStatus({ waiting: 'Waiting for iRacing to close, to turn its LFE off for the sound bar.', state: 'waiting' }))
    .toEqual({ state: 'waiting', text: 'Waiting for iRacing to close, to turn its LFE off for the sound bar.' });
  expect(withStatus({ last: 'Put iRacing\'s LFE back as it was.', lastAtUtc: at(2026, 9, 6, 22, 5) }).text).toBe('Put iRacing\'s LFE back as it was, yesterday at 22:05.');
  expect(withStatus({ last: 'Put iRacing\'s LFE back as it was.', lastAtUtc: at(2026, 8, 30, 9, 0) }).text).toBe('Put iRacing\'s LFE back as it was, 30 Oct at 9:00.');
  expect(withStatus({}).text).toBe('Nothing changed yet: iRacing\'s LFE goes off when the sound bar becomes your speakers.');
  expect(withStatus({}, false)).toEqual({ state: 'off', text: 'Switched off: iRacing\'s LFE is left as you set it.' });
  expect(withStatus({ last: 'Left iRacing\'s LFE as you set it.', lastAtUtc: 'not a time' }).text).toBe('Left iRacing\'s LFE as you set it.');
});

test('every word is sentence case and plain: no jargon, no step codes, no trial', () => {
  const view = card(ANSWER);
  const words = [view.title, view.switch.label, view.device.label, view.status.text].join(' ');
  expect(words).not.toMatch(/\b(trial|endpoint|COM|IMM|ini|xa2)\b/i);
  expect(words.replace(/LFE/g, '')).not.toMatch(/\b[A-Z]{2,}\b/);
  expect(model.CHOOSE).toBe('Choose the sound bar');
});

test('without the app, or without an answer, the card says why and nothing can be switched', () => {
  const away = card(null, { inApp: false });
  expect(away.line).toBe('This is switched from the Racing Desk app.');
  expect(away.switch.enabled).toBe(false);
  expect(away.device.enabled).toBe(false);
  expect(card(null).line).toBe('Asking the host…');
  expect(card({ missing: true }).line).toBe('This host is older than the app: it does not watch the sound bar yet.');
  expect(card({ error: 'Nothing is answering at 127.0.0.1:18889.' }).line).toBe('The host could not be asked: Nothing is answering at 127.0.0.1:18889.');
  expect(card({ value: { available: false, why: 'this host does not watch the playback device' } }).line).toBe('this host does not watch the playback device');
  expect(card({ value: { available: false } }).line).toBe('This host does not watch the sound bar.');
});

test('nothing can be switched while a command runs, and what a command could not do is said', () => {
  const busy = card(ANSWER, { busy: true });
  expect(busy.switch.enabled).toBe(false);
  expect(busy.device.enabled).toBe(false);
  expect(model.saidBy({ ok: true })).toBe('');
  expect(model.saidBy({ ok: false, why: 'Windows doesn\'t list that device now' })).toBe('Windows doesn\'t list that device now');
  expect(model.saidBy({ ok: false, error: 'The host answered 500.' })).toBe('The host answered 500.');
  expect(model.saidBy(null)).toBe('The app did not answer.');
  expect(card(ANSWER, { said: 'Windows doesn\'t list that device now' }).said).toBe('Windows doesn\'t list that device now');
});

test('when: today, yesterday, or the day', () => {
  expect(model.when(at(2026, 9, 7, 8, 5), NOW, FORMAT)).toBe('today at 8:05');
  expect(model.when(at(2026, 9, 6, 23, 59), NOW, FORMAT)).toBe('yesterday at 23:59');
  expect(model.when(at(2026, 9, 1, 12, 0), NOW, FORMAT)).toBe('1 Oct at 12:00');
  expect(model.when(null, NOW, FORMAT)).toBe('');
  expect(model.when('nonsense', NOW, FORMAT)).toBe('');
});
