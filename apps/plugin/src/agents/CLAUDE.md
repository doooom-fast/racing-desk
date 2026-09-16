# MCP Servers

Three Model Context Protocol servers that provide Claude agents with access to K10 Motorsports platform data and capabilities.

## Servers

| Server | Directory | Purpose |
|--------|-----------|---------|
| `k10-broadcaster` | `k10-broadcaster/` | Broadcast control and OBS integration |
| `k10-plugin` | `k10-plugin/` | SimHub plugin management and configuration |
| `simhub-telemetry` | `simhub-telemetry/` | Live telemetry data access from SimHub's HTTP API |

## Tech Stack

- Node.js (ESM)
- MCP SDK (`@modelcontextprotocol/sdk`)
- Configuration: `claude-mcp-config.json`

## Related Resources

- Design skill: `racing-hud-design-skill/` — HUD design system reference for agents
- Tufte audit skill: `tufte-audit-skill/` and `skills/tufte-audit/` — data visualization quality audits
- MCP spec: `racecor-io-pro-drive-mcp.md` (in parent `src/` directory)

## Documentation

Each server has its own docs:
- `k10-broadcaster/`: README, QUICKSTART, DEPLOYMENT, CHECKLIST, INDEX
- `k10-plugin/`: README
- `simhub-telemetry/`: see source files

## Relationship to Other Projects

These servers bridge the plugin and overlay data into Claude agent workflows. The `simhub-telemetry` server reads from the same HTTP API (port 8889) that the overlay polls. See [root CLAUDE.md](../../CLAUDE.md) for the full data flow.
