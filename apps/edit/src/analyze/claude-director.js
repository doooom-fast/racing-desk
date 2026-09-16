// ═══════════════════════════════════════════════════════════════
// CLAUDE DIRECTOR — AI editorial refinement via Claude
//
// Takes the mechanical scores + event stream and asks Claude to
// make the editorial judgment calls: which battles to trim, when
// to build narrative arcs, and how to condense boring stretches.
//
// Two integration modes (user chooses via config or env):
//   1. CLI mode (default) — spawns `claude` CLI tool. Uses the
//      user's Claude subscription. No API key needed.
//   2. SDK mode — uses @anthropic-ai/sdk with ANTHROPIC_API_KEY.
//      Better for automation / CI pipelines.
//
// Detection order:
//   - RACECOR_CLAUDE_MODE=cli|sdk  → explicit override
//   - ANTHROPIC_API_KEY set        → SDK mode
//   - `claude` on PATH             → CLI mode
//   - Neither                      → skip AI refinement
// ═══════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, execFileSync } from 'node:child_process';
import { formatDuration } from '../utils/time.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Mode detection ─────────────────────────────────────────────

let _detectedMode = null;

/**
 * Detect which Claude integration mode is available.
 * @returns {'cli' | 'sdk' | null}
 */
export function detectClaudeMode() {
  if (_detectedMode !== undefined && _detectedMode !== null) return _detectedMode;

  // Explicit override
  const override = process.env.RACECOR_CLAUDE_MODE?.toLowerCase();
  if (override === 'cli' || override === 'sdk') {
    _detectedMode = override;
    return _detectedMode;
  }

  // SDK available?
  if (process.env.ANTHROPIC_API_KEY) {
    _detectedMode = 'sdk';
    return _detectedMode;
  }

  // CLI available?
  if (hasClaudeCLI()) {
    _detectedMode = 'cli';
    return _detectedMode;
  }

  _detectedMode = null;
  return null;
}

/**
 * Check if `claude` CLI is on PATH.
 */
export function hasClaudeCLI() {
  try {
    execSync('which claude 2>/dev/null || where claude 2>nul', {
      encoding: 'utf8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch { return false; }
}

/**
 * Check if the Anthropic SDK is importable.
 */
async function hasSDK() {
  try {
    await import('@anthropic-ai/sdk');
    return true;
  } catch { return false; }
}

// ── Prompt loading ─────────────────────────────────────────────

function loadPrompt(templateName, vars) {
  const templatePath = join(__dirname, 'prompts', templateName + '.md');
  let template = readFileSync(templatePath, 'utf8');
  for (const [key, value] of Object.entries(vars)) {
    template = template.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return template;
}

// ── Schemas ────────────────────────────────────────────────────

const EDL_SCHEMA = JSON.stringify({
  title: "string — race title",
  total_duration: "string — e.g. '45:00'",
  cuts: [
    {
      start: "string — timecode e.g. '0:00'",
      end: "string — timecode",
      source: "'cockpit' | 'tv'",
      reason: "string — why this camera angle",
    }
  ],
  highlight_reel: {
    segments: [
      {
        start: "string", end: "string",
        source: "'cockpit' | 'tv' | 'mixed'",
        label: "string — moment description",
      }
    ]
  }
}, null, 2);

const CONDENSE_SCHEMA = JSON.stringify({
  target_duration: "string — e.g. '5:00'",
  segments: [
    {
      start: "string — timecode",
      end: "string — timecode",
      action: "'keep' | 'cut'",
      source: "'cockpit' | 'tv' | 'mixed'",
      context_bridge: "string | null — title card text for cuts (e.g. 'Lap 4 — Pit Window')",
      reason: "string — editorial rationale",
    }
  ],
  narrative_notes: "string — brief description of the edit's story arc",
}, null, 2);

// ── Claude invocation (dual-mode) ──────────────────────────────

/**
 * Send a prompt to Claude and get a text response.
 * Uses CLI or SDK depending on detected mode.
 */
async function askClaude(prompt, { maxTokens = 4096 } = {}) {
  const mode = detectClaudeMode();

  if (mode === 'cli') {
    return askClaudeCLI(prompt);
  } else if (mode === 'sdk') {
    return askClaudeSDK(prompt, { maxTokens });
  } else {
    throw new Error(
      'No Claude integration available.\n' +
      'Either install the `claude` CLI tool or set ANTHROPIC_API_KEY.\n' +
      'Override with RACECOR_CLAUDE_MODE=cli|sdk'
    );
  }
}

/**
 * CLI mode: write prompt to temp file, pipe to `claude`.
 */
function askClaudeCLI(prompt) {
  const result = execFileSync('claude', [
    '--print',            // output only, no interactive UI
    '--output-format', 'text',
    '--max-turns', '1',
  ], {
    encoding: 'utf8',
    timeout: 120_000,     // 2 min timeout
    maxBuffer: 10 * 1024 * 1024,
    input: prompt,        // pipe prompt via stdin
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return result.trim();
}

/**
 * SDK mode: use @anthropic-ai/sdk.
 */
async function askClaudeSDK(prompt, { maxTokens = 4096 } = {}) {
  let Anthropic;
  try {
    const module = await import('@anthropic-ai/sdk');
    Anthropic = module.default;
  } catch (err) {
    throw new Error(
      'Anthropic SDK not installed or not found. ' +
      'Install with: npm install @anthropic-ai/sdk\n' +
      `Details: ${err.message}`
    );
  }

  const client = new Anthropic();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0]?.text || '';
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Ask Claude to refine camera switching decisions.
 * @param {Object} session - Session metadata from ingest
 * @param {Array} scores - Per-second scores from scoring-engine
 * @param {Array} cameraSegments - Mechanical camera segments
 * @returns {Object} Claude's refined EDL
 */
export async function refineCameraSwitching(session, scores, cameraSegments) {
  const eventStream = session.events
    .map(e => `${formatDuration(e.t)} ${e.event}${e.duration ? ` (${e.duration.toFixed(0)}s)` : ''} ${JSON.stringify(e.data || {})}`)
    .join('\n');

  const significantScores = scores
    .filter(s => s.tvScore > 10)
    .map(s => `${formatDuration(s.t)}: tv=${s.tvScore}`)
    .join('\n');

  const raceSummary = [
    `Duration: ${session.durationStr}`,
    `Start: P${session.startPosition}/${session.totalCars}`,
    `Finish: P${session.endPosition}/${session.totalCars}`,
    `Laps: ${session.totalLaps}`,
    `Incidents: ${session.totalIncidents}`,
    `Events: ${session.events.length}`,
  ].join('\n');

  const prompt = loadPrompt('broadcast-director', {
    race_summary: raceSummary,
    event_stream: eventStream,
    camera_scores: significantScores,
    edl_schema: EDL_SCHEMA,
  });

  const text = await askClaude(prompt);
  return parseJSONResponse(text);
}

/**
 * Ask Claude to refine condensing decisions.
 * @param {Object} session - Session metadata
 * @param {Array} scores - Per-second interest scores
 * @param {Array} segments - Mechanical keep/cut segments
 * @param {string} targetDuration - Target duration string (e.g., "5:00")
 * @returns {Object} Claude's refined condense plan
 */
export async function refineCondensing(session, scores, segments, targetDuration) {
  const eventStream = session.events
    .map(e => `${formatDuration(e.t)} ${e.event}${e.duration ? ` (${e.duration.toFixed(0)}s)` : ''} ${JSON.stringify(e.data || {})}`)
    .join('\n');

  const interestScores = scores
    .filter(s => s.interestScore > 15)
    .map(s => `${formatDuration(s.t)}: interest=${s.interestScore}`)
    .join('\n');

  const segmentClassification = segments
    .map(s => `${formatDuration(s.start)}–${formatDuration(s.end)}: ${s.action} (avg interest: ${s.avgInterest?.toFixed(0) || '?'})`)
    .join('\n');

  const raceSummary = [
    `Duration: ${session.durationStr}`,
    `Start: P${session.startPosition}/${session.totalCars}`,
    `Finish: P${session.endPosition}/${session.totalCars}`,
    `Laps: ${session.totalLaps}`,
    `Incidents: ${session.totalIncidents}`,
  ].join('\n');

  const prompt = loadPrompt('condense-race', {
    race_summary: raceSummary,
    event_stream: eventStream,
    interest_scores: interestScores,
    segment_classification: segmentClassification,
    target_duration: targetDuration,
    original_duration: session.durationStr,
    condense_schema: CONDENSE_SCHEMA,
  });

  const text = await askClaude(prompt);
  return parseJSONResponse(text);
}

// ── JSON extraction ────────────────────────────────────────────

/**
 * Extract JSON from Claude's response text.
 * Handles responses wrapped in markdown code blocks.
 */
function parseJSONResponse(text) {
  // Try direct parse first
  try { return JSON.parse(text); } catch { /* continue */ }

  // Extract from code block
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (match) {
    try { return JSON.parse(match[1]); } catch { /* continue */ }
  }

  // Try finding first { to last }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch { /* continue */ }
  }

  throw new Error('Failed to parse Claude response as JSON:\n' + text.slice(0, 500));
}
