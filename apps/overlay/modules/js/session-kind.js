// What kind of session the payload says it is, from the one word both paths send under
// RacingDesk.Plugin.SessionTypeName: the app's host sends the session YAML's `SessionType` of the session the sim is
// in (IRacingTelemetrySource.SessionType), and the SimHub plugin sends SimHub's `SessionTypeName`, which for iRacing is
// that same string. A test drive — iRacing's solo testing session — is "Offline Testing" in every one of his own .ibt
// files (with WeekendInfo.EventType "Test" and SessionName "TESTING"); a race weekend's sessions are "Practice",
// "Lone Qualify" or "Open Qualify", "Warmup" and "Race". The HUD's DS.SessionMode cannot tell a test drive from a
// practice (both are mode 1), which is why the word is read here.
//
// Pure: runs in the page (window.RacingDeskSessionKind) and in Node (require) alike.
(function () {
  'use strict';

  // A test drive: iRacing's own words for it, "Offline Testing", whatever the case, and nothing looser. Both paths send
  // that exact string (his .ibt files, and the host's tests that read them, have no other); a looser match, any word
  // that begins "test", would take the field's leaderboard from a sim the overlay also runs for through SimHub (ACC,
  // AC, rFactor 2 and the rest) whose own "Test Day" or "Testing" may have a full online field.
  function isTestDrive(sessionTypeName) {
    if (typeof sessionTypeName !== 'string' || !sessionTypeName) return false;
    return /^\s*offline\s+testing\s*$/i.test(sessionTypeName);
  }

  // The session's type name as the frame says it, the demo's when the demo is on; '' when the frame does not say.
  function sessionTypeOf(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const demo = +payload['RacingDesk.Plugin.DemoMode'] || 0;
    const v = payload[demo ? 'RacingDesk.Plugin.Demo.SessionTypeName' : 'RacingDesk.Plugin.SessionTypeName'];
    return typeof v === 'string' ? v : '';
  }

  const api = { isTestDrive, sessionTypeOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskSessionKind = api;
})();
