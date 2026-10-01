// A WebSocket server for the tests, on 127.0.0.1 and a port the OS picks: Node's http server for the upgrade, and
// modules/js/obs/ws-frames.js for the frames. The fake OBS (fake-obs.mjs) and the fake Stream Deck app are built on
// it. Nothing here listens on anything but the loopback address.
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const frames = require('../../modules/js/obs/ws-frames.js');

/**
 * startWsServer({ onConnection(conn, req), protocol })
 *   → { port, url, clients, close(), closeAll(code, reason) }
 * conn: { send(text), close(code, reason), destroy(), on(event, fn), protocol, headers, isOpen() }
 *   events: 'message' (text), 'close' ({ code, reason })
 */
export function startWsServer({ onConnection = () => {}, protocol = null, path = null } = {}) {
  const server = http.createServer((req, res) => { res.writeHead(426, { Connection: 'close' }); res.end('upgrade required'); });
  const clients = new Set();

  server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || (path !== null && req.url !== path)) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const offered = String(req.headers['sec-websocket-protocol'] || '').split(',').map((p) => p.trim()).filter(Boolean);
    const chosen = protocol && offered.includes(protocol) ? protocol : null;
    const lines = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${frames.acceptKey(key)}`];
    if (chosen) lines.push(`Sec-WebSocket-Protocol: ${chosen}`);
    socket.write(lines.join('\r\n') + '\r\n\r\n');

    const emitter = new EventEmitter();
    const parser = frames.createFrameParser();
    const assembler = frames.createMessageAssembler();
    let closed = false;
    let closeSent = false;
    const conn = {
      protocol: chosen,
      offered,
      headers: req.headers,
      isOpen: () => !closed,
      send(text) {
        if (closed) return false;
        socket.write(frames.encodeFrame({ opcode: frames.OPCODE.TEXT, payload: Buffer.from(String(text), 'utf8') }));
        return true;
      },
      close(code = 1000, reason = '') {
        if (closed || closeSent) return;
        closeSent = true;
        socket.write(frames.encodeFrame({ opcode: frames.OPCODE.CLOSE, payload: frames.closePayload(code, reason) }));
        setTimeout(() => finish(code, reason), 500).unref();
      },
      destroy() { finish(1006, 'destroyed'); },
      on(event, fn) { emitter.on(event, fn); return () => emitter.off(event, fn); },
    };
    function finish(code, reason) {
      if (closed) return;
      closed = true;
      clients.delete(conn);
      try { socket.destroy(); } catch (e) { /* gone */ }
      emitter.emit('close', { code, reason });
    }
    socket.on('data', (chunk) => {
      let got;
      try { got = parser.feed(chunk); } catch (err) { conn.close(1009, err.message); return; }
      for (const frame of got) {
        if (frame.opcode === frames.OPCODE.CLOSE) {
          const { code, reason } = frames.parseClose(frame.payload);
          if (!closeSent) { closeSent = true; socket.write(frames.encodeFrame({ opcode: frames.OPCODE.CLOSE, payload: frames.closePayload(1000) })); }
          finish(code, reason);
          return;
        }
        if (frame.opcode === frames.OPCODE.PING) { socket.write(frames.encodeFrame({ opcode: frames.OPCODE.PONG, payload: frame.payload })); continue; }
        if (frame.opcode === frames.OPCODE.PONG) continue;
        const message = assembler.feed(frame);
        if (message && message.opcode === frames.OPCODE.TEXT) emitter.emit('message', message.payload.toString('utf8'));
      }
    });
    socket.on('error', () => finish(1006, 'socket error'));
    socket.on('close', () => finish(1006, 'socket closed'));
    if (head && head.length) socket.emit('data', head);
    clients.add(conn);
    onConnection(conn, req);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        url: `ws://127.0.0.1:${port}/`,
        clients,
        closeAll: (code = 1001, reason = 'server going away') => { for (const c of [...clients]) c.close(code, reason); },
        close: () => new Promise((done) => {
          for (const c of [...clients]) c.destroy();
          server.close(() => done());
        }),
      });
    });
  });
}
