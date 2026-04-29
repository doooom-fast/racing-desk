---
name: server-claude-broker
description: |
  How prodrive-server brokers Anthropic API calls on behalf of native apps (mac/win/ios/tvos). The default path is server-brokered (one shared Anthropic key, per-user rate-limited, billed to Pro Drive); the escape hatch is BYOK (user enters their own key, stored in OS keychain, calls go direct to api.anthropic.com bypassing the server). Use this skill when implementing or modifying the `/api/v1/director` route, the editor's "Refine with Claude" feature, BYOK settings UI in any native app, rate-limit logic, or auditing Anthropic API usage. Also trigger when the user mentions "Claude broker", "API key", "BYOK", "anthropic auth", "rate limit", or asks why we don't use OAuth-to-Claude.
---

# Server-Brokered Claude API + BYOK Fallback

Native apps need Claude for the editor's director feature (and any future AI features). Anthropic banned third-party-app OAuth on April 4, 2026 — Pro/Max OAuth tokens are reserved for Claude Code and Claude.ai only. So the auth model is **API keys**, not OAuth.

This skill captures the two-path architecture: a default server-brokered path (good UX, controlled cost, rate-limitable) and a BYOK fallback (power users with their own quota). Both must be supported simultaneously so neither path becomes a hard requirement.

## How to Use This Skill

1. Read this file for the architecture and the rate-limit rules
2. Server route implementation lives in `apps/web-api/src/routes/director.ts` — match the patterns there
3. Native app keychain code lives in `apps/native/Settings/AnthropicKey*` per platform
4. **Never** ship a default Anthropic key in a native app binary — only the server holds that key

## The two paths

```
Default — server-brokered:
  Native app  ──Discord bearer──▶  prodrive-server  ──Anthropic key──▶  api.anthropic.com
                                   (rate-limit + log)

BYOK — direct:
  Native app  ──user's Anthropic key──▶  api.anthropic.com
              (key stored in OS keychain)
```

The native app picks the path at call time based on whether the user has set a BYOK key. UI in the editor: a single "Refine with Claude" button. Settings panel reveals "Using Pro Drive's Claude budget" or "Using your Anthropic API key (BYOK)".

## Why not OAuth-to-Claude

As of April 4, 2026, Anthropic explicitly prohibits using Pro/Max OAuth tokens in any third-party tool — including the Agent SDK. That ban is enforced in production. Any "Sign in with Anthropic" flow we built would violate the Consumer Terms of Service from day one and would be blocked at the API layer.

If Anthropic ships a real third-party developer OAuth flow analogous to Google's, revisit then. There is no signal of such a flow as of this writing.

## The server-brokered path

### Endpoint

```
POST /api/v1/director
Auth:    Bearer <Discord PKCE token>
Body:    {
  "purpose": "edl-refine" | "narrative" | "incident-coach",
  "model":   "claude-opus-4-7" | "claude-sonnet-4-6",  // server can downgrade
  "input":   { ...purpose-specific payload }
}
Response (success):
  200 OK
  {
    "result": { ...purpose-specific output },
    "usage":  { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens },
    "model":  "claude-opus-4-7",
    "requestId": "req_01HFK..."
  }
Response (rate limited):
  429 Too Many Requests
  Retry-After: 60
  { "error": "rate_limit", "limit": "20/hour", "resetAt": "..." }
Response (over user's monthly cap):
  402 Payment Required
  { "error": "monthly_cap", "usedThisMonth": 19842, "capThisMonth": 20000 }
```

### Rate limits

Multi-layer to protect the budget:

1. **Per-user, per-hour:** sliding-window counter in Redis (Upstash). Default 20 req/hr for free users, 100 for Pro Drive subscribers. Check before forwarding.
2. **Per-user, per-month token cap:** sum of `inputTokens + outputTokens` across all requests. Default 50k tokens/month free, 1M Pro Drive. Counter ticks on each successful response.
3. **Global circuit breaker:** if total Anthropic spend in the current hour exceeds a configurable ceiling, return 503 with `Retry-After: 600` and Slack-alert ops. Prevents runaway costs from a bug.

Per-user counters live in Redis with 31-day TTL, keyed by `claude:rl:user:<userId>:hour` and `claude:rl:user:<userId>:month:<YYYY-MM>`.

### Server-side prompt caching

All director calls use Anthropic's prompt caching (5-minute TTL on the system prompt). The system prompt for `edl-refine` is ~6k tokens of editorial direction; without caching, every call pays full price.

```ts
// apps/web-api/src/routes/director.ts (sketch)
const response = await anthropic.messages.create({
  model,
  system: [{
    type: 'text',
    text: EDL_REFINE_SYSTEM_PROMPT,
    cache_control: { type: 'ephemeral' },  // ★ cache the system prompt
  }],
  messages: [{ role: 'user', content: JSON.stringify(input) }],
  max_tokens: 4096,
});
```

Track cache hit rate in observability. If hit rate drops below 80%, the system prompt is being modified between calls or the 5-min TTL is being missed (idle Pro Drive editors, infrequent calls). Consider switching the cache to 1-hour TTL (more expensive cache writes, much longer reuse) for low-traffic flows.

### Model routing

The server picks the model based on `purpose`. Native apps can request a specific model but the server may downgrade:

| Purpose | Default model | Why |
|---|---|---|
| `edl-refine` | `claude-opus-4-7` | Quality matters; long context (full telemetry + heuristic EDL) |
| `narrative` | `claude-sonnet-4-6` | Lighter task; cost optimization |
| `incident-coach` | `claude-haiku-4-5-20251001` | Fast, low-stakes, called frequently |

Native apps don't hard-code the model name. The server returns the model used in the response so logs can correlate.

### Audit logging

Every brokered call logs to `claude_calls` table (Drizzle):

```ts
{
  id, userId, requestId, purpose, model,
  inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
  costMicrocents,         // computed from token counts × per-token price
  latencyMs, status,      // 'ok' | 'rate_limited' | 'cap_exceeded' | 'error'
  createdAt
}
```

This is the source of truth for billing reconciliation. Run a daily cron that compares `SUM(costMicrocents)` against Anthropic's invoice — divergence > 5% means a counting bug.

## The BYOK path

### When to offer BYOK

- User explicitly requests it (settings panel)
- User hits monthly cap (offer in the 402 error UI)
- User is a power user who wants Anthropic's higher-tier quota or wants to use a model the server doesn't expose

### Storing the key

Each native app stores the user's Anthropic key in the platform secure store. Never sync it through prodrive-server. Never write it to disk in plaintext.

| Platform | API |
|---|---|
| macOS | Keychain Services, item kind `kSecClassGenericPassword`, service `com.racecor.prodrive.anthropic`, account `<userId>` |
| Windows | Windows Credential Manager via `Credentials.PasswordCredential` (WinUI 3) |
| iOS | Keychain Services with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` (don't sync to iCloud) |
| tvOS | Same as iOS but tvOS keychain has known sync flakiness — show "key reset" banner if missing on launch |

### Validating the key

When the user pastes a key in settings, the app makes a minimal call to validate before storing:

```ts
POST https://api.anthropic.com/v1/messages
Authorization: x-api-key <userKey>
Body: { model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }
```

If 200 — store. If 401 — show "invalid key". If 429 — store but warn "key valid but rate-limited". Don't validate every launch (wasteful); validate on first save and re-validate on first 401 in production.

### BYOK call shape

```
POST https://api.anthropic.com/v1/messages
Authorization: x-api-key <fromKeychain>
Anthropic-Version: 2023-06-01
Body: {
  model, system, messages, max_tokens
}
```

The native app holds the system prompts locally. They must match the server's prompts byte-for-byte to avoid quality drift between paths — bake them into a shared `prompts/` directory in the native app and update them when the server-brokered version changes.

### BYOK and rate limits

The server's rate limits don't apply (no server is involved). Anthropic enforces its own quotas. The app catches Anthropic's 429s and shows the user a polite "Anthropic rate-limited your key — wait <Retry-After>".

Don't try to mirror Anthropic's quotas in the app — they're tier-dependent and can change. Just surface the API's response.

## Cost monitoring

For server-brokered, the daily cron reconciliation tells you actual spend.

For total visibility (broker + BYOK), the server can offer a dashboard showing the user's brokered usage. BYOK usage is invisible to the server by design.

Send a Slack alert when:
- Hourly spend exceeds the global circuit-breaker threshold
- Any single user exceeds 5× their normal weekly average (likely a bug or account compromise)
- Cache hit rate drops below 50% over a 1-hour window

## Error handling in native apps

```
"Refine with Claude" button click
  ↓
Has BYOK key in keychain?
  ↓ no
Try POST /api/v1/director
  ↓ 200 → done
  ↓ 401 → re-auth (Discord token expired)
  ↓ 402 → "You've used your monthly Pro Drive Claude budget. Add your own Anthropic key in Settings to continue."
  ↓ 429 → "Slow down — try again in 30s"
  ↓ 503 → "Pro Drive's Claude is temporarily unavailable. Try BYOK in Settings."
  ↓ 5xx → log + retry with exponential backoff (max 3)
  ↓ network error → "No connection"

  ↓ yes (BYOK)
Try POST api.anthropic.com/v1/messages with user's key
  ↓ 200 → done
  ↓ 401 → "Your Anthropic key is invalid — re-enter in Settings"
  ↓ 429 → "Anthropic rate-limited your key. Wait <Retry-After>."
  ↓ 5xx → log + retry with exponential backoff (max 3)
```

## When NOT to use this skill

- Pure server-side AI features that don't involve native apps — those just call Anthropic directly without the broker pattern
- Claude Code or claude.ai usage by the team — those are personal accounts, not in scope
- Other LLM providers (OpenAI, Google) — if we add them, copy the broker pattern but write a separate skill; the auth and billing models differ
- Testing/dev — devs use their own Anthropic key directly via env var, not the broker

## Companion docs

- [`prodrive-context/video-editor-plan.md`](../../prodrive-context/video-editor-plan.md) — How the broker fits into the editor pipeline
- [`native-video-editor/SKILL.md`](../native-video-editor/SKILL.md) — The "Refine with Claude" feature surface
- Anthropic [API auth docs](https://docs.anthropic.com/en/api/getting-started) — current source of truth on auth options
