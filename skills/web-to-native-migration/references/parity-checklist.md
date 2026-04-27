# Parity Audit Checklist (per-feature)

Copy this template into a working doc when auditing a feature. Fill
each row. The shape of the answer tells you exactly which trap is
biting (or whether you have a new one).

---

## Feature: `<name>`

### 1. Surfaces

| Surface | File path | Status |
|---|---|---|
| Legacy query | `apps/web/src/lib/queries/<X>.ts` | exists / deleted / unused |
| Canonical compute | `apps/web-api/src/calc/<X>.ts` | exists / TBD |
| Web consumption | `apps/web/src/app/drive/.../page.tsx` line N | calls canonical / calls legacy |
| Native consumption — iOS | `Sources/API/...` | via `/dashboard` / direct call |
| Native consumption — macOS | `Sources/API/...` | via `/dashboard` / direct call |
| Native consumption — tvOS | `Sources/API/...` | via `/dashboard` / direct call |
| Native consumption — Windows | `src/RaceCorProDrive/Api/...` | via `/dashboard` / direct call |
| Overlay consumption | `apps/overlay/...` | via WS / via /dashboard / N/A |

### 2. Inputs

| Input | Web path constructs as | Native path constructs as | Match? |
|---|---|---|---|
| `sessions` | … | … | ✅/❌ |
| `ratings` | … | … | ✅/❌ |
| `driverRatings` | … | … | ✅/❌ |
| `timeZone` | `getUserTimeZone()` (cookie/header/UTC) | `?tz=<id>` query param | ✅/❌ |
| `schedule` | `fetchIRacingSchedule()` | (same?) | ✅/❌ |
| `activeCategories` | … | … | ✅/❌ |
| `limit` / `topN` | … | … | ✅/❌ |

### 3. Output transform

| Step | Web | Native | Match? |
|---|---|---|---|
| Slice to N | `.slice(0, 5)` | `.prefix(3)` | ❌ — different N |
| Field rename | `s.licenseClass → license` | (same) | ✅ |
| Round-trip leaks | n/a (web doesn't re-send) | typed struct strips field X | ❌ — declare field |
| Optional vs required | n/a | non-optional → hard-fail on missing | ⚠ |

### 4. Render parity

| Element | Web component / line | Native component / line | Match? |
|---|---|---|---|
| Score chip text | `NextRaceIdeas.tsx:83` "MATCH" | `NextRaceTabs.swift:172` "MATCH" | ✅ |
| Score color tiers | `getScoreColor` (4 tiers) | `scoreTint` (4 tiers) | ✅ |
| Time-of-day copy | `formatStartsIn(s)` "in 2 hr 15 min" | `RelativeDateTimeFormatter` | ✅ |
| Brand logo render | `BrandLogo` component | `BrandLogo` SwiftUI | ✅ |
| Track silhouette | `TrackSilhouette` SVG | `TrackSilhouette` SwiftUI canvas | ✅ |
| Commentary text | server `s.commentary` verbatim | server `idea.commentary` verbatim | ✅ |
| Strategy pill | `s.strategy.type` mapped | `idea.strategy` mapped | check enum |
| Verdict tier mapping | 6 → 6 colors | 4 enum cases | ❌ — Trap #3 |
| Empty state copy | "Run a few more sessions…" | "Run a few more sessions…" | ✅ — keep in sync |

### 5. HTTP plumbing

| Check | Status |
|---|---|
| URL `?` encoding (Swift) | uses string concat ✅ / uses appendingPathComponent ❌ |
| Bearer token forwarded | APIClient ✅ / CalcClient `setBearerToken` ✅ |
| Optional struct fields | ✅ — won't hard-fail on missing |
| `?tz=` query param sent | ✅ |

### 6. Pitfalls hit

- [ ] Trap #1 — Server defaults TZ to UTC
- [ ] Trap #2 — JSON round-trip strips fields
- [ ] Trap #3 — Native enum collapses six tiers into four
- [ ] Trap #4 — Swift `appendingPathComponent` encodes `?`
- [ ] Trap #5 — Web first-render falls back to UTC
- [ ] Trap #6 — Asset / lookup fetches diverge

### 7. Action items

- [ ] Server fix (PR …)
- [ ] Mac fix (PR …)
- [ ] iOS fix (PR …)
- [ ] tvOS fix (PR …)
- [ ] Windows fix (PR …)

---

## Worked example: `race-now` verdict

### Surfaces
| Surface | Status |
|---|---|
| Legacy query | `apps/web/src/lib/queries/shouldIRaceNow.ts` — DELETED in PR #27 |
| Canonical compute | `apps/web-api/src/calc/race-now-verdict.ts` ✅ |
| Web consumption | `page.tsx:750` calls `fetchRaceNow` directly ✅ |
| Native — all four | round-trip `dashboard.when` → `/calc/race-now` |

### Pitfalls hit
- [x] **Trap #1** — `/api/v1/dashboard` defaulted to UTC, native got
  UTC-bucketed WhenProfile, looked up wrong rankedSlots row →
  inverted verdict. Fix: PR #28 + native `?tz=` PRs.
- [x] **Trap #2** — `rankedSlots` not declared on
  `Dashboard.WhenProfile`, JSON round-trip stripped it, server fell
  back to "insufficient". Fix: PR #7 (mac), #4 (iOS), #6 (tvOS, win).
- [x] **Trap #3** — Native enum was 4-case, server verdict is 6-case.
  Fix: PR #5 (mac), #4 (iOS), #5 (tvOS).
- [x] **Trap #4** — Mac dashboard 404'd on `?tz=` because of
  `appendingPathComponent` percent-encoding the `?`. Fix: PR #11.
- [x] **Trap #5** — Web first render used UTC fallback. Fix: PR #27.

### Lessons
- The Race-Now feature surfaced FIVE distinct traps in one
  migration. Each was non-obvious and only visible from
  side-by-side testing. The skill exists because of this feature.
- Total fix surface: 5 server PRs, 4–5 native PRs across 4
  platforms. Plan accordingly when budgeting a migration.
