# Overlay Navigation Buttons — Plan

**Status:** Proposal  
**Author:** kevin  
**Date:** April 15, 2026

---

## Goal

Add a small set of clickable buttons to the overlay that launch external windows and tools: the web dashboard, the settings panel, the Moza wheel manager, and future features like the recorder and replay director. These buttons need to live near the logo, work across all 4 layout corners, and not interfere with the click-through overlay during a race.

---

## The Problem

Right now, every feature is accessed through keyboard shortcuts or the settings panel. That works for racing, but for pre-race or post-race tasks (opening the web dashboard, launching Moza manager, starting the replay director), you're either memorizing hotkeys or opening settings just to find a button.

The idle logo — the 98px RaceCor logomark fixed at `top: 10px; right: 10px` that appears when you're not in a car — is the natural home for these buttons. It's already the only UI element visible between sessions, it's already interactive (`pointer-events: auto` when idle), and it represents the moment when you'd actually want to launch tools.

**Key constraint: buttons are idle-state only.** During a race, the dashboard's in-race logo column stays exactly as it is — no buttons, no extra elements, no accidental clicks. The action bar only exists on the idle logo.

---

## Design: Idle Logo Action Bar

When the overlay enters idle state (driver not in car), the idle logo appears in the top-right corner with a staggered column of action buttons extending below it. Clicking the logo itself toggles the button bar open/closed.

### Layout

The buttons extend **to the left** of the idle logo as a horizontal strip, visually attached but not overlapping the logo itself. The logo stays clean — the buttons are a shelf that slides out from its left edge.

```
Idle state — buttons expanded:

                ┌─────┬─────┬─────┬─────┐ ┌──────────┐
                │ ⚙   │ 🌐  │ 🎡  │ 🎬  │─│          │
                │     │     │     │     │ │  RaceCor  │
                │ Set │ Web │Moza │ Rec │ │          │
                └─────┴─────┴─────┴─────┘ └──────────┘
                ← buttons slide out left    ↑ idle logo (98px)
                                            fixed top-right

Idle state — buttons collapsed:

                                           ┌──────────┐
                                           │          │
                                           │  RaceCor  │  (click to expand)
                                           │          │
                                           └──────────┘
```

The horizontal strip grows leftward from the logo's left edge — the logo acts as the right-side anchor. This keeps the buttons out of the way when collapsed (only the logo's 98×98px footprint), and when expanded, the strip extends into the upper-right area of the screen which is typically empty desktop/wallpaper space.

The buttons connect to the logo with a small gap (4px) or flush, sharing the same background and border style so they read as one visual unit. The logo's left border-radius is removed when expanded, and the leftmost button gets the rounding instead.

### Open/Close Toggle

The idle logo itself is the toggle. Click it once → buttons fan out. Click it again → buttons collapse. This avoids cluttering the idle state with a permanent menu — the logo is a clean, single element until you need it.

```js
idleLogo.addEventListener('click', () => {
  navBar.classList.toggle('nav-expanded');
});
```

### Button Size and Style

Buttons sit in a horizontal strip to the left of the idle logo, sharing its visual language:

```css
.idle-nav-bar {
  position: fixed;
  top: 10px;                      /* same top as idle logo */
  right: 112px;                   /* 10px + 98px (logo) + 4px gap */
  z-index: 50;                    /* same z-index as idle logo */
  height: 98px;                   /* same height as idle logo */
  display: flex;
  flex-direction: row;            /* horizontal strip */
  gap: 0;                         /* flush buttons, separated by border */
  opacity: 0;
  transform: translateX(20px);    /* slides in from right (toward logo) */
  pointer-events: none;
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.idle-nav-bar.nav-expanded {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}

.idle-nav-button {
  width: 72px;                    /* narrower than logo — compact columns */
  height: 98px;                   /* full height of logo */
  background: var(--bg-logo);
  border: 1px solid var(--border);
  border-left: none;              /* shared borders between buttons */
  display: flex;
  flex-direction: column;         /* icon on top, label below */
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
  color: var(--text-dim);
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  transition: background 0.15s ease, color 0.15s ease;
}

/* Leftmost button gets left border + rounding */
.idle-nav-button:first-child {
  border-left: 1px solid var(--border);
  border-top-left-radius: var(--corner-r);
  border-bottom-left-radius: var(--corner-r);
}

.idle-nav-button:hover {
  background: hsla(0, 0%, 100%, 0.12);
  color: var(--text-bright, #fff);
}

.idle-nav-button:active {
  background: hsla(0, 0%, 100%, 0.06);
}

/* Icons inside buttons */
.idle-nav-button .nav-icon {
  width: 22px;
  height: 22px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.5;
}
```

When expanded, the logo removes its left-side rounding to connect flush with the button strip:

```css
.idle-logo.nav-active {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
```

### Staggered Reveal

Buttons slide in from right to left — the rightmost button (closest to the logo) appears first, the leftmost last. This creates a visual "unfolding" from the logo:

```css
/* Rightmost (closest to logo) appears first */
.idle-nav-bar.nav-expanded .idle-nav-button:nth-last-child(1) { transition-delay: 0.03s; }
.idle-nav-bar.nav-expanded .idle-nav-button:nth-last-child(2) { transition-delay: 0.06s; }
.idle-nav-bar.nav-expanded .idle-nav-button:nth-last-child(3) { transition-delay: 0.09s; }
.idle-nav-bar.nav-expanded .idle-nav-button:nth-last-child(4) { transition-delay: 0.12s; }
.idle-nav-bar.nav-expanded .idle-nav-button:nth-last-child(5) { transition-delay: 0.15s; }
```

### Auto-Collapse

The action bar collapses automatically when:
- The driver enters the car (idle state ends → dashboard takes over)
- A button is clicked that opens a window (the action is done)
- The user clicks outside the logo/nav area

```js
// Collapse when leaving idle state
window.addEventListener('idle-state-change', (e) => {
  if (!e.detail.idle) navBar.classList.remove('nav-expanded');
});

// Collapse after launching a window (except settings)
function handleNavClick(action) {
  // ...fire action...
  if (action !== 'settings') {
    navBar.classList.remove('nav-expanded');
  }
}
```

---

## Interaction Model

### The Click-Through Problem

The overlay is always-on-top even in idle state. `setIgnoreMouseEvents(true, { forward: true })` makes it click-through, but the idle logo already has `pointer-events: auto` — which means Electron's `{ forward: true }` option detects the logo as a hit target and **stops forwarding** clicks in that region to the desktop underneath.

The nav buttons extend this hit region. If the nav bar is expanded, the ~98×250px area of the logo + buttons blocks clicks to whatever's behind it (desktop, iRacing UI, browser). That's a real problem since you need to use the computer between sessions.

### Solution: Minimal Hit Area + Smart Collapse

The approach is to keep the interactive region as small and short-lived as possible:

**1. Only the logo itself is always-interactive.** The nav bar starts collapsed. The 98×98px logo is the only permanent hit region — small enough to not be annoying, and it's in the top-right corner where desktop content rarely lives.

**2. Nav bar expands on logo click, collapses aggressively.** When you click the logo, buttons fan out. When you click a button or click anywhere else, they collapse. The expanded state should last seconds, not minutes.

**3. Click-outside-to-close.** This is the critical behavior. If the nav bar is expanded and you click anywhere on the overlay that isn't the nav bar, collapse it AND forward the click through to the desktop. This avoids the "I clicked but nothing happened" frustration.

```js
// In the renderer, use Electron's { forward: true } behavior:
// Only the idle logo + expanded nav buttons have pointer-events: auto.
// Everything else is pointer-events: none, so clicks pass through.

document.addEventListener('click', (e) => {
  const isNavClick = e.target.closest('.idle-logo, .idle-nav-bar');
  if (!isNavClick && navBar.classList.contains('nav-expanded')) {
    navBar.classList.remove('nav-expanded');
    // Click was outside nav — it already forwarded to the desktop
    // via Electron's { forward: true } because pointer-events: none
  }
});
```

**4. Auto-collapse on idle state exit.** When the driver enters the car, the nav bar vanishes immediately — no leftover hit regions during racing.

### When Are Buttons Visible?

| State | Idle Logo | Nav Bar | Desktop Click-Through |
|-------|-----------|---------|----------------------|
| **Racing** | Hidden | Hidden | Full — overlay is click-through everywhere |
| **Idle, bar collapsed** | Visible (98×98px hit region) | Hidden | Click-through everywhere except the logo |
| **Idle, bar expanded** | Visible | Visible (~390×98px horizontal strip) | Click-through everywhere except logo + button strip |
| **Settings mode** | Hidden (settings panel open) | Hidden | Full overlay is interactive (existing behavior) |

The maximum interactive hit region is ~98×250px in the top-right corner, and only while the bar is expanded. Clicking any button or anywhere else collapses it immediately.

### Button Click Behavior

Each button triggers an IPC call, collapses the nav bar, and the action happens in a separate window — the overlay stays click-through:

```js
function handleNavClick(action) {
  // Collapse nav bar first
  navBar.classList.remove('nav-expanded');

  // Fire the action
  switch (action) {
    case 'settings':
      // Settings needs interactive mode — toggle it via existing flow
      window.k10.requestInteractive();
      toggleSettings();
      return;
    case 'webapp':    window.k10.openDashboard(); break;
    case 'moza':      window.k10.openMozaManager(); break;
    case 'recorder':  window.k10.openRecorderPanel(); break;
    case 'replay':    window.k10.startReplayDirector(); break;
  }
  // No need to call releaseInteractive() — overlay was already click-through,
  // only the logo/buttons had pointer-events: auto
}
```

Key point: clicking a nav button does NOT toggle the overlay's global interactive mode (except for Settings). The buttons work purely through `pointer-events: auto` on individual elements — the overlay window stays in `setIgnoreMouseEvents(true, { forward: true })` mode the entire time. This is how the idle logo already works today.

---

## Button Set

### Initial Buttons (ship now)

| Button | Icon | Label | Action | IPC |
|--------|------|-------|--------|-----|
| Settings | gear | Settings | Open settings panel | `toggleSettings()` (existing) |
| Web App | globe | ProDrive | Open web dashboard window | `k10.openDashboard()` (existing) |
| Moza | wheel icon | Moza | Open Moza manager window | `k10.openMozaManager()` (new) |

### Future Buttons (added with recording features)

| Button | Icon | Label | Action | IPC |
|--------|------|-------|--------|-----|
| Record | red circle | Record | Toggle recording on/off | `k10.startRecording()` / `k10.stopRecording()` |
| Replay Director | play+camera | Replay | Start automated replay director | `k10.startReplayDirector()` |
| Export | share arrow | Export | Open export/clip panel | `k10.openExportPanel()` |

### Maximum Button Count

The action bar should hold at most **5–6 buttons** before it becomes unwieldy. If more features are added, group them under a "more" overflow menu that expands horizontally or as a grid.

---

## Window Behavior: Normal App vs Overlay

Currently the overlay runs as a frameless, always-on-top, click-through, `skipTaskbar: true` window in all states. That makes sense during a race — it needs to float over the game. But when you're not racing, it should behave like a normal app: visible in the Windows taskbar, alt-tabbable, not always-on-top, and not click-through.

### Two Window Modes

| Property | In-Race (overlay mode) | Idle (normal app mode) |
|----------|----------------------|----------------------|
| `alwaysOnTop` | `'screen-saver'` | `false` |
| `skipTaskbar` | `true` | `false` — **visible in taskbar** |
| `setIgnoreMouseEvents` | `true, { forward: true }` | `true, { forward: true }` (only idle logo is interactive) |
| `focusable` | `false` | `true` |
| Taskbar icon | Hidden | **RaceCor icon visible** |

The transition happens when the driver enters/exits the car:

```js
function enterRaceMode() {
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setSkipTaskbar(true);
  overlayWindow.setFocusable(false);
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
}

function enterIdleMode() {
  overlayWindow.setAlwaysOnTop(false);       // normal window
  overlayWindow.setSkipTaskbar(false);       // visible in taskbar
  overlayWindow.setFocusable(true);          // alt-tabbable
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  // Still click-through by default — only the idle logo
  // and expanded nav buttons have pointer-events: auto
}
```

### Why This Matters

Without a taskbar icon, the overlay is invisible to Windows when you're not racing. You can't alt-tab to it, you can't right-click it in the taskbar to close it, and you can't tell if it's running. Making it a "normal app" in idle mode fixes all of this and gives the nav buttons a proper context — you can click the taskbar icon to bring the overlay forward, see the idle logo + nav bar, and launch whatever you need.

### Taskbar Icon

Use the existing RaceCor logomark (`images/branding/logomark.png`) or an `.ico` version of it. This is already configured in `electron-builder.yml` for the app icon — the taskbar picks it up automatically when `skipTaskbar` is `false`.

### System Tray (Optional Enhancement)

A tray icon could provide a right-click menu with the same actions as the nav bar (Settings, Web App, Moza, Record, Quit). This gives access to the tools even when the overlay window is behind other windows. Low effort since Electron's `Tray` API is straightforward, but it's not required for v1.

---

## DOM Structure

The action bar is a sibling of the idle logo, placed directly after it in the DOM:

```html
<!-- COMPONENT: Idle State Logo (visible when driver is not in-car) -->
<div class="idle-logo" id="idleLogo">
  <img src="images/branding/logomark.png" alt="RaceCor">
</div>

<!-- NEW: Idle Navigation Bar (visible when idle + expanded via logo click) -->
<div class="idle-nav-bar" id="idleNavBar">
  <button class="idle-nav-button" data-action="settings" title="Settings (Ctrl+Shift+S)">
    <svg class="nav-icon" viewBox="0 0 24 24"><!-- gear --></svg>
    <span class="nav-label">Settings</span>
  </button>
  <button class="idle-nav-button" data-action="webapp" title="Open Web Dashboard">
    <svg class="nav-icon" viewBox="0 0 24 24"><!-- globe --></svg>
    <span class="nav-label">ProDrive</span>
  </button>
  <button class="idle-nav-button" data-action="moza" title="Moza Wheel Manager">
    <svg class="nav-icon" viewBox="0 0 24 24"><!-- wheel --></svg>
    <span class="nav-label">Moza</span>
  </button>
</div>
```

### No Corner-Awareness Needed

Unlike the in-race dashboard which can be in any of 4 corners, the idle logo is always fixed at `top: 10px; right: 10px`. The nav bar is always directly below it. No layout mirroring, no corner logic — the simplest possible CSS.

### Rounded Corners

When expanded, the logo loses its left rounding (it connects to the strip) and the leftmost button gets the rounding. Already handled in the CSS above via `.idle-logo.nav-active` and `.idle-nav-button:first-child`.

---

## Label Visibility

At 98px width, there's room for a small icon + short label. If labels feel cramped, buttons can go icon-only with a tooltip:

```css
/* Icon-only mode (optional — toggled via setting or auto-detected) */
.idle-nav-bar.compact .nav-label {
  display: none;
}
.idle-nav-bar.compact .idle-nav-button {
  height: 36px;  /* shorter without labels */
  justify-content: center;
}
```

Tooltips via `title` attribute always show the full name + shortcut:

```
Settings (Ctrl+Shift+S)
ProDrive Web Dashboard
Moza Wheel Manager
Start Recording (Ctrl+Shift+V)
```

---

## New Files

| File | Purpose |
|------|---------|
| `modules/js/idle-nav.js` | **New** — button creation, click handlers, expand/collapse, auto-close |
| `modules/styles/idle-nav.css` | **New** — button styles, staggered animation, expanded/collapsed states |

### Changes to Existing Files

| File | Change |
|------|--------|
| `dashboard.html` | Add `<link>` for idle-nav.css, add `<script>` for idle-nav.js, add `.idle-nav-bar` DOM after `#idleLogo` |
| `effects.css` | Add `.idle-logo.nav-active` rule (remove bottom radius when expanded) |
| `main.js` | Add `enterIdleMode()` / `enterRaceMode()` window behavior switching (always-on-top, skipTaskbar, focusable). Add IPC handler for `openMozaManager`. |
| `preload.js` | Expose `k10.openMozaManager()` |
| `keyboard.js` | No changes — existing hotkeys still work, buttons are a visual alternative |

---

## What This Does NOT Include

- **Buttons during racing** — The action bar only exists on the idle logo. During a race, the overlay is identical to today.
- **Mobile/touch support** — The LAN remote view (`remote-server.js`) has its own floating menu. This is desktop overlay only.
- **Drag reordering** — Buttons are in a fixed order. If customization is needed later, it goes in the settings panel.
- **Full system tray menu** — The tray icon is optional. The nav bar is the primary access method.

---

## Implementation Effort

| Task | Effort |
|------|--------|
| `idle-nav.css` (styles, stagger animation, expanded/collapsed) | 2 hours |
| `idle-nav.js` (expand/collapse, click handlers, auto-close, IPC calls) | 2–3 hours |
| `dashboard.html` DOM additions | 30 minutes |
| `main.js` — idle/race mode window switching (always-on-top, skipTaskbar) | 2 hours |
| `main.js` + `preload.js` — IPC for Moza manager window | 1 hour |
| Testing (expand/collapse, click-through, taskbar icon, race transition) | 1–2 hours |
| **Total** | **~1.5 days** |
