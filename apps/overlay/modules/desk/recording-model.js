// The Recording card's model and the masthead pill's: what the desk says of the recording for a status the app sends
// (main.js recordingStatus: the keeper's status with the folder, what Set up OBS has left to do, and the switches).
// Pure — no DOM, no bridge — so it runs in the desk and in the unit tests alike. Half the card is commands, not keys
// of the settings file, which is why it is not a section of settings-model.js.
//
// Every sentence here is a plain one, and one he can follow. OBS's own menus are pointed at once, to say where the
// password is when he has to type it; for everything else Set up OBS does what OBS needs.
(function () {
  'use strict';

  const SWITCHES = [
    { key: 'recordingAutoRecord', label: 'Record by itself', def: true, hint: 'In a race from the green flag; in practice and qualifying from pit exit. It stops on a new session, five seconds after the end of the race, and when you leave the car, and stops only the recordings it started. OBS has to be open already.' },
    { key: 'recordingInstantReplay', label: 'Instant replay', def: false, hint: "OBS's replay buffer runs while you are in the car. Ctrl+Shift+B, the tray or the Stream Deck saves the last 20 seconds as a clip, with its telemetry beside it." },
    { key: 'recordingChapters', label: 'Chapters', def: true, hint: 'A chapter in the video for each lap, incident, pit stop and place gained, which a player or editor can jump to. Hybrid MP4 only, which Set up OBS sets.' },
    { key: 'obsStartOnRecord', label: 'Start OBS when I press Record', def: true, hint: 'From the desk, the tray or the Stream Deck, out of the car. A key in the car never starts OBS: the HUD says "OBS is not open" instead.' },
    { key: 'obsStartWithApp', label: 'Start OBS with Racing Desk', def: false, hint: 'Off unless you turn it on. OBS opens minimised to the tray when Racing Desk starts.' },
  ];

  const NETWORK_SENTENCE = 'OBS then answers on port 4455 to anything on your network that knows the password.';
  const FROM_THE_APP = 'This is switched from the Racing Desk app.';

  function formatElapsed(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }

  function formatBytes(bytes) {
    const b = Number(bytes) || 0;
    if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
    if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
    return `${Math.round(b / 1e3)} kB`;
  }

  function formatHours(hours) {
    if (!Number.isFinite(hours)) return null;
    if (hours >= 48) return `${Math.round(hours / 24)} days`;
    if (hours >= 2) return `${Math.round(hours)} hours`;
    if (hours >= 1) return 'about an hour';
    const minutes = Math.round(hours * 60);
    return minutes <= 1 ? 'under a minute' : `${minutes} minutes`;
  }

  /** The one-line state of the recording, for the masthead and the top of the card. */
  function stateLine(status) {
    if (!status) return 'Recording';
    if (status.recording) return `Recording ${formatElapsed(status.elapsedMs)}`;
    if (status.starting || status.busy === 'starting') return 'Starting the recording…';
    if (status.stopping || status.busy === 'stopping') return 'Stopping…';
    if (status.busy === 'starting-obs') return 'Starting OBS…';
    switch (status.obs) {
      case 'open': return 'OBS is open, not recording';
      case 'authFailed': return 'OBS refused the password';
      case 'passwordMissing': return 'OBS wants a password';
      case 'connecting': return 'Looking for OBS…';
      default: return 'OBS is not open';
    }
  }

  /** The masthead's pill: a short state and one button, Record or Stop. Without the app it is there, disabled. */
  function pill(status, { inApp = true } = {}) {
    if (!inApp || !status) {
      return { text: 'Recording', state: 'off', detail: FROM_THE_APP, button: { label: 'Record', enabled: false, command: 'toggle' } };
    }
    const recordingNow = status.recording || status.starting;
    let state = 'off';
    if (status.recording) state = 'recording';
    else if (status.starting || status.stopping || status.busy) state = 'busy';
    else if (status.obs === 'open') state = 'ready';
    else if (status.obs === 'authFailed' || status.obs === 'passwordMissing') state = 'warn';
    const detail = status.recording && status.outputPath ? status.outputPath : stateLine(status);
    return {
      text: stateLine(status),
      state,
      detail,
      button: { label: recordingNow ? 'Stop' : 'Record', enabled: !status.busy, command: 'toggle' },
    };
  }

  /** What Set up OBS will change, in one sentence, from what it has left to do; null when nothing is missing. */
  function setupSentence(status) {
    const setup = status && status.setup;
    if (!setup || !setup.needed) return null;
    const parts = [];
    const wsOff = setup.wsEnabled !== true;
    if (wsOff) parts.push("switch on OBS's WebSocket");
    if (setup.hybrid !== true) parts.push('set your profile to Hybrid MP4');
    if (setup.replayBuffer !== true) parts.push('turn its 20 s replay buffer on');
    if (setup.folderSet !== true) parts.push(`point its recordings at ${status.folder}`);
    if (!parts.length) return null;
    const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    // His own Ctrl+Space recordings are made with the same profile: what changes for them is the format and the folder,
    // and only what is really changing is said (the replay buffer changes nothing of theirs).
    const theirs = [];
    if (setup.hybrid !== true) theirs.push('become Hybrid MP4');
    if (setup.folderSet !== true) theirs.push(`go to ${status.folder}`);
    const profile = theirs.length ? ` Your own Ctrl+Space recordings ${theirs.join(' and ')} too.` : '';
    return `Set up OBS will ${list}.${profile}${wsOff ? ' ' + NETWORK_SENTENCE : ''}`;
  }

  /** Where the last recording went, in one sentence; null while there is none to say. */
  function filedSentence(status) {
    const filed = status && status.lastFiled;
    if (!filed) return null;
    const bits = [];
    if (filed.chapters) bits.push(`${filed.chapters} ${filed.chapters === 1 ? 'chapter' : 'chapters'}`);
    if (filed.clips) bits.push(`${filed.clips} ${filed.clips === 1 ? 'replay' : 'replays'}`);
    const extra = bits.length ? ` (${bits.join(', ')})` : '';
    if (filed.folder) return `The last recording is in ${filed.folder}${extra}.`;
    return `The last recording stayed where OBS wrote it, ${filed.video}${filed.why ? `: ${filed.why}` : ''}.`;
  }

  /** The replay buffer, in one sentence; null when Instant replay is off. */
  function replaySentence(status) {
    const replay = status && status.replay;
    if (!replay || !replay.on) return null;
    if (replay.unavailable) return replay.unavailable;
    if (replay.running) return 'Instant replay is on: Ctrl+Shift+B, the tray or the Stream Deck saves the last seconds.';
    return 'Instant replay runs while you are in the car.';
  }

  /** The card: sentences, buttons and switches for a status, or the read-only card without the app. */
  function card(status, { inApp = true } = {}) {
    const switches = SWITCHES.map((s) => ({ ...s, value: status && typeof status[s.key] === 'boolean' ? status[s.key] : s.def, enabled: inApp && !!status }));
    if (!inApp || !status) {
      return {
        line: FROM_THE_APP,
        details: [],
        record: { label: 'Record', enabled: false },
        saveReplay: { show: false, enabled: false },
        openObs: { show: false, enabled: false },
        setup: { show: false, enabled: false, sentence: null },
        openFolder: { enabled: false },
        chooseFolder: { enabled: false },
        password: { show: false, hint: null },
        folder: status && status.folder ? status.folder : '',
        switches,
      };
    }
    const details = [];
    if (status.recording) {
      const bits = [];
      if (status.bytes) bits.push(formatBytes(status.bytes));
      if (status.chapters) bits.push(`${status.chapters} ${status.chapters === 1 ? 'chapter' : 'chapters'}`);
      if (status.outputPath) bits.push(status.outputPath);
      if (!status.owned) bits.push('started in OBS');
      else if (status.auto) bits.push('started by itself');
      if (bits.length) details.push(bits.join(' · '));
      if (status.sidecar) details.push(`Telemetry is being written beside it (${status.sidecar.frames} frames).${status.filed && status.filed.folder ? ` It goes to ${status.filed.folder} when it stops.` : ''}`);
      else details.push('No sim session is live, so no telemetry is written beside this one.');
    } else {
      const filed = filedSentence(status);
      if (filed) details.push(filed);
    }
    const replay = replaySentence(status);
    if (replay) details.push(replay);
    if (status.replay && status.replay.lastSaved && status.replay.lastSaved.path) details.push(`Replay saved: ${status.replay.lastSaved.path}`);
    if (status.lowDisk) details.push(status.lowDisk);
    if (status.last && status.last.ok === false && status.last.text) details.push(status.last.text);
    if (status.obs === 'authFailed') details.push("OBS refused the password Racing Desk has. Type the password from OBS's WebSocket settings below, or quit OBS and press Set up OBS.");
    if (status.obs === 'passwordMissing') details.push("OBS wants a password and Racing Desk has none. Type the password from OBS's WebSocket settings below, or quit OBS and press Set up OBS.");
    if (status.setup && status.setup.wsState === 'unreadable') details.push("OBS's WebSocket settings file could not be read. Type the password below.");
    if (status.setup && status.setup.obsFound === false) details.push('OBS was not found at C:\\Program Files\\obs-studio, so Racing Desk cannot start it. If you open OBS yourself, Racing Desk will find it.');
    if (status.free && Number.isFinite(status.free.hoursLeft)) {
      const left = formatHours(status.free.hoursLeft);
      details.push(`About ${left} of recording left on ${status.free.drive || 'the recording drive'} at ${Math.round((status.bytesPerSecond || 0) * 8 / 1e6)} Mbps.`);
    }
    const sentence = setupSentence(status);
    if (sentence) details.push(sentence);
    const recordingNow = status.recording || status.starting;
    const needsPassword = !!status.needsPassword || (status.setup && status.setup.wsState === 'unreadable');
    return {
      line: stateLine(status),
      details,
      record: { label: recordingNow ? 'Stop' : 'Record', enabled: !status.busy },
      saveReplay: { show: !!(status.replay && status.replay.on), enabled: !!(status.replay && status.replay.running) && !status.busy && status.obs === 'open' },
      openObs: { show: status.obs !== 'open', enabled: !status.busy },
      setup: { show: !!sentence || needsPassword, enabled: !status.busy && !status.recording, sentence },
      openFolder: { enabled: true },
      chooseFolder: { enabled: !status.recording },
      password: {
        show: needsPassword,
        hint: status.passwordTyped ? 'A password you typed is kept, protected by Windows. Leave the field empty and press Keep to go back to the one in OBS\'s file.' : "The password is in OBS under Tools, WebSocket Server Settings. It is kept protected by Windows and shown nowhere.",
      },
      folder: status.folder || '',
      switches,
    };
  }

  const api = { SWITCHES, NETWORK_SENTENCE, FROM_THE_APP, formatElapsed, formatBytes, formatHours, stateLine, pill, setupSentence, filedSentence, replaySentence, card };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskRecordingModel = api;
})();
