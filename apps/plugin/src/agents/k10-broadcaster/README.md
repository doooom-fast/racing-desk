# RaceCor Broadcaster MCP Server

Part of the [RaceCorProDrive](https://github.com/alternatekev/media-coach-simhub-plugin) sim racing platform. A Model Context Protocol (MCP) server providing structured access to the RaceCorProDrive dashboard overlay source code — 28+ JavaScript modules, 10 CSS modules, WebGL shaders, and the Electron main process. Enables Claude to understand the overlay's architecture, module relationships, and styling without parsing raw HTML or manually reading files.

## Location

```
mcp/k10-broadcaster/
├── package.json
├── tsconfig.json
├── src/
│   └── index.ts
└── dist/
    ├── index.js
    └── index.d.ts
```

## Features

The MCP provides 12 specialized tools for exploring the RaceCor Broadcaster dashboard codebase:

### Dashboard Module Management
- **`list_components`** - Lists all dashboard modules with categories (HUD, panels, overlays, settings, layout)
- **`get_component`** - Reads module source (JS) and styling (CSS)
- **`get_component_tree`** - Extracts the full module hierarchy from dashboard.html

### Configuration Data
- **`get_telemetry_types`** - Reads telemetry property definitions
- **`get_settings_types`** - Reads overlay settings definitions

### Utilities & Helpers
- **`get_hook`** - Reads utility functions and helpers
- **`get_lib`** - Reads utility libraries (formatters, manufacturers, etc.)

### Styling & Design
- **`get_design_tokens`** - Reads CSS custom properties (design system variables)

### Testing
- **`list_tests`** - Lists all test files
- **`get_test`** - Reads specific test files

### Build Configuration
- **`get_build_config`** - Reads build configuration and package.json

### Code Search
- **`search_source`** - Searches across source files for regex patterns with context

## Source Structure

The MCP reads from the RaceCorProDrive dashboard source:

```
racecor-overlay/
├── modules/
│   ├── js/                # Dashboard modules
│   │   ├── config.js
│   │   ├── keyboard.js
│   │   ├── car-logos.js
│   │   ├── game-detect.js
│   │   ├── settings.js
│   │   ├── connections.js
│   │   ├── leaderboard.js
│   │   ├── datastream.js
│   │   ├── spotter.js
│   │   ├── pit-limiter.js
│   │   ├── webgl.js
│   │   ├── poll-engine.js
│   │   └── more modules...
│   └── styles/            # Dashboard styles
│       ├── base.css
│       ├── dashboard.css
│       ├── effects.css
│       └── more styles...
├── tests/
│   ├── helpers.mjs
│   ├── discord-oauth.spec.mjs
│   └── dashboard.spec.mjs
├── main.js                # Electron main process
├── preload.js             # IPC context bridge
├── dashboard.html         # Main dashboard
└── package.json
```

## Tool Reference

### list_components

Lists all dashboard modules with file paths and CSS status.

**Parameters:**
- `category` (optional): Filter by "hud", "panels", "overlays", "settings", "layout", or "all" (default)

**Returns:** Component list with names, categories, file paths, and CSS availability

**Example:**
```
Get HUD components only:
category: "hud"
```

### get_component

Reads a component's TSX source and CSS module (if it exists).

**Parameters:**
- `name` (required): Component name without extension (e.g., "Tachometer", "FuelPanel")

**Returns:** Combined TSX and CSS module contents

**Example:**
```
name: "Tachometer"
→ Returns Tachometer.tsx and Tachometer.module.css
```

### get_telemetry_types

Returns all telemetry type definitions from src/types/telemetry.ts.

**Parameters:** None

**Returns:** Full TypeScript type definitions including:
- `TelemetryProps` - Raw telemetry snapshot interface
- `ParsedTelemetry` - Normalized telemetry with friendly names
- `ConnectionStatus` - Connection state type
- `PollStats` - Polling statistics interface

### get_settings_types

Returns all settings configuration types from src/types/settings.ts.

**Parameters:** None

**Returns:** Full TypeScript type definitions including:
- `OverlaySettings` - Complete settings interface
- `LayoutPosition`, `SecondaryLayout`, `LayoutFlow` - Type unions
- `DEFAULT_SETTINGS` - Default settings constant
- Validator functions

### get_hook

Reads a custom React hook from src/hooks.

**Parameters:**
- `name` (required): "useTelemetry" or "useSettings"

**Returns:** Full hook source code including:
- State management
- Effects and side effects
- Return value interfaces
- Usage examples

### get_lib

Reads a utility library from src/lib.

**Parameters:**
- `name` (required): "formatters", "manufacturers", or "telemetry-client"

**Returns:** Library source code including:
- Function definitions
- Type exports
- Utility implementations

### get_design_tokens

Returns CSS custom properties from src/styles/tokens.css.

**Parameters:** None

**Returns:** Complete design system:
- Color variables
- Typography variables
- Spacing and sizing
- Layout variables

### get_component_tree

Parses Dashboard.tsx to extract the full component hierarchy.

**Parameters:** None

**Returns:**
- Component imports
- JSX structure
- Conditional rendering logic
- Component composition order

### list_tests

Lists all test files in the project.

**Parameters:** None

**Returns:** Test file names and paths

### get_test

Reads a specific test file.

**Parameters:**
- `name` (required): Test name without extension (e.g., "formatters", "components/Tachometer")

**Returns:** Full test source code including:
- Test suites
- Test cases
- Assertions
- Mock setup

### get_build_config

Returns build configuration files.

**Parameters:** None

**Returns:** Combined content from:
- `package.json` - Dependencies and scripts
- `main.js` - Electron entry point configuration

### search_source

Searches across all source files for a regex pattern.

**Parameters:**
- `pattern` (required): Regex pattern to search for
- `fileType` (optional): "tsx", "ts", "css", or "all" (default)

**Returns:**
- File paths
- Line numbers
- Matching lines
- Context (surrounding lines)
- Limited to first 50 results

**Example:**
```
pattern: "useState"
fileType: "tsx"
→ Returns all useState imports and calls
```

## Installation & Setup

### Build the MCP

```bash
cd src/agents/k10-broadcaster
npm install
npm run build
```

### Start the Server

```bash
npm start
```

The server will start on stdio and begin accepting MCP calls.

### Environment Variables

- `K10_BROADCASTER_ROOT` - Path to racecor-overlay modules directory
  - Default: `racecor-overlay/`

## Component Architecture

The overlay follows a clear component hierarchy:

```
Dashboard (Main Layout)
├── Main HUD Area (grid-based)
│   ├── Fuel Column
│   │   ├── FuelPanel
│   │   └── TyresPanel
│   ├── Controls Column
│   │   ├── ControlsPanel
│   │   └── PedalsPanel
│   ├── Maps Column (placeholder)
│   ├── Position Column
│   │   ├── PositionPanel
│   │   └── GapsPanel
│   ├── Tachometer Column
│   └── Logo Column (RaceCor + Car)
├── Timer Row (placeholder)
├── Commentary Column (right side)
├── Secondary Panels (opposite side)
│   ├── LeaderboardPanel
│   ├── DatastreamPanel
│   ├── IncidentsPanel
│   └── SpotterPanel
├── Full-width Overlays
│   ├── RaceControlBanner
│   ├── PitLimiterBanner
│   └── RaceEndScreen
└── SettingsPanel (overlay)
```

## Telemetry Flow

```
SimHub Plugin API
    ↓
useTelemetry Hook
    ↓
ParsedTelemetry (normalized)
    ↓
Dashboard & Components
    ↓
Display Data
```

## Settings Flow

```
OverlaySettings (types)
    ↓
useSettings Hook (localStorage/IPC)
    ↓
DEFAULT_SETTINGS (defaults)
    ↓
SettingsPanel (UI)
    ↓
Dashboard Layout
```

## Usage Example

```typescript
// List all HUD components
tools.call("list_components", { category: "hud" })

// Get Tachometer component code
tools.call("get_component", { name: "Tachometer" })

// Understand telemetry types
tools.call("get_telemetry_types", {})

// Find all useState calls
tools.call("search_source", {
  pattern: "useState",
  fileType: "tsx"
})

// Get component tree
tools.call("get_component_tree", {})

// Read the telemetry hook
tools.call("get_hook", { name: "useTelemetry" })
```

## Benefits

Instead of asking Claude to read raw dashboard.html or manually parsing files:

1. **Structured Access**: Get exactly what you need via specialized tools
2. **Type Safety**: Understand types without parsing TypeScript
3. **Code Navigation**: Easily explore component relationships
4. **Search Capability**: Find patterns across the entire codebase
5. **No HTML Parsing**: Work with source code, not compiled output
6. **Categorized Components**: Find components by their functional area
7. **Complete Context**: Access styles, tests, and configuration together

## Building on This MCP

The MCP can be extended with additional tools:

- Component dependency graph
- Hook usage analysis
- Test coverage reports
- Performance metrics
- Type relationship diagrams
- Component prop documentation
- Import/export analysis
