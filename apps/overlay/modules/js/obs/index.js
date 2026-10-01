// OBS as Racing Desk's recording surface: the obs-websocket client, the launcher (finding, starting and setting up
// OBS), the keeper (the recording mirrored from OBS, the sidecar, ownership, the floor, auto-record, the replay
// buffer, chapters, filing), auto-record's rules, the filing rules and the MP4 reader. docs/recording.md says how it
// fits together; main.js wires it to the desk, the tray, the HUD's keys and the Stream Deck.
const client = require('./client');
const launcher = require('./launcher');
const recording = require('./recording');
const autoRecord = require('./auto-record');
const filing = require('./filing');
const mp4Info = require('./mp4-info');
const hudSource = require('./hud-source');
const tvShots = require('./tv-shots');
const recordingsIndex = require('./recordings-index');
const recordingRate = require('./recording-rate');

module.exports = {
  createObsClient: client.createObsClient,
  createRecordingKeeper: recording.createRecordingKeeper,
  createHudSource: hudSource.createHudSource,
  createTvShots: tvShots.createTvShots,
  tvShots,
  recordingsIndex,
  recordingRate,
  launcher,
  client,
  recording,
  autoRecord,
  filing,
  mp4Info,
  hudSource,
};
