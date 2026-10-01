/**
 * The desk's Settings page model (modules/desk/settings-model.js): which of the HUD's keys it edits, what a
 * control shows for a given overlay-settings.json, and what a control's value becomes in the file.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { SETTINGS_SECTIONS, fieldFor, settingsView, parseControlValue } = require('../../modules/desk/settings-model.js');

const valueOf = (view, key) => view.flatMap((s) => s.fields).find((f) => f.key === key).value;

test.describe('settings model', () => {
  test('groups the HUD keys once each under Layout, Modules, Look and Commentary', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.title)).toEqual(['Layout', 'Modules', 'Look', 'Commentary']);
    const keys = SETTINGS_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
    expect(new Set(keys).size).toBe(keys.length);
    // Every panel applySettings shows or hides (modules/js/settings.js _MODULE_VISIBILITY) has a switch.
    for (const key of [
      'showControls', 'showPedals', 'showPosition', 'showTacho', 'showMaps', 'showTimer', 'showCommentary',
      'showLeaderboard', 'showDatastream', 'showPitBox', 'showIncidents', 'showSpotter', 'showK10Logo', 'showCarLogo', 'showGameLogo',
    ]) {
      expect(fieldFor(key) && fieldFor(key).type, key).toBe('switch');
    }
    // Recording stays out.
    expect(keys.filter((k) => /^recording|^replayBuffer/.test(k))).toEqual([]);
    expect(fieldFor('nope')).toBeNull();
  });

  test('shows the file where it has a value and the HUD default where it has none', () => {
    const view = settingsView({ zoom: 120, showSpotter: false, visualPreset: 'minimal-plus', commentaryEventOnlyMode: true, logoSubtitle: 'by DOOOOM' });
    expect(valueOf(view, 'zoom')).toBe(120);
    expect(valueOf(view, 'showSpotter')).toBe(false);
    expect(valueOf(view, 'showLeaderboard')).toBe(true);           // absent: on, as applySettings' `!== false` has it
    expect(valueOf(view, 'visualPreset')).toBe('minimal+');         // the older spelling of the same preset
    expect(valueOf(view, 'commentaryEventOnlyMode')).toBe(true);    // the one switch that defaults off
    expect(valueOf(view, 'layoutPosition')).toBe('top-right');
    expect(valueOf(view, 'logoSubtitle')).toBe('by DOOOOM');
  });

  test('a missing or empty file shows every default', () => {
    for (const file of [null, undefined, {}]) {
      for (const f of settingsView(file).flatMap((s) => s.fields)) expect(f.value, f.key).toEqual(f.def);
    }
  });

  test('a value the HUD would not understand shows the default instead', () => {
    const view = settingsView({ zoom: 'big', layoutPosition: 'top-centre', ambientMode: 7, coachDepth: null });
    expect(valueOf(view, 'zoom')).toBe(165);
    expect(valueOf(view, 'layoutPosition')).toBe('top-right');
    expect(valueOf(view, 'ambientMode')).toBe('reflective');
    expect(valueOf(view, 'coachDepth')).toBe('standard');
  });

  test('a control value becomes what the file should hold', () => {
    expect(parseControlValue(fieldFor('showSpotter'), true)).toBe(true);
    expect(parseControlValue(fieldFor('showSpotter'), false)).toBe(false);
    expect(parseControlValue(fieldFor('zoom'), '120')).toBe(120);
    expect(parseControlValue(fieldFor('zoom'), '9000')).toBe(250);                 // clamped to the range
    expect(parseControlValue(fieldFor('zoom'), '')).toBe(165);                     // cleared: the default
    expect(parseControlValue(fieldFor('commentaryPromptDuration'), '1')).toBe(5);
    expect(parseControlValue(fieldFor('bottomYOffset'), '-40')).toBe(0);
    expect(parseControlValue(fieldFor('layoutPosition'), 'bottom-left')).toBe('bottom-left');
    expect(parseControlValue(fieldFor('layoutPosition'), 'sideways')).toBe('top-right');
    expect(parseControlValue(fieldFor('logoSubtitle'), '  by DOOOOM ')).toBe('by DOOOOM');
    expect(parseControlValue(fieldFor('logoSubtitle'), null)).toBe('');
  });

  test('the panel background is a slider under Look, 90 by default (the panels as they were), 0 to 100 in fives; the OBS one is not here', () => {
    const field = fieldFor('panelBackground');
    expect(SETTINGS_SECTIONS.find((s) => s.id === 'look').fields.map((f) => f.key)).toContain('panelBackground');
    expect(field).toMatchObject({ type: 'range', def: 90, min: 0, max: 100, step: 5, unit: '%' });
    expect(field.hint).toMatch(/game show through/);
    expect(valueOf(settingsView({}), 'panelBackground')).toBe(90);
    expect(valueOf(settingsView({ panelBackground: 35 }), 'panelBackground')).toBe(35);
    expect(valueOf(settingsView({ panelBackground: 'none' }), 'panelBackground')).toBe(90);
    expect(parseControlValue(field, '0')).toBe(0);
    expect(parseControlValue(field, '150')).toBe(100);
    expect(parseControlValue(field, '')).toBe(90);
    // The slider for the HUD drawn by OBS is the Recording card's (recording-model.js), with the switch it belongs to.
    expect(fieldFor('obsPanelBackground')).toBeNull();
  });
  // ── The HUD's screen ──
  const SCREENS = {
    displays: [{ key: '2', name: '1440 × 1080 (left, primary)' }, { key: '1', name: '3440 × 1440 (right)' }],
    using: { name: '3440 × 1440 (right)', why: 'iRacing is running on it' },
  };
  const screenField = (view) => view.flatMap((s) => s.fields).find((f) => f.key === 'hudDisplay');

  test('the HUD screen is in Layout, Automatic by default, and without the app\'s answer offers Automatic alone', () => {
    expect(SETTINGS_SECTIONS[0].fields.map((f) => f.key)).toContain('hudDisplay');
    const field = screenField(settingsView({}));
    expect(field.value).toBe('auto');
    expect(field.options).toEqual([['auto', 'Automatic (the screen iRacing is on)']]);
    expect(field.note).toBeNull();
    // A choice in the file is no claim that a screen is missing when the app has not said which there are: it stays the
    // control's value, as itself, and can be changed to Automatic.
    const chosen = screenField(settingsView({ hudDisplay: '7' }));
    expect(chosen.note).toBeNull();
    expect(chosen.value).toBe('7');
    expect(chosen.options).toEqual([['auto', 'Automatic (the screen iRacing is on)'], ['7', 'The screen you chose']]);
  });

  test('with the screens the app names, each is offered and the note says where the HUD is', () => {
    const field = screenField(settingsView({ hudDisplay: '2' }, { hudScreens: SCREENS }));
    expect(field.options.map(([key]) => key)).toEqual(['auto', '2', '1']);
    expect(field.options.map(([, name]) => name)).toEqual([
      'Automatic (the screen iRacing is on)', '1440 × 1080 (left, primary)', '3440 × 1440 (right)',
    ]);
    expect(field.value).toBe('2');
    expect(field.note).toBe('Now on 3440 × 1440 (right): iRacing is running on it.');
  });

  test("a choice that is not connected stays the control's value, as an option that says so, so that Automatic can replace it", () => {
    const field = screenField(settingsView({ hudDisplay: '7' }, { hudScreens: SCREENS }));
    // Selected as itself: choosing Automatic is then a change like any other, and clears it from the file. (It showed
    // Automatic before, and choosing Automatic again fired no change, so the stale key stayed.)
    expect(field.value).toBe('7');
    expect(field.options).toEqual([
      ['auto', 'Automatic (the screen iRacing is on)'], ['2', '1440 × 1080 (left, primary)'], ['1', '3440 × 1440 (right)'],
      ['7', 'The screen you chose (not connected)'],
    ]);
    expect(field.note).toBe('The screen you chose is not connected, so the HUD follows iRacing until it is. Now on 3440 × 1440 (right): iRacing is running on it.');
    // The file's value is the model's to read, not to change: what a control's value becomes keeps the key.
    expect(parseControlValue(fieldFor('hudDisplay'), '7')).toBe('7');
    expect(parseControlValue(fieldFor('hudDisplay'), 'auto')).toBe('auto');
    expect(parseControlValue(fieldFor('hudDisplay'), '')).toBe('auto');
    expect(parseControlValue(fieldFor('hudDisplay'), null)).toBe('auto');
    // Once it is Automatic the extra option is gone, and a screen that is connected needs none.
    expect(screenField(settingsView({ hudDisplay: 'auto' }, { hudScreens: SCREENS })).options).toHaveLength(3);
    expect(screenField(settingsView({ hudDisplay: '1' }, { hudScreens: SCREENS })).options).toHaveLength(3);
  });

  test('a saved value that is not a screen\'s key reads as Automatic, and nothing an answer holds breaks the control', () => {
    for (const saved of [null, 5, true, {}, '', '  ']) expect(screenField(settingsView({ hudDisplay: saved })).value).toBe('auto');
    const junk = { displays: [null, { key: 3, name: 'x' }, { key: 'auto', name: 'again' }, { key: '1', name: '3440 × 1440 (right)' }], using: null };
    expect(screenField(settingsView({}, { hudScreens: junk })).options.map(([key]) => key)).toEqual(['auto', '1']);
    expect(screenField(settingsView({}, { hudScreens: { displays: 'no' } })).options).toHaveLength(1);
  });
});
