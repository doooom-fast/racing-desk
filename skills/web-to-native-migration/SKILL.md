---
name: web-to-native-migration
description: |
  Audit and ship parity between the web dashboard, the canonical web-api compute layer, and native consumers (mac/iOS/tvOS/Windows/overlay/plugin) for any feature that produces user-facing data — verdicts, scores, lists, panels. Use this skill whenever migrating a feature from `apps/web/src/lib/queries/*.ts` (legacy) to `apps/web-api/src/calc/*.ts` (canonical), wiring native apps to consume an existing endpoint, debugging "web shows X but mac shows Y" complaints, or proactively reviewing a recent migration for the parity pitfalls listed below. Also trigger when the user mentions "different list / data / verdict in the apps", "doesn't seem api-driven", or asks to bring a feature to native.
---

# Web → Web-API → Native Migration

This skill captures the recurring pattern in this monorepo: a feature
starts life as a query function in `apps/web/src/lib/queries/*.ts`
(coupled to the web app), gets migrated to a canonical compute path
in `apps/web-api/src/calc/*.ts`, and then native clients (mac, iOS,
tvOS, Windows, plus the overlay and plugin) need to consume the same
canonical path so all platforms agree on every number, every
verdict, every text string.

The pattern is simple. The pitfalls are not. This skill is the
checklist + known-trap inventory we accumulated the hard way.

## Repo topology cheat-sheet

```
prodrive-server/
├── apps/web/              — Next.js dashboard (the visible web app)
│   ├── src/lib/queries/   — Legacy query functions (one per feature)
│   ├── src/lib/web-api-client.ts — Calls into apps/web-api
│   └── src/app/drive/.../page.tsx — Server-component dashboard render
│
└── apps/web-api/          — Canonical compute (Hono on Vercel)
    ├── src/calc/          — Pure compute functions (where math lives)
    └── api/v1/calc/       — HTTP route handlers exposing each compute

prodrive-{macos,ios,tvos}/Sources/API/   — Swift APIClient + CalcClient
prodrive-windows/src/RaceCorProDrive/Api/ — C# ApiClient + CalcClient
prodrive-overlay, prodrive-plugin/        — TypeScript / Electron clients
```

A migrated feature has THREE consumption surfaces: web dashboard,
direct native fetch, and (in some cases) embedded-in-dashboard
native fetch. All three must agree.

## How to use this skill

1. **Audit first, fix second.** Run the checklist below against the
   feature in question. Surface every divergence before changing
   anything — single-fix-per-PR scopes the work and makes regressions
   visible. The trap inventory below is the source of every "wait,
   why don't they match?" we've shipped a fix for.

2. **Match the data exactly before touching the rendering.** Native
   UIs are hand-rolled per platform (SwiftUI / WinUI / React); they
   WILL drift from web rendering. But debugging UI drift while data
   is also wrong is impossible. Get numbers + verdict + text strings
   identical first, *then* port any view-model that looks different.

3. **Server view-models > native re-rendering.** When the server
   produces a verbatim view-model (e.g. `whenPanel.strengths.paragraph`
   is a pre-built string), every client renders it as-is. When the
   server produces raw data and asks each client to format it, the
   clients drift. Push formatting decisions server-side whenever the
   data is opaque to the client (incident-rate text, score color,
   countdown copy, etc.).

## The checklist

For feature `X` (e.g. `race-now`, `next-race-ideas`, `dashboard`,
`when-profile`):

### 1. Locate the surfaces

- [ ] **Legacy:** `apps/web/src/lib/queries/<X>.ts` — does it still
      exist? Does anything still import it? If no callers remain,
      delete it (parallel paths cause confusion later).
- [ ] **Canonical:** `apps/web-api/src/calc/<X>.ts` — is the math
      here? If not, this is a migration-not-done; audit can stop.
- [ ] **Web consumption:** `apps/web/src/app/drive/.../page.tsx` —
      does it call canonical via `web-api-client` or still call the
      legacy query?
- [ ] **Native consumption:** does each native client get the data
      via `/api/v1/dashboard` (embedded payload) or via a direct
      `/api/v1/<X>` call?

### 2. Inputs identical?

The same compute function called with different inputs returns
different outputs. This is the single biggest source of native-vs-web
divergence in this repo.

- [ ] **Sessions:** is the session list identical? Same DB query?
      Same filtering? Same field-mapping into the input shape?
- [ ] **Ratings / driverRatings:** same construction? License
      filtering? Category coalescing (e.g. "road" + "formula" merge)?
- [ ] **Timezone:** does the web path pass a TZ via
      `getUserTimeZone()` (cookie → `x-vercel-ip-timezone` → UTC)?
      Does the native path pass one explicitly via `?tz=` query
      param? If the route handler defaults to UTC, every native
      client sees UTC-bucketed data while web sees user-TZ data.
      *(See trap #1.)*
- [ ] **Schedule / lookups / external fetches:** if the compute
      function takes a schedule object (e.g. `IRacingSchedule`),
      who fetches it on each path? Is it cached? Could the two
      paths see different schedule snapshots in the same second?

### 3. Output transform identical?

After the compute returns, each surface transforms the result. Drift
here produces "same compute, different output to the client".

- [ ] **Slicing:** does each path slice to the same N? (E.g.
      `nextRaceIdeas` may return 20 suggestions; web shows 5, native
      shows 3 — those are different lists.)
- [ ] **Field selection:** does each path pick the same fields off
      the result? Renaming `s.licenseClass` → `license` on both?
- [ ] **Type coercion:** native Codable hard-fails on missing fields
      that aren't declared optional. Web silently ignores extra
      fields. Both can hide real divergences.
- [ ] **JSON round-trip leaks:** does the native client decode a
      typed struct, then re-encode it back to send to another
      endpoint? Any field NOT declared on the typed struct gets
      stripped on the round-trip. *(See trap #2.)*

### 4. Render parity

- [ ] **View-models:** does the server emit pre-formatted strings
      (e.g. `whenPanel.strengths.paragraph`) that native renders
      verbatim? If yes, drift impossible. If no, native is
      reformatting and WILL drift.
- [ ] **Text strings:** chip labels ("MATCH", "OFFICIAL"), score
      thresholds (good/marginal/bad cutoffs), commentary phrasing,
      time-of-day copy ("Currently 9 PM" vs "near 9 PM") — these
      are usually duplicated, hand-rolled per platform, and have
      already drifted. Audit each one against the web React
      component.
- [ ] **Layout / fields shown:** does the native card show fewer
      or different fields than the web card? Score chips, brand
      logos, car class names, lap/time limit, license badges,
      official/fixed flags — easy to miss one.
- [ ] **Verdict tier vocabulary:** server returns six tiers
      (`best | good | clean-side | messy-side | risky | insufficient`).
      Native enums sometimes collapse to four (`good | marginal |
      bad | unknown`) which throws away two tiers and produces
      visible disagreement on quartile-boundary hours. *(See trap
      #3.)*

### 5. Native HTTP client gotchas

- [ ] **URL `?` encoding:** Swift's
      `URL.appendingPathComponent(endpoint)` percent-encodes `?` to
      `%3F`, turning `/api/v1/dashboard?tz=America/Denver` into a
      literal path. Use `URL(string: baseURL.absoluteString + endpoint)`
      or `URLComponents` with explicit query items. *(See trap #4.)*
- [ ] **Bearer token forwarded:** every native request needs the
      auth header. APIClient typically handles this; CalcClient on
      iOS/tvOS/macOS is a separate actor that needs its own
      `setBearerToken(...)` call.
- [ ] **C# System.Text.Json defaults:** missing properties on a
      typed class are silently set to default values. Same
      round-trip-strip risk as Swift Codable, but the failure mode
      is "empty list" rather than "decode error".

## The trap inventory

These are the bugs we've actually shipped fixes for in this repo.
Each one is generic enough to bite again on the next feature.

### Trap #1 — Server defaults TZ to UTC, native sends own TZ

**Symptom:** native panel shows different stats than web for the
same wall-clock hour. Specifically: native says "near 9 PM 8.7
inc/race" while web says "near 9 PM 5.1 inc/race". Same hour string,
opposite verdict.

**Cause:** `computeWhenProfile` (and similar) buckets sessions into
hour-of-week using a TZ parameter. If the route handler doesn't pass
a TZ, the underlying query function defaults to UTC. So the native
client receives a UTC-bucketed `WhenProfile`, looks up
`rankedSlots[localHour]`, and gets a completely different bucket of
races than what the user actually ran at that local hour.

**Fix:** route handler reads `?tz=` query param first, falls back to
`getUserTimeZone()` (cookie / `x-vercel-ip-timezone` / UTC). Native
clients always send `?tz=<TimeZone.current.identifier>` (or the C#
equivalent: `TimeZoneInfo.Local.HasIanaId ? .Id :
TryConvertWindowsIdToIanaId`).

**Reference fixes:**
- `prodrive-server` PR #28 (`/api/v1/dashboard` accepts `?tz=`)
- `prodrive-server` PR #27 (`getUserTimeZone()` falls back to
  `x-vercel-ip-timezone` when cookie missing — closes web's
  first-render gap)
- Native PRs adding `?tz=` to dashboard fetch

### Trap #2 — JSON round-trip strips fields not on the typed struct

**Symptom:** native gets the right data on first read but loses
information when re-sending the same data to another endpoint. E.g.
mac decodes `Dashboard.WhenProfile`, then sends `when` as part of a
`/calc/race-now` POST. The verdict comes back "insufficient" even
though the field was populated.

**Cause:** native typed struct (`Dashboard.WhenProfile`) doesn't
declare a field that exists on the server response (e.g.
`rankedSlots`). `JSONDecoder` silently drops unknown keys. Then on
re-encode, the field is gone. The server's downstream compute
(`evaluateRaceNow`) reads `profile.rankedSlots[hour].tier`, finds
nothing, returns "insufficient".

**Fix:** declare every field that participates in any round-trip on
the typed struct, even if the field is opaque to the client. Write
explanatory comments on the struct member explaining why it's there.

**Reference fixes:**
- `prodrive-macos` PR #7 — added `rankedSlots` to
  `Dashboard.WhenProfile`
- `prodrive-ios` PR #4 (same)
- `prodrive-tvos` PR #6 (same)
- `prodrive-windows` PR #6 (same)

### Trap #3 — Native enum collapses six server tiers into four

**Symptom:** native panel renders a generic "marginal" chip while
web shows the specific tier ("clean-side" or "messy-side"). On
boundary hours, native looks generic while web looks confident.

**Cause:** server's verdict vocabulary expanded from
`good | marginal | risky | insufficient` (4 tiers) to
`best | good | clean-side | messy-side | risky | insufficient` (6
tiers). Native enums weren't updated. `mapServerVerdict` falls
through to `.unknown` for unrecognized strings.

**Fix:** native enum mirrors server vocabulary 1:1. SF Symbol +
tint per tier. `mapServerVerdict` is a complete mapping with no
`default` collapsing.

**Reference fixes:**
- `prodrive-macos` PR #5
- `prodrive-ios` PR #4
- `prodrive-tvos` PR #5

### Trap #4 — Swift `URL.appendingPathComponent` encodes `?` as `%3F`

**Symptom:** native dashboard renders empty after a fix that added
`?tz=` to a fetch URL. iOS works, mac doesn't.

**Cause:** macOS `APIClient.request(endpoint:)` used
`baseURL.appendingPathComponent(endpoint)`. On macOS 26.4.1 (and
earlier) this percent-encodes the `?` query separator, so
`/api/v1/dashboard?tz=America/Denver` becomes
`/api/v1/dashboard%3Ftz=America/Denver` — a literal path with `?`
baked in, not a URL with a query string. Server 404s. iOS used raw
string concat, which is why iOS worked.

**Empirical proof:**
```swift
URL(string: "https://example.com")!
  .appendingPathComponent("/api/v1/dashboard?tz=America/Denver")
// → "https://example.com/api/v1/dashboard%3Ftz=America/Denver"
```

**Fix:** use `URL(string: baseURL.absoluteString + endpoint)` (or
`URLComponents` with explicit query items). All clients should use
the same pattern.

**Reference fix:**
- `prodrive-macos` PR #11

### Trap #5 — Web's first-render TZ falls back to UTC

**Symptom:** web dashboard shows different verdict on the very first
load of a fresh browser session vs subsequent navigations.

**Cause:** `TimeZoneCookieSetter` is `'use client'` — it runs in
`useEffect`, which fires AFTER the dashboard server component has
already rendered. So the first render of a fresh session uses
`DEFAULT_TZ = 'UTC'` because the cookie doesn't exist yet. Once the
client mounts, the cookie is set and subsequent navigations use the
correct TZ.

**Fix:** `getUserTimeZone()` falls back to `x-vercel-ip-timezone`
header (Vercel populates from geo-IP on every request) before
falling back to UTC. First render now uses a real TZ.

**Reference fix:**
- `prodrive-server` PR #27

### Trap #6 — Asset / lookup fetches diverge between paths

**Symptom:** native renders a grey rectangle where web shows a track
silhouette. Or web shows a brand logo and native shows nothing.

**Cause:** web's page.tsx and `getDashboardData` (the native
endpoint) populate `trackImageLookup` / `brandLogoLookup` /
`carImageLookup` with different population logic. Web typically
walks `nextRaceIdeas[].trackName` AND `topTracks[].trackName`,
while the native endpoint may only walk one. Native then can't
find a lookup for an idea's track.

**Fix:** centralize lookup population — both paths walk the same
union of session-driven + suggestion-driven names. Or push the
lookups into the canonical compute output rather than computing them
client-side.

## When NOT to use this skill

- Single-platform features (web-only or native-only) — there's no
  parity surface to audit.
- Pure styling drift on chrome — design-system skills cover that.
- Compute correctness bugs that affect all clients identically — fix
  the canonical path; parity is preserved by definition.

## Companion docs

- `references/parity-checklist.md` — the audit table you fill in
  per-feature, including a worked example for `race-now`.
- `prodrive-context/` (in this same submodule) — cross-repo data
  flow diagrams.
- `agents/prodrive-server/AGENTS.md` — server-side conventions.
