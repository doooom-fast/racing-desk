// Settings → Cars and the Desk page's line: putting back each car's driver height and brakes (docs/view-and-pedals-plan.md),
// as the desk shows it. Pure — no DOM, no bridge — so it runs in the desk and in the unit tests alike; desk.js does the DOM
// and the asking (window.racingDesk.restore, which main.js answers from the app's host: modules/js/restore-api.js).
//
// The host is in trial in this build: it says what it would do and writes and presses nothing. The first run's buttons each
// run one step of the real code on his click, and his marks are what the build that acts will go by.
(function () {
  'use strict';

  // The three switches, as overlay-settings.json keeps them (restore-api.js switchesOf: the height and the brakes on unless
  // the file says false, the horizon off unless it says true).
  const SWITCHES = [
    {
      key: 'height', setting: 'restoreHeight', def: true,
      label: 'Put back each car’s driver height',
      hint: 'When you leave a car, the height you chose in it is kept in that car’s iRacing camera file, so iRacing puts it back when you get in; app.ini starts every car at −2.0 cm. Files are written only with iRacing closed.',
    },
    {
      key: 'brakes', setting: 'restoreBrakes', def: true,
      label: 'A brake profile for each car',
      hint: 'Each car gets its own SmartControl profile, from LightBrake or Default, at the force you last set in it with your keys, and SmartControl Live is switched to it (F24) when you get in, parked with the brake released. Your own profiles and keys are never changed.',
    },
    {
      key: 'horizon', setting: 'restoreHorizon', def: false,
      label: 'The horizon per car too',
      hint: 'Kept in the cockpit camera’s vertical shift — only once the first run shows that it adds to the horizon (B6). Off until then.',
    },
  ];

  const TRIAL = 'Trial — saying what it would do; nothing is written or pressed until the first run with you at the rig.';
  const FROM_THE_APP = 'This is switched from the Racing Desk app.';
  const NEEDS = { brakes: 'A4, A5, A6 and B2', height: 'B1, B4 and B5', horizon: 'B6' };

  const isRow = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v) => (typeof v === 'string' ? v : '');

  function switchesFrom(settings) {
    const s = isRow(settings) ? settings : {};
    const out = {};
    for (const sw of SWITCHES) out[sw.key] = sw.def ? s[sw.setting] !== false : s[sw.setting] === true;
    return out;
  }

  // The line under a switch: off, or in trial (with what the first run has proven), or acting.
  function stateLine(key, value, answer) {
    if (!value) return 'Off.';
    const gate = isRow(answer) && isRow(answer.gate) && isRow(answer.gate[key]) ? answer.gate[key] : null;
    if (gate && gate.acts === true) return 'On.';
    if (gate && gate.proven === true) return `Proven by the first run (${NEEDS[key]}). This build still only says what it would do; the next one acts.`;
    return `${TRIAL} It leaves trial once ${NEEDS[key]} have passed.`;
  }

  // What a press did, in lines: why it did nothing, what it did, what it saw.
  function resultLines(result) {
    if (!isRow(result)) return [{ kind: 'error', text: 'The app did not answer.' }];
    const lines = [];
    if (result.ok === false && text(result.why || result.error)) lines.push({ kind: result.refused ? 'refused' : 'error', text: text(result.why || result.error) });
    for (const d of Array.isArray(result.did) ? result.did : []) if (text(d)) lines.push({ kind: 'did', text: d });
    for (const s of Array.isArray(result.saw) ? result.saw : []) if (text(s)) lines.push({ kind: 'saw', text: s });
    if (!lines.length && result.ok !== false) lines.push({ kind: 'did', text: 'Done.' });
    return lines;
  }

  function stepView(step, results) {
    const actions = (Array.isArray(step.actions) ? step.actions : []).filter(isRow).map((a) => ({
      id: text(a.id),
      label: text(a.label),
      writes: a.writes === true,
      presses: a.presses === true,
      ran: isRow(a.ran) ? { at: text(a.ran.at), ok: a.ran.ok === true, result: text(a.ran.result) } : null,
      // What this press answered in this sitting, if it was pressed: said under it until the next press.
      said: results && results[a.id] ? resultLines(results[a.id]) : null,
    }));
    return {
      id: text(step.id),
      part: text(step.part),
      title: text(step.title),
      heDoes: text(step.heDoes),
      expected: text(step.expected),
      settles: text(step.settles),
      actions,
      mark: isRow(step.mark) && (step.mark.state === 'passed' || step.mark.state === 'failed') ? step.mark.state : null,
    };
  }

  // A press that writes one of his files or presses a key is asked again before it goes.
  function confirmText(action, step) {
    const what = [];
    if (action.writes) what.push(/A[2567]|B2/.test(step.id) ? 'writes SmartControl’s database (backed up first)' : 'writes iRacing’s view files (backed up first)');
    if (action.presses) what.push('presses F24 five seconds after you click — put the window the step names in front');
    return `${step.id} · ${action.label}: this ${what.join(' and ')}. Go on?`;
  }

  /**
   * The card. `answer` is restore:read's ({ value } | { missing } | { error }); `inApp` whether there is an app to ask;
   * `settings` overlay-settings.json as the desk read it; `results` what each press answered in this sitting; `busy` a press
   * under way.
   */
  function card(answer, { inApp = true, settings = {}, results = {}, busy = false } = {}) {
    const switches = switchesFrom(settings);
    const value = isRow(answer) && isRow(answer.value) ? answer.value : null;
    let line;
    if (!inApp) line = FROM_THE_APP;
    else if (!answer) line = 'Asking the host…';
    else if (answer.missing) line = 'This host is older than the app: it does not put cars back yet.';
    else if (text(answer.error)) line = `The host could not be asked: ${answer.error}`;
    else if (!value || value.available !== true) line = text(value && value.why) || 'This host does not put cars back.';
    else line = value.mode === 'on' ? 'On: Racing Desk puts each car’s height and brakes back.' : TRIAL;
    const ready = inApp && !!value && value.available === true;

    const steps = ready && isRow(value.firstRun) && Array.isArray(value.firstRun.steps) ? value.firstRun.steps.filter(isRow).map((s) => stepView(s, results)) : [];
    const parts = [];
    for (const step of steps) {
      const last = parts[parts.length - 1];
      if (last && last.part === step.part) last.steps.push(step);
      else parts.push({ part: step.part, steps: [step] });
    }
    const made = ready && isRow(value.made) ? value.made : {};
    const profiles = Array.isArray(made.profiles) ? made.profiles.length : 0;
    const heights = Array.isArray(made.heights) ? made.heights.length : 0;
    return {
      line,
      ready,
      switches: SWITCHES.map((sw) => ({
        ...sw,
        value: switches[sw.key],
        state: ready ? stateLine(sw.key, switches[sw.key], value) : null,
        enabled: inApp && !busy,
      })),
      undo: [
        {
          cmd: 'brakes', label: 'Remove the brake profiles Racing Desk made', enabled: ready && !busy && (profiles > 0 || isRow(made.switch)),
          hint: profiles || isRow(made.switch) ? `${profiles} car profile${profiles === 1 ? '' : 's'}${isRow(made.switch) ? ', the Racing Desk profile and F24' : ''}. Your own profiles, presets and keys stay. With the SmartControl editor closed.` : 'Racing Desk has made none.',
        },
        {
          cmd: 'heights', label: 'Undo everything Racing Desk changed', enabled: ready && !busy && (heights > 0 || typeof made.appIniOriginal === 'number'),
          hint: heights || typeof made.appIniOriginal === 'number' ? `${heights} camera file${heights === 1 ? '' : 's'} put back as they were, and app.ini’s height. With iRacing closed.` : 'Racing Desk has changed no file.',
        },
      ],
      plan: ready && isRow(value.plan) && Array.isArray(value.plan.lines) ? value.plan.lines.filter((l) => typeof l === 'string') : [],
      planError: ready && isRow(value.plan) && text(value.plan.error) ? value.plan.error : null,
      parts,
      firstRunIntro: 'Each button runs only that step, and only when you click it; one that writes or presses a key asks first. Mark each step passed or failed as you go. '
        + `Nothing leaves trial in this build: the brakes need ${NEEDS.brakes} passed, the height ${NEEDS.height}.`,
      busy,
    };
  }

  // The Desk page's line: the newest car's newest lines, as the HUD was told them ("Trial · Porsche 963 GTP, 14:38: brakes
  // 70 kg · height −2.0 cm (its camera file)"). Null while there is nothing to say.
  function lastAction(answer, { timeFormat } = {}) {
    const value = isRow(answer) && isRow(answer.value) ? answer.value : null;
    if (!value || value.available !== true || !Array.isArray(value.lines)) return null;
    const lines = value.lines.filter((l) => isRow(l) && l.hud === true && text(l.text) && text(l.car));
    if (!lines.length) return null;
    const newest = lines[lines.length - 1];
    const at = Date.parse(newest.at);
    // The same car's lines of the same moment (a car load says its brakes and its height together).
    const same = lines.filter((l) => l.car === newest.car && Math.abs(Date.parse(l.at) - at) < 120000);
    const trial = same.some((l) => /^Trial: /.test(l.text));
    const name = (() => {
      const m = /^(?:Trial: )?(?:brakes|height) (.+?) · /.exec(newest.text) || /for the (.+?) yet$/.exec(newest.text);
      return m ? m[1] : newest.car;
    })();
    const said = same.map((l) => l.text.replace(/^Trial: /, '').replace(` ${name} · `, ' ').replace(` for the ${name} yet`, ' yet'));
    const when = Number.isFinite(at) && typeof timeFormat === 'function' ? timeFormat(new Date(at)) : '';
    return { car: newest.car, name, trial, text: `${trial ? 'Trial · ' : ''}${name}${when ? `, ${when}` : ''}: ${said.join(' · ')}` };
  }

  const api = { SWITCHES, TRIAL, FROM_THE_APP, NEEDS, switchesFrom, stateLine, resultLines, stepView, confirmText, card, lastAction };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskRestoreModel = api;
})();
