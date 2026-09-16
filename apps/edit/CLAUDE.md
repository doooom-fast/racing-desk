# prodrive-edit

Canonical instructions and skills live under [`agents/prodrive-edit/`](agents/prodrive-edit/) — pulled in via the [prodrive-agents](https://github.com/k10-motorsports/prodrive-agents) submodule.

Common entry points:
- Repo overview: [`agents/prodrive-edit/CLAUDE.md`](agents/prodrive-edit/CLAUDE.md)
- Cross-repo context: [`agents/prodrive-context/`](agents/prodrive-context/)
- Skills: installed via the `prodrive-knowledge` plugin (run `/plugin` to inspect). Source lives under [`agents/skills/`](agents/skills/).

To pull updates:
```bash
git submodule update --init --remote agents
```
