# CLAUDE.md — racecor-prodrive-windows

## What this repo is

Two Windows apps in one private repo: `apps/shell/` (Electron) and `apps/native/` (WinUI 3). See [README.md](README.md) for the overview.

## When you're editing either app

Read the app's own `CLAUDE.md` — each contains the architecture notes for its stack. The important high-level differences:

- **Shell**: single-instance lock is critical on Windows. Without it, the OAuth redirect via `racecor-prodrive://` can land in a second Electron instance that nobody expected. `app.requestSingleInstanceLock()` + `second-instance` listener forwards the URL to the primary window.
- **Native**: runs **unpackaged** for v0.1 development. This simplifies debugging but means `WebAuthenticationBroker` isn't reliable; auth falls back to opening the system browser and catching the callback via a registered protocol handler. Flip to MSIX for Store distribution.

## Cross-repo context

Same backend as the other native apps (`https://prodrive.racecor.io`):
- Auth: `/api/plugin-auth/*` PKCE. Client IDs `racecor-prodrive-win-shell` and `racecor-prodrive-win`. Allowed redirects include `racecor-prodrive://auth` and localhost.
- Data: `/api/v1/*` with Bearer (native app only — shell uses the web UI).
- Tokens: `/api/v1/tokens/native?format=cs` for the native app; Electron shell has no tokens to fetch.

## Agent work policy

All agent-spawned work should use `isolation: "worktree"`. Exceptions: read-only exploration, single-file doc updates.

## Not shared (yet)

No `packages/` at the root. Each app is self-contained. Add a shared package only if concrete duplication appears (e.g. both apps end up needing the same telemetry-event helper).

## Pointers

- Master plan: `../native-apps-plan.md`
- API contract: `../native-apps-api-contract.md`
- Server (closed): `../racecor-prodrive-server/`
- Plugin + overlay (open): `../racecorio-prodrive/`
