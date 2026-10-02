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
    { key: 'obsHudSource', label: 'HUD drawn by OBS', def: false, hint: "Off unless you turn it on. OBS draws the HUD itself, from a page Racing Desk serves on this PC, as a browser source named Racing Desk HUD in each of your scenes just above the game, and the HUD's own window is left out of your screen capture. Off, the HUD is in the picture through your screen capture, as before. Nothing of yours is removed either way." },
    { key: 'tvShotsHideFacecam', label: 'Hide the facecam during TV shots', def: true, hint: 'While a TV take is recorded your camera source is hidden in OBS, and shown again after.' },
  ];

  // What OBS draws with "HUD drawn by OBS" on: the choice under the switch (obsHudView), one sentence each.
  const HUD_VIEW = {
    key: 'obsHudView', label: 'What OBS draws', def: 'rig',
    options: [
      ['rig', 'Rig HUD', 'The HUD as it is on your screen, laid over the whole of the game video in each of your scenes.'],
      ['ipad', 'iPad dashboard', 'The glance layout the iPad shows, every panel in one grid, as a small source in the bottom-left corner of the game video, placed once; where you move or size it in OBS is yours, and the page lays itself out to the size you give it.'],
    ],
  };
  // How solid the panels are in the picture OBS draws, whichever it draws: a slider of its own, so the recording can be
  // clearer or more see-through than what he drives with (Settings → Look has the rig's and the iPad's).
  const OBS_PANEL_BACKGROUND = {
    key: 'obsPanelBackground', label: 'Panel background in OBS', def: 90, min: 0, max: 100, step: 5, unit: '%',
    hint: 'How solid the panels are in the picture OBS draws, with either choice. 90 is the panels as they have always been; lower lets the game show through, and the numbers get a soft shadow so they still read. The Look page\'s slider is what you drive with.',
  };

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

  /** "18 GB an hour" from a rate in bytes a second (one decimal under 10). */
  function formatGbPerHour(bytesPerSecond) {
    const gb = (Number(bytesPerSecond) || 0) * 3600 / 1e9;
    return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB an hour`;
  }

  /** The bitrate his profile is capped at, in Mbps, as the setup status says it (100 when it does not). */
  function capMbps(status) {
    const kbps = status && status.setup ? status.setup.capKbps : null;
    return Number.isFinite(kbps) && kbps > 0 ? Math.round(kbps / 1000) : 100;
  }

  /** The size the profile records at ("2580x1080"), as the setup status says it; null when it does not say. */
  function outputSize(status) {
    const size = status && status.setup ? status.setup.outputSize : null;
    return typeof size === 'string' && /^\d+x\d+$/.test(size) ? size : null;
  }

  /** The recordings' size change, while OBS is open and it has not been made: it waits for a run with OBS closed. */
  function sizeNextTimeSentence(status) {
    const setup = status && status.setup;
    if (!setup || setup.qualityTarget !== false || status.obs !== 'open') return null;
    const size = outputSize(status);
    return `The size change (a quality target instead of a fixed ${capMbps(status)} Mbps${size ? `; the recordings stay ${size}` : ''}) happens the next time Set up OBS runs with OBS closed.`;
  }

  /**
   * How much recording is left on the drive, in one sentence, at the rate in use: OBS's own while recording; the real
   * rate of his recordings, measured from the files, once there is one; until then the bitrate the profile is capped
   * at — and with a quality target that cap is the most it can be, so the hours are that many or more, said without
   * a word of the rate until a recording has said what it is.
   */
  function hoursLeftSentence(status) {
    if (!status || !status.free || !Number.isFinite(status.free.hoursLeft)) return null;
    const left = formatHours(status.free.hoursLeft);
    const drive = status.free.drive || 'the recording drive';
    const measured = status.measured;
    if (status.rateFrom === 'measured' && measured && measured.recordings > 0) {
      const from = measured.recordings === 1 ? 'your last recording' : `your last ${measured.recordings} recordings`;
      return `About ${left} of recording left on ${drive} at ${formatGbPerHour(measured.bytesPerSecond)}, measured from ${from}.`;
    }
    if (status.rateFrom === 'configured' && status.setup && status.setup.qualityTarget === true) {
      return `About ${left} or more of recording left on ${drive}.`;
    }
    return `About ${left} of recording left on ${drive} at ${Math.round((status.bytesPerSecond || 0) * 8 / 1e6)} Mbps.`;
  }

  /** The TV shots under way, in a few words; null when none are. */
  function tvLine(status) {
    const tv = status && status.tv;
    if (!tv || !tv.running) return null;
    if (tv.step === 'preparing') return 'TV shots: getting ready';
    if (tv.step === 'cancelling') return 'TV shots: stopping';
    if (tv.step === 'filing') return 'TV shots: filing the take';
    return `TV shots ${tv.index || 0} of ${tv.total || 0}`;
  }

  /** What the last TV shots came to, in one sentence; null when there is nothing to say. */
  function tvSentence(status) {
    const tv = status && status.tv;
    if (!tv) return null;
    if (tv.running) {
      const label = tv.label ? ` — ${tv.label}` : '';
      if (tv.step === 'seeking') return `TV shots: finding moment ${tv.index} of ${tv.total} in the replay${label}.`;
      if (tv.step === 'recording') return `TV shots: recording moment ${tv.index} of ${tv.total}${label}.`;
      if (tv.step === 'skipped') return `TV shots: moment ${tv.index} of ${tv.total} is not in the replay, so it is skipped${label}.`;
      return `${tvLine(status)}.`;
    }
    const r = tv.result;
    if (!r) return null;
    const missed = r.skipped > 0 ? ` (${r.skipped} ${r.skipped === 1 ? 'was' : 'were'} not in the replay)` : '';
    if (r.ok) return `TV shots done: ${r.moments} ${r.moments === 1 ? 'moment' : 'moments'}${missed}${r.video ? `, in ${r.video}` : ''}.`;
    if (r.cancelled) return `TV shots stopped after ${r.moments} ${r.moments === 1 ? 'moment' : 'moments'}${r.video ? `; what was recorded is in ${r.video}` : ''}.`;
    return `TV shots were not made: ${r.reason}`;
  }

  /** The one-line state of the recording, for the masthead and the top of the card. */
  function stateLine(status) {
    if (!status) return 'Recording';
    const tv = tvLine(status);
    if (tv) return tv;
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
    // TV shots under way: the pill is theirs, and its one button stops them.
    if (status.tv && status.tv.running) {
      return { text: stateLine(status), state: 'busy', detail: tvSentence(status), button: { label: 'Stop', enabled: status.tv.step !== 'cancelling', command: 'tvShotsCancel' } };
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
    else if (setup.replaySeconds === false) parts.push('set its replay buffer to 20 s');
    if (setup.folderSet !== true) parts.push(`point its recordings at ${status.folder}`);
    // The recordings' size is set in a file OBS writes from memory, so only with OBS closed: while it is open the card
    // says so in a sentence of its own (sizeNextTimeSentence) and the button's sentence leaves it out.
    const size = setup.qualityTarget === false && status.obs !== 'open';
    if (size) {
      const at = outputSize(status);
      parts.push(`${at ? `keep its recordings at ${at} with` : 'give its recordings'} a quality target instead of a fixed ${capMbps(status)} Mbps`);
    }
    if (!parts.length) return null;
    const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    // His own Ctrl+Space recordings are made with the same profile: what changes for them is the format, the folder and
    // the size, and only what is really changing is said (the replay buffer changes nothing of theirs).
    const theirs = [];
    if (setup.hybrid !== true) theirs.push('become Hybrid MP4');
    if (setup.folderSet !== true) theirs.push(`go to ${status.folder}`);
    if (size) theirs.push('keep their size with a quality target');
    const joined = theirs.length <= 1 ? theirs.join('') : `${theirs.slice(0, -1).join(', ')} and ${theirs[theirs.length - 1]}`;
    const profile = theirs.length ? ` Your own Ctrl+Space recordings ${joined} too.` : '';
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

  /** What "HUD drawn by OBS" has done, in one sentence, while the switch is on. */
  function hudSourceSentence(status) {
    const hs = status && status.hudSource;
    const last = hs && hs.last;
    const what = status.obsHudView === 'ipad' ? 'the iPad dashboard' : 'the HUD';
    if (status.obs !== 'open') return `HUD drawn by OBS: ${what} goes into your scenes when OBS opens.`;
    if (!last) return `HUD drawn by OBS: ${what} is being put into your scenes.`;
    if (last.problems && last.problems.length) return `HUD drawn by OBS: ${last.problems.join(' ')}`;
    return `HUD drawn by OBS: ${last.did || `${what} is in your scenes.`}`;
  }

  /** The choice of what OBS draws, as the card shows it: the file's word, or Rig HUD. */
  function hudViewOf(status) {
    return status && HUD_VIEW.options.some(([value]) => value === status.obsHudView) ? status.obsHudView : HUD_VIEW.def;
  }

  /** The OBS panel-background slider's value, as the card shows it: the file's number, held to the slider, or 90. */
  function obsPanelBackgroundOf(status) {
    const n = status ? status.obsPanelBackground : undefined;
    if (typeof n !== 'number' || Number.isNaN(n)) return OBS_PANEL_BACKGROUND.def;
    return Math.min(OBS_PANEL_BACKGROUND.max, Math.max(OBS_PANEL_BACKGROUND.min, n));
  }

  /** The card: sentences, buttons and switches for a status, or the read-only card without the app. */
  function card(status, { inApp = true } = {}) {
    const switches = SWITCHES.map((s) => ({ ...s, value: status && typeof status[s.key] === 'boolean' ? status[s.key] : s.def, enabled: inApp && !!status }));
    const view = { ...HUD_VIEW, value: hudViewOf(status), enabled: inApp && !!status };
    const panelBackground = { ...OBS_PANEL_BACKGROUND, value: obsPanelBackgroundOf(status), enabled: inApp && !!status };
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
        view,
        panelBackground,
      };
    }
    const details = [];
    if (status.recording) {
      const bits = [];
      if (status.bytes) bits.push(formatBytes(status.bytes));
      if (status.chapters) bits.push(`${status.chapters} ${status.chapters === 1 ? 'chapter' : 'chapters'}`);
      if (status.outputPath) bits.push(status.outputPath);
      if (!status.owned) bits.push('started in OBS');
      else if (status.kind === 'tv') bits.push('a TV take');
      else if (status.auto) bits.push('started by itself');
      if (bits.length) details.push(bits.join(' · '));
      if (status.sidecar) details.push(`Telemetry is being written beside it (${status.sidecar.frames} frames).${status.filed && status.filed.folder ? ` It goes to ${status.filed.folder} when it stops.` : ''}`);
      else details.push('No sim session is live, so no telemetry is written beside this one.');
    } else {
      const filed = filedSentence(status);
      if (filed) details.push(filed);
    }
    const tvSaid = tvSentence(status);
    if (tvSaid) details.push(tvSaid);
    const replay = replaySentence(status);
    if (replay) details.push(replay);
    if (status.replay && status.replay.lastSaved && status.replay.lastSaved.path) details.push(`Replay saved: ${status.replay.lastSaved.path}`);
    if (status.lowDisk) details.push(status.lowDisk);
    if (status.obsHudSource === true) details.push(hudSourceSentence(status));
    if (status.last && status.last.ok === false && status.last.text) details.push(status.last.text);
    if (status.obs === 'authFailed') details.push("OBS refused the password Racing Desk has. Type the password from OBS's WebSocket settings below, or quit OBS and press Set up OBS.");
    if (status.obs === 'passwordMissing') details.push("OBS wants a password and Racing Desk has none. Type the password from OBS's WebSocket settings below, or quit OBS and press Set up OBS.");
    if (status.setup && status.setup.wsState === 'unreadable') details.push("OBS's WebSocket settings file could not be read. Type the password below.");
    if (status.setup && status.setup.obsFound === false) details.push('OBS was not found at C:\\Program Files\\obs-studio, so Racing Desk cannot start it. If you open OBS yourself, Racing Desk will find it.');
    const hoursLeft = hoursLeftSentence(status);
    if (hoursLeft) details.push(hoursLeft);
    const sizeNextTime = sizeNextTimeSentence(status);
    if (sizeNextTime) details.push(sizeNextTime);
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
      view,
      panelBackground,
    };
  }

  /** The race detail's TV shots: the button and its line, for a race's recording as the app found it (or none). */
  function raceTv(status, recording) {
    const running = !!(status && status.tv && status.tv.running);
    if (!recording) return { show: false, line: 'No recording of this race was found in the recordings folder.', button: null };
    const line = `Recording: ${recording.name}${recording.take ? ' (TV shots made)' : ''}${recording.clips ? ` · ${recording.clips} ${recording.clips === 1 ? 'replay' : 'replays'}` : ''}`;
    if (running) return { show: true, line, button: { label: 'Stop TV shots', command: 'tvShotsCancel', enabled: status.tv.step !== 'cancelling' } };
    const canStart = !!status && status.obs === 'open' && !status.recording && !status.starting && !status.busy;
    return { show: true, line, button: { label: recording.take ? 'TV shots again' : 'TV shots', command: 'tvShots', enabled: canStart, hint: canStart ? "From iRacing's replay of this race, through a TV camera, into this recording's folder." : 'Needs OBS open and nothing recording.' } };
  }

  const api = { SWITCHES, HUD_VIEW, OBS_PANEL_BACKGROUND, NETWORK_SENTENCE, FROM_THE_APP, formatElapsed, formatBytes, formatHours, formatGbPerHour, stateLine, pill, setupSentence, sizeNextTimeSentence, hoursLeftSentence, filedSentence, replaySentence, hudSourceSentence, hudViewOf, obsPanelBackgroundOf, tvLine, tvSentence, raceTv, card };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskRecordingModel = api;
})();
