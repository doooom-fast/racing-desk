// The obs-websocket 5 client: Hello → Identify (the challenge-and-salt authentication, protocol §"Creating an
// authentication string") → Identified, requests answered by requestId, events by name, and a connection that is
// tried again by itself — every 5 s while OBS is closed (which is how OBS being open is noticed), every 30 s after
// a password OBS refused. Requests are made only while identified and never retried blindly (StartRecord is not
// idempotent); the one exception is 207 NotReady, OBS changing its collection, which is "ask again in a moment".
//
// The password is a function, asked when OBS sends its Hello, and is held nowhere here: it is never logged (the
// log says "password: set" or "none"), never put in an error and never sent anywhere but in the Identify, hashed.
//
// No Electron. The socket, the clock and the timers are handed in, so tests/unit/obs-client.spec.mjs runs it
// against the fake server on 127.0.0.1.
const crypto = require('crypto');
const wsClient = require('./ws-client');

const OP = Object.freeze({ HELLO: 0, IDENTIFY: 1, IDENTIFIED: 2, REIDENTIFY: 3, EVENT: 5, REQUEST: 6, RESPONSE: 7 });
const RPC_VERSION = 1;
// General (ExitStarted, VendorEvent) | Config (profile and collection changes) | Outputs (the recording's state).
const SUBSCRIPTIONS = 1 | 2 | 64;
const PROTOCOL = 'obswebsocket.json';
const STATUS = Object.freeze({ SUCCESS: 100, NOT_READY: 207, OUTPUT_RUNNING: 500, OUTPUT_NOT_RUNNING: 501 });
const CLOSE = Object.freeze({ AUTH_FAILED: 4009, UNSUPPORTED_RPC: 4010 });

const DEFAULT_PORT = 4455;
const RETRY_MS = 5000;
const AUTH_RETRY_MS = 30000;
const REQUEST_TIMEOUT_MS = 10000;
const CONNECT_TIMEOUT_MS = 3000;
const NOT_READY_RETRY_MS = 500;

function authentication(password, { salt, challenge }) {
  const secret = crypto.createHash('sha256').update(String(password) + String(salt)).digest('base64');
  return crypto.createHash('sha256').update(secret + String(challenge)).digest('base64');
}

function createObsClient({
  host = '127.0.0.1',
  port = DEFAULT_PORT,
  password = () => null,
  connect = wsClient.connect,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  retryMs = RETRY_MS,
  authRetryMs = AUTH_RETRY_MS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
  notReadyRetryMs = NOT_READY_RETRY_MS,
  eventSubscriptions = SUBSCRIPTIONS,
  log = () => {},
} = {}) {
  let running = false;
  let phase = 'stopped';         // stopped | connecting | hello | identified | closed
  let ws = null;
  let retryTimer = null;
  let seq = 0;
  let obsVersion = null;
  let wsVersion = null;
  let authFailed = false;        // OBS refused the last password
  let passwordMissing = false;   // OBS wants one and we had none to give
  let lastClose = null;
  let since = now();
  let attempts = 0;
  const pending = new Map();     // requestId → { type, resolve, reject, timer, data, deadline }
  const handlers = new Map();    // eventType → Set of fn; '*' for all
  const watchers = new Set();    // onChange

  const portNow = () => (typeof port === 'function' ? port() : port) || DEFAULT_PORT;
  const passwordNow = () => { try { const p = password(); return typeof p === 'string' && p.length ? p : null; } catch (e) { return null; } };

  function state() {
    return { phase, identified: phase === 'identified', obsVersion, wsVersion, authFailed, passwordMissing, lastClose, since, port: portNow(), attempts };
  }

  function setPhase(next) {
    if (phase === next) return;
    phase = next;
    since = now();
    for (const fn of [...watchers]) {
      try { fn(state()); } catch (e) { log(`[RacingDesk] OBS: a watcher threw: ${e.message}`); }
    }
  }

  function send(obj) {
    if (!ws || !ws.isOpen()) return false;
    return ws.send(JSON.stringify(obj));
  }

  function failPending(reason) {
    for (const [id, p] of [...pending]) {
      pending.delete(id);
      clearTimer(p.timer);
      const err = new Error(`${p.type}: ${reason}`);
      err.code = 'disconnected';
      err.requestType = p.type;
      p.reject(err);
    }
  }

  function schedule(ms) {
    if (!running) return;
    if (retryTimer !== null) clearTimer(retryTimer);
    retryTimer = setTimer(() => { retryTimer = null; attempt(); }, ms);
    if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref();
  }

  function onHello(d) {
    obsVersion = d.obsStudioVersion || null;
    wsVersion = d.obsWebSocketVersion || null;
    const identify = { rpcVersion: RPC_VERSION, eventSubscriptions };
    if (d.authentication && typeof d.authentication === 'object') {
      const pw = passwordNow();
      if (pw === null) {
        passwordMissing = true;
        log(`[RacingDesk] OBS ${obsVersion || '?'} wants a password and there is none to give (password: none)`);
        ws.close(1000, 'no password');
        return;
      }
      identify.authentication = authentication(pw, d.authentication);
      log(`[RacingDesk] OBS ${obsVersion || '?'} (obs-websocket ${wsVersion || '?'}) asks for authentication (password: set)`);
    } else {
      log(`[RacingDesk] OBS ${obsVersion || '?'} (obs-websocket ${wsVersion || '?'}) asks for no authentication (password: not needed)`);
    }
    send({ op: OP.IDENTIFY, d: identify });
  }

  function onResponse(d) {
    const p = pending.get(d.requestId);
    if (!p) return;
    const status = d.requestStatus || {};
    if (status.result === true) {
      pending.delete(d.requestId);
      clearTimer(p.timer);
      p.resolve(d.responseData || {});
      return;
    }
    if (status.code === STATUS.NOT_READY && now() + notReadyRetryMs < p.deadline) {
      // OBS is changing its collection or profile: the same request, a moment later, with the same id.
      setTimer(() => { if (pending.has(d.requestId)) send({ op: OP.REQUEST, d: { requestType: p.type, requestId: d.requestId, requestData: p.data } }); }, notReadyRetryMs);
      return;
    }
    pending.delete(d.requestId);
    clearTimer(p.timer);
    const err = new Error(status.comment ? `${p.type}: ${status.comment}` : `${p.type} failed (${status.code})`);
    err.code = status.code;
    err.comment = status.comment || null;
    err.requestType = p.type;
    p.reject(err);
  }

  function onEvent(d) {
    const type = d.eventType;
    for (const key of [type, '*']) {
      const set = handlers.get(key);
      if (!set) continue;
      for (const fn of [...set]) {
        try { fn(d.eventData || {}, type); } catch (e) { log(`[RacingDesk] OBS: a handler of ${type} threw: ${e.message}`); }
      }
    }
  }

  function onMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch (e) { log('[RacingDesk] OBS sent something that is not JSON'); return; }
    const d = msg && msg.d ? msg.d : {};
    switch (msg.op) {
      case OP.HELLO: onHello(d); break;
      case OP.IDENTIFIED:
        authFailed = false;
        passwordMissing = false;
        attempts = 0;
        log(`[RacingDesk] OBS: identified (rpc ${d.negotiatedRpcVersion})`);
        setPhase('identified');
        break;
      case OP.EVENT: onEvent(d); break;
      case OP.RESPONSE: onResponse(d); break;
      default: break;
    }
  }

  function onClose({ code, reason }) {
    const wasIdentified = phase === 'identified';
    ws = null;
    lastClose = { code, reason, at: now() };
    failPending(code === 1006 ? 'OBS went away' : `the connection closed (${code})`);
    let delay = retryMs;
    if (code === CLOSE.AUTH_FAILED) {
      authFailed = true;
      passwordMissing = passwordNow() === null;
      delay = authRetryMs;
      log('[RacingDesk] OBS refused the password (password: ' + (passwordMissing ? 'none' : 'set') + ')');
    } else if (code === CLOSE.UNSUPPORTED_RPC) {
      log(`[RacingDesk] OBS does not speak rpc version ${RPC_VERSION}: ${reason}`);
      delay = authRetryMs;
    } else if (wasIdentified) {
      log(`[RacingDesk] OBS: the connection closed (${code}${reason ? ' ' + reason : ''})`);
    } else if (passwordMissing) {
      delay = authRetryMs;
    }
    setPhase(running ? 'closed' : 'stopped');
    if (running) schedule(delay);
  }

  function attempt() {
    if (!running || ws) return;
    attempts++;
    setPhase('connecting');
    let mine;
    try {
      mine = connect({ host, port: portNow(), path: '/', protocols: [PROTOCOL], timeoutMs: connectTimeoutMs });
    } catch (err) {
      ws = null;
      onClose({ code: 1006, reason: err.message });
      return;
    }
    ws = mine;
    // Each socket's events count only while it is the current one. A socket let go of (passwordChanged, stop) says
    // 'close' a moment later, when its server's answer comes, and by then `ws` may be a new connection that this
    // must not null, nor mark closed, nor book a retry for.
    const current = (fn) => (...args) => { if (ws === mine) fn(...args); };
    mine.on('open', current(() => setPhase('hello')));
    mine.on('message', current(onMessage));
    mine.on('error', () => {});
    mine.on('close', current(onClose));
  }

  function start() {
    if (running) return;
    running = true;
    attempt();
  }

  function stop() {
    running = false;
    if (retryTimer !== null) { clearTimer(retryTimer); retryTimer = null; }
    if (ws) { const w = ws; ws = null; try { w.close(1000, 'Racing Desk is closing'); } catch (e) { /* gone */ } }
    failPending('Racing Desk is closing');
    setPhase('stopped');
  }

  // A press: try now rather than at the next tick of the retry.
  function tryNow() {
    if (!running || ws) return;
    if (retryTimer !== null) { clearTimer(retryTimer); retryTimer = null; }
    attempt();
  }

  function passwordChanged() {
    authFailed = false;
    passwordMissing = false;
    if (ws) { const w = ws; ws = null; try { w.close(1000, 'password changed'); } catch (e) { /* gone */ } onClose({ code: 1000, reason: 'password changed' }); }
    tryNow();
  }

  function request(type, data = {}, { timeoutMs = requestTimeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      if (phase !== 'identified' || !ws) {
        const err = new Error(`${type}: OBS isn't open`);
        err.code = 'not-connected';
        err.requestType = type;
        reject(err);
        return;
      }
      const id = `rd-${++seq}`;
      const timer = setTimer(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        const err = new Error(`${type}: OBS did not answer within ${timeoutMs} ms`);
        err.code = 'timeout';
        err.requestType = type;
        reject(err);
      }, timeoutMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
      pending.set(id, { type, data, resolve, reject, timer, deadline: now() + timeoutMs });
      if (!send({ op: OP.REQUEST, d: { requestType: type, requestId: id, requestData: data } })) {
        pending.delete(id);
        clearTimer(timer);
        const err = new Error(`${type}: OBS isn't open`);
        err.code = 'not-connected';
        err.requestType = type;
        reject(err);
      }
    });
  }

  function on(eventType, fn) {
    if (!handlers.has(eventType)) handlers.set(eventType, new Set());
    handlers.get(eventType).add(fn);
    return () => { const set = handlers.get(eventType); if (set) set.delete(fn); };
  }

  function onChange(fn) {
    watchers.add(fn);
    return () => watchers.delete(fn);
  }

  return { start, stop, tryNow, passwordChanged, request, on, onChange, state, identified: () => phase === 'identified' };
}

module.exports = { createObsClient, authentication, OP, STATUS, CLOSE, SUBSCRIPTIONS, DEFAULT_PORT, RETRY_MS, AUTH_RETRY_MS, REQUEST_TIMEOUT_MS, PROTOCOL };
