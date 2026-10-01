// Who RacingDesk.Host answers when it is asked for its data (/racing-desk/data/…), for the stand-in hosts of the tests.
//
// A mirror of LocalRequest.RefusalOfRead (apps/core/RacingDesk.Core/Runtime/LocalRequest.cs), which the host makes of every
// request under /data/ before it looks at the route: the connection is the machine's own, the Host names this machine
// (localhost, 127.0.0.1 or [::1]) at the port the request came in on, and the Origin, if it has one, is `null` — the
// app's own pages are files — and not a web site's. Anything else is a 403 with no CORS header. A CORS header goes to the
// origin `null` by name and to no other, never `*`. The C# side of the rule is pinned over a real socket by
// DataRoutesThisMachineTests; this is what the readers in this folder are held to, so that a reader that would be refused
// by the host (a page that sends a web site's origin, a request that names another host or leaves the port out) fails here.

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const HOST = /^(localhost|127\.0\.0\.1|\[::1\]):(\d+)$/i;

/** Why the host would refuse `req`, or null when it would answer. `port` is the port the request came in on. */
export function refusalOfRead(req, port) {
  if (!LOOPBACK.has(req.socket.remoteAddress)) return 'AnotherMachine';
  const named = HOST.exec(String(req.headers.host ?? '').trim());
  if (!named || Number(named[2]) !== port) return 'AnotherHost';
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== '' && origin !== 'null') return 'AWebSite';
  return null;
}

/** The headers an answered read carries: CORS to the app's own page by name, and `Vary: Origin` always. */
export function corsHeaders(req) {
  return req.headers.origin === 'null'
    ? { 'Access-Control-Allow-Origin': 'null', 'Access-Control-Allow-Private-Network': 'true', Vary: 'Origin' }
    : { Vary: 'Origin' };
}

/**
 * Answers a refusal or a preflight the way the host does, and says whether it did: a refused request is a 403 with no CORS
 * header; a preflight from the app's own page is a 204 that names its origin. Returns false for a request to be answered.
 */
export function answerRuleOrPreflight(req, res, port, refused) {
  const why = refusalOfRead(req, port);
  if (why) {
    refused.push({ why, method: req.method, url: req.url, host: req.headers.host, origin: req.headers.origin });
    res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'this is for the app on this machine' }));
    return true;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(req),
      ...(req.headers.origin ? { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } : {}),
    });
    res.end();
    return true;
  }
  return false;
}
