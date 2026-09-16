/**
 * RaceCor Web Components Library
 *
 * Barrel export for all web components used in the overlay and web app.
 * Import this file to auto-register all components.
 *
 * @example
 * // In dashboard.html
 * <script type="module">
 *   import './modules/components/index.js';
 * </script>
 *
 * // Now use components
 * <racecor-fuel-gauge></racecor-fuel-gauge>
 * <racecor-leaderboard></racecor-leaderboard>
 */

// ══════════════════════════════════════════════════════════════
// PHASE 1: SIMPLE DOM COMPONENTS
// ══════════════════════════════════════════════════════════════

// Fuel gauge with consumption stats and pit window estimate
import './fuel-gauge.js';

// Tire temperature and wear grid (2x2 layout)
// import './tire-grid.js';

// Gap ahead/behind with driver names and iRatings
// import './gap-display.js';

// Position card with cycling rating page
// import './position-card.js';

// Race control message banner with animated stripes
// import './race-control.js';

// Race end results screen
// import './race-end.js';

// Incident counter with penalty/DQ thresholds
// import './incidents.js';

// Position history heat-map strip
// import './race-timeline.js';

// ══════════════════════════════════════════════════════════════
// PHASE 2: CANVAS & MODERATE COMPLEXITY COMPONENTS
// ══════════════════════════════════════════════════════════════

// Full leaderboard table with sparkline history
import './leaderboard.js';

// G-force circle, yaw waveform, telemetry readouts
import './datastream.js';

// Pedal input visualization with curves overlay
import './pedal-curves.js';

// Tabbed pit strategy panel
import './pitbox.js';

// Proximity/spotter directional indicators
import './spotter.js';

// Sector timing display with color-coded splits
import './sector-hud.js';

// AI commentary panel with sentiment coloring
import './commentary.js';

// iRating/SR editing interface
import './rating-editor.js';

// ══════════════════════════════════════════════════════════════
// PHASE 3: COMPLEX & WEBGL COMPONENTS
// ══════════════════════════════════════════════════════════════

// RPM gauge with segmented color bar, gear, and speed display
import './tachometer.js';

// WebGL2 post-processing effects engine for tachometer bloom and heat distortion
import './webgl-fx.js';

// Full-screen driving HUD with track map, position, lap times, incidents
import './drive-hud.js';

// Advanced commentary visualization with Canvas charts and track image
import './commentary-viz.js';

// ══════════════════════════════════════════════════════════════
// COMPONENT REGISTRY
// ══════════════════════════════════════════════════════════════

/**
 * Global component registry for runtime discovery and metadata.
 * Used by poll-engine and other systems to know which components are available.
 *
 * @type {Object<string, {componentClass: Function, type: string, phase: number}>}
 */
window._componentRegistry = window._componentRegistry || {
  'racecor-fuel-gauge': {
    componentClass: customElements.get('racecor-fuel-gauge'),
    type: 'dom',
    phase: 1,
    description: 'Fuel level display with consumption and pit window'
  },

  // Phase 2: Canvas & Moderate Complexity
  'racecor-leaderboard': {
    componentClass: customElements.get('racecor-leaderboard'),
    type: 'canvas',
    phase: 2,
    description: 'Driver leaderboard table with sparkline history'
  },
  'racecor-datastream': {
    componentClass: customElements.get('racecor-datastream'),
    type: 'canvas',
    phase: 2,
    description: 'G-force circle, yaw waveform, telemetry readouts'
  },
  'racecor-pedal-curves': {
    componentClass: customElements.get('racecor-pedal-curves'),
    type: 'canvas',
    phase: 2,
    description: 'Pedal input visualization with curves overlay'
  },
  'racecor-pitbox': {
    componentClass: customElements.get('racecor-pitbox'),
    type: 'dom',
    phase: 2,
    description: 'Tabbed pit strategy panel (fuel, tires, strategy)'
  },
  'racecor-spotter': {
    componentClass: customElements.get('racecor-spotter'),
    type: 'dom',
    phase: 2,
    description: 'Proximity/spotter directional indicators'
  },
  'racecor-sector-hud': {
    componentClass: customElements.get('racecor-sector-hud'),
    type: 'dom',
    phase: 2,
    description: 'Sector timing display with color-coded splits'
  },
  'racecor-commentary': {
    componentClass: customElements.get('racecor-commentary'),
    type: 'dom',
    phase: 2,
    description: 'AI commentary panel with sentiment coloring'
  },
  'racecor-rating-editor': {
    componentClass: customElements.get('racecor-rating-editor'),
    type: 'dom',
    phase: 2,
    description: 'iRating/Safety Rating editing interface'
  },

  // Phase 3: Complex & WebGL Components
  'racecor-tachometer': {
    componentClass: customElements.get('racecor-tachometer'),
    type: 'dom',
    phase: 3,
    description: 'RPM gauge with segmented color bar, gear display, speed readout'
  },
  'racecor-webgl-fx': {
    componentClass: customElements.get('racecor-webgl-fx'),
    type: 'webgl2',
    phase: 3,
    description: 'WebGL2 post-processing effects (tachometer bloom, heat distortion)'
  },
  'racecor-drive-hud': {
    componentClass: customElements.get('racecor-drive-hud'),
    type: 'svg',
    phase: 3,
    description: 'Full-screen driving HUD with track map, position, sectors, incidents'
  },
  'racecor-commentary-viz': {
    componentClass: customElements.get('racecor-commentary-viz'),
    type: 'canvas',
    phase: 3,
    description: 'Commentary panel with Canvas visualizations and track image'
  }
};

/**
 * Helper function to log registered components (for debugging).
 * @example window._logComponents()
 */
window._logComponents = function() {
  console.group('[K10] Registered Web Components');
  Object.entries(window._componentRegistry).forEach(([tag, info]) => {
    console.log(`  ${tag} (${info.type}, phase ${info.phase})`);
  });
  console.groupEnd();
};

console.log('[K10 Web Components] Loaded (21 components: Phase 1 + 2 + 3). Call window._logComponents() to see all.');
