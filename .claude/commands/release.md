---
description: Cut a coordinated release across all six prodrive lockstep repos (plugin, overlay, windows, macos, ios, tvos), watch the CI runs, fix failures, retry as needed.
argument-hint: "[version like 1.5.0 — omit for auto-bump from current]"
allowed-tools: Bash, Read, Edit, Write, TodoWrite
---

# /release — orchestrate a coordinated release across all six lockstep repos

You are cutting a release. Your job is to push a `v<version>` tag to each of the six lockstep repos, watch all the CI runs, classify any failures, auto-retry transients, and propose fixes for real failures so the user can OK them and you can re-cut. Do not skip any of these steps and do not invent shortcuts. The user has flaky Windows builds and wants supervision.

## Lockstep set (six repos)

These repos always release at the same version. They live as siblings in `../`:

| Repo | Wave | Workflow file | Failure mode notes |
|---|---|---|---|
| `prodrive-plugin` | 1 (leaf) | `.github/workflows/release.yml` | C# .NET 4.8 SimHub plugin. Stable. |
| `prodrive-overlay` | 1 (leaf) | `.github/workflows/release.yml` | Electron win-x64/arm64. Usually clean. |
| `prodrive-windows` | 2 (consumer) | `.github/workflows/release.yml` | **Flakiest.** Downloads latest plugin+overlay releases, builds WinUI 3 + Inno Setup combined installer. |
| `prodrive-macos` | 2 (consumer) | `.github/workflows/release.yml` | xcodegen → archive → notarized DMG. App Store Connect API key required. |
| `prodrive-ios` | 2 (consumer) | `.github/workflows/release.yml` | xcodegen → archive → upload to App Store Connect (lands in TestFlight). |
| `prodrive-tvos` | 2 (consumer) | `.github/workflows/release.yml` | Same as iOS, tvOS variant. |

Wave 1 must publish before Wave 2 starts (Windows downloads plugin/overlay assets at build time).

## Versioning rule (load-bearing — do not deviate)

- **Build fix** (re-tagging because CI failed and the fix touches only `.github/workflows/`, build scripts, electron-builder/Inno Setup config, fastlane, xcconfig, signing setup, or similar build plumbing — **no product code change**) → **patch bump** (e.g. `v1.5.0` failed → fix → `v1.5.1`).
- **Anything else** (new feature, product bug fix, dependency change, refactor that lands) → **minor bump** (e.g. last shipped `v1.4.7` → next is `v1.5.0`).
- **Major bumps** are user-driven; never auto-pick major.

Lockstep means **all six repos always carry the same version**. A build fix patch-bump still re-tags all six, even if only Windows broke.

## Pre-flight (always do this first)

1. Determine current version. Read `MARKETING_VERSION` (or equivalent) from each lockstep repo. Sources of truth per repo:
   - `prodrive-plugin`: most recent `v*` git tag in the repo (`git -C ../prodrive-plugin describe --tags --abbrev=0 --match 'v*'`)
   - `prodrive-overlay`: same — most recent git tag
   - `prodrive-windows`: same — most recent git tag
   - `prodrive-macos`: `MARKETING_VERSION` in `../prodrive-macos/project.yml`
   - `prodrive-ios`: `MARKETING_VERSION` in `../prodrive-ios/project.yml`
   - `prodrive-tvos`: `MARKETING_VERSION` in `../prodrive-tvos/project.yml`

2. Verify they all match. If they don't, **stop and report** — fix the drift first (probably a previous release was incomplete). Do not proceed.

3. Determine target version:
   - If user passed an explicit version arg (e.g. `/release 1.5.0`), use that.
   - Otherwise default to a **minor bump** of the current version.

4. Confirm with the user: "About to release `v<NEW>` across plugin, overlay, windows, macos, ios, tvos. Current is `v<CUR>`. OK?" Wait for explicit yes.

5. Verify the user has the API key task done. Ask: "Are the four `APPLE_TEAM_ID` / `APP_STORE_CONNECT_*` org secrets in place?" If no and macos/ios/tvos are in scope, those will fail — flag this but proceed only if the user says to.

## Wave 1 — leaves (plugin + overlay)

Tag and push in parallel:

```bash
cd ../prodrive-plugin && git tag "v$NEW" && git push origin "v$NEW"
cd ../prodrive-overlay && git tag "v$NEW" && git push origin "v$NEW"
```

Then watch both runs. Use `gh run watch --exit-status` per repo so a non-zero exit signals failure:

```bash
gh -R k10-motorsports/prodrive-plugin run watch --exit-status $(gh -R k10-motorsports/prodrive-plugin run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

Run them in parallel by backgrounding the watches. Block until both publish a release with assets attached. Verify with:

```bash
gh -R k10-motorsports/prodrive-plugin release view "v$NEW" --json assets -q '.assets | length'
gh -R k10-motorsports/prodrive-overlay release view "v$NEW" --json assets -q '.assets | length'
```

Both must be > 0 before Wave 2. If wave 1 fails, do the watch/fix/retry loop (see below) before continuing.

## Wave 2 — consumers (windows + macos + ios + tvos)

After Wave 1 publishes, tag and push all four in parallel:

```bash
cd ../prodrive-windows && git tag "v$NEW" && git push origin "v$NEW"
cd ../prodrive-macos   && git tag "v$NEW" && git push origin "v$NEW"
cd ../prodrive-ios     && git tag "v$NEW" && git push origin "v$NEW"
cd ../prodrive-tvos    && git tag "v$NEW" && git push origin "v$NEW"
```

Watch each run in parallel via `gh run watch`. Apple platforms have a "build/upload succeeded → TestFlight processing pending" terminal state that's a success from CI's perspective; downstream Apple review is async and out of scope.

## Watch/fix/retry loop (for any failed run in either wave)

When a run fails:

### Step 1: Pull the failure log

```bash
gh -R k10-motorsports/<repo> run view <run-id> --log-failed
```

### Step 2: Classify the failure

**Auto-retry transients** (re-run the failed job, no asking, max 2 retries per job):
- Network errors: `getaddrinfo ENOTFOUND`, `connect ETIMEDOUT`, HTTP 5xx from github.com, registry.npmjs.org, api.nuget.org, downloads.apple.com
- Runner shutdown / "operation was canceled" / "The runner has received a shutdown signal"
- Codesigning timeouts: `signtool.exe` timed out, `codesign` timed out, notarytool timeouts (Apple's notarization queue is sometimes slow)
- Cache restore failures (actions/cache)
- "Asset not found" when downloading sibling-repo releases — wait 30s and retry (upstream may still be publishing the asset)
- App Store Connect API rate limiting (HTTP 429, "rate limit exceeded")

To re-run just the failed job:
```bash
gh -R k10-motorsports/<repo> run rerun <run-id> --failed
```

**Pause and propose a fix** (everything else):
- Compile errors, missing files, type errors
- Test failures
- Inno Setup script errors, electron-builder config errors, MSBuild config errors
- Xcode signing errors that aren't transient (e.g. "No matching profiles found" — usually a real config problem, not a flake)
- Anything not in the transient list above — show the user the failing step and the relevant log excerpt and ask before doing anything

### Step 3: When proposing a fix

Read the relevant files. Diagnose. Propose a concrete diff. Wait for user OK. Then apply the diff, commit + push to `main`, and re-tag per the versioning rule:

- Fix touched only build plumbing → **patch bump**: delete old tag (`git tag -d v$NEW && git push origin :v$NEW`), create new tag `v$PATCH_BUMP`, re-push to ALL SIX repos in lockstep, restart the wave.
- Fix touched product code → **minor bump**: same dance, but new tag is the next minor. (This should be rare during a release — usually you'd cancel the release, land the fix as a normal PR, then re-cut.)

Always re-tag all six lockstep repos to the same version, even if only one needed a fix.

### Step 4: After 2 retries on the same job, stop auto-retrying

If a transient fails 2x in a row, treat it as non-transient. Pull the log, ask the user.

## Reporting

Throughout, give brief status updates: "Wave 1 in flight. Plugin: queued. Overlay: building." When something fails: "Windows build failed at step X. Classifying..." When done: a one-line summary with links to the GitHub releases.

## Don'ts

- Don't force-push the same tag — always bump to a new version per the rule.
- Don't push a fix to one repo without re-tagging all six.
- Don't skip the user-confirm step before pushing the initial tags.
- Don't `gh release create` manually — the workflows do that.
- Don't proceed to Wave 2 until Wave 1 publishes both releases with assets.
- Don't auto-retry a non-transient failure even if the user might want you to.
