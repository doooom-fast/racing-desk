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
          // The screens are the app's to say (main.js get-hud-displays), so the choices are given to settingsView; the
          // one option here is what the file holds when nothing is chosen. A key is the screen's, as the app names it.
          key: 'hudDisplay', label: 'HUD screen', type: 'select', screens: true, def: 'auto',
          hint: 'Which screen the HUD is drawn on. Automatic is the screen iRacing is on.',
          options: [['auto', 'Automatic (the screen iRacing is on)']],
        },
        {
          key: 'layoutPosition', label: 'Position', type: 'select', def: 'top-right',
          hint: 'Where the main HUD sits. The other panels place themselves around it.',
          options: [
            ['top-right', 'Top right'], ['top-left', 'Top left'],
            ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'],
            ['top-center', 'Top centre'], ['bottom-center', 'Bottom centre'],
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
        on('showK10Logo', 'DOOOOM logo'),
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
          key: 'panelBackground', label: 'Panel background', type: 'range', def: 90, min: 0, max: 100, step: 5, unit: '%',
          hint: 'How solid the panels are behind the numbers, on the rig and on the iPad. Lower lets the game show through; the numbers get a soft shadow so they still read. The HUD drawn by OBS has a slider of its own, under Recording.',
        },
        {
          // modules/js/map-zoom.js has the modes and the curve; the same words here so the desk and the HUD agree.
          key: 'followMapZoom', label: 'Following map zoom', type: 'select', def: 'closer',
          hint: 'The local map that follows your car: closer in as your speed rises and out as it falls, or the other way round (that is the map as it was before this setting), or one view at every speed. On the rig, the iPad and in OBS alike.',
          options: [['closer', 'Closer at speed'], ['wider', 'Wider at speed'], ['fixed', 'Fixed']],
        },
        on('showBorders', 'Borders', 'Outlines on the panels.'),
        on('showWebGL', 'WebGL effects', 'Glare, bloom and vignette.'),
        {
          key: 'logoSubtitle', label: 'Logo subtitle', type: 'text', def: '', placeholder: 'none',
          hint: 'A short line under the DOOOOM logo.',
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
    // A screen is kept by the app's key for it, whatever is connected: a screen that is not there now is still the
    // choice, and is not lost by looking at the page.
    if (field.screens) return typeof raw === 'string' && raw.trim() ? raw.trim() : field.def;
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

  // The HUD screen's control, given the screens the app says are connected ({ displays: [{ key, name }], using:
  // { name, why } | null }, from main.js): Automatic and one option for each. A saved choice that is not one of them
  // stays the control's value, as an option of its own, "not connected" where the app has said which screens there are:
  // the HUD is following iRacing meanwhile and the file keeps the choice for when the screen is back, and choosing
  // Automatic is then a change like any other, which clears it.
  function screenField(field, saved, hudScreens) {
    const displays = hudScreens && Array.isArray(hudScreens.displays) ? hudScreens.displays : [];
    const options = [...field.options, ...displays.filter((d) => d && typeof d.key === 'string' && d.key !== field.def).map((d) => [d.key, String(d.name)])];
    const listed = options.some(([key]) => key === saved);
    // Said only when the app has said which screens there are: without its answer nothing is known to be missing.
    const missing = !!hudScreens && Array.isArray(hudScreens.displays) && saved !== field.def && !listed;
    if (saved !== field.def && !listed) options.push([saved, missing ? 'The screen you chose (not connected)' : 'The screen you chose']);
    const using = hudScreens && hudScreens.using;
    const notes = [];
    if (missing) notes.push('The screen you chose is not connected, so the HUD follows iRacing until it is.');
    if (using && using.name) notes.push(`Now on ${using.name}${using.why ? `: ${using.why}` : ''}.`);
    return { ...field, options, value: saved, note: notes.join(' ') || null };
  }

  // `extra.hudScreens` is what the app says of the screens; without it the HUD screen offers Automatic alone.
  function settingsView(settings, extra) {
    const hudScreens = extra && extra.hudScreens;
    return SETTINGS_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      fields: section.fields.map((field) => {
        const value = currentValue(field, settings);
        return field.screens ? screenField(field, value, hudScreens) : { ...field, value };
      }),
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
        // A screen's key is the app's to check: one that is not connected is kept, not turned into Automatic.
        if (field.screens) return typeof raw === 'string' && raw.trim() ? raw.trim() : field.def;
        return field.options.some(([value]) => value === raw) ? raw : field.def;
      default:
        return String(raw == null ? '' : raw).trim();
    }
  }

  const api = { SETTINGS_SECTIONS, fieldFor, currentValue, settingsView, parseControlValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskSettingsModel = api;
})();
