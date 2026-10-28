# apps/plugin/src/agents — MCP servers (dormant)

Of the three Model Context Protocol servers this folder had in `prodrive-plugin`, one is here: `k10-broadcaster/`
(broadcast control and OBS, with its own README, QUICKSTART and DEPLOYMENT). `k10-plugin/` and `simhub-telemetry/`, which
`claude-mcp-config.json` still names, are not in the tree, and that file's paths (`racing-desk-plugin`,
`racing-desk-overlay`) are the old repo's.

Nothing in Racing Desk runs or depends on them. OBS is driven by the app itself (`apps/overlay/modules/js/obs/`,
`docs/recording.md`); the telemetry is `GET localhost:8889/racing-desk/` (root CLAUDE.md). Treat this folder as history
until the driver decides to bring a server back or remove it. `../racing-desk-io-pro-drive-mcp.md` is the original
brief for the plugin and dashboard, written before any of the current design.
