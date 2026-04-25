# CLAUDE.md — racecor-prodrive-windows

## What this repo is

The Windows native app for RaceCor Pro Drive: `apps/native/` (WinUI 3). See [README.md](README.md) for the overview.

## When you're editing the app

Read `apps/native/CLAUDE.md` for the architecture notes. Important high-level note:

- The app runs **unpackaged** for v0.1 development. This simplifies debugging but means `WebAuthenticationBroker` isn't reliable; auth falls back to opening the system browser and catching the callback via a registered protocol handler. Flip to MSIX for Store distribution.

## Cross-repo context

Same backend as the other native apps (`https://prodrive.racecor.io`):
- Auth: `/api/plugin-auth/*` PKCE. Client ID `racecor-prodrive-win`. Allowed redirects include `racecor-native://auth` and localhost.
- Data: `/api/v1/*` with Bearer.
- Tokens: `/api/v1/tokens/native?format=cs`.

## Agent work policy

All agent-spawned work should use `isolation: "worktree"`. Exceptions: read-only exploration, single-file doc updates.

## Not shared (yet)

No `packages/` at the root. The app is self-contained. Add a shared package only if a future target appears and concrete duplication shows up.

## Pointers

- Master plan: `../native-apps-plan.md`
- API contract: `../native-apps-api-contract.md`
- Server (closed): `../racecor-prodrive-server/`
- Plugin + overlay (open): `../racecorio-prodrive/`
