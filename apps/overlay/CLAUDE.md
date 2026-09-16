# prodrive-overlay

Canonical instructions and skills live under [`agents/prodrive-overlay/`](agents/prodrive-overlay/) — pulled in via the [prodrive-agents](https://github.com/k10-motorsports/prodrive-agents) submodule.

Common entry points:
- Repo overview: [`agents/prodrive-overlay/CLAUDE.md`](agents/prodrive-overlay/CLAUDE.md)
- Cross-repo context: [`agents/prodrive-context/`](agents/prodrive-context/)
- Skills: installed via the `prodrive-knowledge` plugin (run `/plugin` to inspect). Source lives under [`agents/skills/`](agents/skills/) — `overlay-*` skills are scoped to this repo (e.g. `overlay-moza-api`, `overlay-webgl`, `overlay-dataviz`).

To pull updates:
```bash
git submodule update --init --remote agents
```
