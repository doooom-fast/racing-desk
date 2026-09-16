# RaceCor Overlay — Visual Style Guide

## Overview

The RaceCor overlay supports three visual styles, each optimized for different viewing contexts:
- **Standard** — full broadcasting aesthetic with effects and branding
- **Minimal** — Tufte-pure data visualization, maximum clarity
- **Minimal+** — racing-educated Tufte with essential data-reactive effects

All three modes share the same underlying data and layout structure. Visual style is applied via CSS custom properties and body class toggles, with no HTML restructuring required.

---

## CSS Variable System

The overlay defines a comprehensive CSS variable library for consistent theming:

### Layout & Spacing
```css
--corner-r: 8px;          /* Primary border radius */
--corner-r-sm: 5px;       /* Secondary border radius */
--gap: 4px;               /* Intra-panel gaps */
--panel-gap: 6px;         /* Inter-panel spacing */
--edge: 10px;             /* Screen edge inset */
--pad: 6px;               /* Padding inside panels */
```

### Colors
```css
--bg: hsla(0, 0%, 8%, 0.90);             /* Primary background */
--bg-panel: hsla(0, 0%, 6%, 0.90);       /* Panel background */
--bg-logo: hsla(0, 0%, 12%, 0.90);       /* Logo panel background */
--border: hsla(0, 0%, 100%, 0.14);       /* Standard border color */

--text-primary: hsla(0, 0%, 100%, 1.0);      /* Headings, values */
--text-secondary: hsla(0, 0%, 100%, 0.69);   /* Labels, hints */
--text-dim: hsla(0, 0%, 100%, 0.55);         /* Footnotes, muted */

--red: #e53935;      /* Caution / Alert */
--green: #43a047;    /* Optimal / Safe */
--amber: #ffb300;    /* Warning / Flag */
--blue: #1e88e5;     /* Info */
--orange: #fb8c00;   /* Secondary alert */
--cyan: #00acc1;     /* Accent */
--purple: hsl(280,80%,70%);  /* Accent */
```

### Typography
```css
--ff: 'Barlow Condensed', 'Corbel', 'Segoe UI', system-ui, sans-serif;
--ff-display: 'Cinzel Decorative', 'Georgia', serif;
--ff-mono: 'JetBrains Mono', 'Consolas', 'SF Mono', monospace;

--fs-xl: 20px;    /* Large headings */
--fs-lg: 13px;    /* Panel titles */
--fs-md: 11px;    /* Standard text */
--fs-sm: 11px;    /* Labels */
--fs-xs: 10px;    /* Fine print */

--fw-black: 800;   /* Strongest emphasis */
--fw-bold: 700;    /* Values, titles */
--fw-semi: 600;    /* Emphasis */
--fw-medium: 500;  /* Mid-weight */
--fw-regular: 400; /* Body text */
```

### Animation & Transitions
```css
--t-fast: 180ms ease;
--t-med: 350ms ease;
--t-slow: 600ms ease-out;
```

### Data Visualization
```css
--sentiment-h: 0;      /* Commentary sentiment hue */
--sentiment-s: 0%;     /* Sentiment saturation */
--sentiment-l: 0%;     /* Sentiment lightness */
--sentiment-alpha: 0;  /* Sentiment halo opacity */
```

---

## Visual Modes

### Design Philosophy

The three visual modes—Standard, Minimal, and Minimal+—each adapt each module's visual presentation according to specific design goals, rather than simply hiding/showing elements with `display: none`. This approach:

1. **Preserves HTML structure** — No elements are added or removed, only styled differently
2. **Uses CSS custom properties** — Variables are overridden for cleaner code and easier maintenance
3. **Targets specific modules** — Each module (tachometer, fuel bar, SR display, etc.) has precise visual adaptations
4. **Respects data hierarchy** — Decoration is removed/reduced, but essential data values are always visible
5. **Avoids display:none where possible** — Panel borders use `border-color: transparent` instead of `border: none` to preserve gap spacing without layout shift

Each mode represents a different balance between visual fidelity and cognitive load. Users can select the mode that best matches their viewing context (broadcast, accessibility, racing focus, etc.).

---

### Standard Mode (Default)

**Philosophy:** Broadcast-grade presentation with full cinematic effects. Maximum visual impact for streaming audiences.

**Characteristics:**
- Full panel borders: `--border: hsla(0,0%,100%,0.14)`
- WebGL effects enabled: bloom, glow, ambient light sampling
- Sentiment halo around dashboard (color-reactive based on commentary tone)
- Animated stripe patterns on race control banner
- Track map player dot glow with drop shadow
- Car manufacturer logo visible (branding)
- RaceCor logo visible (branding)
- Game logo visible (branding)
- Fuel bar: gradient green → amber → red
- iRating: segmented bar + numeric value
- Safety Rating: pie chart + numeric value
- Commentary panel: 14px padding
- G-force vignette at full intensity
- Backdrop filter blur on panels (CSS)
- All animations enabled

**CSS Class:** (none — this is the root state)

**Use Cases:**
- Broadcast streams
- Public viewing / esports venues
- Premium viewing experience

---

### Minimal Mode

**Philosophy:** Tufte-pure information visualization. Maximum data-ink ratio, zero decoration. All cognitive load goes to reading actual data values. Each module adapts its visual presentation to emphasize pure numeric/factual data while removing all decorative effects.

**Per-Module Visual Adaptations:**

| Module | Standard | Minimal | Implementation |
|--------|----------|---------|-----------------|
| **Tachometer** | RPM bloom glow, segmented bar, gear, speed | Hide bloom/glow canvas. Keep segmented bar + number + gear | `display: none` on `.gl-overlay`, `.ambient-canvas` |
| **Fuel bar** | Green→amber→red gradient | Single-hue green. Darkens on low, red on critical | `background: var(--green)` solid color with state-based transitions |
| **Safety Rating** | Pie chart + numeric value | Numeric value only | `display: none` on `.sr-pie-container` and related SVG elements |
| **iRating** | Progress bar + numeric value | Numeric value only | `display: none` on `.irating-bar`, `.irating-progress` |
| **Race Control** | Animated stripe pattern | Solid color, no animation | `animation: none; opacity: 0` on `.rc-inner::after` |
| **Track map** | Player dot with glow effect | Bright dot, no glow | `filter: none; box-shadow: none` on `.map-player` |
| **G-force vignette** | Full intensity (edge darkening) | Hidden | `opacity: 0` |
| **Sentiment halo** | Full color around dashboard | Hidden | `.dashboard::before { opacity: 0 }` |
| **Commentary panel** | Visible with 14px padding | Hidden entirely | `display: none` on `.commentary-col` |
| **Logos** | All visible (RaceCor, car, game) | All hidden | `display: none` on `#k10LogoSquare`, `#carLogoSquare`, etc. |

**CSS Variable Overrides:**
```css
body.mode-minimal {
  --border: transparent;      /* Remove panel borders (transparent color, not none) */
  --pad: 4px;                 /* Tighter internal padding */
  --gap: 3px;                 /* Tighter inter-panel gaps */
}
```

**Animation/Effects:**
- Disable all animations globally: `* { animation: none !important; transition: none !important; }`
- Re-enable opacity transitions for UI state changes only (toggles, visibility)
- No WebGL effects (bloom, ambient light, glow)
- No backdrop-filter blur on panels

**CSS Class:** `body.mode-minimal`

**Use Cases:**
- Accessibility-first viewing (maximum contrast, no distraction)
- Data archival / analysis overlays (pure numeric focus)
- Minimal cognitive load during intense racing
- Testing and verification environments

**Design Rationale:**
Removes all elements that don't directly communicate data. If it doesn't show a number, a state, or a position, it's gone. Typography emphasizes labels (regular weight) vs. values (bold) for maximum contrast. No animations distract from reading values in real time.

---

### Minimal+ Mode

**Philosophy:** Racing-educated Tufte. Preserves only data-reactive effects that communicate urgency and state during active driving. Removes static decoration but keeps animations and glows that encode real-time information. Maximum clarity with racing context cues.

**Per-Module Visual Adaptations:**

| Module | Standard | Minimal+ | Implementation |
|--------|----------|----------|-----------------|
| **Tachometer** | RPM bloom glow, segmented bar, gear, speed | Keep bloom at 60% opacity. Hide ambient/glow canvas | `.gl-overlay { opacity: 0.6 !important; display: block }` |
| **RPM glow effects** | Full intensity color pulses | Reduced intensity (60% of standard) | `text-shadow` with reduced blur radius and opacity |
| **Fuel bar** | Green→amber→red gradient | Keep green→amber→red gradient | Standard behavior preserved |
| **Safety Rating** | Pie chart + numeric value | Pie chart + numeric value | Standard behavior preserved |
| **iRating** | Progress bar + numeric value | Numeric value visible, progress bar optional | Value always visible, bar depends on data |
| **Race Control** | Animated stripe pattern | Animate on flag change, settle after 4s | `animation: rc-flag-scroll 1.5s, rc-flag-settle 0.5s ease 4s forwards` |
| **Track map** | Player dot with glow effect | Glow preserved but tightened (8px vs 12px) | `filter: drop-shadow(0 0 8px rgba(...))` with pulse animation |
| **Map pulse animation** | Full intensity | Reduced intensity | `@keyframes map-player-pulse-mini` with 6-8px drop-shadow |
| **G-force vignette** | Full intensity (edge darkening) | 50% opacity | `opacity: 0.5 !important` |
| **Sentiment halo** | Full color around dashboard | 40% opacity | `.dashboard::before { opacity: 0.4 }` |
| **Commentary panel** | Visible with 14px padding | Visible with 10px padding | `padding: 10px !important` |
| **Car logo** | Visible (branding) | Visible (contextual data — car identity) | `display: block !important` |
| **K10 & Game logos** | Visible (branding) | Hidden | `display: none !important` |

**CSS Variable Overrides:**
```css
body.mode-minimal-plus {
  --border: transparent;      /* Remove panel borders */
  --pad: 5px;                 /* Slightly tighter than standard (6px) */
  --gap: 3px;                 /* Tight inter-panel gaps */
}
```

**Animation/Effects:**
- Disable non-critical animations: `* { animation: none !important; transition: none !important; }`
- Re-enable essential data-reactive effects:
  - RPM color transitions (green/yellow/red based on RPM level)
  - Fuel bar color transitions
  - Track map dot pulse (reduced intensity)
  - Race control flag stripe animation + settle
  - Sentiment halo color (reactive to commentary tone)
  - G-force vignette (reactive to lateral acceleration)

**CSS Class:** `body.mode-minimal-plus`

**Use Cases:**
- Serious racing broadcasts (league play, esports)
- Professional stream overlays with pro-audience context
- Training / coaching scenarios (need real-time urgency cues)
- Driver cockpit HUD (responsive to telemetry)

**Design Rationale:**

**Why keep tachometer bloom at 60%?** RPM heat is actively changing during driving. The color intensity (brighter green at safe RPM, brighter red at redline) encodes urgency that drivers train to perceive instantly. This is data-reactive feedback, not decoration.

**Why reduce bloom instead of hiding it?** At full intensity, the bloom effect can be distracting during broadcasts. 60% preserves the urgency signal while reducing visual chaos. The brightness differential (green vs red) still communicates state clearly.

**Why keep map dot pulse but tighten it?** Locating player position on track is safety-critical. The glow helps find the dot quickly without the extra drama of standard intensity. Tightening the radius (8px vs 12px) reduces bloom while maintaining visibility.

**Why sentiment halo at 40%?** Commentary sentiment is real data (color-reactive), but broadcasting at full intensity (100%) is overwhelming. 40% opacity provides peripheral color context without dominating the view. Users can still perceive mood shifts at a glance.

**Why settle RC banner after 4s?** Racing rules flags are momentary events. Keeping stripes animated for 4 seconds ensures visibility of the flag change, then settles to 15% opacity for reference without distraction.

**Why preserve fuel and SR pie chart?** These are essential racing data. The gradient fuel bar and SR pie are standard racing UI conventions that drivers expect. Removing them would create cognitive load ("where's my fuel state?").

**Why show G-force vignette at 50%?** Drivers need peripheral awareness of lateral acceleration limits. The vignette warns when approaching lateral limits without detailed telemetry reading. 50% opacity is noticeable but not intrusive.

---

## Feature Gates

### Preset Buttons (Settings → Effects Tab)

Three preset buttons appear at the top of the Effects settings tab:
- **Minimal** — applies all Minimal mode toggles, gates to K10 Pro
- **Minimal+** — applies all Minimal+ mode toggles, gates to K10 Pro
- **Standard** — applies all Standard mode toggles, always available

When K10 Pro is not connected, Minimal and Minimal+ buttons show a pro badge and trigger navigation to the Connections tab.

### Per-Feature Toggles

Individual effect toggles live in the Effects tab and can be mixed:
- **Panel Borders** (default: on)
- **WebGL Effects** (default: on)
- **Ambient Light** (default: reflective)
- **Sentiment Halo** (default: on)
- **Commentary Glow** (default: on)
- **Race Control Animation** (default: on)
- **Track Map Glow** (default: on)
- **Redline Flash** (default: on)
- **Pit Limiter Bonkers** (default: on)

The preset buttons set all toggles at once; individual toggles allow fine-tuning.

---

## Implementation Details

### Body Classes

Visual mode is applied via CSS body class:
```html
<!-- Standard (no class) -->
<body>

<!-- Minimal -->
<body class="mode-minimal">

<!-- Minimal+ -->
<body class="mode-minimal-plus">
```

### Settings Storage

Visual preset is stored in `_settings.visualPreset`:
```javascript
_settings.visualPreset = 'standard' | 'minimal' | 'minimal-plus';
```

Individual toggles are stored separately:
```javascript
_settings.showBorders = boolean;
_settings.showWebGL = boolean;
_settings.ambientMode = 'reflective' | 'matte' | 'plastic' | 'off';
_settings.showSentimentHalo = boolean;
_settings.showCommentaryGlow = boolean;
_settings.showRcAnimation = boolean;
_settings.showMapGlow = boolean;
_settings.showRedlineFlash = boolean;
_settings.showBonkers = boolean;
_settings.showK10Logo = boolean;
_settings.showCarLogo = boolean;
_settings.showGameLogo = boolean;
```

### Drive Mode

Drive mode follows Minimal principles by default:
- Pure black background
- No tints or atmospheric effects
- Bright data elements floating on black
- Optional redline flash (CSS property `--redline-flash: on/off`)
- Color-coding preserved (data, not decoration)

---

## Accessibility

### Color Contrast

All text meets WCAG AAA standards (7:1 ratio minimum):
- Primary text on dark background: `--text-primary` on `--bg`
- Secondary text: `--text-secondary` has sufficient separation

### Colorblind Safety

- Gap ahead/behind uses direction AND color (left = behind, right = ahead)
- Fuel state: green → amber → red uses hue AND saturation darkening
- Tire temperature: color palette tested for deuteranopia and protanopia

### Motion

- All animations respect `prefers-reduced-motion`
- Essential feedback (toggle state changes) use brief, direct transitions
- The Minimal preset disables non-essential animations entirely

---

## Migration Guide

### From Standard to Minimal

Settings automatically collapse when "Minimal" preset is clicked:
1. All glow/bloom effects hidden
2. Panel borders removed
3. Logos hidden
4. Padding tightened
5. Animations disabled (except essential state changes)

No user data is lost — switching back to Standard restores all effects.

### Custom Presets

Users who want "Minimal but keep the fuel gradient" can:
1. Click Minimal preset
2. Manually toggle on `showWebGL` or individual toggles
3. The preset updates the preset button to show "Custom" (not yet implemented, but possible)

---

## Future Enhancements

- **Dark mode / Light mode** — standard CSS dark color scheme swap
- **Custom color schemes** — user-defined hue ranges for alert colors
- **High-contrast mode** — white text, black background, max saturation
- **Dyslexia-friendly font** — OpenDyslexic or similar fallback
- **Salient object detection** — AI-based glow routing to only the most critical data element per frame
