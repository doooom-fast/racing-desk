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
export const STATUS = { SUCCESS: 100, UNKNOWN_REQUEST: 204, NOT_READY: 207, OUTPUT_RUNNING: 500, OUTPUT_NOT_RUNNING: 501, OUTPUT_PAUSED: 502, OUTPUT_NOT_PAUSED: 503, RESOURCE_NOT_FOUND: 600, INVALID_RESOURCE_STATE: 604 };
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
    replayBuffer: false,
    recordDirectory,
    profile: { AdvOut: { RecFormat2: 'mp4', RecRB: 'false', RecRBTime: '20', RecFilePath: 'C:/Users/Driver/Videos/NVIDIA' }, SimpleOutput: { FilePath: 'C:/Users/Driver/Videos' } },
    outputs: [{ outputName: 'adv_file_output', outputKind: 'ffmpeg_muxer', outputActive: false }],
    clock: 0,
  };
  const mode = { neverStarts: false, notReadyOnce: false, delayMs: 0, clock: () => Date.now() };
  const requests = [];
  const events = [];
  const failures = new Map();
  const sessions = new Set();
  let fileNo = 0;

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
    PauseRecord: () => { if (!state.recording) throw { code: STATUS.OUTPUT_NOT_RUNNING }; if (state.paused) throw { code: STATUS.OUTPUT_PAUSED }; state.paused = true; emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_PAUSED', outputPath: null }, INTENT.OUTPUTS); return {}; },
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
    GetReplayBufferStatus: () => { if (state.profile.AdvOut.RecRB !== 'true') throw { code: STATUS.INVALID_RESOURCE_STATE, comment: 'There is no replay buffer' }; return { outputActive: state.replayBuffer }; },
    StartReplayBuffer: () => { if (state.replayBuffer) throw { code: STATUS.OUTPUT_RUNNING }; state.replayBuffer = true; return {}; },
    StopReplayBuffer: () => { if (!state.replayBuffer) throw { code: STATUS.OUTPUT_NOT_RUNNING }; state.replayBuffer = false; return {}; },
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
    state.path = filePath || `${state.recordDirectory.replace(/[\\/]+$/, '')}/2026-09-30 21-00-${String(fileNo++).padStart(2, '0')}.mp4`;
    emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED', outputPath: state.path });
  }

  function stopRecording() {
    if (!state.recording) return;
    const p = state.path;
    emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPING', outputPath: null });
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
