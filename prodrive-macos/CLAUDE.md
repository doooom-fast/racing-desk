# CLAUDE.md — racecor-prodrive-macos

## What this repo is

Two macOS apps grouped in one private repo: `apps/shell/` (Electron wrapper) and `apps/native/` (SwiftUI/AppKit). See [README.md](README.md) for the product-level overview.

## When you're editing either app

Both apps are substantial on their own. Read the `CLAUDE.md` inside the app directory you're touching — those files have the architecture notes (main/renderer split for Electron; MVVM + `@Observable` for SwiftUI).

## Cross-repo context

Both apps are consumers of the same backend at `https://prodrive.racecor.io`:

- **Auth** via `/api/plugin-auth/*` PKCE (shared with the SimHub plugin and the other native apps). Client IDs: `racecor-prodrive-mac-shell` and `racecor-prodrive-mac`. Allowed redirects for macOS: `http://localhost:*` callbacks or `racecor-prodrive://auth` custom scheme. The shell currently doesn't use PKCE — it loads the web app inside a `BrowserWindow` and uses the NextAuth session cookie.
- **Data** via `/api/v1/*` with Bearer tokens. Only the native app consumes these; the shell gets its data through the web UI. See `../native-apps-api-contract.md`.
- **Design tokens** via `/api/v1/tokens/native?format=swift`. The native app fetches on launch and caches to disk.

## Agent work policy

All agent-spawned work should use `isolation: "worktree"`, per the parent `racecor.io` convention.

Exceptions: read-only exploration; single-file doc updates.

## What's intentionally *not* shared (yet)

- No shared package directory at the monorepo root. Each app owns its full dependency tree.
- No shared CI — each app has its own build/test pipeline, configured independently.
- No shared design-token package. Both apps fetch tokens from the server at runtime.

If pressure grows for any of these (e.g. both apps need the same OAuth helper Swift package), add `packages/<name>/` and move shared code there. Don't add sharing speculatively.

## Pointers

- Master plan: `../native-apps-plan.md`
- API contract: `../native-apps-api-contract.md`
- Server (closed): `../racecor-prodrive-server/`
- Plugin + overlay (open): `../racecorio-prodrive/`
