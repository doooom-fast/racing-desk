# CLAUDE.md — racecor-prodrive-ios

## What this repo is

Three iOS/iPadOS apps in one repo, each targeting the same product via a different approach. See [README.md](README.md).

## When you're editing any of the three

Read the app's own `CLAUDE.md`:
- `apps/shell/CLAUDE.md` — WKWebView delegate plumbing, SFSafariViewController for off-site links, cookie persistence.
- `apps/native/CLAUDE.md` — adaptive layout (size classes), `@MainActor` `AuthManager`, 401-refresh-retry contract, `ASWebAuthenticationSession` vs in-app WebView (Apple requires the former for OAuth).
- `apps/rn/CLAUDE.md` — Expo Router v4 file-based routing, TanStack Query persistence, NativeWind vs StyleSheet, `expo-auth-session` + `expo-secure-store`.

## Cross-repo context

Backend: `https://prodrive.racecor.io`.
- Auth: `/api/plugin-auth/*` PKCE. Client IDs `racecor-prodrive-ios-shell`, `racecor-prodrive-ios`, `racecor-prodrive-rn`. All three register `racecor-prodrive://auth` as an allowed redirect.
- Data: `/api/v1/*` (native + RN consume directly; shell uses the web UI). See `../native-apps-api-contract.md`.
- Tokens: `/api/v1/tokens/native?format=swift` or `?format=json`.

## Agent work policy

Agent-spawned work should use `isolation: "worktree"`. Exception: read-only exploration, single-file doc updates.

## Why three, not one

After TestFlight feedback, **two of these three will be killed**. Until then they coexist. If an edit pattern is obviously needed in more than one, duplicate it first — wait for pressure before extracting. Killing one of the three is much easier if nothing in the repo root depends on it.

## Not shared

No `packages/` at the root. No shared CI. No shared design-token package.
- Shell is pure Swift; native is pure Swift; RN is pure TypeScript. The "Swift" overlap is shallower than it looks — the two Swift apps have very different architectures (the shell barely has any Swift; the native has a full app-shell).
- Design tokens come from the server at runtime for each app.

## Pointers

- Master plan: `../native-apps-plan.md`
- API contract: `../native-apps-api-contract.md`
- Original RN plan (historical, informs `apps/rn`): `../racecor-prodrive-server/mobile-app-plan.md`
