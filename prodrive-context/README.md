# prodrive-context

Cross-repo context — anything that applies to the K10 Motorsports platform as a whole, not just one repo.

| Doc | What it covers | Originally lived at |
|-----|----------------|---------------------|
| [monorepo-orchestration.md](monorepo-orchestration.md) | Repo map, end-to-end data flow, cross-repo contracts (design tokens, demo build, Windows installer, native apps), iRacing scraping constraints | [`prodrive-plugin/CLAUDE.md`](../prodrive-plugin/CLAUDE.md) (back when plugin and overlay were one monorepo) |
| [native-apps-api-contract.md](native-apps-api-contract.md) | Versioned API surface that ios/macos/tvos/windows clients consume from prodrive-server | (originated here) |
| [native-apps-plan.md](native-apps-plan.md) | Rollout plan for the native apps work | (originated here) |

## When to add something here

Use this folder for context that:
- Spans **two or more** repos in the K10 Motorsports org
- Documents a **contract** between repos (data shapes, ports, build paths, env vars)
- Captures org-wide **conventions** (worktree usage, naming, etc.)

Use a per-repo folder (e.g. `agents/prodrive-plugin/`) for anything tied to a single repo's code, structure, or stack.
