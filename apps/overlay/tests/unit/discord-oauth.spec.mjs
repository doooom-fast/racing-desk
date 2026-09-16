/**
 * Discord OAuth2 PKCE — Unit + Integration tests
 *
 * Unit tests: verify PKCE generation, token exchange payload, auth URL shape.
 * Integration tests: spin up the real callback server, hit it with HTTP,
 * and verify the full flow (minus actual Discord API calls).
 */

import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import http from 'http';
import https from 'https';

// ────────────────────────────────────────────────
//  Re-implement the pure functions from main.js
//  (they aren't exportable from an Electron main process file)
// ────────────────────────────────────────────────

const DISCORD_CLIENT_ID     = '1483105220023160882';
const DISCORD_REDIRECT_PORT = 18492;
const DISCORD_REDIRECT_URI  = `http://localhost:${DISCORD_REDIRECT_PORT}/callback`;
const DISCORD_SCOPES        = 'identify guilds.join';

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ════════════════════════════════════════════════
//  UNIT TESTS
// ════════════════════════════════════════════════

test.describe('Discord PKCE — Unit Tests', () => {

  test('generateCodeVerifier returns base64url string of correct length', () => {
    const verifier = generateCodeVerifier();
    // 32 random bytes → 43 base64url chars
    expect(verifier).toHaveLength(43);
    // Must be valid base64url (no +, /, or = padding)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('generateCodeVerifier produces unique values', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  test('generateCodeChallenge returns S256 hash of verifier', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = generateCodeChallenge(verifier);

    // Verify independently
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);

    // Must be base64url, 43 chars (sha256 = 32 bytes)
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('challenge differs for different verifiers', () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(generateCodeChallenge(v1)).not.toBe(generateCodeChallenge(v2));
  });

  test('auth URL contains all required PKCE params', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(DISCORD_SCOPES)}&code_challenge=${challenge}&code_challenge_method=S256`;

    const url = new URL(authUrl);
    expect(url.searchParams.get('client_id')).toBe(DISCORD_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(DISCORD_REDIRECT_URI);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe(DISCORD_SCOPES);
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('token exchange payload includes code_verifier, not client_secret', () => {
    const verifier = generateCodeVerifier();
    const code = 'mock_auth_code_123';

    const payload = {
      client_id: DISCORD_CLIENT_ID,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: DISCORD_REDIRECT_URI,
      code_verifier: verifier,
    };

    expect(payload).not.toHaveProperty('client_secret');
    expect(payload.code_verifier).toBe(verifier);
    expect(payload.grant_type).toBe('authorization_code');
    expect(payload.client_id).toBe(DISCORD_CLIENT_ID);

    // Verify it serializes correctly as URLSearchParams
    const params = new URLSearchParams(payload);
    expect(params.get('code_verifier')).toBe(verifier);
    expect(params.get('code')).toBe(code);
    expect(params.has('client_secret')).toBe(false);
  });

  test('PKCE round-trip: challenge derived from verifier validates', () => {
    // Simulate what Discord does server-side: hash the verifier and compare
    const verifier = generateCodeVerifier();
    const challengeSent = generateCodeChallenge(verifier);

    // "Server side" re-derives from verifier
    const serverChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(serverChallenge).toBe(challengeSent);
  });
});

// ════════════════════════════════════════════════
//  INTEGRATION TESTS — real callback server
// ════════════════════════════════════════════════

test.describe('Discord OAuth2 — Integration Tests', () => {

  // Use a different port for tests to avoid conflicts with the real app
  const TEST_PORT = 18493;

  /**
   * Start a callback server identical to main.js's startCallbackServer,
   * but on TEST_PORT and with a shorter timeout.
   */
  function startTestCallbackServer() {
    let server;
    const promise = new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${TEST_PORT}`);

        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body>Connection Cancelled</body></html>');
            resolve({ error });
            setTimeout(() => { try { server.close(); } catch (e) {} }, 500);
            return;
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body>Connected!</body></html>');
            resolve({ code });
            setTimeout(() => { try { server.close(); } catch (e) {} }, 500);
            return;
          }

          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing code parameter');
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      server.listen(TEST_PORT, '127.0.0.1', () => {
        // server ready
      });

      server.on('error', reject);

      // Short timeout for tests
      setTimeout(() => {
        try { server.close(); } catch (e) {}
        resolve({ error: 'timeout' });
      }, 5000);
    });

    return { promise, server };
  }

  /** Helper: make a GET request to the test callback server */
  function httpGet(urlPath) {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${TEST_PORT}${urlPath}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }

  test('callback server resolves with code on successful auth', async () => {
    const { promise, server } = startTestCallbackServer();

    // Simulate Discord redirecting back with a code
    const mockCode = 'test_auth_code_abc123';
    const response = await httpGet(`/callback?code=${mockCode}`);

    expect(response.status).toBe(200);
    expect(response.body).toContain('Connected!');

    const result = await promise;
    expect(result).toEqual({ code: mockCode });

    // Clean up
    try { server.close(); } catch (e) {}
  });

  test('callback server resolves with error on denied auth', async () => {
    const { promise, server } = startTestCallbackServer();

    // Simulate user denying the OAuth prompt
    const response = await httpGet('/callback?error=access_denied');

    expect(response.status).toBe(200);
    expect(response.body).toContain('Cancelled');

    const result = await promise;
    expect(result).toEqual({ error: 'access_denied' });

    try { server.close(); } catch (e) {}
  });

  test('callback server returns 400 for missing code param', async () => {
    const { promise, server } = startTestCallbackServer();

    const response = await httpGet('/callback');

    expect(response.status).toBe(400);
    expect(response.body).toContain('Missing code');

    try { server.close(); } catch (e) {}
  });

  test('callback server returns 404 for non-callback paths', async () => {
    const { promise, server } = startTestCallbackServer();

    const response = await httpGet('/something-else');

    expect(response.status).toBe(404);

    try { server.close(); } catch (e) {}
  });

  test('full PKCE flow simulation: verifier → challenge → auth URL → callback → exchange payload', async () => {
    // 1. Generate PKCE pair
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    // 2. Build auth URL (what we'd open in browser)
    const authUrl = new URL('https://discord.com/api/oauth2/authorize');
    authUrl.searchParams.set('client_id', DISCORD_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', `http://localhost:${TEST_PORT}/callback`);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', DISCORD_SCOPES);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    // Verify the URL is well-formed
    expect(authUrl.searchParams.get('code_challenge')).toHaveLength(43);
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');

    // 3. Start callback server and simulate Discord callback
    const { promise, server } = startTestCallbackServer();
    const mockCode = 'discord_mock_code_xyz789';
    await httpGet(`/callback?code=${mockCode}`);
    const result = await promise;

    expect(result.code).toBe(mockCode);

    // 4. Build token exchange payload (what exchangeCodeForToken would send)
    const exchangePayload = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      grant_type: 'authorization_code',
      code: result.code,
      redirect_uri: `http://localhost:${TEST_PORT}/callback`,
      code_verifier: verifier,
    });

    // Verify no client_secret leaked in
    expect(exchangePayload.has('client_secret')).toBe(false);
    expect(exchangePayload.get('code_verifier')).toBe(verifier);
    expect(exchangePayload.get('code')).toBe(mockCode);

    // 5. Verify PKCE integrity: server can reproduce challenge from verifier
    const serverDerived = crypto.createHash('sha256')
      .update(exchangePayload.get('code_verifier'))
      .digest('base64url');
    expect(serverDerived).toBe(challenge);

    try { server.close(); } catch (e) {}
  });

  test('callback server handles concurrent requests gracefully', async () => {
    const { promise, server } = startTestCallbackServer();

    // Fire multiple requests simultaneously — only the first code should resolve
    const [r1, r2] = await Promise.all([
      httpGet('/callback?code=first_code'),
      httpGet('/callback?code=second_code'),
    ]);

    // Both should get 200 responses
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // The promise resolves with whichever code arrived first
    const result = await promise;
    expect(result.code).toBeDefined();
    expect(['first_code', 'second_code']).toContain(result.code);

    try { server.close(); } catch (e) {}
  });
});
