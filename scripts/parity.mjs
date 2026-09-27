#!/usr/bin/env node
// npm run parity [-- --host-port 18889 --seconds 120]
//
// During a live iRacing session, compares the SimHub plugin's :8889 payload with RacingDesk.Host's, started
// beside it with:  npm run host -- --http-port 18889 --ws-port 18890 --no-hardware --no-record
//
// Samples both once a second and reports, per key, how often the values disagree and an example. Numbers
// are compared with a tolerance (the two readers sample different frames); strings and arrays exactly.

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true] : null).filter(Boolean));
const HOST_PORT = Number(args['host-port'] ?? 18889);
const SECONDS = Number(args.seconds ?? 60);
const PATH = '/racing-desk/';

const get = async (port) => (await fetch(`http://localhost:${port}${PATH}`, { signal: AbortSignal.timeout(1500) })).json();

const close = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') {
    const scale = Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) / scale < 0.02;
  }
  return JSON.stringify(a) === JSON.stringify(b);
};

const stats = new Map();
let samples = 0, inCar = 0;
const end = Date.now() + SECONDS * 1000;
console.log(`comparing :8889 (SimHub) with :${HOST_PORT} (RacingDesk.Host) for ${SECONDS}s…`);

while (Date.now() < end) {
  let simhub, host;
  try { [simhub, host] = await Promise.all([get(8889), get(HOST_PORT)]); }
  catch (e) { console.log(`  sample failed: ${e.message}`); await new Promise((r) => setTimeout(r, 1000)); continue; }
  samples++;
  if (Number(simhub['DataCorePlugin.GameRunning']) === 1) inCar++;
  for (const key of new Set([...Object.keys(simhub), ...Object.keys(host)])) {
    const s = stats.get(key) ?? { differ: 0, missingInHost: 0, missingInSimhub: 0, example: null };
    if (!(key in host)) s.missingInHost++;
    else if (!(key in simhub)) s.missingInSimhub++;
    else if (!close(simhub[key], host[key])) { s.differ++; s.example ??= { simhub: simhub[key], host: host[key] }; }
    stats.set(key, s);
  }
  await new Promise((r) => setTimeout(r, 1000));
}

const rows = [...stats].filter(([, s]) => s.differ || s.missingInHost || s.missingInSimhub)
  .sort((a, b) => (b[1].differ + b[1].missingInHost + b[1].missingInSimhub) - (a[1].differ + a[1].missingInHost + a[1].missingInSimhub));
console.log(`\n${samples} samples (${inCar} with the game running), ${stats.size} keys, ${rows.length} with disagreements\n`);
for (const [key, s] of rows) {
  const what = s.missingInHost ? `missing in host ×${s.missingInHost}` : s.missingInSimhub ? `host only ×${s.missingInSimhub}` : `differ ${s.differ}/${samples}`;
  const ex = s.example ? `  simhub=${JSON.stringify(s.example.simhub).slice(0, 60)}  host=${JSON.stringify(s.example.host).slice(0, 60)}` : '';
  console.log(`${key.padEnd(62)} ${what}${ex}`);
}
