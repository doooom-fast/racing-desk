/**
 * How the app finds or starts RaceCor.Host: what an answer on :8889 means, which ports follow, the argv, where
 * the exe is — and the start decision itself, with fake probes and a fake spawn (no ports, no processes).
 */

import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  classifyStatus, choosePorts, hostArgs, hostExePath, hostExeCandidates, startHost, stopHost, waitForHost,
} = require('../../modules/js/host-launcher.js');

const HOST = { answered: true, status: 200, body: '{"schemaVersion":3,"sessions":120}' };
const SIMHUB = { answered: true, status: 200, body: '{"sessions":0}' };
const FREE = { answered: false, error: 'ECONNREFUSED' };

test.describe('classifyStatus', () => {
  test('the host answers with a numeric schemaVersion', () => {
    expect(classifyStatus(HOST)).toBe('host');
  });

  test('anything else answering is SimHub, or something like it', () => {
    for (const result of [
      SIMHUB,
      { answered: true, status: 200, body: '{"schemaVersion":"3"}' },
      { answered: true, status: 404, body: 'Not found' },
      { answered: true, status: 200, body: '' },
      { answered: true, status: 200, body: 'null' },
    ]) {
      expect(classifyStatus(result), result.body).toBe('other');
    }
  });

  test('refused or timed out means the port is free', () => {
    expect(classifyStatus(FREE)).toBe('free');
    expect(classifyStatus({ answered: false, error: 'timeout' })).toBe('free');
    expect(classifyStatus(undefined)).toBe('free');
  });
});

test.describe('choosePorts and hostArgs', () => {
  test('beside SimHub: 18889/18890 and no hardware', () => {
    const ports = choosePorts('other');
    expect(ports).toEqual({ http: 18889, ws: 18890, noHardware: true });
    expect(hostArgs(ports)).toEqual(['--http-port', '18889', '--ws-port', '18890', '--no-hardware']);
  });

  test('otherwise the usual ports, with hardware', () => {
    for (const what of ['free', 'host']) {
      expect(choosePorts(what), what).toEqual({ http: 8889, ws: 8890, noHardware: false });
    }
    expect(hostArgs(choosePorts('free'))).toEqual(['--http-port', '8889', '--ws-port', '8890']);
  });

  test('the host is told which process to outlive by no more than a moment', () => {
    expect(hostArgs(choosePorts('free'), { parentPid: 1234 })).toEqual(['--http-port', '8889', '--ws-port', '8890', '--parent-pid', '1234']);
    expect(hostArgs(choosePorts('other'), { parentPid: 1234 })).toEqual(['--http-port', '18889', '--ws-port', '18890', '--no-hardware', '--parent-pid', '1234']);
  });
});

test.describe('hostExePath', () => {
  test('packaged: resources/host next to the app, spaces intact', () => {
    const resourcesPath = 'C:\\Users\\Kevin Conboy\\Racing Desk\\resources';
    const where = { isPackaged: true, resourcesPath, appDir: 'C:\\ignored' };
    const exe = hostExePath(where);
    expect(exe).toBe(path.join(resourcesPath, 'host', 'RaceCor.Host.exe'));
    expect(exe.startsWith(resourcesPath)).toBe(true);
    expect(hostExeCandidates(where)).toEqual([exe]);
  });

  test('dev: the host project build beside apps/overlay, then what build:host publishes', () => {
    const appDir = path.join('C:\\Users\\Kevin Conboy\\Documents\\GitHub\\prodrive', 'apps', 'overlay');
    const hostDir = path.join(appDir, '..', 'host');
    const [built, published] = hostExeCandidates({ isPackaged: false, appDir });
    expect(built).toBe(path.join(hostDir, 'RaceCor.Host', 'bin', 'Release', 'net8.0-windows', 'RaceCor.Host.exe'));
    expect(published).toBe(path.join(hostDir, 'publish', 'RaceCor.Host.exe'));
    expect(built).not.toContain('..');
    expect(built).toContain('Kevin Conboy');
    expect(hostExePath({ isPackaged: false, appDir })).toBe(built);
  });
});

test.describe('startHost', () => {
  const logPath = path.join(os.tmpdir(), `racing-desk-host-launcher-${process.pid}.log`);
  const where = { isPackaged: true, resourcesPath: 'C:\\Racing Desk\\resources', appDir: 'C:\\ignored' };
  const exe = path.join(where.resourcesPath, 'host', 'RaceCor.Host.exe');

  function fakeChild() {
    const child = new EventEmitter();
    child.pid = 4242;
    child.exitCode = null;
    child.killed = false;
    child.kill = () => { child.killed = true; return true; };
    return child;
  }

  // answers: { [port]: probeResult }; anything unlisted is free.
  function fakes(answers) {
    const probed = [];
    const spawned = [];
    return {
      probed,
      spawned,
      probe: async (url) => { probed.push(url); return answers[new URL(url).port] || FREE; },
      spawn: (file, args, opts) => { spawned.push({ file, args, opts }); return fakeChild(); },
      exists: () => true,
      logPath,
      parentPid: 777,
    };
  }

  const lastLogLine = () => fs.readFileSync(logPath, 'utf8').trimEnd().split('\n').pop();

  test.afterAll(() => { try { fs.unlinkSync(logPath); } catch (e) { /* never written */ } });

  test(':8889 free: the host takes it, with hardware, hidden, logging to host.log', async () => {
    const f = fakes({});
    const result = await startHost({ ...where, ...f });
    expect(result.url).toBe('http://localhost:8889');
    expect(result.child).not.toBeNull();
    expect(result.reason).toContain('host on :8889');
    expect(f.probed).toEqual(['http://localhost:8889/racecor-io-pro-drive/data/status']);
    expect(f.spawned).toHaveLength(1);
    expect(f.spawned[0].file).toBe(exe);
    expect(f.spawned[0].args).toEqual(['--http-port', '8889', '--ws-port', '8890', '--parent-pid', '777']);
    expect(f.spawned[0].opts).toMatchObject({ cwd: path.dirname(exe), windowsHide: true, detached: false });
    expect(lastLogLine()).toMatch(/^==== \d{4}-\d\d-\d\dT\S+ host on :8889: .*RaceCor\.Host\.exe --http-port 8889 --ws-port 8890 --parent-pid 777$/);
  });

  test('SimHub on :8889: beside it on :18889, without hardware', async () => {
    const f = fakes({ 8889: SIMHUB });
    const result = await startHost({ ...where, ...f });
    expect(result.url).toBe('http://localhost:18889');
    expect(result.reason).toMatch(/^SimHub holds :8889, host on :18889 without hardware \(pid 4242, log /);
    expect(f.probed.map((u) => new URL(u).port)).toEqual(['8889', '18889']);
    expect(f.spawned[0].args).toEqual(['--http-port', '18889', '--ws-port', '18890', '--no-hardware', '--parent-pid', '777']);
  });

  test('a host already running is used, not duplicated', async () => {
    for (const [answers, url] of [
      [{ 8889: HOST }, 'http://localhost:8889'],
      [{ 8889: SIMHUB, 18889: HOST }, 'http://localhost:18889'],
    ]) {
      const f = fakes(answers);
      const result = await startHost({ ...where, ...f });
      expect(result.url).toBe(url);
      expect(result.child).toBeNull();
      expect(result.reason).toContain(`using the host already on :${new URL(url).port}`);
      expect(f.spawned).toHaveLength(0);
      expect(lastLogLine()).toMatch(new RegExp(`^==== \\S+ .*using the host already on :${new URL(url).port}$`));
    }
  });

  test('something that is not the host on :18889: nothing started, no URL', async () => {
    const f = fakes({ 8889: SIMHUB, 18889: SIMHUB });
    const result = await startHost({ ...where, ...f });
    expect(result).toEqual({ url: null, child: null, reason: "SimHub holds :8889, something that isn't the host answers on :18889" });
    expect(f.spawned).toHaveLength(0);
  });

  test('no exe: nothing started, and the reason says how to build one — in host.log too', async () => {
    const f = fakes({});
    const result = await startHost({ ...where, ...f, exists: () => false });
    expect(result).toEqual({ url: null, child: null, reason: `no host exe at ${exe}; run npm run build:host` });
    expect(f.spawned).toHaveLength(0);
    expect(lastLogLine()).toMatch(/^==== \d{4}-\d\d-\d\dT\S+ no host exe at .*RaceCor\.Host\.exe; run npm run build:host$/);
  });

  test('in dev the published exe is used when the project build is missing', async () => {
    const appDir = path.join('C:\\dev', 'prodrive', 'apps', 'overlay');
    const published = path.join(appDir, '..', 'host', 'publish', 'RaceCor.Host.exe');
    const f = fakes({});
    const result = await startHost({ isPackaged: false, appDir, ...f, exists: (p) => p === published });
    expect(result.child).not.toBeNull();
    expect(f.spawned[0].file).toBe(published);
  });

  test('waitForHost gives up as soon as the child it waits for has exited', async () => {
    const probed = [];
    const probe = async (url) => { probed.push(url); return FREE; };
    const gone = fakeChild();
    gone.exitCode = 1;
    const started = Date.now();
    expect(await waitForHost('http://localhost:8889', { timeoutMs: 5000, intervalMs: 10, probe, child: gone })).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(probed).toEqual([]);

    // Still alive: it keeps asking until the deadline.
    expect(await waitForHost('http://localhost:8889', { timeoutMs: 40, intervalMs: 10, probe, child: fakeChild() })).toBe(false);
    expect(probed.length).toBeGreaterThan(1);
  });

  test('stopHost kills a live child and leaves a finished one alone', () => {
    const live = fakeChild();
    stopHost(live);
    expect(live.killed).toBe(true);

    const finished = fakeChild();
    finished.exitCode = 0;
    finished.kill = () => { throw new Error('kill called on a finished child'); };
    stopHost(finished);
    stopHost(null);
  });

  test('with a grace period the kill waits, and is skipped for a child that stopped by itself', async () => {
    const slow = fakeChild();
    const prompt = fakeChild();
    stopHost(slow, { graceMs: 30 });
    stopHost(prompt, { graceMs: 30 });
    expect(slow.killed).toBe(false);
    prompt.exitCode = 0;   // saw its parent go and stopped
    prompt.kill = () => { throw new Error('kill called on a child that had already stopped'); };
    await new Promise((r) => setTimeout(r, 80));
    expect(slow.killed).toBe(true);
  });
});
