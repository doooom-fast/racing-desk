/**
 * No web page open on the rig can read the host's data, by any way a browser has of asking (apps/host LocalDataApi), whatever
 * Origin it says. Run in headless Chromium (software GL: playwright.config.mjs) against a stand-in host that makes the host's
 * check (tests/this-machine-rule.mjs, the mirror of LocalRequest.RefusalOfRead, which DataRoutesThisMachineTests pins over the
 * real host's socket with the very headers Chromium sends below), with the host's answers behind the check being the sessions of a
 * driver whose customer id is 424242.
 *
 * What this adds to the rule's own cases is what a browser really says. A page's fetch says its origin, and a page of the rig's
 * own, at another port, is another origin. But the origin `null` is what a fetch says when it was redirected from one site to
 * another, what a sandboxed frame says, and what a file says: the desk's own page is one, and a hostile page can be any of the
 * others, so the host cannot answer `null` and does not. And what a browser sends with no Origin at all — an image, a script,
 * a no-cors fetch, a navigation — is marked with Sec-Fetch-* and is turned away by the marks. The page that does all of these
 * reads nothing, and the host answers none of them.
 */

import { test, expect } from '@playwright/test';
import http from 'node:http';
import { answerRefusal } from '../this-machine-rule.mjs';

const SESSIONS = [{ id: 1, driver_cust_id: 424242, car_path: 'mx5 mx52016' }];

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

// The host: its check, and then the answer. `asked` is what it answered; `refused` is what it turned away.
async function startHost() {
  const state = { asked: [], refused: [], port: 0 };
  const server = http.createServer((req, res) => {
    if (answerRefusal(req, res, state.port, state.refused)) return;
    state.asked.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(SESSIONS));
  });
  state.port = await listen(server);
  state.url = `http://127.0.0.1:${state.port}`;
  state.close = () => new Promise((done) => { server.closeAllConnections(); server.close(done); });
  return state;
}

// Another site, that sends a request on to the host by a redirect: the page asks it, and the host is where it lands.
async function startRedirector(to) {
  const server = http.createServer((req, res) => {
    res.writeHead(302, { Location: to, 'Access-Control-Allow-Origin': '*' });
    res.end();
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) };
}

// The hostile page itself, on a port of its own: a site open in a browser on the rig.
async function startSite() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>a site</title><body>a site</body>');
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) };
}

let host;
let redirector;
let site;
test.beforeEach(async () => {
  host = await startHost();
  redirector = await startRedirector(`${host.url}/racing-desk/data/sessions`);
  site = await startSite();
});
test.afterEach(async () => {
  await host.close();
  await redirector.close();
  await site.close();
});

// What the page learned of a fetch: whether it could read the answer, and what it read.
const tryFetch = (page, url, init = {}) => page.evaluate(async ([target, options]) => {
  try {
    const res = await fetch(target, options);
    return { read: true, status: res.status, text: await res.text() };
  } catch (err) {
    return { read: false, error: String(err) };
  }
}, [url, init]);

test('a program on this machine reads the sessions (the positive control: the host answers, and the page does not)', async () => {
  const answer = await new Promise((resolve, reject) => {
    http.get(`${host.url}/racing-desk/data/sessions`, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
  expect(answer.status).toBe(200);
  expect(answer.text).toContain('424242');
  expect(host.refused).toEqual([]);
});

test('a page of a site on the rig cannot read the sessions: not by a fetch, not by a fetch redirected to the host, not from a sandboxed frame', async ({ page }) => {
  await page.goto(site.url);

  // Directly: its own origin is another origin.
  const direct = await tryFetch(page, `${host.url}/racing-desk/data/sessions`);
  expect(direct.read, JSON.stringify(direct)).toBe(false);

  // By way of another site that redirects to the host. Chromium marks the redirected fetch as tainted and sends Origin: null,
  // which a host that answered `null` (the desk's own origin) would have answered, with Access-Control-Allow-Origin: null, to the page.
  const redirected = await tryFetch(page, `${redirector.url}/r`);
  expect(redirected.read, JSON.stringify(redirected)).toBe(false);

  // From a sandboxed frame, whose origin is null too.
  const framed = await page.evaluate((url) => new Promise((resolve) => {
    window.addEventListener('message', (e) => resolve(e.data));
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.srcdoc = `<script>fetch(${JSON.stringify(url)}).then(async (r) => parent.postMessage({ read: true, text: await r.text() }, '*'), (e) => parent.postMessage({ read: false, error: String(e) }, '*'));<\/script>`;
    document.body.appendChild(frame);
    setTimeout(() => resolve({ read: false, error: 'no answer' }), 5000);
  }), `${host.url}/racing-desk/data/sessions`);
  expect(framed.read, JSON.stringify(framed)).toBe(false);

  // The host turned each away, and said what it was asked: an origin, null for the redirected fetch and the frame.
  expect(host.asked, 'the host answered none of them').toEqual([]);
  const origins = host.refused.map((r) => r.origin);
  expect(origins).toContain(site.url);
  expect(origins.filter((o) => o === 'null')).toHaveLength(2);
  expect(host.refused.every((r) => r.why === 'AWebSite')).toBe(true);
});

test('nor can it by what a browser sends with no Origin: an image, a script, a no-cors fetch, a form, a navigation', async ({ page }) => {
  await page.goto(site.url);
  const target = `${host.url}/racing-desk/data/sessions`;

  await page.evaluate((url) => new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = resolve;
    img.src = `${url}?img=1`;
  }), target);
  await page.evaluate((url) => new Promise((resolve) => {
    const script = document.createElement('script');
    script.onload = script.onerror = resolve;
    script.src = `${url}?script=1`;
    document.head.appendChild(script);
  }), target);
  const noCors = await tryFetch(page, `${target}?nocors=1`, { mode: 'no-cors' });
  expect(noCors.read && noCors.text, 'an opaque answer has no body to read').toBeFalsy();
  await page.evaluate((url) => {
    const form = document.createElement('form');
    form.method = 'GET';
    form.action = url;
    form.target = 'sink';
    // A GET form's fields replace the action's query, so the marker is a field.
    const field = document.createElement('input');
    field.type = 'hidden';
    field.name = 'form';
    field.value = '1';
    form.appendChild(field);
    const frame = document.createElement('iframe');
    frame.name = 'sink';
    document.body.append(frame, form);
    form.submit();
  }, target);
  await expect.poll(() => host.refused.some((r) => r.url.includes('form=1')), { message: 'the form request reached the host' }).toBe(true);
  await page.goto(`${target}?navigation=1`);   // a navigation to the host's address: the person's own, and a page all the same
  expect(await page.locator('body').innerText()).not.toContain('424242');

  expect(host.asked, 'the host answered none of them: not one carried the customer id to the browser').toEqual([]);
  const refusedUrls = host.refused.map((r) => r.url);
  for (const marker of ['img=1', 'script=1', 'nocors=1', 'form=1', 'navigation=1']) {
    expect(refusedUrls.some((u) => u.includes(marker)), `${marker} was refused`).toBe(true);
  }
});
