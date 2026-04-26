# prodrive-designer — Live prototyping shell for prodrive surfaces

Electron desktop tool that hosts the production overlay (or web app) over a recorded race video, with telemetry sidecar replay, an element picker / layout grid, and Claude attached to the side panel as an in-window collaborator who can read/edit the overlay source.

**First target:** the `prodrive-overlay` HUD. Built to extend to other prodrive surfaces (web app screens, native apps) over time.

## Repo

- GitHub: [`k10-motorsports/prodrive-designer`](https://github.com/k10-motorsports/prodrive-designer) (private)
- Local: `~/Documents/K10/racecor-prodrive/prodrive-designer/`

## Architecture in one diagram

```
┌─ prodrive-designer Electron host ─────────────────────────────────────┐
│                                                                       │
│  ┌─ Stage area ─────────────────────────────┐ ┌─ Side panel ──────┐   │
│  │ <video> recorded race                    │ │ Claude transcript │   │
│  │  └─ <webview> dashboard.html (transparent│ │  + composer       │   │
│  │     bg, polls our replayer instead of    │ │  + picked-element │   │
│  │     :8889) ──── poll → http://127.0.0.1:N │ │    chat entries   │   │
│  └──────────────────────────────────────────┘ └───────────────────┘   │
│                                                                       │
│  ┌─ Toolbar (transport / source / modes) ───────────────────────────┐ │
│  └──────────────────────────────────────────────────────────────────┘ │
│  ┌─ Dock (Overrides | Logs tabs) ───────────────────────────────────┐ │
│  └──────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘

  ↑ http poll on N        ↑ IPC      ↑ executeJavaScript    ↑ Anthropic
  Sidecar Replayer  ←  main.js  →  Picker / Grid       →  @anthropic-ai/
  (./replayer/                  ←   stage controls           claude-agent-sdk
   sidecar-server.js)           (./host/stage-tools.js)  (long-running session,
                                                          custom MCP tools)
```

## Key paths

| What | Path |
|------|------|
| Electron main | `main.js` |
| Host preload (renderer ↔ main IPC) | `preload.js` |
| Host renderer | `host/index.html`, `host/host.js`, `host/host.css` |
| Stage `<webview>` preload (window.k10 stub + simhub override) | `host/stage-preload.js` |
| Web-app settings preload (real K10Bridge) | `host/web-stage-preload.js` |
| Picker / grid injection scripts | `host/stage-tools.js` |
| Sidecar JSONL → plugin-shape mapper | `replayer/sidecar-mapper.js` |
| Sidecar HTTP server (mimics plugin endpoint) | `replayer/sidecar-server.js` |
| Claude Agent SDK host + custom MCP tools | `claude/agent-host.js` |

## Cross-repo dependencies

The designer reads from sibling checkouts at `../`:

- **`prodrive-overlay/`** — the dashboard.html + modules/* mounted into the stage. Designer's edits operate on this tree.
- **`prodrive-server/`** — Next.js app for the settings window (auto-launched at port 3000) and web-api at port 3001.
- **`prodrive-telemetry/`** — `.mp4` + matching `.telemetry.jsonl` recordings.

Override paths via env: `OVERLAY_PATH`, `SERVER_PATH`, `SERVER_URL`, `TELEMETRY_PATH`.

## Telemetry sidecar contract

The replayer reads `.telemetry.jsonl` produced by `prodrive-overlay`'s recorder. Schema is documented at [`prodrive-context/telemetry-sidecar-schema.md`](../prodrive-context/telemetry-sidecar-schema.md). When you add a field, update both the producer (`telemetry-sidecar.js`) and the consumer (`sidecar-mapper.js`) plus the schema doc.

## Settings persistence

By default the designer reads/writes the **production overlay's** settings file at `~/Library/Application Support/K10 Motorsports/overlay-settings.json` so the stage reflects the live config. To isolate (testing risky settings), set `DESIGNER_ISOLATED_SETTINGS=1`.

## Auth

Either:
- `ANTHROPIC_API_KEY=sk-ant-...` (Console API key)
- `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...` (Max-plan, generate with `claude setup-token`)

Loaded from `.env.local` or `.env` at boot.

## When making changes

- The designer has **no build step** — vanilla JS in the renderer, ES modules in main via `import()` for the SDK only. Don't introduce a bundler.
- The stage `<webview>` runs with `contextIsolation=false` deliberately so the stage preload can patch `window.k10` and `window._simhubUrlOverride` directly.
- The web-app settings window runs with `contextIsolation=true` and uses `contextBridge` because it needs the real K10Bridge contract.
- Keep designer-tools MCP changes mirrored: tool definition in `claude/agent-host.js` AND host hook implementation in `main.js`.
