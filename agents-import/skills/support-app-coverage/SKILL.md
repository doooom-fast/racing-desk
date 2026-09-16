---
name: support-app-coverage
description: |
  How to keep the prodrive-support help center in sync with what's actually shipping across the six lockstep Pro Drive apps (web, macOS, iOS, tvOS, Windows plugin, overlay). Use this skill when: a feature ships and you're deciding what docs need to be written/updated; reviewing whether the support site has gaps; after a release in any of the platform repos; or auditing coverage before a public launch. Covers: which platforms exist and where they live in the org, how to detect what's user-facing vs internal, what triggers a new article vs an edit to an existing one, and how to backfill coverage retroactively. If in doubt about whether something needs a help article, use this skill.
---

# RaceCor.io Pro Drive — Support Article Coverage

This skill answers the question: *"What support articles need to exist or be updated?"* It complements `support-content-authoring`, which answers *"How do I write the article well?"*.

## The lockstep set

Six apps ship in lockstep (same `vX.Y.Z` every release). Each is a separate repo under [`k10-motorsports`](https://github.com/k10-motorsports):

| Repo                | Surface in support site         | Local path                    |
|---------------------|---------------------------------|-------------------------------|
| `prodrive-server`   | `content/docs/web-app/`         | `~/Documents/K10/racecor-prodrive/prodrive-server` |
| `prodrive-macos`    | `content/docs/macos/`           | `~/Documents/K10/racecor-prodrive/prodrive-macos` |
| `prodrive-ios`      | `content/docs/ios/`             | `~/Documents/K10/racecor-prodrive/prodrive-ios` |
| `prodrive-tvos`     | `content/docs/tvos/`            | `~/Documents/K10/racecor-prodrive/prodrive-tvos` |
| `prodrive-windows`  | `content/docs/windows/`         | `~/Documents/K10/racecor-prodrive/prodrive-windows` |
| `prodrive-overlay`  | `content/docs/overlay/`         | `~/Documents/K10/racecor-prodrive/prodrive-overlay` |
| `prodrive-plugin`   | (mostly under `windows/`)       | `~/Documents/K10/racecor-prodrive/prodrive-plugin` |

(`prodrive-homebridge`, `prodrive-edit`, `prodrive-narrative`, `prodrive-designer`, `prodrive-telemetry` are not currently surfaced in the user-facing support site — they're either internal or shipping separately. Confirm before writing for those.)

## When to write or update an article

### Write a NEW article when…

- A new **user-facing setting** appears in any app's settings/preferences UI
- A new **flow** is added (signup, sharing, importing, exporting)
- A new **error message** can be triggered by user action (those need a troubleshooting article keyed by the error text, so search finds it)
- A new **integration** is added (a new sim, a new device, a new third-party service)
- A new **install or distribution path** is added (e.g. a Mac App Store version alongside the .dmg)

### Update an EXISTING article when…

- A UI element referenced in the article moved or got renamed
- A step in a numbered procedure changed
- A screenshot is more than ~6 months old or the UI no longer matches it
- A linked URL changed (`racecor.io/foo` → `racecor.io/bar`)
- A platform requirement changed (min macOS version, min iOS version, etc.)
- A new troubleshooting case is now common — add it to the relevant `troubleshooting/` article

### Do NOT write an article for…

- **Backend-only changes.** If the user can't see it, it doesn't need docs.
- **Performance improvements** unless they change a documented number ("up to 50 cars" → "up to 100 cars").
- **Bug fixes** unless the bug had a workaround documented in support — in which case, *delete the workaround* once the fix ships.
- **Internal refactors, dependency bumps, build changes.**

## How to detect what changed

After a release (or before a release as a coverage check):

```bash
# From a sibling checkout, scan recent commits in each platform repo for user-facing changes
for repo in prodrive-server prodrive-macos prodrive-ios prodrive-tvos prodrive-windows prodrive-overlay prodrive-plugin; do
  echo "=== $repo ==="
  cd ../$repo
  git log --since="1 month ago" --pretty=format:"%h %s" -- '*Settings*' '*Onboarding*' '*Welcome*' '*UI*' '*View*' '*Page*' 2>/dev/null | head -20
  cd ../prodrive-support
done
```

Then for each commit that looks user-facing, ask:

1. *Will a user notice this?* If no, skip.
2. *Is there an existing article that mentions the affected thing?* If yes, edit it.
3. *Should there be a new article?* If yes, add to the right category folder + register in `meta.json`.

For a more thorough audit, look at:

- **Settings screens** — every toggle/field should be findable in the support site
- **Empty states / first-run UI** — every link or CTA should land somewhere
- **Error dialogs** — every error message should be searchable
- **App Store / TestFlight release notes** — these are the user's view of what changed; the support site should match

## Coverage audit checklist

Run this monthly or before any public-facing announcement:

- [ ] Every category has a non-stub `index.mdx`
- [ ] Every install / first-run article matches the current installer/onboarding UI
- [ ] Every error string mentioned in `troubleshooting/` still exists in the apps (or the article documents the error's removal)
- [ ] Every external URL resolves (run a link checker)
- [ ] Every `> Stub —` marker is either filled in or has a tracking issue
- [ ] FAQ matches what the support inbox is actually being asked

## Coordinating across apps

A change that ships in *one* app often needs coverage in *multiple* support categories:

- iOS gets a "share session to Apple TV" feature → write under `ios/` AND `tvos/`, cross-link both.
- A new SimHub integration ships → write under `windows/` AND `overlay/`, cross-link.
- A new web dashboard widget renders telemetry from the plugin → write under `web-app/` AND mention in `windows/` "what gets sent to the cloud".

## What goes in the API vs the website

The site exposes a JSON API at `/api/v1/articles` for native apps that want to render docs natively. **The article body is the same MDX either way** — there's no second source. So:

- Write content in MDX, period.
- The native apps either embed a webview (renders the website) or call the JSON API (renders themselves).
- Don't write "MDX for the website + a separate plain-text version for the apps". One source.

If an article has interactive widgets (a `<CodeBlock>`, a `<Cards>` grid), the JSON API returns the raw markdown source — the apps decide how to render it. Keep articles renderable as plain markdown for graceful native fallback.

## When you genuinely don't know

The support inbox (`support@racecor.io`) and the bug inbox (`bugs@racecor.io`) are the ground truth for what users are confused about. If you're stuck deciding whether something needs an article, look at the last 30 days of inbound questions for that category — if 2+ users asked it, write it.
