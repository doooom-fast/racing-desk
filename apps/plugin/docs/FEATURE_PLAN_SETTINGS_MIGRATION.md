# Feature Plan: Overlay Settings → Web Admin Migration

> Move the overlay settings UI into the Pro Drive web admin as a new tab, available only when the web app is running inside the Electron overlay. Keeps a minimal "quick settings" strip in the overlay for mid-race adjustments.

## Motivation

The current overlay settings UI is ~800 lines of hand-built vanilla HTML/JS in `dashboard.html` + `settings.js`. Moving it to the web admin gives us:

- **Consistent UX** — React components, design tokens, and the same form patterns as the rest of Pro Drive admin
- **Easier iteration** — Next.js hot reload vs. Electron restart cycles
- **Shared validation** — Zod schemas, proper form state management
- **Better organization** — settings live alongside the token editor, theme management, and component catalog that already target the overlay

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ Electron Main Process                                   │
│                                                         │
│  overlay-settings.json ←→ IPC handlers                  │
│       ↕                      ↕                          │
│  ┌─────────┐          ┌──────────────┐                  │
│  │ Overlay  │  sync    │ Web Dashboard│                  │
│  │ Renderer │ ←──────→ │ BrowserWindow│                  │
│  │          │          │              │                  │
│  │ Quick    │          │ /drive/admin │                  │
│  │ Settings │          │ /overlay-    │                  │
│  │ Strip    │          │  settings    │                  │
│  └─────────┘          └──────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

### How It Works

1. User clicks "Settings" in the overlay → opens the web dashboard BrowserWindow, deep-linked to `/drive/admin/overlay-settings`
2. The web route detects `window.k10` (Electron preload bridge) on mount
3. Reads current settings via `window.k10.getSettings()`
4. Writes changes via `window.k10.saveSettings(updated)` on form change
5. Subscribes to external changes via `window.k10.onSettingsSync()` (handles popout/overlay edits)
6. When `window.k10` is unavailable (standalone web), the tab is hidden from `AdminNav`

### Electron Detection

```typescript
// hooks/useElectronBridge.ts
const isInElectron = typeof window !== 'undefined'
  && typeof (window as any).k10 === 'object'
  && typeof (window as any).k10.getSettings === 'function';
```

This is already the pattern — the web dashboard window gets the same preload bridge as the overlay renderer.

## Settings Classification

### Moves to Web Admin Tab

These are all keys in `overlay-settings.json` that are pure configuration — no runtime coupling, no hardware dependency.

#### Dashboard Module Toggles
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `showTacho` | bool | `true` | Tachometer panel |
| `showPosition` | bool | `true` | Position tracker |
| `showControls` | bool | `true` | Pedal/wheel inputs |
| `showPedals` | bool | `true` | Pedal telemetry |
| `showFuel` | bool | `true` | Fuel strategy |
| `showTyres` | bool | `true` | Tyre strategy |
| `showCommentary` | bool | `true` | AI commentary feed |
| `showLeaderboard` | bool | `true` | Race leaderboard |
| `showDatastream` | bool | `true` | Telemetry datastream |
| `showPitBox` | bool | `true` | Pit strategy box |
| `showIncidents` | bool | `true` | Incident tracker |
| `showSpotter` | bool | `true` | AI spotter |
| `showMaps` | bool | `true` | Track map |

#### Visual & Theme
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `theme` | string | `'dark'` | Dark/light mode (already synced with web) |
| `visualPreset` | string | `'standard'` | `standard`, `minimal`, `minimal-plus` |
| `showWebGL` | bool | `true` | Fragment shader pipeline (glare, bloom, vignette) |
| `ambientMode` | string | `'reflective'` | `reflective`, `matte`, `plastic`, `off` |
| `showBorders` | bool | `true` | Panel outlines |
| `showSentimentHalo` | bool | `true` | Sentiment color ring |
| `showCommentaryGlow` | bool | `true` | Commentary glow effect |
| `showRcAnimation` | bool | `true` | RC animation |
| `showRedlineFlash` | bool | `true` | Redline flash effect |
| `showMapGlow` | bool | `true` | Track map glow |
| `showBonkers` | bool | `true` | Pit limiter bonkers animation |

#### Layout & Position
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `zoom` | number | `165` | 100–200% scale |
| `layoutPosition` | string | `'top-right'` | Corner position |
| `bottomYOffset` | number | `0` | Vertical offset (0–200px) |

#### Branding
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `showK10Logo` | bool | `true` | K10 brand logo |
| `showCarLogo` | bool | `true` | Car manufacturer logo |
| `showGameLogo` | bool | `true` | Sim title logo |
| `logoSubtitle` | string | `''` | Custom team name text |
| `logoOnlyStart` | bool | `true` | Start in logo-only mode |

#### Leaderboard
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `lbFocus` | string | `'me'` | `me` (player-centered) or `lead` (P1-centered) |
| `lbMaxRows` | number | `10` | 3, 5, 7, 10, 15, 20, 60 |
| `lbExpandToFill` | bool | `false` | Override max rows to fill screen |

#### Datastream Fields
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `dsShowGforce` | bool | `true` | G-force display |
| `dsShowYaw` | bool | `true` | Yaw rate |
| `dsShowFfb` | bool | `true` | Force feedback |
| `dsShowDelta` | bool | `true` | Lap delta |
| `dsShowTrackTemp` | bool | `true` | Track temperature |
| `dsShowFps` | bool | `true` | Frame rate |

#### AI Race Coach
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `agentKey` | string | `''` | Claude API key (password field) |
| `coachTone` | string | `'coach'` | `broadcast`, `coach`, `mentor` |
| `coachDepth` | string | `'standard'` | `quick`, `standard`, `deep` |

#### Race Rules
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `incPenalty` | number | `17` | Incident penalty threshold |
| `incDQ` | number | `25` | Incident DQ threshold |
| `forceFlag` | string | `''` | Flag state override |

#### Modes
| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `rallyMode` | bool | `false` | Rally-specific UI layout |
| `driveMode` | bool | `false` | Fullscreen driving mode |

**Total: ~45 settings that move cleanly.**

### Stays in Overlay — Connections Panel

The connections panel is not settings — it's a live status dashboard with action buttons. Must remain in the overlay.

| Component | Why It Stays |
|-----------|-------------|
| K10 Pro login/status | OAuth flow, token lifecycle, live connection state |
| SimHub connection | Polls `simhubUrl`, shows connected/disconnected badge |
| Discord presence | Rich presence toggle, live status |
| Remote dashboard | Start/stop LAN server, show IP + QR code |
| `simhubUrl` | Set-once infrastructure config, misconfiguration breaks everything |
| `remoteServer` / `remoteServerPort` | LAN server lifecycle, not a "setting" |

### Stays in Overlay — Moza Hardware

`moza-settings.js` manages real-time hardware state, not persistent settings:

- Fetches device config from SimHub HTTP action endpoints on tab open
- Debounced sliders (200ms) write directly to wheelbase hardware
- Per-device caching, not stored in `overlay-settings.json`
- Cannot work over the web IPC bridge — needs direct SimHub HTTP access

### Stays in Overlay — Recording Controls

Recording *configuration* could theoretically move, but the tight coupling to the ffmpeg encoder state machine makes it risky:

| Key | Verdict | Reason |
|-----|---------|--------|
| `recordingQuality`, `recordingOutputFormat`, `recordingEncoder` | **Could move** | Pure config, read at record start |
| `recordingMic`, `recordingMicDevice`, `recordingSystemAudioDevice` | **Could move** | Device enumeration needs Electron APIs though |
| `recordingFacecam`, `recordingFacecamDevice`, `recordingFacecamSize` | **Could move** | Same device enumeration caveat |
| Record/Stop/Replay transport controls | **Stays** | Tied to encoder state machine |
| `recordingAutoRecord`, `recordingAutoStopOnPit` | **Could move** | Pure config |

**Recommendation:** Keep all recording settings in the overlay for Phase 1. Revisit after recording feature stabilizes. The device enumeration APIs (`navigator.mediaDevices.enumerateDevices()`) may not return the same results in the web BrowserWindow context.

### Stays in Overlay — Reference-Only

| Component | Why |
|-----------|-----|
| Hotkey reference (Keys tab) | Read-only reference, no settings to sync |
| System/troubleshooting | Debug info, version, logs — overlay-specific diagnostics |

## Web Admin Tab Design

### New Route

```
web/src/app/drive/admin/overlay-settings/
├── page.tsx                    # Main settings page
├── OverlaySettingsForm.tsx     # Form component (client)
├── useOverlaySettings.ts      # Hook: read/write/sync via window.k10
└── sections/
    ├── DashboardModules.tsx    # Module visibility toggles
    ├── VisualEffects.tsx       # Theme, preset, ambient, glow toggles
    ├── LayoutPosition.tsx      # Zoom slider, corner picker, offset
    ├── Branding.tsx            # Logo toggles, subtitle
    ├── Leaderboard.tsx         # Focus, max rows, expand
    ├── Datastream.tsx          # Field toggles
    ├── AICoach.tsx             # Key, tone, depth
    └── RaceRules.tsx           # Incident thresholds, flag override, modes
```

### AdminNav Update

```typescript
// AdminNav.tsx — add conditional tab
const isOverlayContext = useIsElectronOverlay(); // hook checks window.k10

const tabs = [
  // ... existing tabs ...
  ...(isOverlayContext ? [{
    name: 'Overlay',
    href: '/drive/admin/overlay-settings',
    icon: MonitorIcon,
  }] : []),
];
```

### Settings Hook

```typescript
// useOverlaySettings.ts
export function useOverlaySettings() {
  const [settings, setSettings] = useState<OverlaySettings | null>(null);
  const bridge = (window as any).k10;

  useEffect(() => {
    if (!bridge) return;

    // Initial load
    bridge.getSettings().then(setSettings);

    // Subscribe to external changes (popout window, overlay quick-settings)
    const unsub = bridge.onSettingsSync((updated: OverlaySettings) => {
      setSettings(updated);
    });

    return unsub;
  }, []);

  const update = useCallback((patch: Partial<OverlaySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    bridge.saveSettings(next);
  }, [settings]);

  return { settings, update, isConnected: !!bridge };
}
```

### Settings Sync Latency

The IPC path is: web form change → `window.k10.saveSettings()` → Electron main process → file write → `onSettingsSync` broadcast → overlay renderer re-reads. This is sub-frame (~1-5ms) because `onSettingsSync` is an IPC event, not a file-watch. The overlay's existing popout settings window already validates this path works.

## Quick Settings Strip (Overlay)

A compact, always-available settings strip in the overlay for mid-race adjustments. No full settings UI — just the things you'd toggle without leaving the race.

### Candidates for Quick Settings

- `visualPreset` toggle (standard → minimal → minimal+)
- `zoom` slider
- `showWebGL` toggle (kill effects for FPS)
- `showLeaderboard` / `showCommentary` quick toggles
- `driveMode` toggle

### Implementation

Keep a small floating strip (or gear icon → dropdown) in the overlay renderer that reads/writes the same `overlay-settings.json` via the same IPC bridge. Changes sync bidirectionally — if the web settings tab is open, it sees the update via `onSettingsSync`.

## Migration Strategy

### Phase 1: Build the Web Settings Tab

1. Create `useElectronBridge` hook and `useOverlaySettings` hook
2. Build `/drive/admin/overlay-settings` route with section components
3. Add TypeScript types for `OverlaySettings` (derived from `_defaultSettings` in `config.js`)
4. Add conditional "Overlay" tab to `AdminNav.tsx`
5. Wire up `window.k10` IPC bridge for read/write/sync
6. Test: settings changes in web tab reflect in overlay in real-time

### Phase 2: Build Quick Settings Strip

1. Design compact quick-settings strip for overlay renderer
2. Implement as a minimal DOM element in `dashboard.html` (or migrate to a small React island)
3. Same IPC bridge, bidirectional sync with web tab
4. Assign hotkey to toggle quick-settings visibility

### Phase 3: Remove Old Settings UI

1. Remove settings tab HTML from `dashboard.html` (lines 906–1726, minus connections panel)
2. Remove `settings.js` initialization and DOM manipulation code
3. Keep connections panel in overlay (move to its own section if needed)
4. Keep Moza tab in overlay
5. Update the overlay's "Settings" button to call `k10.openDashboard('/drive/admin/overlay-settings')`
6. Update `openSettingsPopout()` to open web dashboard window instead of cloning `dashboard.html`

### Phase 4: Recording Settings (Future)

Revisit once recording is stable. If device enumeration works in the web BrowserWindow context, move recording configuration to the web tab. Transport controls (record/stop/replay) stay in overlay.

## Key Files to Modify

### Overlay (racecor-overlay/)
| File | Change |
|------|--------|
| `main.js` | Update `openSettingsPopout()` to open web dashboard; add deep-link IPC handler |
| `preload.js` | No changes needed (bridge already exposes what we need) |
| `dashboard.html` | Remove settings sections (keep connections, Moza); add quick-settings strip |
| `modules/js/settings.js` | Gut most of file; keep quick-settings strip logic |
| `modules/js/connections.js` | No changes (stays in overlay) |
| `modules/js/moza-settings.js` | No changes (stays in overlay) |
| `modules/js/config.js` | Add TypeScript-exportable schema or shared types file |

### Web (web/)
| File | Change |
|------|--------|
| `src/app/drive/admin/AdminNav.tsx` | Add conditional "Overlay" tab |
| `src/app/drive/admin/overlay-settings/` | New route — full settings form |
| `src/hooks/useElectronBridge.ts` | New — Electron detection + bridge access |
| `src/hooks/useOverlaySettings.ts` | New — settings CRUD via IPC |
| `src/types/overlay-settings.ts` | New — TypeScript types for all settings keys |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `window.k10` unavailable in web BrowserWindow | Settings tab broken | Already works — web dashboard window gets preload bridge. Verify on first PR. |
| Settings sync race condition (two editors open) | Last-write-wins conflict | Already handled — `onSettingsSync` is the existing pattern for the popout window. Same mechanism. |
| Device enumeration for recording settings | Wrong devices listed in web context | Keep recording settings in overlay for Phase 1. Test `enumerateDevices()` in both contexts before migrating. |
| Users bookmark/share overlay settings URL | 404 or broken page when not in Electron | Route checks `window.k10` on mount, shows "only available in overlay" message. Tab hidden from nav. |
| Performance regression from IPC hop | Laggy setting changes | IPC is sub-frame. Overlay popout settings already validate this. Not a real risk. |
| Losing quick mid-race toggles | UX regression for racers | Quick-settings strip in Phase 2 covers this. Don't remove old UI until strip is built. |

## Open Questions

1. **Should recording config move in a later phase?** Leaning no for now — device enumeration is the blocker.
2. **Should the web settings tab work standalone** (without overlay) as a "prepare your config" tool that exports JSON? Could be useful for remote setup.
3. **Do we want the quick-settings strip to be React** (small island in the overlay) or keep it vanilla JS for consistency with the rest of the overlay renderer?
4. **Should `greenScreen` move?** It requires an app restart — could go either way. Currently leaning "stays in overlay system tab" since it's infrastructure-level.
