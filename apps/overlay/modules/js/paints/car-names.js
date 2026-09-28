// What the local store calls each car. The store keeps the name the sim gave every car that has been in one of
// the driver's sessions, and RacingDesk.Host serves them read-only:
//
//   GET <host>/racing-desk/data/cars
//   [ { "car_path": "mx5 mx52016", "name": "Mazda MX-5 Cup", "short_name": "MX-5 Cup", "car_id": 67,
//       "driven": 668, "seen": 702 } ]
//
// `driven` is the driver's own sessions in the car, `seen` the sessions whose entry list had it. A car that has
// never been in a session is not there and has no name; the Paints page shows its folder instead.
//
// Names are a nicety. Anything going wrong — no host, a host from before this route, a slow answer — is an empty
// list, never an error, and only a good answer is kept: a host that was still starting is asked again next time.
const http = require('http');

const CARS_PATH = '/racing-desk/data/cars';
const TIMEOUT_MS = 3000;
const KEEP_MS = 60000;

// GET the URL and parse it; rejects on anything but a 200 carrying JSON.
function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`${url} answered ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(e);
        }
      });
    });
    // `timeout` is how long the socket may sit idle; the timer is the whole request, so a host that trickles its
    // answer cannot hold the page's list up either.
    const timer = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
  });
}

// `host` returns where the host is now (it can move while the app runs: :8889, or :18889 beside SimHub). Returns
// an async function answering the store's rows. `get` and `now` are injectable for the tests.
function createCarNames({ host, get = getJson, now = Date.now, timeoutMs = TIMEOUT_MS, keepMs = KEEP_MS } = {}) {
  let kept = null;   // { url, at, rows }
  return async function carNames() {
    let url;
    try {
      const base = typeof host === 'function' ? host() : host;
      if (typeof base !== 'string' || !base.length) return [];
      url = base.replace(/\/+$/, '') + CARS_PATH;
    } catch (e) {
      return [];
    }
    if (kept && kept.url === url && now() - kept.at < keepMs) return kept.rows;
    try {
      const body = await get(url, timeoutMs);
      if (!Array.isArray(body)) return [];
      const rows = body.filter((r) => r !== null && typeof r === 'object' && typeof r.car_path === 'string');
      kept = { url, at: now(), rows };
      return rows;
    } catch (e) {
      return [];
    }
  };
}

module.exports = { CARS_PATH, TIMEOUT_MS, KEEP_MS, getJson, createCarNames };
