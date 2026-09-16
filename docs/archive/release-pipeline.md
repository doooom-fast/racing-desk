# Release pipeline

The `Release lockstep` workflow on this repo orchestrates a coordinated
tag push across the lockstep release repos and waits for each repo's
own `release.yml` to publish assets.

> Source: [.github/workflows/release.yml](../.github/workflows/release.yml)
> Per-repo step: [.github/actions/release-one/action.yml](../.github/actions/release-one/action.yml)

## Lockstep repos

| Repo | Wave | Why |
|---|---|---|
| `prodrive-plugin` | 1 (leaf) | C# .NET 4.8 SimHub plugin |
| `prodrive-overlay` | 1 (leaf) | Electron HUD |
| `prodrive-windows` | 2 (consumer) | WinUI 3 host — downloads plugin/overlay assets at build time |
| `prodrive-macos` | 2 (consumer) | Currently excluded — see [task: signing fix](#mac-status) |

Wave 2 starts only after Wave 1 publishes — windows downloads
plugin/overlay release assets via `gh release download` in its own
`release.yml`.

## Running a release

1. Go to **Actions → Release lockstep → Run workflow**.
2. Inputs:
   - `version` — the target version *without* the `v` prefix (e.g. `0.18.0`)
   - `scope` — comma-separated. Default `plugin,overlay,windows`. Add
     `macos` once cloud signing is fixed.
   - `dry_run` — runs pre-flight only, prints the plan, pushes nothing.

The workflow validates the version format, checks lockstep (all
in-scope repos must share the same most-recent `v*` tag), and refuses
to proceed if `v<version>` already exists on any repo.

## Pre-flight failures

| Message | Meaning | Fix |
|---|---|---|
| `version must be MAJOR.MINOR.PATCH` | Bad input format. | Re-dispatch with `0.18.0` not `v0.18.0` or `0.18`. |
| `Lockstep drift detected` | In-scope repos have different latest tags. | Either reconcile manually (re-tag the lagging repo at the common version) or shrink the scope to a subset that does match. |
| `<tag> already exists on <repo>` | The version was already used. | Bump and re-dispatch. |

## Wave failures

If a Wave 1 leg fails, Wave 2 never starts. If a Wave 2 leg fails, the
preceding Wave 1 releases stay shipped (don't try to "undo" them — the
fix is to ship a follow-up version once the failure is resolved).

The workflow does **not** auto-retry transient failures (network,
runner shutdown, codesign timeout, etc.). If you suspect a transient,
re-dispatch with the same version — the pre-flight will refuse because
the tag already exists, so you'll need to bump (e.g. `0.18.0` → `0.18.1`).

## Required secret

`LOCKSTEP_RELEASE_PAT` — fine-grained PAT, on this repo's Actions
secrets, with:

- **Resource owner:** k10-motorsports
- **Repository access:** plugin, overlay, windows (+ macos when included)
- **Repository permissions:**
  - Contents: Read and write (tag push)
  - Actions: Read (poll workflow runs)
  - Metadata: Read-only (auto-required)

## Mac status

`prodrive-macos` is excluded from the default scope while cloud-managed
Developer ID signing is investigated. The release workflow on that repo
fails at the export step with `Cloud signing permission error`. Once
the App Store Connect API key role and cert visibility are sorted,
re-include `macos` in `scope` and re-dispatch.
