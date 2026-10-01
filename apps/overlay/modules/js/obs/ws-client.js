// A WebSocket client over a plain TCP socket: the handshake, text messages, ping and close, and no more. It is what
// talks to OBS's obs-websocket on 127.0.0.1:4455 (client.js) and what the Stream Deck plugin talks to the Stream
// Deck app with. Only ws://, never wss://: both are on this machine.
//
//   connect({ host, port, path, protocols, timeoutMs })
//     → { send(text), close(code, reason), destroy(), on(event, fn), off(event, fn), once(event, fn), isOpen() }
//   events: 'open' ({ protocol }), 'message' (text), 'binary' (Buffer), 'close' ({ code, reason }), 'error' (Error)
//
// 'close' is said once, whatever happened: a clean close carries the server's code, a cut socket or a handshake
// that failed carries 1006 and a reason in words. `net` and the random bytes are injectable for the tests.
const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const frames = require('./ws-frames');

const CLOSE_WAIT_MS = 1000;

function connect({ host = '127.0.0.1', port, path = '/', protocols = [], timeoutMs = 5000, net: netModule = net, random = crypto.randomBytes } = {}) {
  const emitter = new EventEmitter();
  const key = frames.newKey(random);
  const parser = frames.createFrameParser();
  const assembler = frames.createMessageAssembler();
  let socket = null;
  let open = false;        // the handshake is over and frames may be sent
  let closed = false;      // 'close' has been said
  let closeSent = false;   // we sent a close frame and are waiting for the server's
  let head = Buffer.alloc(0);
  let closeTimer = null;
  const connectTimer = setTimeout(() => finish(1006, `no answer from ${host}:${port} within ${timeoutMs} ms`), timeoutMs);
  if (connectTimer.unref) connectTimer.unref();

  function emitError(err) {
    if (emitter.listenerCount('error') > 0) emitter.emit('error', err);
  }

  function finish(code, reason) {
    if (closed) return;
    closed = true;
    open = false;
    clearTimeout(connectTimer);
    if (closeTimer) clearTimeout(closeTimer);
    try { if (socket) socket.destroy(); } catch (e) { /* gone already */ }
    emitter.emit('close', { code, reason });
  }

  function sendFrame(opcode, payload) {
    if (!socket || socket.destroyed) return false;
    try {
      socket.write(frames.encodeFrame({ opcode, payload, mask: true, random }));
      return true;
    } catch (err) {
      emitError(err);
      return false;
    }
  }

  function onFrame(frame) {
    switch (frame.opcode) {
      case frames.OPCODE.TEXT:
      case frames.OPCODE.BINARY:
      case frames.OPCODE.CONTINUATION: {
        const message = assembler.feed(frame);
        if (!message) return;
        if (message.opcode === frames.OPCODE.TEXT) emitter.emit('message', message.payload.toString('utf8'));
        else emitter.emit('binary', message.payload);
        return;
      }
      case frames.OPCODE.CLOSE: {
        const { code, reason } = frames.parseClose(frame.payload);
        if (!closeSent) { closeSent = true; sendFrame(frames.OPCODE.CLOSE, frames.closePayload(code === 1005 ? undefined : 1000)); }
        finish(code, reason);
        return;
      }
      case frames.OPCODE.PING:
        sendFrame(frames.OPCODE.PONG, frame.payload);
        return;
      case frames.OPCODE.PONG:
        return;
      default:
        close(1002, 'unknown opcode');
    }
  }

  function onHandshake(chunk) {
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf('\r\n\r\n');
    if (end < 0) {
      if (head.length > 16384) finish(1006, 'handshake answer too long');
      return;
    }
    const { statusLine, headers } = frames.parseHeaders(head.subarray(0, end).toString('utf8'));
    const rest = head.subarray(end + 4);
    head = Buffer.alloc(0);
    if (!/^HTTP\/1\.1 101\b/.test(statusLine)) {
      finish(1006, `handshake refused: ${statusLine.trim() || 'no status line'}`);
      return;
    }
    if (headers['sec-websocket-accept'] !== frames.acceptKey(key)) {
      finish(1006, 'handshake answer did not match the key');
      return;
    }
    clearTimeout(connectTimer);
    open = true;
    emitter.emit('open', { protocol: headers['sec-websocket-protocol'] || null });
    if (rest.length) onData(rest);
  }

  function onData(chunk) {
    if (closed) return;
    if (!open) { onHandshake(chunk); return; }
    let got;
    try {
      got = parser.feed(chunk);
      for (const frame of got) {
        onFrame(frame);
        if (closed) return;
      }
    } catch (err) {
      emitError(err);
      close(1009, err.message);
    }
  }

  function close(code = 1000, reason = '') {
    if (closed) return;
    if (!open) { finish(1006, reason || 'closed before it was open'); return; }
    if (!closeSent) {
      closeSent = true;
      sendFrame(frames.OPCODE.CLOSE, frames.closePayload(code, reason));
      // A server that never answers the close is not waited on.
      closeTimer = setTimeout(() => finish(code, reason), CLOSE_WAIT_MS);
      if (closeTimer.unref) closeTimer.unref();
    }
  }

  try {
    socket = netModule.connect({ host, port });
  } catch (err) {
    setTimeout(() => finish(1006, err.message), 0);
    return api();
  }
  if (socket.setNoDelay) socket.setNoDelay(true);
  socket.on('connect', () => {
    const lines = [
      `GET ${path} HTTP/1.1`,
      `Host: ${host}:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
    ];
    if (protocols && protocols.length) lines.push(`Sec-WebSocket-Protocol: ${protocols.join(', ')}`);
    socket.write(lines.join('\r\n') + '\r\n\r\n');
  });
  socket.on('data', onData);
  socket.on('error', (err) => { emitError(err); finish(1006, err && err.message ? err.message : 'socket error'); });
  socket.on('close', () => finish(1006, 'the connection was cut'));
  socket.on('end', () => finish(1006, 'the server ended the connection'));

  function api() {
    return {
      send: (text) => open && !closeSent && sendFrame(frames.OPCODE.TEXT, Buffer.from(String(text), 'utf8')),
      close,
      destroy: () => finish(1006, 'destroyed'),
      on: (event, fn) => { emitter.on(event, fn); return () => emitter.off(event, fn); },
      once: (event, fn) => { emitter.once(event, fn); },
      off: (event, fn) => { emitter.off(event, fn); },
      isOpen: () => open && !closed,
    };
  }
  return api();
}

module.exports = { connect, CLOSE_WAIT_MS };
