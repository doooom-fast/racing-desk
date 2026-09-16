# prodrive-plugin

Canonical instructions and skills live under [`agents/prodrive-plugin/`](agents/prodrive-plugin/) — pulled in via the [prodrive-agents](https://github.com/k10-motorsports/prodrive-agents) submodule.

Common entry points:
- Repo overview: [`agents/prodrive-plugin/CLAUDE.md`](agents/prodrive-plugin/CLAUDE.md)
- Cross-repo context: [`agents/prodrive-context/`](agents/prodrive-context/)
- SimHub plugin context: [`agents/prodrive-plugin/racecor-plugin/CLAUDE.md`](agents/prodrive-plugin/racecor-plugin/CLAUDE.md)
- Skills: installed via the `prodrive-knowledge` plugin (run `/plugin` to inspect). Source lives under [`agents/skills/`](agents/skills/) — `plugin-*` skills are scoped to this repo.

To pull updates:
```bash
git submodule update --init --remote agents
```
