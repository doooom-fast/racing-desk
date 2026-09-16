# prodrive-homebridge — HomeKit Smart Light Plugin

Homebridge platform plugin (TypeScript, Node 18+) that subscribes to the SimHub plugin's HTTP API and maps telemetry state to HomeKit smart light colors and patterns.

This plugin previously lived inside [`prodrive-plugin`](https://github.com/k10-motorsports/prodrive-plugin) at `racecor-plugin/homebridge-plugin/`. It was extracted into its own repo so the Homebridge release cycle is independent from the SimHub plugin / overlay shipping cycle.

## Integration Contract (Homebridge ↔ SimHub Plugin)

This plugin is a **consumer** of the SimHub plugin's telemetry pipeline. The SimHub plugin (in [`prodrive-plugin/racecor-plugin/simhub-plugin/`](https://github.com/k10-motorsports/prodrive-plugin)) is the **producer**.

- **HTTP API**: `GET http://<simhub-host>:8889/racecor-io-pro-drive/`
- **Response**: Flat JSON object with 100+ properties (telemetry, commentary, strategy)
- **Polling**: configurable interval (default 500ms), per-property timeouts, parallel fetch
- **Contract rule**: Property names consumed here (flag state, severity, proximity) must stay in sync with the SimHub plugin

## Tech Stack

- TypeScript targeting Node.js 18+
- Zero runtime dependencies (uses Node built-in `http` module)
- Jest for testing
- Homebridge v1.6+ platform plugin
- Published to npm as `homebridge-racecor-lights` (platform alias `RaceCorProDriveLights`)

## Key Files

| What | Path |
|------|------|
| Plugin entry | `src/index.ts` |
| Platform class | `src/platform.ts` |
| Light accessory | `src/platformAccessory.ts` |
| Color mapper | `src/colorMapper.ts` |
| SimHub HTTP client | `src/simhubClient.ts` |
| Vendor clients | `src/merossClient.ts`, `src/vocolincClient.ts` |
| Flag-as-sensor | `src/flagSensorAccessory.ts` |
| Settings/aliases | `src/settings.ts` |
| Shared types | `src/types.ts` |
| Tests | `src/__tests__/` |
| Config schema | `config.schema.json` (Homebridge UI) |
| Docs | `docs/HOMEBRIDGE_PLUGIN.md`, `docs/HOMEBRIDGE_IMPLEMENTATION.md`, `docs/HOMEKIT.md` |

## How It Works

1. Polls SimHub's HTTP API at the configured interval
2. Reads flag state (8 colors), event severity (6 levels), and driver proximity
3. Resolves to an HSB color via the priority chain: flag → severity → proximity (configurable per mode)
4. Drives HomeKit Lightbulb characteristics (Hue, Saturation, Brightness, On)
5. Optional blink patterns for urgent states (yellow/red flag, near-miss proximity)
6. Per-light overrides: each configured light can pick its own mode and blink toggle

Three top-level modes:
- **flags only** — green / yellow / red / blue / white / debris
- **events only** — proximity-driven coloring
- **all_colors** — combined flags → severity → proximity priority chain

## Building & Testing

```bash
npm install && npm run build    # TypeScript → dist/
npm test                         # 133 Jest tests
npm run test:coverage            # With coverage
npm run lint                     # ESLint
npm run watch                    # Dev mode
```

133 Jest tests covering: color mapping (84), SimHub HTTP client (24), per-light mode overrides (25). Tests use mock HTTP responses — no running SimHub instance required.

## CI

`.github/workflows/ci.yml` runs `npm ci` + `npm run build` + `npm test` on every push/PR.

## Code Style

- TypeScript uses the project ESLint config
- Strict mode is enabled in `tsconfig.json`
- HSB throughout for color math (with conversion helpers to/from RGB and hex)
- All errors are logged via the Homebridge logger; recoverable failures fall back to "lights off" defaults
