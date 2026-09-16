// Serves a recording on the plugin's live contract: GET /racecor-io-pro-drive/ returns the frame at
// the playhead, `?action=` calls are acknowledged, OPTIONS gets the plugin's CORS preflight answer.
// /__replay/state and /__replay/control let tests and tools pin the playhead.

import http from 'node:http';
import { Player } from './format.mjs';

export const CONTRACT_PATH = '/racecor-io-pro-drive/';

export function createClock({ speed = 1, paused = false, startMs = 0 } = {}) {
  let base = startMs, wallStart = performance.now();
  const clock = {
    speed, paused,
    now() { return clock.paused ? base : base + (performance.now() - wallStart) * clock.speed; },
    seek(ms) { base = ms; wallStart = performance.now(); },
    pause() { if (!clock.paused) { base = clock.now(); clock.paused = true; } },
    resume() { if (clock.paused) { wallStart = performance.now(); clock.paused = false; } },
    setSpeed(s) { base = clock.now(); wallStart = performance.now(); clock.speed = s; },
  };
  return clock;
}

const cors = { 'Access-Control-Allow-Origin': '*' };

function send(res, status, body, headers = {}) {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': buf.length, ...cors, ...headers });
  res.end(buf);
}

export function startReplayServer({ recording, port = 8889, host = '127.0.0.1', loop = true, speed = 1, paused = false, startMs = 0, log = () => {} }) {
  const player = new Player(recording);
  const clock = createClock({ speed, paused, startMs });
  const seenActions = new Set();
  let requests = 0;

  const playhead = () => {
    const t = clock.now();
    if (player.duration <= 0) return 0;
    if (loop) return ((t % (player.duration + 1)) + player.duration + 1) % (player.duration + 1);
    return Math.min(Math.max(t, 0), player.duration);
  };
  const state = () => {
    const t = playhead();
    return { file: recording.path, frames: player.frames.length, frame: player.indexAt(t), t: Math.round(t), duration: player.duration, speed: clock.speed, paused: clock.paused, loop, requests };
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://replay');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true' });
      return res.end();
    }
    if (url.pathname === '/__replay/state') return send(res, 200, JSON.stringify(state()));
    if (url.pathname === '/__replay/control') {
      const q = url.searchParams;
      if (q.has('speed')) clock.setSpeed(Number(q.get('speed')));
      if (q.has('frame')) clock.seek(player.frames[Math.max(0, Math.min(Number(q.get('frame')), player.frames.length - 1))].t);
      if (q.has('t')) clock.seek(Number(q.get('t')));
      if (q.get('pause') === '1') clock.pause();
      if (q.get('pause') === '0' || q.has('resume')) clock.resume();
      return send(res, 200, JSON.stringify(state()));
    }
    if (url.pathname.startsWith(CONTRACT_PATH) || url.pathname === CONTRACT_PATH.slice(0, -1)) {
      const action = url.searchParams.get('action');
      if (action) {
        if (!seenActions.has(action)) { seenActions.add(action); log(`action "${action}" acknowledged (no-op in replay)`); }
        return send(res, 200, '{"ok":true}');
      }
      requests++;
      return send(res, 200, JSON.stringify(player.stateAt(player.indexAt(playhead()))));
    }
    send(res, 404, '{"error":"not found"}');
  });

  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        err.message = `port ${port} is already in use — if SimHub is running it owns :8889. Close SimHub, or pass --port <n> (npm run dev does this for you).`;
      }
      reject(err);
    });
    server.listen(port, host, () => {
      const { port: bound } = server.address();
      resolve({
        port: bound, server, player, clock, state,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}
