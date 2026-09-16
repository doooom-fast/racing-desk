# prodrive

Pro Drive for one driver on one rig: a transparent HUD and desk app over live iRacing telemetry, with
no account, no cloud and no distribution. This machine *is* the rig — iRacing, SimHub and the full
`.ibt` history are local, so verify against real data rather than assuming.

**The plan:** [`docs/local-first-refactor-plan.md`](docs/local-first-refactor-plan.md) (phases in §8).
**What the rig actually looks like:** [`docs/local-first-phase0-findings.md`](docs/local-first-phase0-findings.md).

## Layout

| Path | What | Instructions |
|---|---|---|
| `apps/overlay/` | Electron HUD (consumer of `localhost:8889`) | [`apps/overlay/CLAUDE.md`](apps/overlay/CLAUDE.md) |
| `apps/plugin/` | C# SimHub plugin — engine + `localhost:8889` producer. Splits into `core` / `host` / `simhub-plugin` in Phase 2 | [`apps/plugin/CLAUDE.md`](apps/plugin/CLAUDE.md) |
| `apps/edit/` | Node CLI for `.rcpdv` bundle editing | [`apps/edit/CLAUDE.md`](apps/edit/CLAUDE.md) |
| `docs/` | Cross-app context; `docs/archive/` is superseded | [`docs/README.md`](docs/README.md) |
| `.claude/skills/` | Project skills (overlay, plugin, racing domain, bundle format) | — |

Imported 2026-09-16 from `prodrive-overlay`, `prodrive-plugin`, `prodrive-edit` and `prodrive-agents`
with history (subtree merges). Those repos, plus `prodrive-server` and `prodrive-windows`, still exist
and are archived in Phase 6 — nothing is deleted before its replacement works.

## Ground rules

- **Single user, local only.** No accounts, sync, telemetry upload, content packs, installer, release
  pipeline or marketing. Don't add seams for them.
- **No feature may depend on an authenticated iRacing endpoint.** The only network fetch is the
  season schedule PDF, never at race time.
- **Store and bundle no track or car data.** Track geometry comes from `Lat`/`Lon` in the user's own
  `.ibt` files; the sim's `.dat` packs are not decoded.
- **Keep the `localhost:8889` contract byte-identical** while hosts move — it's the seam between the
  engine and everything that consumes it.
- **No CI.** Everything runs locally; GitHub is source control and backup.

## Rig facts worth knowing

- iRacing install: `C:\Program Files (x86)\Steam\steamapps\common\iRacing` (the uninstall registry
  key points at a stale copy on `D:`).
- Telemetry: `Documents\iRacing\telemetry\*.ibt` — ~3k files, ~100 GB since Oct 2025.
- SimHub: `C:\Program Files (x86)\SimHub\` with the plugin installed.
- `%APPDATA%\iracing-electron\` holds iRacing login state — never dump its contents.
