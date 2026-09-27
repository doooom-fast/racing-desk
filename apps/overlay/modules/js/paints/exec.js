// Run a command with no console window and hand back what it said. The Rust drove `tasklist`, `reg` and `git`
// as commands with CREATE_NO_WINDOW; `windowsHide` is the same flag. This never throws and never blocks the
// caller: a tool that could not be started comes back with `error` set, so each module decides what an absent
// tool means (no git → "cannot update"; no tasklist → "nothing is running"). Every module takes `exec` as an
// injectable so the unit tests can run with canned output and start no processes at all.
const { spawn } = require('child_process');

function run(file, args, { cwd, env, timeoutMs } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ status: null, signal: null, stdout: '', stderr: '', error: e });
      return;
    }
    const out = [];
    const err = [];
    let done = false;
    let timer = null;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        ...result,
      });
    };
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    if (timeoutMs) {
      timer = setTimeout(() => {
        try { child.kill(); } catch (e) { /* already gone */ }
        finish({ status: null, signal: 'SIGTERM', error: new Error(`${file} took longer than ${timeoutMs} ms`) });
      }, timeoutMs);
    }
    child.on('error', (e) => finish({ status: null, signal: null, error: e }));
    child.on('close', (status, signal) => finish({ status, signal, error: null }));
  });
}

module.exports = { run };
