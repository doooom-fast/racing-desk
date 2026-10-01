/**
 * The obs-websocket 5 client (modules/js/obs/client.js) against the fake server (fake-obs.mjs) on 127.0.0.1: the
 * handshake, the password right and wrong and missing, requests once identified and the status codes, events, the
 * connection tried again after OBS exits or the socket is cut, and the password never in a log line.
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { startFakeObs, authString } from './fake-obs.mjs';

const require = createRequire(import.meta.url);
const { createObsClient, authentication, SUBSCRIPTIONS } = require('../../modules/js/obs/client.js');

const PASSWORD = 'correct-horse-battery';
const until = async (what, timeoutMs = 3000) => {
  const start = Date.now();
  while (!what()) {
    if (Date.now() - start > timeoutMs) throw new Error('waited too long');
    await new Promise((r) => setTimeout(r, 15));
  }
};

function makeClient(server, options = {}) {
  const lines = [];
  const client = createObsClient({
    port: server.port,
    password: () => PASSWORD,
    retryMs: 60, authRetryMs: 120, requestTimeoutMs: 1500, connectTimeoutMs: 1000,
    log: (line) => lines.push(line),
    ...options,
  });
  return { client, lines };
}

test('the authentication string is the protocol\'s: base64(sha256(base64(sha256(password + salt)) + challenge))', () => {
  const salt = 'lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=';
  const challenge = '+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=';
  expect(authentication('supersecretpassword', { salt, challenge })).toBe(authString('supersecretpassword', salt, challenge));
  expect(authentication('supersecretpassword', { salt, challenge })).toMatch(/^[A-Za-z0-9+/]{43}=$/);
});

test.describe('with the right password', () => {
  let server;
  test.beforeEach(async () => { server = await startFakeObs({ password: PASSWORD }); });
  test.afterEach(async () => { await server.close(); });

  test('identifies, subscribes to General, Config and Outputs, and answers requests', async () => {
    const { client, lines } = makeClient(server);
    const phases = [];
    client.onChange((s) => phases.push(s.phase));
    client.start();
    await until(() => client.identified());
    expect(server.identified()).toBe(1);
    expect(server.clients()[0].subscriptions).toBe(SUBSCRIPTIONS);
    expect(phases).toEqual(['connecting', 'hello', 'identified']);
    expect(client.state().obsVersion).toBe('32.1.2');
    expect(client.state().wsVersion).toBe('5.7.3');
    const version = await client.request('GetVersion');
    expect(version.obsVersion).toBe('32.1.2');
    expect(server.requests.map((r) => r.type)).toEqual(['GetVersion']);
    // A request with no response data resolves to {}.
    expect(await client.request('SetProfileParameter', { parameterCategory: 'AdvOut', parameterName: 'RecFormat2', parameterValue: 'hybrid_mp4' })).toEqual({});
    expect(server.state.profile.AdvOut.RecFormat2).toBe('hybrid_mp4');
    expect(lines.join('\n')).toMatch(/password: set/);
    client.stop();
    await until(() => server.identified() === 0);
    expect(client.state().phase).toBe('stopped');
  });

  test('a request that fails is rejected with the status code and OBS\'s comment', async () => {
    const { client } = makeClient(server);
    client.start();
    await until(() => client.identified());
    server.startRecording();
    await until(() => server.state.recording);
    const err = await client.request('StartRecord').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(500);
    expect(err.message).toBe('StartRecord: The output is already running.');
    const unknown = await client.request('MakeTea').catch((e) => e);
    expect(unknown.code).toBe(204);
    client.stop();
  });

  test('207 NotReady is asked again a moment later, with the same id', async () => {
    const { client } = makeClient(server, { notReadyRetryMs: 30 });
    client.start();
    await until(() => client.identified());
    server.mode.notReadyOnce = true;
    const version = await client.request('GetVersion');
    expect(version.obsVersion).toBe('32.1.2');
    expect(server.requests.filter((r) => r.type === 'GetVersion')).toHaveLength(2);
    client.stop();
  });

  test('a request OBS never answers times out; one made while not identified is refused at once', async () => {
    const { client } = makeClient(server, { requestTimeoutMs: 120 });
    const early = await client.request('GetVersion').catch((e) => e);
    expect(early.code).toBe('not-connected');
    expect(early.message).toBe("GetVersion: OBS isn't open");
    client.start();
    await until(() => client.identified());
    server.handlers.GetVersion = () => new Promise(() => {});
    const late = await client.request('GetVersion').catch((e) => e);
    expect(late.code).toBe('timeout');
    client.stop();
  });

  test('events arrive by name and as a whole, with their data', async () => {
    const { client } = makeClient(server);
    const got = [];
    const all = [];
    client.on('RecordStateChanged', (data) => got.push(data.outputState + (data.outputPath ? ':' + data.outputPath : '')));
    client.on('*', (data, type) => all.push(type));
    client.start();
    await until(() => client.identified());
    server.startRecording('D:/Racing Desk/Recordings/2026-09-30 21-00-00.mp4');
    await until(() => got.length === 2);
    expect(got).toEqual(['OBS_WEBSOCKET_OUTPUT_STARTING', 'OBS_WEBSOCKET_OUTPUT_STARTED:D:/Racing Desk/Recordings/2026-09-30 21-00-00.mp4']);
    server.stopRecording();
    await until(() => got.length === 4);
    expect(got[3]).toBe('OBS_WEBSOCKET_OUTPUT_STOPPED:D:/Racing Desk/Recordings/2026-09-30 21-00-00.mp4');
    expect(all).toEqual(['RecordStateChanged', 'RecordStateChanged', 'RecordStateChanged', 'RecordStateChanged']);
    client.stop();
  });

  test('OBS exiting, or the socket cut, is a closed connection that is tried again and comes back', async () => {
    const { client, lines } = makeClient(server);
    const exits = [];
    client.on('ExitStarted', () => exits.push(1));
    client.start();
    await until(() => client.identified());
    server.handlers.GetVersion = () => new Promise(() => {});
    const pendingWhileExiting = client.request('GetVersion').catch((e) => e);
    await server.exitStarted();
    await until(() => client.state().phase === 'closed');
    expect(exits).toEqual([1]);
    const err = await pendingWhileExiting;
    expect(err.code).toBe('disconnected');
    expect(client.state().lastClose.code).toBe(1001);
    // Back: the fake is still listening, as OBS would be once started again.
    await until(() => client.identified());
    expect(server.identified()).toBe(1);
    expect(client.state().attempts).toBe(0);

    for (const s of server.clients()) s.conn.destroy();
    await until(() => client.state().phase === 'closed');
    expect(client.state().lastClose.code).toBe(1006);
    await until(() => client.identified());
    expect(lines.some((l) => /the connection closed/.test(l))).toBe(true);
    client.stop();
  });

  test('tryNow connects at once instead of at the next retry', async () => {
    const { client } = makeClient(server, { retryMs: 5000 });
    client.start();
    await until(() => client.identified());
    for (const s of server.clients()) s.conn.destroy();
    await until(() => client.state().phase === 'closed');
    client.tryNow();
    await until(() => client.identified(), 1000);
    client.stop();
  });
});

test.describe('the password', () => {
  test('wrong: OBS closes with 4009, the client says so and tries again only every authRetryMs; right again on passwordChanged', async () => {
    const server = await startFakeObs({ password: PASSWORD });
    let pw = 'wrong';
    const { client, lines } = makeClient(server, { password: () => pw, retryMs: 40, authRetryMs: 400 });
    try {
      client.start();
      await until(() => client.state().authFailed);
      expect(client.state().passwordMissing).toBe(false);
      expect(client.state().lastClose.code).toBe(4009);
      expect(server.identified()).toBe(0);
      const attemptsAfterFailure = client.state().attempts;
      await new Promise((r) => setTimeout(r, 200));
      expect(client.state().attempts).toBe(attemptsAfterFailure);   // not every 40 ms: a refused password waits
      pw = PASSWORD;
      client.passwordChanged();
      await until(() => client.identified());
      expect(client.state().authFailed).toBe(false);
      expect(lines.join('\n')).toMatch(/refused the password \(password: set\)/);
      expect(lines.join('\n')).not.toContain(PASSWORD);
      expect(lines.join('\n')).not.toContain('wrong');
    } finally {
      client.stop();
      await server.close();
    }
  });

  test('none to give: no Identify is sent, the state says a password is missing, and the log says "password: none"', async () => {
    const server = await startFakeObs({ password: PASSWORD });
    const { client, lines } = makeClient(server, { password: () => null, authRetryMs: 300 });
    try {
      client.start();
      await until(() => client.state().passwordMissing);
      expect(server.identified()).toBe(0);
      expect(client.state().lastClose.code).toBe(1000);
      expect(lines.join('\n')).toMatch(/password: none/);
    } finally {
      client.stop();
      await server.close();
    }
  });

  test('not required: the client identifies without one', async () => {
    const server = await startFakeObs({ authRequired: false });
    const { client, lines } = makeClient(server, { password: () => null });
    try {
      client.start();
      await until(() => client.identified());
      expect(lines.join('\n')).toMatch(/password: not needed/);
    } finally {
      client.stop();
      await server.close();
    }
  });

  test('is never in a log line, whatever the server does', async () => {
    const server = await startFakeObs({ password: PASSWORD });
    const { client, lines } = makeClient(server);
    try {
      client.start();
      await until(() => client.identified());
      await client.request('GetVersion');
      server.closeAll(4009, 'Authentication failed.');
      await until(() => client.state().phase === 'closed');
      await server.exitStarted();
      expect(lines.length).toBeGreaterThan(2);
      for (const line of lines) expect(line).not.toContain(PASSWORD);
    } finally {
      client.stop();
      await server.close();
    }
  });
});

test('with nothing listening it keeps trying every retryMs and connects once something does', async () => {
  const probe = await startFakeObs({ password: PASSWORD });
  const port = probe.port;
  await probe.close();
  const { client } = makeClient({ port }, { retryMs: 50 });
  client.start();
  await until(() => client.state().attempts >= 3, 3000);
  expect(client.state().phase === 'closed' || client.state().phase === 'connecting').toBe(true);
  expect(client.state().lastClose.code).toBe(1006);
  client.stop();
});
