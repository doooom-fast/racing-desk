// OBS as Racing Desk's recording surface: the obs-websocket client, the launcher (finding, starting and setting up
// OBS) and the keeper (the recording mirrored from OBS, the sidecar, ownership, the floor). docs/recording.md says
// how it fits together; main.js wires it to the desk, the tray, the HUD's keys and the Stream Deck.
const client = require('./client');
const launcher = require('./launcher');
const recording = require('./recording');

module.exports = {
  createObsClient: client.createObsClient,
  createRecordingKeeper: recording.createRecordingKeeper,
  launcher,
  client,
  recording,
};
