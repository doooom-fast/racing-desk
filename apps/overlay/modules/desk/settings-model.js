// The Settings page's model: which of the HUD's settings the desk edits, grouped and labelled, with the value
// each control shows for a given overlay-settings.json. Pure — no DOM, no bridge — so it runs in the desk and
// in the unit tests alike. Keys, defaults and choices follow modules/js/settings.js and config.js: a show*
// switch is on unless the file says false (applySettings' `!== false`), a missing key shows the HUD's default.
(function () {
  'use strict';

  const SWITCH = 'switch';
  const on = (key, label, hint) => ({ key, label, hint, type: SWITCH, def: true });

  // 'minimal-plus' is how older files spell 'minimal+'; the HUD accepts both, the desk shows one.
  const PRESET_ALIASES = { 'minimal-plus': 'minimal+' };

  const SETTINGS_SECTIONS = [
    {
      id: 'layout',
      title: 'Layout',
      fields: [
        {
          key: 'layoutPosition', label: 'Position', type: 'select', def: 'top-right',
          hint: 'Where the main HUD sits. The other panels place themselves around it.',
          options: [
            ['top-right', 'Top right'], ['top-left', 'Top left'],
            ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['centered', 'Centred'],
          ],
        },
        { key: 'zoom', label: 'Zoom', type: 'range', def: 165, min: 50, max: 250, step: 5, unit: '%', hint: 'Scale of every panel.' },
        {
          key: 'bottomYOffset', label: 'Bottom offset', type: 'number', def: 0, min: 0, max: 600, step: 10, unit: 'px',
          hint: 'Lifts the panels off the bottom edge. Only used by the bottom positions.',
        },
      ],
    },
    {
      id: 'modules',
      title: 'Modules',
      fields: [
        on('showControls', 'Controls', 'Wheel, gear and inputs.'),
        on('showPedals', 'Pedals', 'Throttle, brake and clutch traces.'),
        on('showPosition', 'Position and gaps'),
        on('showTacho', 'Tacho'),
        on('showMaps', 'Track map'),
        on('showTimer', 'Race timer'),
        on('showCommentary', 'Commentary'),
        on('showLeaderboard', 'Leaderboard'),
        on('showDatastream', 'Datastream'),
        on('showPitBox', 'Pit box'),
        on('showIncidents', 'Incidents'),
        on('showSpotter', 'Spotter'),
        on('showBonkers', 'Pit limiter', 'The flash while the limiter is on.'),
        on('showK10Logo', 'Racing Desk logo'),
        on('showCarLogo', 'Car logo'),
        on('showGameLogo', 'Game logo'),
      ],
    },
    {
      id: 'look',
      title: 'Look',
      fields: [
        {
          key: 'visualPreset', label: 'Visual preset', type: 'select', def: 'standard',
          hint: 'Minimal drops the effects and logos; Minimal+ keeps the ones driven by the data.',
          options: [['standard', 'Standard'], ['minimal', 'Minimal'], ['minimal+', 'Minimal+']],
          aliases: PRESET_ALIASES,
        },
        { key: 'theme', label: 'Theme', type: 'select', def: 'dark', options: [['dark', 'Dark'], ['light', 'Light']] },
        {
          key: 'ambientMode', label: 'Ambient light', type: 'select', def: 'reflective',
          hint: 'Glow behind the panels from the colours on screen.',
          options: [['off', 'Off'], ['auto', 'Auto'], ['reflective', 'Reflective']],
        },
        on('showBorders', 'Borders', 'Outlines on the panels.'),
        on('showWebGL', 'WebGL effects', 'Glare, bloom and vignette.'),
        {
          key: 'logoSubtitle', label: 'Logo subtitle', type: 'text', def: '', placeholder: 'none',
          hint: 'A short line under the Racing Desk logo.',
        },
      ],
    },
    {
      id: 'commentary',
      title: 'Commentary',
      fields: [
        {
          key: 'commentaryPromptDuration', label: 'Prompt duration', type: 'number', def: 15, min: 5, max: 120, step: 1, unit: 's',
          hint: 'How long a remark stays on screen.',
        },
        on('commentaryShowTopicTitle', 'Topic title', 'The topic above the remark.'),
        { ...on('commentaryEventOnlyMode', 'Events only', 'Nothing periodic — only when something happens.'), def: false },
        on('commentaryCatStrategy', 'Strategy'),
        on('commentaryCatTrack', 'Track'),
        on('commentaryCatRivals', 'Rivals'),
        on('commentaryCatBehavior', 'Behaviour'),
        on('commentaryCatHardware', 'Hardware'),
        on('commentaryCatGameFeel', 'Game feel'),
        on('commentaryCatCarResponse', 'Car response'),
        on('commentaryCatRacingExperience', 'Racing experience'),
        {
          key: 'coachTone', label: 'Coach tone', type: 'select', def: 'coach',
          hint: 'The voice of the post-race analysis.',
          options: [['broadcast', 'Broadcast commentator'], ['coach', 'Racing engineer'], ['mentor', 'Friendly mentor']],
        },
        {
          key: 'coachDepth', label: 'Coach depth', type: 'select', def: 'standard',
          hint: 'How far the analysis goes, and how much of your API budget it uses.',
          options: [['quick', 'Quick'], ['standard', 'Standard'], ['deep', 'Deep dive']],
        },
      ],
    },
  ];

  const FIELDS_BY_KEY = {};
  for (const section of SETTINGS_SECTIONS) for (const field of section.fields) FIELDS_BY_KEY[field.key] = field;

  function fieldFor(key) {
    return FIELDS_BY_KEY[key] || null;
  }

  // What the control for `field` shows for this settings file.
  function currentValue(field, settings) {
    const raw = settings ? settings[field.key] : undefined;
    switch (field.type) {
      case SWITCH:
        return field.def === false ? raw === true : raw !== false;
      case 'range':
      case 'number':
        return typeof raw === 'number' && !Number.isNaN(raw) ? raw : field.def;
      case 'select': {
        const v = field.aliases && raw in field.aliases ? field.aliases[raw] : raw;
        return field.options.some(([value]) => value === v) ? v : field.def;
      }
      default:
        return raw == null ? field.def : String(raw);
    }
  }

  function settingsView(settings) {
    return SETTINGS_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      fields: section.fields.map((field) => ({ ...field, value: currentValue(field, settings) })),
    }));
  }

  // What a control's value (a checkbox's checked, or an input's string) becomes in the file.
  function parseControlValue(field, raw) {
    switch (field.type) {
      case SWITCH:
        return raw === true || raw === 'true' || raw === 'on';
      case 'range':
      case 'number': {
        if (raw === '' || raw == null) return field.def;
        const n = Number(raw);
        if (Number.isNaN(n)) return field.def;
        return Math.min(field.max, Math.max(field.min, n));
      }
      case 'select':
        return field.options.some(([value]) => value === raw) ? raw : field.def;
      default:
        return String(raw == null ? '' : raw).trim();
    }
  }

  const api = { SETTINGS_SECTIONS, fieldFor, currentValue, settingsView, parseControlValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskSettingsModel = api;
})();
