// WebSocket framing (RFC 6455), the little of it two JSON protocols need: the handshake's accept key, a frame
// encoded with or without a mask, and a parser that hands frames back as they complete. Shared by the client that
// talks to OBS (ws-client.js), the Stream Deck plugin (which talks to the Stream Deck app the same way) and the
// fake servers the tests run. No dependency: Electron 33's Node has no WebSocket client of its own and `ws` is not
// in the tree, and the plugin runs in the Stream Deck app's own Node with nothing installed beside it.
const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OPCODE = Object.freeze({ CONTINUATION: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa });

// 16 MB: an obs-websocket answer is a few kilobytes; nothing here should be larger than this, and a frame that
// claims to be is a reason to drop the connection, not to allocate.
const MAX_PAYLOAD = 16 * 1024 * 1024;

function acceptKey(key) {
  return crypto.createHash('sha1').update(String(key) + GUID).digest('base64');
}

function newKey(random = crypto.randomBytes) {
  return random(16).toString('base64');
}

/** One frame. A client masks what it sends (the RFC requires it); a server never does. */
function encodeFrame({ opcode, payload = Buffer.alloc(0), mask = false, fin = true, random = crypto.randomBytes }) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = data.length;
  let header;
  if (len < 126) header = Buffer.alloc(2);
  else if (len < 65536) header = Buffer.alloc(4);
  else header = Buffer.alloc(10);
  header[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
  if (len < 126) header[1] = len;
  else if (len < 65536) { header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  if (!mask) return Buffer.concat([header, data]);
  header[1] |= 0x80;
  const key = random(4);
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = data[i] ^ key[i & 3];
  return Buffer.concat([header, key, masked]);
}

/** The payload of a close frame: a two-byte code and a reason, both optional. */
function closePayload(code, reason = '') {
  if (code === undefined || code === null) return Buffer.alloc(0);
  const text = Buffer.from(String(reason), 'utf8').subarray(0, 123);
  const out = Buffer.alloc(2 + text.length);
  out.writeUInt16BE(code, 0);
  text.copy(out, 2);
  return out;
}

function parseClose(payload) {
  if (!payload || payload.length < 2) return { code: 1005, reason: '' };
  return { code: payload.readUInt16BE(0), reason: payload.subarray(2).toString('utf8') };
}

/**
 * Feed it bytes as they arrive; it answers with the frames that are complete, each { fin, opcode, payload } with
 * the mask already taken off. Throws on a frame larger than maxPayload, which the caller turns into a close.
 */
function createFrameParser({ maxPayload = MAX_PAYLOAD } = {}) {
  let buf = Buffer.alloc(0);
  function feed(chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : Buffer.from(chunk);
    const frames = [];
    for (;;) {
      if (buf.length < 2) break;
      const b0 = buf[0];
      const b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) break;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) break;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(maxPayload)) throw new Error(`frame of ${big} bytes refused`);
        len = Number(big);
        off = 10;
      }
      if (len > maxPayload) throw new Error(`frame of ${len} bytes refused`);
      const total = off + (masked ? 4 : 0) + len;
      if (buf.length < total) break;
      let payload;
      if (masked) {
        const key = buf.subarray(off, off + 4);
        const data = buf.subarray(off + 4, total);
        payload = Buffer.alloc(len);
        for (let i = 0; i < len; i++) payload[i] = data[i] ^ key[i & 3];
      } else {
        payload = Buffer.from(buf.subarray(off, total));
      }
      frames.push({ fin, opcode, payload });
      buf = buf.subarray(total);
    }
    return frames;
  }
  return { feed };
}

/**
 * Fragments into messages: feed it each data frame (text, binary, continuation) and it answers with the message
 * once the final fragment is in — { opcode, payload } — or null while one is still being assembled.
 */
function createMessageAssembler({ maxPayload = MAX_PAYLOAD } = {}) {
  let opcode = null;
  let parts = [];
  let size = 0;
  function feed(frame) {
    if (frame.opcode === OPCODE.CONTINUATION) {
      if (opcode === null) throw new Error('continuation with nothing to continue');
    } else {
      if (opcode !== null) throw new Error('a new message inside another');
      opcode = frame.opcode;
    }
    size += frame.payload.length;
    if (size > maxPayload) throw new Error(`message of ${size} bytes refused`);
    parts.push(frame.payload);
    if (!frame.fin) return null;
    const message = { opcode, payload: parts.length === 1 ? parts[0] : Buffer.concat(parts) };
    opcode = null;
    parts = [];
    size = 0;
    return message;
  }
  return { feed };
}

/** The headers of an HTTP request or response as a map of lower-cased names, from the text before the blank line. */
function parseHeaders(text) {
  const lines = text.split(/\r?\n/);
  const headers = {};
  for (const line of lines.slice(1)) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return { statusLine: lines[0] || '', headers };
}

module.exports = {
  GUID, OPCODE, MAX_PAYLOAD,
  acceptKey, newKey, encodeFrame, closePayload, parseClose, createFrameParser, createMessageAssembler, parseHeaders,
};
