// Settings → Cars: putting back each car's seat height and brakes (docs/view-and-pedals-plan.md), as the desk shows it — two
// rows, each a switch and how it stands in a sentence, and one undo. Pure — no DOM, no bridge — so it runs in the desk and in
// the unit tests alike; desk.js does the DOM and the asking (window.racingDesk.restore, which main.js answers from the app's
// host: modules/js/restore-api.js). The host keeps the switches and says how each part stands: working, waiting for
// something (said), or turned itself off (and why).
(function () {
  'use strict';

  const SWITCHES = [
    { key: 'brakes', label: 'Brakes put back for each car' },
    { key: 'height', label: 'Seat height put back for each car' },
  ];

  const UNDO = 'Undo what Racing Desk changed';
  const UNDO_ASK = 'This turns both off, takes Racing Desk’s profile and its F24 key out of SmartControl, and puts back the seat heights it kept in app.ini and the cars’ camera files. Close iRacing and the SmartControl editor first. Go on?';
  const FROM_THE_APP = 'This is switched from the Racing Desk app.';

  const isRow = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v) => (typeof v === 'string' ? v : '');

  // What the undo did, in lines: why it did nothing, what it did, what is left for him.
  function resultLines(result) {
    if (!isRow(result)) return [{ kind: 'error', text: 'The app did not answer.' }];
    const lines = [];
    if (result.ok === false && text(result.why || result.error)) lines.push({ kind: 'error', text: text(result.why || result.error) });
    for (const d of Array.isArray(result.did) ? result.did : []) if (text(d)) lines.push({ kind: 'did', text: d });
    for (const s of Array.isArray(result.saw) ? result.saw : []) if (text(s)) lines.push({ kind: result.ok === false ? 'error' : 'saw', text: s });
    if (!lines.length && result.ok !== false) lines.push({ kind: 'did', text: 'Done.' });
    return lines.map((l) => ({ ...l, text: /[.!?]$/.test(l.text) ? l.text : `${l.text}.` }));
  }

  /**
   * The card. `answer` is restore:read's ({ value } | { missing } | { error }); `inApp` whether there is an app to ask;
   * `undone` what the undo answered in this sitting; `busy` a command under way.
   */
  function card(answer, { inApp = true, undone = null, busy = false } = {}) {
    const value = isRow(answer) && isRow(answer.value) ? answer.value : null;
    let line = null;
    if (!inApp) line = FROM_THE_APP;
    else if (!answer) line = 'Asking the host…';
    else if (answer.missing) line = 'This host is older than the app: it does not put cars back yet.';
    else if (text(answer.error)) line = `The host could not be asked: ${answer.error}`;
    else if (!value || value.available !== true) line = text(value && value.why) || 'This host does not put cars back.';
    const ready = inApp && !!value && value.available === true;
    const switches = ready && isRow(value.switches) ? value.switches : {};
    const status = ready && isRow(value.status) ? value.status : {};
    return {
      line,
      ready,
      busy,
      rows: SWITCHES.map((sw) => {
        const s = isRow(status[sw.key]) ? status[sw.key] : {};
        return {
          key: sw.key,
          label: sw.label,
          value: ready ? switches[sw.key] === true : true,
          status: ready ? text(s.text) : '',
          state: ready ? text(s.state) : '',
          enabled: ready && !busy,
        };
      }),
      undo: { label: UNDO, enabled: ready && !busy && value.undo === true },
      undone: undone ? resultLines(undone) : [],
    };
  }

  const api = { SWITCHES, UNDO, UNDO_ASK, FROM_THE_APP, resultLines, card };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskRestoreModel = api;
})();
