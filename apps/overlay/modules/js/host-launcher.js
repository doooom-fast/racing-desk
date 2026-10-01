// Starts RacingDesk.Host beside the overlay so the app is one double-click: probe :8889, decide where the host
// goes, spawn it with no console window, and hand main.js the URL the desk should read. The port rule:
// SimHub's plugin holds :8889 while SimHub runs, so beside it the host serves :18889/:18890 and leaves the
// Moza serial port alone; otherwise it takes :8889/:8890 itself. The host's stdout goes to
// %LOCALAPPDATA%\RacingDesk\host.log, since there is no window to read it in, and every start attempt writes
// its one-line outcome there too — the packaged app has nowhere else a person can read it.
//
// The host is told our pid (--parent-pid) and shuts itself down, flushing what it was recording, when this
// process goes away by any route: quit, app.exit(), a crash, End task — and if that stop is not over five seconds
// after we went, it ends its own process (apps/host/RacingDesk.Host/HostStop.cs). That deadline has to be the host's:
// a host that outlives the app has nothing of the app left to end it. stopHost() is only the backstop for while the
// app is still here.
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const STATUS_PATH = '/racing-desk/data/status';
const HOST_PORTS = { http: 8889, ws: 8890 };
const BESIDE_SIMHUB_PORTS = { http: 18889, ws: 18890 };

function statusUrl(port) {
  return `http://localhost:${port}${STATUS_PATH}`;
}

// What a probe of the status URL says is on that port. The host answers with JSON carrying a numeric
// schemaVersion; SimHub's plugin answers the same URL, but without one; nothing there → refused or timed out.
function classifyStatus(probeResult) {
  if (!probeResult || !probeResult.answered) return 'free';
  try {
    const body = JSON.parse(probeResult.body);
    return body && typeof body.schemaVersion === 'number' ? 'host' : 'other';
  } catch (e) {
    return 'other';
  }
}

function choosePorts(what8889Is) {
  return what8889Is === 'other'
    ? { ...BESIDE_SIMHUB_PORTS, noHardware: true }
    : { ...HOST_PORTS, noHardware: false };
}

function hostArgs(ports, { parentPid } = {}) {
  const args = ['--http-port', String(ports.http), '--ws-port', String(ports.ws)];
  if (ports.noHardware) args.push('--no-hardware');
  if (parentPid) args.push('--parent-pid', String(parentPid));
  return args;
}

// Packaged: electron-builder copies apps/host/publish into resources/host. Dev: what `npm run host` builds,
// falling back to what `npm run build:host` publishes.
function hostExeCandidates({ isPackaged, resourcesPath, appDir }) {
  if (isPackaged) return [path.join(resourcesPath, 'host', 'RacingDesk.Host.exe')];
  const hostDir = path.join(appDir, '..', 'host');
  return [
    path.join(hostDir, 'RacingDesk.Host', 'bin', 'Release', 'net8.0-windows', 'RacingDesk.Host.exe'),
    path.join(hostDir, 'publish', 'RacingDesk.Host.exe'),
  ];
}

function hostExePath(where) {
  return hostExeCandidates(where)[0];
}

function hostLogPath() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(local, 'Racing Desk', 'host.log');   // the host's data folder (RacingDesk.Data/DataFolder.cs)
}

// Append one dated launcher line to host.log and hand back the open descriptor (null when the file can't be
// written) — the caller either gives it to the child as stdout or closes it.
function openLog(logPath, line, log) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const fd = fs.openSync(logPath, 'a');
    fs.writeSync(fd, `\n==== ${new Date().toISOString()} ${line}\n`);
    return fd;
  } catch (e) {
    log(`host log ${logPath} not writable: ${e.message}`);
    return null;
  }
}

// GET the URL; resolves { answered, status, body } or { answered: false, error } — never rejects.
function probe(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => { if (!done) { done = true; resolve(result); } };
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => finish({ answered: true, status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => finish({ answered: true, status: res.statusCode, body: '' }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => finish({ answered: false, error: err.code || err.message }));
  });
}

// Poll the status URL until a host answers there, or give up at the deadline — or sooner, when the child this
// wait is for has already exited (the host stops itself when its port turns out to be taken). Returns whether
// a host answered.
async function waitForHost(url, { timeoutMs = 10000, intervalMs = 500, probe: probeFn = probe, child = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) return false;
    if (classifyStatus(await probeFn(url + STATUS_PATH, intervalMs)) === 'host') return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Find or start the host. Resolves { url, child, reason }: url is where a host is (or will be) serving, null
 * when there is none; child is the process this call spawned, null when it found one already running or
 * couldn't start one; reason is a one-line explanation, written to host.log and returned for the app's log.
 *
 * probe / spawn / exists / logPath / parentPid are injectable so the decision flow can be tested without
 * ports or processes.
 */
async function startHost({
  isPackaged, resourcesPath, appDir,
  probe: probeFn = probe, spawn: spawnFn = spawn, exists = fs.existsSync, logPath = hostLogPath(), log = () => {},
  parentPid = process.pid,
}) {
  // Every way out that spawns nothing still leaves its reason in host.log.
  const noSpawn = (result) => {
    const fd = openLog(logPath, result.reason, log);
    if (fd !== null) fs.closeSync(fd);
    return result;
  };

  const what8889Is = classifyStatus(await probeFn(statusUrl(HOST_PORTS.http)));
  if (what8889Is === 'host') {
    return noSpawn({ url: `http://localhost:${HOST_PORTS.http}`, child: null, reason: 'using the host already on :8889' });
  }
  const ports = choosePorts(what8889Is);
  const url = `http://localhost:${ports.http}`;
  const beside = what8889Is === 'other' ? 'SimHub holds :8889, ' : '';
  if (what8889Is === 'other') {
    const onChosen = classifyStatus(await probeFn(statusUrl(ports.http)));
    if (onChosen === 'host') return noSpawn({ url, child: null, reason: `${beside}using the host already on :${ports.http}` });
    if (onChosen === 'other') return noSpawn({ url: null, child: null, reason: `${beside}something that isn't the host answers on :${ports.http}` });
  }

  const where = { isPackaged, resourcesPath, appDir };
  const exe = hostExeCandidates(where).find((p) => exists(p));
  if (!exe) return noSpawn({ url: null, child: null, reason: `no host exe at ${hostExePath(where)}; run npm run build:host` });

  const args = hostArgs(ports, { parentPid });
  const what = `${beside}host on :${ports.http}${ports.noHardware ? ' without hardware' : ''}`;
  const logFd = openLog(logPath, `${what}: ${exe} ${args.join(' ')}`, log);
  const out = logFd === null ? 'ignore' : logFd;
  // detached: on Windows, Node puts an attached child in a job object that is killed outright the moment this
  // process ends — so on every quit the host was terminated mid-write, never reaching its own orderly stop.
  // Detached, it outlives us for the second it takes to see --parent-pid go, flush and exit. No console either way.
  const child = spawnFn(exe, args, {
    cwd: path.dirname(exe),
    windowsHide: true,
    detached: true,
    stdio: ['ignore', out, out],
  });
  if (logFd !== null) fs.closeSync(logFd);   // the child holds its own handle
  child.on('error', (err) => log(`host failed to start: ${err.message}`));
  child.on('exit', (code, signal) => log(`host exited (${signal || code})`));
  return { url, child, reason: `${what} (pid ${child.pid}, log ${logPath})` };
}

// Kill the host this app started. With graceMs the kill waits that long, unref'd, so the host has the chance
// to see its parent go and stop by itself — on a quit the app is gone long before the timer fires, and the
// timer goes with it; the kill only happens if the app is still here and so is the host.
function stopHost(child, { graceMs = 0 } = {}) {
  if (!child || child.exitCode !== null || child.killed) return;
  const kill = () => {
    if (child.exitCode !== null || child.killed) return;
    try { child.kill(); } catch (e) { /* already gone */ }
  };
  if (graceMs > 0) setTimeout(kill, graceMs).unref();
  else kill();
}

module.exports = {
  STATUS_PATH, classifyStatus, choosePorts, hostArgs, hostExeCandidates, hostExePath, hostLogPath,
  probe, waitForHost, startHost, stopHost,
};
