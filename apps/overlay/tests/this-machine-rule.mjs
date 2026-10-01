// Who RacingDesk.Host answers when it is asked for its data (/racing-desk/data/…), for the stand-in hosts of the tests.
//
// A mirror of LocalRequest.RefusalOfRead (apps/core/RacingDesk.Core/Runtime/LocalRequest.cs), which the host makes of every
// request under /data/ before it looks at the route: the connection is the machine's own, the Host names this machine
// (localhost, 127.0.0.1 or [::1]) at the port the request came in on, and no browser sent it — no Origin of any kind (`null`
// included: a file's page says it, and so does a web page whose fetch is redirected to the host, sandboxed, or opened from
// disk), and none of the marks a browser puts on a request that has no Origin (Referer, Sec-Fetch-Site, -Dest, -User). Node's
// own fetch sends Sec-Fetch-Mode and no more, so that mark is not held against a program. Anything else is a 403 with no CORS
// header, and nothing is ever sent one: no page reads the host, the desk's included, which asks the app's main process
// (modules/js/desk-reads.js). The C# side of the rule is pinned over a real socket by DataRoutesThisMachineTests; this is what
// the readers in this folder are held to, so that a reader that would be refused by the host (a page's fetch, a request that
// names another host or leaves the port out) fails here.

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const HOST = /^(localhost|127\.0\.0\.1|\[::1\]):(\d+)$/i;
const BROWSER_MARKS = ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-dest', 'sec-fetch-user'];

/** Why the host would refuse `req`, or null when it would answer. `port` is the port the request came in on. */
export function refusalOfRead(req, port) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return 'AnotherMachine';
  const named = HOST.exec(String(req.headers.host ?? '').trim());
  if (!named || Number(named[2]) !== port) return 'AnotherHost';
  if (req.headers.origin !== undefined && req.headers.origin !== '') return 'AWebSite';
  if (BROWSER_MARKS.some((name) => req.headers[name] !== undefined && req.headers[name] !== '')) return 'ABrowser';
  return null;
}

/**
 * Answers a refusal the way the host does, and says whether it did: a refused request is a 403 with no CORS header, and so is a
 * preflight (a browser's: no page may ask). Returns false for a request to be answered, which carries no CORS header either.
 */
export function answerRefusal(req, res, port, refused) {
  let why = refusalOfRead(req, port);
  if (!why && req.method === 'OPTIONS') why = 'ABrowser';
  if (!why) return false;
  refused.push({ why, method: req.method, url: req.url, host: req.headers.host, origin: req.headers.origin });
  res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'this is for the app on this machine' }));
  return true;
}
