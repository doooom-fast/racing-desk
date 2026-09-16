# prodrive-context

Cross-repo context — anything that applies to the K10 Motorsports platform as a whole, not just one repo.

| Doc | What it covers | Originally lived at |
|-----|----------------|---------------------|
| [monorepo-orchestration.md](monorepo-orchestration.md) | Repo map, end-to-end data flow, cross-repo contracts (design tokens, demo build, Windows installer, native apps), iRacing scraping constraints | [`prodrive-plugin/CLAUDE.md`](../prodrive-plugin/CLAUDE.md) (back when plugin and overlay were one monorepo) |
| [native-apps-api-contract.md](native-apps-api-contract.md) | Per-screen GET REST contract that ios/macos/tvos/windows clients consume from prodrive-server | (originated here) |
| [native-apps-calc-integration.md](native-apps-calc-integration.md) | How native apps consume the post-Phase-9 calc API; division of labor with the per-screen REST surface | (originated here) |
| [native-apps-plan.md](native-apps-plan.md) | Rollout plan for the native apps work | (originated here) |
| [video-editor-plan.md](video-editor-plan.md) | Native-only video editor (mac/win) consolidating prodrive-edit + prodrive-designer; `.rcpdv` bundle format; LAN/Blob transfer; YouTube upload; web is YouTube-consumer-only | (originated here) |
| [local-first-refactor-plan.md](local-first-refactor-plan.md) | **Proposal** — collapse the ecosystem to a rig-local, account-free system: two processes on the rig, cloud reduced to anonymous static content packs, 16 repos → 3, local-only race suggestions, and the sim rig as the dev environment | (originated here) |
| [obs-recording-mode-plan.md](obs-recording-mode-plan.md) | OBS recording option — OBS owns video + composition while a headless companion records the edit-compatible telemetry sidecar; 16:9/custom broadcast overlay as an OBS Browser Source; native-plugin tradeoff | (originated here) |

## When to add something here

Use this folder for context that:
- Spans **two or more** repos in the K10 Motorsports org
- Documents a **contract** between repos (data shapes, ports, build paths, env vars)
- Captures org-wide **conventions** (worktree usage, naming, etc.)

Use a per-repo folder (e.g. `agents/prodrive-plugin/`) for anything tied to a single repo's code, structure, or stack.
