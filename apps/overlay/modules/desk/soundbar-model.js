// Settings → Sound: iRacing's LFE off while the sound bar is the speakers, as the desk shows it — one switch, the choice of which
// playback device is the sound bar, and one sentence on what Racing Desk did last and when. Pure — no DOM, no bridge — so it runs
// in the desk and in the unit tests alike; desk.js does the DOM and the asking (window.racingDesk.soundBar, which main.js answers
// from the app's host: modules/js/soundbar-api.js). The host keeps the switch and the choice and says how it stands.
(function () {
  'use strict';

  const TITLE = 'Sound';
  const SWITCH_LABEL = "Turn iRacing's LFE off on the sound bar";
  const DEVICE_LABEL = 'Sound bar';
  const NO_DEVICE_HINT = "Windows doesn't list the sound bar right now. Choose it from the list once it is connected.";
  const CHOOSE = 'Choose the sound bar';
  const NOT_CONNECTED = 'not connected';
  const FROM_THE_APP = 'This is switched from the Racing Desk app.';
  const NOTHING_YET = "Nothing changed yet: iRacing's LFE goes off when the sound bar becomes your speakers.";
  const SWITCHED_OFF = "Switched off: iRacing's LFE is left as you set it.";

  const isRow = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v) => (typeof v === 'string' ? v : '');
  const sameId = (a, b) => text(a).toLowerCase() === text(b).toLowerCase();

  const defaultFormat = {
    time: (d) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d),
    date: (d) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(d),
  };

  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  // When, in words: "today at 2:30 pm", "yesterday at 2:30 pm", "7 Oct at 2:30 pm". Empty for a time that is not one.
  function when(iso, now = new Date(), format = defaultFormat) {
    const at = new Date(iso);
    if (!iso || Number.isNaN(at.getTime())) return '';
    const fmt = { ...defaultFormat, ...format };
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    if (sameDay(at, now)) return `today at ${fmt.time(at)}`;
    if (sameDay(at, yesterday)) return `yesterday at ${fmt.time(at)}`;
    return `${fmt.date(at)} at ${fmt.time(at)}`;
  }

  // The one sentence: what is wrong, or what it waits for, or what it did last and when, or why it has done nothing.
  function statusSentence(status, enabled, now, format) {
    const problem = text(status.problem).trim();
    if (problem) return { state: 'problem', text: problem };
    const waiting = text(status.waiting).trim();
    if (waiting) return { state: 'waiting', text: waiting };
    const last = text(status.last).trim();
    if (last) {
      const at = when(status.lastAtUtc, now, format);
      const sentence = last.replace(/[.!?]+$/, '');
      return { state: text(status.state), text: at ? `${sentence}, ${at}.` : `${sentence}.` };
    }
    return enabled ? { state: 'idle', text: NOTHING_YET } : { state: 'off', text: SWITCHED_OFF };
  }

  // The playback devices Windows lists, with the one taken for the sound bar picked; a chosen one that is away is still listed.
  function deviceChoice(value) {
    const listed = (Array.isArray(value.devices) ? value.devices : []).filter((d) => isRow(d) && text(d.id)).map((d) => ({ id: d.id, name: text(d.name) || d.id }));
    const chosen = isRow(value.device) && text(value.device.id) ? value.device : null;
    const options = listed.map((d) => ({ id: d.id, label: d.name, selected: !!chosen && sameId(d.id, chosen.id), disabled: false }));
    if (chosen && !options.some((o) => o.selected)) {
      options.push({ id: chosen.id, label: `${text(chosen.name) || chosen.id} (${NOT_CONNECTED})`, selected: true, disabled: false });
    }
    if (!chosen) options.unshift({ id: '', label: CHOOSE, selected: true, disabled: true });
    return { options, note: chosen ? '' : NO_DEVICE_HINT };
  }

  /**
   * The card. `answer` is soundbar:read's ({ value } | { missing } | { error }); `inApp` whether there is an app to ask; `busy` a
   * command under way; `said` what the last command answered when it could not be done; `now` and `format` for the time.
   */
  function card(answer, { inApp = true, busy = false, said = '', now = new Date(), format = defaultFormat } = {}) {
    const value = isRow(answer) && isRow(answer.value) ? answer.value : null;
    let line = null;
    if (!inApp) line = FROM_THE_APP;
    else if (!answer) line = 'Asking the host…';
    else if (answer.missing) line = 'This host is older than the app: it does not watch the sound bar yet.';
    else if (text(answer.error)) line = `The host could not be asked: ${answer.error}`;
    else if (!value || value.available !== true) line = text(value && value.why) || 'This host does not watch the sound bar.';
    const ready = inApp && !!value && value.available === true;
    const enabled = ready ? value.enabled !== false : true;
    const choice = ready ? deviceChoice(value) : { options: [], note: '' };
    const status = ready ? statusSentence(isRow(value.status) ? value.status : {}, enabled, now, format) : { state: '', text: '' };
    return {
      title: TITLE,
      line,
      ready,
      busy,
      said: text(said),
      switch: { label: SWITCH_LABEL, value: enabled, enabled: ready && !busy },
      device: { label: DEVICE_LABEL, options: choice.options, note: choice.note, enabled: ready && !busy && choice.options.length > 0 },
      status,
    };
  }

  // What a command that could not be done says, in words; empty when it was done.
  function saidBy(result) {
    if (!isRow(result)) return 'The app did not answer.';
    if (result.ok !== false) return '';
    return text(result.why || result.error) || 'That could not be done.';
  }

  const api = { TITLE, SWITCH_LABEL, DEVICE_LABEL, CHOOSE, NOT_CONNECTED, FROM_THE_APP, NOTHING_YET, SWITCHED_OFF, when, card, saidBy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskSoundBarModel = api;
})();
