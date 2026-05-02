---
name: support-content-authoring
description: |
  Voice, structure, frontmatter, and editorial conventions for the RaceCor.io Pro Drive support site (prodrive-support repo). Use this skill whenever creating or editing an article under `content/docs/**`, or when reorganizing the sidebar via `meta.json`. Covers: how to write a stub vs. a finished article, when to use `<Cards>` vs prose, frontmatter requirements, cross-linking, voice/tone, and what "good" looks like for a help-center article in this codebase. If in doubt about any aspect of writing or structuring a help article, use this skill.
---

# RaceCor.io Pro Drive — Support Content Authoring

This skill governs everything in `content/docs/**` of the `prodrive-support` repo. The audience is a sim racer who is mid-frustration and needs an answer fast, *not* a developer or power user.

## Voice

- **Direct.** Lead with the answer. The user is here to fix something, not read prose.
- **Second person.** "You'll see the overlay in the top-left corner." Not "users will see…".
- **No marketing language.** This is a support site, not a brochure. Don't say "powerful", "seamless", "robust". Say what it does.
- **No apologies or hedging.** "If the overlay doesn't appear, do X." Not "We're sorry you're having trouble! You might want to try…".
- **Short paragraphs.** 1–3 sentences. Use lists for sequences.

## Frontmatter (required)

Every `.mdx` file under `content/docs/` must have:

```mdx
---
title: <Sentence case, no trailing period, < 60 chars>
description: <One sentence, ends with a period, < 150 chars. Used for the search snippet and the OG image.>
---
```

Validated by `pageSchema` in `source.config.ts`. CI fails if either is missing.

**Title rules:**

- Sentence case: "Install Pro Drive on macOS" (not "Install Pro Drive On macOS")
- No product name in the title when the category already implies it. Inside `macos/`, prefer "Install" over "Install Pro Drive on macOS" — *unless* the article will surface in cross-category search and needs disambiguation. The current convention is: include the platform in the title for any install/setup article (those get linked from the home page), drop it for everything else.
- Imperative for how-to ("Install on Windows", "Configure SimHub"), noun phrase for reference ("Account & billing", "HUD layout").

## Article shapes

Two shapes — pick one explicitly, don't blend.

### Shape 1: Index page (one per category)

A category's `index.mdx` is a router, not an article. One short intro paragraph + a `<Cards>` grid. Example:

```mdx
---
title: macOS app
description: Pro Drive for Mac — install, sign in, and the macOS-specific features.
---

Pro Drive for Mac is a native SwiftUI app distributed as a **notarized .dmg** from <https://racecor.io/download>.

<Cards>
  <Card title="Install" href="/docs/macos/install" />
  <Card title="First-run setup" href="/docs/macos/first-run" />
</Cards>
```

Don't put substantive content on an index page — it should fit on one screen.

### Shape 2: How-to / troubleshooting article

Numbered steps for sequences, `## Heading` per logical section. End with a `<Cards>` block linking to related articles or the next step. Example structure:

```mdx
---
title: Install on Windows
description: Run the Inno Setup installer for the Pro Drive plugin and overlay.
---

The Windows installer bundles two pieces: the SimHub plugin and the overlay HUD. You install both at once.

## 1. Download

Get the latest installer from <https://racecor.io/download>. The file is a single `RaceCor-<version>-setup.exe`.

## 2. Run the installer

(steps...)

## What gets installed

(reference info...)

## Next steps

<Cards>
  <Card title="Configure SimHub" href="/docs/windows/simhub" />
  <Card title="Troubleshooting → no sessions appearing" href="/docs/troubleshooting/no-sessions" />
</Cards>
```

## Stubs

Many articles in the seed are stubs — placeholders so the navigation works before the content is written. A stub looks like:

```mdx
---
title: ...
description: ...
---

> Stub — fill me in. Cover: <hint of what should go here>.
```

When you fill a stub:

1. **Delete the `> Stub —` line.** It's a marker, not content.
2. **Use the hint.** The hint documents what someone (probably you, last week) decided this article should cover. Honor it unless you have a specific reason not to.
3. **Don't expand scope.** If the stub says "cover the Gatekeeper dialog", don't write a 4-section article on macOS security generally. Tight beats comprehensive.

## Cross-linking

- Use **relative file paths** in MDX `<a>` / `[text](./foo)` syntax — Fumadocs rewrites these via `createRelativeLink` (see `app/docs/[[...slug]]/page.tsx`).
- Use **absolute `/docs/...` paths** in `<Card href>` — `<Card>` is not auto-rewritten.
- Always link from troubleshooting articles to the relevant install/setup article and vice versa. The user will move between them.

## Sidebar order (`meta.json`)

Each folder has a `meta.json` that controls sidebar order:

```json
{
  "title": "Windows",
  "pages": ["index", "install", "simhub", "uninstall"]
}
```

Rules:

- **Always list `index` first.**
- Order by user journey, not alphabetically. Install → Configure → Troubleshoot, not Configure → Install → Troubleshoot.
- Use `"---Section name---"` to group items inside a folder if the list grows past ~8 entries. (Fumadocs renders these as separators.)

## What NOT to do

- **Don't reference internal repo names or file paths.** "The plugin DLL gets installed to `racecor-plugin/bin/Release/...`" is for engineers, not users. Say "the plugin gets installed into SimHub".
- **Don't link to GitHub source.** The "Edit on GitHub" link in the page header handles that.
- **Don't use `:::tip` / `:::warning` callouts** — Fumadocs supports them but the design system here uses inline `**bold**` + a short note. Reserve callouts for genuinely critical safety info (data loss, irreversible action).
- **Don't write release notes.** Those go in the apps or in a changelog page on racecor.io, not here.
- **Don't write prose where a list works.** Three or more parallel items → list.
- **Don't mention the AI / LLM / `llms.txt` machinery.** The end user doesn't care that we expose markdown for LLMs.

## Reviewing your own work

Before committing a content change, ask:

1. Could the user act on this in under 30 seconds? If they have to read three paragraphs to find the steps, restructure.
2. Is every link in this article going to resolve? (Run `npm run dev` and click them.)
3. Is the title scannable at a glance from the sidebar?
4. Does the description tell the user whether this is the article they want, before they click?

## When to use `support-app-coverage` instead

Use that skill (not this one) when the question is *what articles need to exist or be updated* — e.g. after a feature ships in the iOS app. This skill assumes you already know which file you're editing.
