# CLAUDE.md — racecor-prodrive-macos

## What this repo is

The macOS native app for RaceCor Pro Drive: `apps/native/` (SwiftUI/AppKit). See [README.md](README.md) for the product-level overview.

## When you're editing the app

Read `apps/native/CLAUDE.md` for the architecture notes (MVVM + `@Observable` for SwiftUI).

## Cross-repo context

The app is a consumer of the same backend at `https://prodrive.racecor.io`:

- **Auth** via `/api/plugin-auth/*` PKCE (shared with the SimHub plugin and the other native apps). Client ID: `racecor-prodrive-mac`. Allowed redirects for macOS: `http://localhost:*` callbacks or `racecor-native://auth` custom scheme.
- **Data** via `/api/v1/*` with Bearer tokens. See `../native-apps-api-contract.md`.
- **Design tokens** via `/api/v1/tokens/native?format=swift`. The app fetches on launch and caches to disk.

## Agent work policy

All agent-spawned work should use `isolation: "worktree"`, per the parent `racecor.io` convention.

Exceptions: read-only exploration; single-file doc updates.

## What's intentionally *not* shared (yet)

- No shared package directory at the monorepo root. The app owns its full dependency tree.
- No shared CI — the app has its own build/test pipeline.
- No shared design-token package. The app fetches tokens from the server at runtime.

If pressure grows for any of these (e.g. a future second target needs the same OAuth helper Swift package), add `packages/<name>/` and move shared code there. Don't add sharing speculatively.

## Pointers

- Master plan: `../native-apps-plan.md`
- API contract: `../native-apps-api-contract.md`
- Server (closed): `../racecor-prodrive-server/`
- Plugin + overlay (open): `../racecorio-prodrive/`
