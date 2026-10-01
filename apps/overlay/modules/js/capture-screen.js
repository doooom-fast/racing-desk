// Which screen a recording is of. The HUD's page asks for one with getDisplayMedia (recorder.js), and the main process
// grants a screen without a picker (setDisplayMediaRequestHandler in main.js). It used to grant the first screen
// desktopCapturer listed, which is not the sim's on a rig whose screens are listed the other way round. The recording
// is of the race, so it is now the screen the sim is on while it runs — and the screen the HUD is on otherwise, which
// is where the HUD's rule (hud-display.js) puts it — by its key, matched to the capturer's sources by their
// `display_id`, which on Windows is Electron's `display.id` as text, the same as hud-display's key for a screen. The
// first screen is what is granted while nothing is known yet (the rule has not run) and when no source is that
// screen (it has gone since the rule last ran, or the platform gives no display_id).
//
// Pure: the sources and the key are handed in, so it is tested without Electron (tests/unit/capture-screen.spec.mjs).

// The source to record from { source, matched }: the one whose display_id is the key, else the first. `source` is
// null when there is none to record.
function pickScreenSource(sources, displayKey) {
  const list = Array.isArray(sources) ? sources.filter((s) => s && typeof s === 'object') : [];
  if (!list.length) return { source: null, matched: false };
  const key = typeof displayKey === 'string' || typeof displayKey === 'number' ? String(displayKey).trim() : '';
  const own = key ? list.find((s) => (typeof s.display_id === 'string' || typeof s.display_id === 'number') && String(s.display_id) === key) : null;
  return own ? { source: own, matched: true } : { source: list[0], matched: false };
}

/**
 * The handler for session.setDisplayMediaRequestHandler.
 *
 *   getSources()      resolves desktopCapturer's screens
 *   getDisplayKey()   the screen to record, from hudScreen.recordScreen(): { key, reason } — reason `sim` where it is
 *                     the screen the sim is on, else `hud` — or a bare key (the HUD's), or null
 *   log(line)
 *
 * Grants that screen, with the system's sound, and says in the log which screen it was and why; a screen that
 * cannot be found, or a lookup that fails, is refused ({ video: null }), as before.
 */
function createDisplayMediaHandler({ getSources, getDisplayKey = () => null, log = () => {} }) {
  return async function handleDisplayMediaRequest(_request, callback) {
    try {
      const sources = await getSources();
      let key = null;
      let whose = "HUD's";
      try {
        const asked = getDisplayKey();
        if (asked && typeof asked === 'object') {
          key = asked.key;
          if (asked.reason === 'sim') whose = "sim's";
        } else {
          key = asked;
        }
      } catch (e) {
        key = null;
      }
      const { source, matched } = pickScreenSource(sources, key);
      if (!source) {
        log('[RacingDesk] Screen recording: there is no screen to record');
        callback({ video: null });
        return;
      }
      // Where none matches, the key and the sources' display_ids are said: a platform whose ids do not agree with
      // Electron's screens would otherwise record the first screen every time with nothing to show why.
      const ids = sources.map((s) => (s && (typeof s.display_id === 'string' || typeof s.display_id === 'number') && String(s.display_id) !== '' ? String(s.display_id) : '?')).join(', ');
      const which = matched ? `the ${whose} screen`
        : key === null || key === undefined ? 'the first screen: the HUD has no screen yet'
        : `the first screen: none of the screens is the ${whose} (the ${whose} is ${key}; the screens are ${ids})`;
      log(`[RacingDesk] Screen recording: ${which} (${source.name || source.id || 'unnamed'})`);
      callback({ video: source, audio: 'loopback' });
    } catch (err) {
      log(`[RacingDesk] Display media handler error: ${err.message}`);
      callback({ video: null });
    }
  };
}

module.exports = { pickScreenSource, createDisplayMediaHandler };
