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
});
