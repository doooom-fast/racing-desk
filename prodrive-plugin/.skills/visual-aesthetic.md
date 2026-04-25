# K10 Motorsports — Visual Aesthetic Profile

## Core Principles
1. **Dark-but-not-black**: 8% luminance base, never true black (avoids OLED ghosting, adds warmth)
2. **High contrast text**: 19.5:1 ratio (WCAG AAA), readable at any stream quality
3. **Selective glow**: Only critical events (flags, pit, redline) get glow effects — routine data stays flat
4. **No gradients**: Depth created via opacity layers and inset/outset glow, not gradients
5. **Condensed typography**: Barlow Condensed maximizes data density without sacrificing readability
6. **Color = meaning**: Every color has a semantic purpose, nothing decorative
7. **Peripheral readability**: Tier 1 data (gear 96px, position 44px) legible in peripheral vision
8. **Breathing animations**: Critical states pulse slowly (2.5-3.5s) not frantically

## What the Driver Values
- **Clarity over decoration**: Remove anything that doesn't directly serve information delivery
- **Consistent hierarchy**: Size and weight always correspond to importance
- **Non-blocking alerts**: Spotter messages fade in/out, pit limiter dims rather than hides
- **Configurable layout**: 8+ layout permutations without code changes
- **Performance**: backdrop-filter:blur removed (doesn't work in CEF anyway), WebGL for heavy FX only

## What YouTube Viewers Need
- **Leaderboard**: Multi-car context without commentary
- **Race Control banners**: Visual story beats (flag events are dramatic moments)
- **Position changes**: Delta arrows with color (green ↑, red ↓) = instant narrative
- **Start lights sequence**: F1-style drama, builds tension
- **Commentary system**: Auto-generated event narrative layer
- **Green screen mode**: OBS chroma-key compositing for professional broadcast

## Animation Philosophy
- **Fast transitions (180ms)**: Value changes, state toggles — responsive but not jarring
- **Medium transitions (350ms)**: Panel state changes, bar animations — smooth follow
- **Slow transitions (600ms)**: Layout changes, commentary slide-in — deliberate and weighty
- **Infinite alternates**: Breathing pulses for sustained states (redline, fuel warning, flag glow)
- **Bouncy arrivals**: Commentary uses cubic-bezier(0.22, 1, 0.36, 1) for playful entrance
- **Step charts over lines**: Discrete data (lap times) rendered as steps, not interpolated curves

## Color Coding System
| State | Color | Usage |
|-------|-------|-------|
| Optimal/Good/Ahead | Green (#43a047) | Throttle, gains, clear spotter, tyre optimal |
| Danger/Bad/Behind | Red (#e53935) | Brake, losses, incidents, redline, tyre danger |
| Caution/Warning | Amber (#ffb300) | Yellow flag, tyre hot, fuel caution |
| Player/Primary | Cyan (#00acc1) | Player highlight, active selection |
| Session Best | Purple (280°, 80%, 70%) | Best lap time accent |
| Neutral/Info | Blue (#1e88e5) | Clutch, info states |
| Proximity Alert | Orange (#fb8c00) | Close opponents on map |

## Module Dimming Hierarchy
- Grid/Formation active: 15% opacity (near-invisible, full attention on lights)
- Pit Limiter active: 25% opacity (dimmed but readable if needed)
- Race Control banner: 50% opacity (still visible, RC is temporary)
- Normal state: 100% opacity with 1.0-1.5s ease transitions between states
