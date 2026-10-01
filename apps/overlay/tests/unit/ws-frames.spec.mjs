/**
 * The WebSocket framing the OBS client and the Stream Deck plugin are built on (modules/js/obs/ws-frames.js), and
 * the client over a plain socket (ws-client.js) against the test's own server on 127.0.0.1.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { startWsServer } from './ws-fake-server.mjs';

const require = createRequire(import.meta.url);
const frames = require('../../modules/js/obs/ws-frames.js');
const { connect } = require('../../modules/js/obs/ws-client.js');

test.describe('frames', () => {
  test('the accept key is the RFC\'s example', () => {
    expect(frames.acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  test('a frame of each length class comes back whole, masked or not', () => {
    const parser = frames.createFrameParser();
    for (const len of [0, 1, 125, 126, 1000, 65535, 65536, 200000]) {
      const payload = Buffer.alloc(len, 0xab);
      for (const mask of [false, true]) {
        const [frame] = parser.feed(frames.encodeFrame({ opcode: frames.OPCODE.BINARY, payload, mask }));
        expect(frame.fin).toBe(true);
        expect(frame.opcode).toBe(frames.OPCODE.BINARY);
        expect(frame.payload.equals(payload), `${len} bytes, mask ${mask}`).toBe(true);
      }
    }
  });

  test('bytes arriving in pieces, and several frames in one piece, are parsed all the same', () => {
    const a = frames.encodeFrame({ opcode: frames.OPCODE.TEXT, payload: Buffer.from('hello'), mask: true });
    const b = frames.encodeFrame({ opcode: frames.OPCODE.TEXT, payload: Buffer.from('world'), mask: true });
    const all = Buffer.concat([a, b]);
    const parser = frames.createFrameParser();
    let got = [];
    for (let i = 0; i < all.length; i++) got = got.concat(parser.feed(all.subarray(i, i + 1)));
    expect(got.map((f) => f.payload.toString())).toEqual(['hello', 'world']);
    expect(frames.createFrameParser().feed(all).map((f) => f.payload.toString())).toEqual(['hello', 'world']);
  });

  test('a message in fragments is one message; a frame too large is refused', () => {
    const assembler = frames.createMessageAssembler();
    expect(assembler.feed({ fin: false, opcode: frames.OPCODE.TEXT, payload: Buffer.from('ab') })).toBeNull();
    expect(assembler.feed({ fin: false, opcode: frames.OPCODE.CONTINUATION, payload: Buffer.from('cd') })).toBeNull();
    const message = assembler.feed({ fin: true, opcode: frames.OPCODE.CONTINUATION, payload: Buffer.from('ef') });
    expect(message.opcode).toBe(frames.OPCODE.TEXT);
    expect(message.payload.toString()).toBe('abcdef');
    const small = frames.createFrameParser({ maxPayload: 10 });
    expect(() => small.feed(frames.encodeFrame({ opcode: frames.OPCODE.TEXT, payload: Buffer.alloc(11) }))).toThrow(/refused/);
  });

  test('a close frame carries its code and reason', () => {
    expect(frames.parseClose(frames.closePayload(4009, 'Authentication failed.'))).toEqual({ code: 4009, reason: 'Authentication failed.' });
    expect(frames.parseClose(Buffer.alloc(0))).toEqual({ code: 1005, reason: '' });
  });
});

test.describe('the client', () => {
  let server;
  const received = [];
  test.beforeEach(async () => {
    received.length = 0;
    server = await startWsServer({
      protocol: 'obswebsocket.json',
      onConnection(conn) {
        conn.on('message', (text) => { received.push(text); conn.send(`echo:${text}`); });
      },
    });
  });
  test.afterEach(async () => { await server.close(); });

  const opened = (ws) => new Promise((resolve) => ws.on('open', resolve));
  const closed = (ws) => new Promise((resolve) => ws.on('close', resolve));
  const message = (ws) => new Promise((resolve) => ws.once('message', resolve));

  test('shakes hands, chooses the protocol, sends and receives text, and closes cleanly', async () => {
    const ws = connect({ port: server.port, protocols: ['obswebsocket.json'] });
    const { protocol } = await opened(ws);
    expect(protocol).toBe('obswebsocket.json');
    expect(ws.isOpen()).toBe(true);
    const reply = message(ws);
    ws.send('hi');
    expect(await reply).toBe('echo:hi');
    expect(received).toEqual(['hi']);
    const big = 'x'.repeat(70000);
    const bigReply = message(ws);
    ws.send(big);
    expect(await bigReply).toBe(`echo:${big}`);
    const done = closed(ws);
    ws.close(1000, 'bye');
    expect((await done).code).toBe(1000);
    expect(ws.isOpen()).toBe(false);
  });

  test('a server that closes the connection with a code says so once, with the code', async () => {
    const ws = connect({ port: server.port });
    await opened(ws);
    const closes = [];
    ws.on('close', (c) => closes.push(c));
    server.closeAll(4009, 'Authentication failed.');
    await new Promise((r) => setTimeout(r, 200));
    expect(closes).toEqual([{ code: 4009, reason: 'Authentication failed.' }]);
  });

  test('a port nothing listens on, and a server that is not a WebSocket one, close with 1006 and a reason in words', async () => {
    const free = await startWsServer();
    const port = free.port;
    await free.close();
    const refused = await closed(connect({ port, timeoutMs: 2000 }));
    expect(refused.code).toBe(1006);
    expect(refused.reason).toMatch(/ECONNREFUSED|cut|ended/i);

    const { createServer } = await import('node:http');
    const plain = createServer((req, res) => { res.writeHead(200); res.end('hello'); });
    await new Promise((r) => plain.listen(0, '127.0.0.1', r));
    try {
      const answer = await closed(connect({ port: plain.address().port }));
      expect(answer.code).toBe(1006);
      expect(answer.reason).toMatch(/handshake refused: HTTP\/1\.1 200/);
    } finally {
      await new Promise((r) => plain.close(r));
    }
  });

  test('a cut socket is a close of 1006', async () => {
    const ws = connect({ port: server.port });
    await opened(ws);
    const done = closed(ws);
    for (const c of server.clients) c.destroy();
    expect((await done).code).toBe(1006);
  });
});
