# prodrive-agents

Central instructions and skills for every repo in the [k10-motorsports](https://github.com/k10-motorsports) org. Each consuming repo pulls this in as a git submodule mounted at `agents/`.

## Layout

```
prodrive-context/         ← cross-repo context (data flow, contracts, conventions)
prodrive-plugin/          ← mirrors prodrive-plugin/'s instruction tree
prodrive-overlay/         ← mirrors prodrive-overlay/'s instruction tree
prodrive-server/          ← mirrors prodrive-server/'s instruction tree
prodrive-windows/         ← mirrors prodrive-windows/'s instruction tree
prodrive-ios/             ← mirrors prodrive-ios/'s instruction tree
prodrive-macos/           ← mirrors prodrive-macos/'s instruction tree
prodrive-tvos/            ← mirrors prodrive-tvos/'s instruction tree
```

Inside each per-repo folder, paths mirror the source repo's layout. So `prodrive-plugin/racecor-plugin/CLAUDE.md` here corresponds to `racecor-plugin/CLAUDE.md` inside the prodrive-plugin repo.

## How a source repo uses this

Every source repo has this repo wired in as a submodule at `agents/`:

```bash
git submodule update --init agents
```

A thin pointer `CLAUDE.md` at each former location forwards Claude Code (and humans) to the canonical doc under `agents/<repo-name>/...`.

## Editing flow

To change instructions or skills:

1. Make the edit inside the matching `agents/<repo>/...` path within a source repo's checkout (the submodule), or directly in this repo.
2. Commit + push **in this repo** (`prodrive-agents`).
3. In each source repo that consumes the change, bump the submodule pointer: `git submodule update --remote agents`, commit, push.

## Adding a new repo

1. Create the new `prodrive-<name>/` folder here with the per-repo instruction tree.
2. Add the submodule in the source repo: `git submodule add git@github.com:k10-motorsports/prodrive-agents.git agents`.
3. Move/rewrite source repo's instruction files as thin pointers into `agents/prodrive-<name>/...`.
