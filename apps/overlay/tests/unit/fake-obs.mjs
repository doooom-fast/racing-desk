// A fake obs-websocket 5 server for the tests: Hello with a salt and a challenge, the authentication check exactly
// as the protocol has it (base64(sha256(base64(sha256(password + salt)) + challenge))), close 4009 on a wrong
// password, Identify → Identified, requests answered by requestId with the status codes the client has to handle,
// and the events a recording goes through — STARTING, STARTED (with outputPath), STOPPING, STOPPED — on demand or
// from a scripted StartRecord. On 127.0.0.1 and a port the OS picks, never 4455. Scripted from the test; nothing
// clever: the real OBS is never run or connected to here.
import crypto from 'node:crypto';
import path from 'node:path';
import { startWsServer } from './ws-fake-server.mjs';

const OP = { HELLO: 0, IDENTIFY: 1, IDENTIFIED: 2, REIDENTIFY: 3, EVENT: 5, REQUEST: 6, RESPONSE: 7 };
export const CLOSE = { NOT_IDENTIFIED: 4008, AUTH_FAILED: 4009, UNSUPPORTED_RPC: 4010 };
export const STATUS = { SUCCESS: 100, UNKNOWN_REQUEST: 204, NOT_READY: 207, OUTPUT_RUNNING: 500, OUTPUT_NOT_RUNNING: 501, OUTPUT_PAUSED: 502, OUTPUT_NOT_PAUSED: 503, RESOURCE_NOT_FOUND: 600, INVALID_RESOURCE_STATE: 604, REQUEST_PROCESSING_FAILED: 702 };
export const INTENT = { GENERAL: 1, CONFIG: 2, OUTPUTS: 64 };

export function authString(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

const tick = () => new Promise((r) => setImmediate(r));

/**
 * startFakeObs({ password, authRequired, obsVersion, wsVersion, recordDirectory })
 *   → the server: { port, state, requests, events, clients(), identified(), close(), closeAll(),
 *                    emit(type, data, intent), startRecording(), stopRecording(), fail(type, status, comment), mode }
 */
export async function startFakeObs({
  password = 'correct-horse',
  authRequired = true,
  obsVersion = '32.1.2',
  wsVersion = '5.7.3',
  rpcVersion = 1,
  recordDirectory = 'D:/Racing Desk/Recordings',
} = {}) {
  const salt = crypto.randomBytes(32).toString('base64');
  const state = {
    recording: false, paused: false, path: null, startedAt: 0, bytes: 0,
    replayBuffer: false, lastReplay: null,
    chapters: [],      // { name, ms } since the recording began, as CreateRecordChapter asked
    recordDirectory,
    profile: { AdvOut: { RecFormat2: 'mp4', RecRB: 'false', RecRBTime: '20', RecFilePath: 'C:/Users/Driver/Videos/NVIDIA' }, SimpleOutput: { FilePath: 'C:/Users/Driver/Videos' } },
    outputs: [{ outputName: 'adv_file_output', outputKind: 'ffmpeg_muxer', outputActive: false }],
    clock: 0,
    // His collection, as sim race 2k has it: three scenes, each with the game's display capture at the bottom and the
    // facecam above it; the mic and the game audio beside. Items are listed bottom to top, as obs-websocket lists them.
    inputs: [
      { inputName: 'game video', inputKind: 'monitor_capture', settings: { monitor_id: 'LG' } },
      { inputName: 'Video Capture Device', inputKind: 'dshow_input', settings: { video_device_id: 'j5' } },
      { inputName: 'mic', inputKind: 'wasapi_input_capture', settings: {} },
      { inputName: 'game audio', inputKind: 'wasapi_output_capture', settings: {} },
    ],
    scenes: [
      { sceneName: 'Large Video', items: [item(1, 'game video', { positionX: 0, positionY: 0, width: 3440, height: 1440 }), item(2, 'Video Capture Device', { positionX: 3000, positionY: 1100, width: 400, height: 300 })] },
      { sceneName: 'Small Video', items: [item(3, 'game video', { positionX: 0, positionY: 0, width: 3440, height: 1440 }), item(4, 'Video Capture Device', { positionX: 3100, positionY: 1200, width: 300, height: 220 })] },
      { sceneName: '2up', items: [item(5, 'game video', { positionX: 0, positionY: 360, boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1720, boundsHeight: 720, width: 1720, height: 720 }), item(6, 'Video Capture Device', { positionX: 1720, positionY: 360, width: 1720, height: 720 })] },
    ],
    currentScene: 'Large Video',
    collection: 'sim race 2k',   // the scene collection OBS is on (his others: commentary, sim video with voice)
    nextItemId: 100,
    pressed: [],     // { inputName, propertyName }
  };
  const mode = { neverStarts: false, notReadyOnce: false, delayMs: 0, clock: () => Date.now(), writeClip: null, noReplayBuffer: false };
  // A scene item as the fake keeps it: the source's name, enabled, and a transform of the fields obs-websocket gives.
  function item(id, sourceName, transform) {
    return { sceneItemId: id, sourceName, enabled: true, transform: { positionX: 0, positionY: 0, rotation: 0, scaleX: 1, scaleY: 1, alignment: 5, boundsType: 'OBS_BOUNDS_NONE', boundsAlignment: 0, boundsWidth: 0, boundsHeight: 0, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, cropToBounds: false, sourceWidth: 3440, sourceHeight: 1440, width: 3440, height: 1440, ...transform } };
  }
  const sceneNamed = (name) => { const sc = state.scenes.find((x) => x.sceneName === name); if (!sc) throw { code: STATUS.RESOURCE_NOT_FOUND, comment: `No source was found by the name of \`${name}\`.` }; return sc; };
  const itemIn = (sc, id) => { const it = sc.items.find((x) => x.sceneItemId === id); if (!it) throw { code: STATUS.RESOURCE_NOT_FOUND, comment: `No scene items were found in scene \`${sc.sceneName}\` with id \`${id}\`.` }; return it; };
  const inputNamed = (name) => { const inp = state.inputs.find((x) => x.inputName === name); if (!inp) throw { code: STATUS.RESOURCE_NOT_FOUND, comment: `No input was found by the name of \`${name}\`.` }; return inp; };
  const requests = [];
  const events = [];
  const failures = new Map();
  const sessions = new Set();
  let fileNo = 0;
  let clipNo = 0;

  const handlers = {
    GetVersion: () => ({ obsVersion, obsWebSocketVersion: wsVersion, rpcVersion, availableRequests: Object.keys(handlers), supportedImageFormats: [], platform: 'windows', platformDescription: 'Windows 11' }),
    GetRecordStatus: () => ({
      outputActive: state.recording, outputPaused: state.paused,
      outputTimecode: '00:00:00.000',
      outputDuration: state.recording ? Math.max(0, mode.clock() - state.startedAt) : 0,
      outputBytes: state.recording ? state.bytes : 0,
    }),
    StartRecord: async () => {
      if (state.recording) throw { code: STATUS.OUTPUT_RUNNING, comment: 'The output is already running.' };
      if (mode.neverStarts) return {};
      setTimeout(() => startRecording(), mode.delayMs);
      return {};
    },
    StopRecord: async () => {
      if (!state.recording) throw { code: STATUS.OUTPUT_NOT_RUNNING, comment: 'The output is not running.' };
      const p = state.path;
      setTimeout(() => stopRecording(), mode.delayMs);
      return { outputPath: p };
    },
    PauseRecord: () => { if (!state.recording) throw { code: STATUS.OUTPUT_NOT_RUNNING }; if (state.paused) throw { code: STATUS.OUTPUT_PAUSED }; state.paused = true; emit('RecordStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_PAUSED', outputPath: null }, INTENT.OUTPUTS); return {}; },
    ResumeRecord: () => { if (!state.recording) throw { code: STATUS.OUTPUT_NOT_RUNNING }; if (!state.paused) throw { code: STATUS.OUTPUT_NOT_PAUSED }; state.paused = false; emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_RESUMED', outputPath: null }, INTENT.OUTPUTS); return {}; },
    GetOutputList: () => ({ outputs: state.outputs.map((o) => ({ ...o, outputActive: o.outputName === 'adv_file_output' ? state.recording : o.outputActive })) }),
    GetOutputSettings: (d) => {
      const out = state.outputs.find((o) => o.outputName === d.outputName);
      if (!out) throw { code: STATUS.RESOURCE_NOT_FOUND, comment: `No output was found by the name of \`${d.outputName}\`.` };
      return { outputSettings: out.outputName === 'adv_file_output' ? { path: state.path || '', muxer_settings: '' } : {} };
    },
    GetRecordDirectory: () => ({ recordDirectory: state.recordDirectory }),
    SetRecordDirectory: (d) => {
      if (state.recording) throw { code: STATUS.OUTPUT_RUNNING };
      state.recordDirectory = d.recordDirectory;
      state.profile.AdvOut.RecFilePath = d.recordDirectory;
      state.profile.SimpleOutput.FilePath = d.recordDirectory;
      return {};
    },
    GetProfileParameter: (d) => {
      const section = state.profile[d.parameterCategory] || {};
      return { parameterValue: section[d.parameterName] === undefined ? null : section[d.parameterName], defaultParameterValue: null };
    },
    SetProfileParameter: (d) => {
      if (typeof d.parameterValue !== 'string' && d.parameterValue !== null) throw { code: 403, comment: 'The field value is the wrong type.' };
      state.profile[d.parameterCategory] = state.profile[d.parameterCategory] || {};
      if (d.parameterValue === null) delete state.profile[d.parameterCategory][d.parameterName];
      else state.profile[d.parameterCategory][d.parameterName] = d.parameterValue;
      return {};
    },
    GetProfileList: () => ({ currentProfileName: 'Untitled', profiles: ['Untitled', 'yersy'] }),
    GetSceneCollectionList: () => ({ currentSceneCollectionName: state.collection, sceneCollections: [...new Set([state.collection, 'sim race 2k', 'commentary', 'sim video with voice'])] }),
    // The replay buffer's outputs are built when OBS starts, from its profile: `mode.noReplayBuffer` is an OBS that started
    // before its profile said RecRB (Set up OBS over the WebSocket changes the profile, not the outputs).
    GetReplayBufferStatus: () => { if (state.profile.AdvOut.RecRB !== 'true' || mode.noReplayBuffer) throw { code: STATUS.INVALID_RESOURCE_STATE, comment: 'There is no replay buffer' }; return { outputActive: state.replayBuffer }; },
    // As obs-websocket does it: the request only queues the start on OBS's UI thread (obs_frontend_replay_buffer_start is
    // an invokeMethod), so the answer comes first, then STARTING (outputActive false, like every state but STARTED), then
    // STARTED. The output is active once STARTED has been sent. A stop likewise: the answer, STOPPING (inactive), STOPPED.
    StartReplayBuffer: () => {
      if (state.profile.AdvOut.RecRB !== 'true' || mode.noReplayBuffer) throw { code: STATUS.INVALID_RESOURCE_STATE, comment: 'There is no replay buffer' };
      if (state.replayBuffer || state.replayBufferStarting) throw { code: STATUS.OUTPUT_RUNNING };
      state.replayBufferStarting = true;
      setTimeout(() => {
        emit('ReplayBufferStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTING' });
        setTimeout(() => {
          state.replayBufferStarting = false;
          state.replayBuffer = true;
          emit('ReplayBufferStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' });
        }, mode.delayMs);
      }, 0);
      return {};
    },
    StopReplayBuffer: () => {
      if (!state.replayBuffer) throw { code: STATUS.OUTPUT_NOT_RUNNING };
      setTimeout(() => {
        emit('ReplayBufferStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPING' });
        setTimeout(() => {
          state.replayBuffer = false;
          emit('ReplayBufferStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' });
        }, mode.delayMs);
      }, 0);
      return {};
    },
    // The clip is "written" by the test's mode.writeClip(path) before the saved event, as OBS's mux thread does.
    SaveReplayBuffer: () => {
      if (!state.replayBuffer) throw { code: STATUS.OUTPUT_NOT_RUNNING };
      const clip = `${state.recordDirectory.replace(/[\\/]+$/, '')}/Replay 2026-09-30 21-20-${String(clipNo++).padStart(2, '0')}.mp4`;
      setTimeout(() => {
        if (mode.writeClip) mode.writeClip(clip);
        state.lastReplay = clip;
        emit('ReplayBufferSaved', { savedReplayPath: clip });
      }, mode.delayMs);
      return {};
    },
    GetLastReplayBufferReplay: () => ({ savedReplayPath: state.lastReplay || '' }),
    // ── Scenes and inputs, as obs-websocket answers (Obs_ArrayHelper.cpp, Obs_ObjectHelper.cpp) ──
    GetSceneList: () => ({ currentProgramSceneName: state.currentScene, currentProgramSceneUuid: 'uuid-' + state.currentScene, currentPreviewSceneName: null, currentPreviewSceneUuid: null, scenes: state.scenes.map((sc, i) => ({ sceneName: sc.sceneName, sceneUuid: 'uuid-' + sc.sceneName, sceneIndex: state.scenes.length - i - 1 })) }),
    GetCurrentProgramScene: () => ({ sceneName: state.currentScene, sceneUuid: 'uuid-' + state.currentScene, currentProgramSceneName: state.currentScene, currentProgramSceneUuid: 'uuid-' + state.currentScene }),
    GetInputList: (d) => ({ inputs: state.inputs.filter((i) => !d.inputKind || i.inputKind === d.inputKind).map((i) => ({ inputName: i.inputName, inputUuid: 'uuid-' + i.inputName, inputKind: i.inputKind, unversionedInputKind: i.inputKind })) }),
    GetInputSettings: (d) => { const inp = inputNamed(d.inputName); return { inputSettings: { ...inp.settings }, inputKind: inp.inputKind }; },
    SetInputSettings: (d) => { const inp = inputNamed(d.inputName); inp.settings = d.overlay === false ? { ...d.inputSettings } : { ...inp.settings, ...d.inputSettings }; return {}; },
    CreateInput: (d) => {
      if (state.inputs.some((i) => i.inputName === d.inputName)) throw { code: 601, comment: 'A source already exists by that input name.' };   // ResourceAlreadyExists
      const sc = sceneNamed(d.sceneName);
      state.inputs.push({ inputName: d.inputName, inputKind: d.inputKind, settings: { ...(d.inputSettings || {}) } });
      const it = item(state.nextItemId++, d.inputName, { sourceWidth: (d.inputSettings || {}).width || 0, sourceHeight: (d.inputSettings || {}).height || 0, width: (d.inputSettings || {}).width || 0, height: (d.inputSettings || {}).height || 0 });
      it.enabled = d.sceneItemEnabled !== false;
      sc.items.push(it);
      return { inputUuid: 'uuid-' + d.inputName, sceneItemId: it.sceneItemId };
    },
    GetSceneItemList: (d) => ({ sceneItems: sceneNamed(d.sceneName).items.map((it, i) => ({ sceneItemId: it.sceneItemId, sceneItemIndex: i, sceneItemEnabled: it.enabled, sceneItemLocked: false, sceneItemTransform: { ...it.transform }, sceneItemBlendMode: 'OBS_BLEND_NORMAL', sourceName: it.sourceName, sourceUuid: 'uuid-' + it.sourceName, sourceType: 'OBS_SOURCE_TYPE_INPUT', inputKind: (state.inputs.find((x) => x.inputName === it.sourceName) || {}).inputKind || null, isGroup: null })) }),
    GetSceneItemId: (d) => { const sc = sceneNamed(d.sceneName); const it = sc.items.find((x) => x.sourceName === d.sourceName); if (!it) throw { code: STATUS.RESOURCE_NOT_FOUND }; return { sceneItemId: it.sceneItemId }; },
    CreateSceneItem: (d) => {
      const sc = sceneNamed(d.sceneName);
      const inp = inputNamed(d.sourceName);
      const it = item(state.nextItemId++, d.sourceName, { sourceWidth: inp.settings.width || 3440, sourceHeight: inp.settings.height || 1440, width: inp.settings.width || 3440, height: inp.settings.height || 1440 });
      it.enabled = d.sceneItemEnabled !== false;
      sc.items.push(it);   // on top
      return { sceneItemId: it.sceneItemId };
    },
    SetSceneItemEnabled: (d) => { itemIn(sceneNamed(d.sceneName), d.sceneItemId).enabled = !!d.sceneItemEnabled; return {}; },
    GetSceneItemEnabled: (d) => ({ sceneItemEnabled: itemIn(sceneNamed(d.sceneName), d.sceneItemId).enabled }),
    SetSceneItemIndex: (d) => {
      // obs_sceneitem_set_order_position: the item is taken out and put at the position, 0 the bottom.
      const sc = sceneNamed(d.sceneName);
      const it = itemIn(sc, d.sceneItemId);
      sc.items.splice(sc.items.indexOf(it), 1);
      sc.items.splice(Math.max(0, Math.min(sc.items.length, d.sceneItemIndex)), 0, it);
      return {};
    },
    GetSceneItemTransform: (d) => ({ sceneItemTransform: { ...itemIn(sceneNamed(d.sceneName), d.sceneItemId).transform } }),
    SetSceneItemTransform: (d) => { const it = itemIn(sceneNamed(d.sceneName), d.sceneItemId); Object.assign(it.transform, d.sceneItemTransform || {}); return {}; },
    PressInputPropertiesButton: (d) => { inputNamed(d.inputName); state.pressed.push({ inputName: d.inputName, propertyName: d.propertyName }); return {}; },
    RemoveInput: () => { throw { code: 702, comment: 'the tests never remove anything of his' }; },
    RemoveSceneItem: () => { throw { code: 702, comment: 'the tests never remove anything of his' }; },
    // Chapters: Hybrid MP4 alone takes them (RequestProcessingFailed otherwise), not while paused, not while not recording.
    CreateRecordChapter: (d) => {
      if (!state.recording) throw { code: STATUS.OUTPUT_NOT_RUNNING };
      // obs_frontend_recording_add_chapter returns false for a paused recording, and obs-websocket answers any false with
      // RequestProcessingFailed (702): there is no 502 for a chapter.
      if (state.paused) throw { code: STATUS.REQUEST_PROCESSING_FAILED, comment: 'Verify that the output being used supports chapter markers.' };
      if (state.profile.AdvOut.RecFormat2 !== 'hybrid_mp4') throw { code: STATUS.REQUEST_PROCESSING_FAILED, comment: 'Verify that the output being used supports chapter markers.' };
      const name = typeof d.chapterName === 'string' && d.chapterName ? d.chapterName : `Unnamed ${state.chapters.length + 1}`;
      state.chapters.push({ name, ms: Math.max(0, mode.clock() - state.startedAt) });
      return {};
    },
  };

  function emit(eventType, eventData, eventIntent = INTENT.OUTPUTS) {
    events.push({ eventType, eventData });
    for (const s of sessions) {
      if (!s.identified) continue;
      if ((s.subscriptions & eventIntent) === 0) continue;
      s.conn.send(JSON.stringify({ op: OP.EVENT, d: { eventType, eventIntent, eventData } }));
    }
  }

  function startRecording(filePath) {
    if (state.recording) return;
    emit('RecordStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTING', outputPath: null });
    state.recording = true;
    state.paused = false;
    state.startedAt = mode.clock();
    state.bytes = 0;
    state.chapters = [];
    state.path = filePath || `${state.recordDirectory.replace(/[\\/]+$/, '')}/2026-09-30 21-00-${String(fileNo++).padStart(2, '0')}.mp4`;
    emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED', outputPath: state.path });
  }

  function stopRecording() {
    if (!state.recording) return;
    const p = state.path;
    emit('RecordStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPING', outputPath: null });
    state.recording = false;
    state.paused = false;
    emit('RecordStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED', outputPath: p });
  }

  async function answer(session, d) {
    requests.push({ type: d.requestType, data: d.requestData || {} });
    let status = { result: true, code: STATUS.SUCCESS };
    let responseData;
    const planned = failures.get(d.requestType);
    try {
      if (mode.notReadyOnce) { mode.notReadyOnce = false; throw { code: STATUS.NOT_READY, comment: 'OBS is not ready to perform the request.' }; }
      if (planned) { failures.delete(d.requestType); throw planned; }
      const handler = handlers[d.requestType];
      if (!handler) throw { code: STATUS.UNKNOWN_REQUEST, comment: `Your request type is not valid.` };
      responseData = await handler(d.requestData || {}, session);
    } catch (err) {
      status = { result: false, code: err.code || 700, comment: err.comment || err.message || 'failed' };
    }
    const out = { requestType: d.requestType, requestId: d.requestId, requestStatus: status };
    if (status.result && responseData && Object.keys(responseData).length) out.responseData = responseData;
    session.conn.send(JSON.stringify({ op: OP.RESPONSE, d: out }));
  }

  const server = await startWsServer({
    protocol: 'obswebsocket.json',
    onConnection(conn) {
      const session = { conn, identified: false, subscriptions: 0, challenge: crypto.randomBytes(32).toString('base64') };
      sessions.add(session);
      conn.on('close', () => sessions.delete(session));
      const hello = { obsStudioVersion: obsVersion, obsWebSocketVersion: wsVersion, rpcVersion };
      if (authRequired) hello.authentication = { challenge: session.challenge, salt };
      conn.send(JSON.stringify({ op: OP.HELLO, d: hello }));
      conn.on('message', (text) => {
        let msg;
        try { msg = JSON.parse(text); } catch (e) { conn.close(4002, 'Your message was not a valid JSON object.'); return; }
        const d = msg.d || {};
        if (msg.op === OP.IDENTIFY) {
          if (session.identified) { conn.close(4007, 'already identified'); return; }
          if (d.rpcVersion !== rpcVersion) { conn.close(CLOSE.UNSUPPORTED_RPC, `Your requested RPC version (${d.rpcVersion}) is not supported by this server.`); return; }
          if (authRequired && (typeof d.authentication !== 'string' || d.authentication !== authString(password, salt, session.challenge))) {
            conn.close(CLOSE.AUTH_FAILED, 'Authentication failed.');
            return;
          }
          session.identified = true;
          session.subscriptions = typeof d.eventSubscriptions === 'number' ? d.eventSubscriptions : 0x7ff;
          conn.send(JSON.stringify({ op: OP.IDENTIFIED, d: { negotiatedRpcVersion: rpcVersion } }));
          return;
        }
        if (!session.identified) { conn.close(CLOSE.NOT_IDENTIFIED, 'You attempted to send a non-Identify message while not identified.'); return; }
        if (msg.op === OP.REIDENTIFY) { session.subscriptions = typeof d.eventSubscriptions === 'number' ? d.eventSubscriptions : session.subscriptions; conn.send(JSON.stringify({ op: OP.IDENTIFIED, d: { negotiatedRpcVersion: rpcVersion } })); return; }
        if (msg.op === OP.REQUEST) { answer(session, d); return; }
        conn.close(4005, 'unknown opcode');
      });
    },
  });

  return {
    port: server.port,
    state,
    mode,
    requests,
    events,
    handlers,
    salt,
    clients: () => [...sessions],
    identified: () => [...sessions].filter((s) => s.identified).length,
    emit,
    startRecording,
    stopRecording,
    fail: (type, code, comment) => failures.set(type, { code, comment }),
    exitStarted: async () => { emit('ExitStarted', undefined, INTENT.GENERAL); await tick(); server.closeAll(1001, 'OBS is exiting'); },
    closeAll: (code, reason) => server.closeAll(code, reason),
    close: () => server.close(),
  };
}
