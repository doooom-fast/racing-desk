---
name: race-coach
description: |
  AI Race Coach — post-race analysis via Anthropic API. Use when working on system prompt,
  tone/depth configs, race data schema, API integration, or when user mentions "race coach,"
  "AI analysis," "post-race commentary," "coaching prompt."
---

# AI Race Coach Skill

Post-race AI analysis in the overlay results screen.

## Files

| File | Role |
|------|------|
| `racecor-overlay/modules/js/race-coach.js` | Runtime module (IIFE): system prompt builder, tone/depth configs, API call, renderer |
| `racecor-overlay/modules/js/race-results.js` | Calls `generateRaceAnalysis()` on button click (line ~535) |
| `racecor-overlay/modules/js/config.js` | `_defaultSettings`: `agentKey`, `coachTone: 'coach'`, `coachDepth: 'standard'` |
| `racecor-overlay/modules/js/connections.js` | `updateAgentKey()`, `_populateCoachSettings()` |
| `racecor-overlay/dashboard.html` | Agent key input + tone/depth selectors in K10 connections panel |
| `racecor-overlay/modules/styles/race-results.css` | `.rr-ai-*` classes (lines 368–442) |

Note: `updateCoachTone()` and `updateCoachDepth()` live in **race-coach.js** (lines 332–340), not connections.js.

## Tones (`_settings.coachTone`)

| Key | Persona | Style |
|-----|---------|-------|
| `broadcast` | Broadcast Commentator | Dramatic, narrative-driven (Sky F1 debrief) |
| `coach` | Racing Engineer | Analytical, data-referencing, direct |
| `mentor` | Friendly Mentor | Encouraging, explains the "why," casual |

Each tone must produce noticeably different text distinguishable blindfolded.

## Depth (`_settings.coachDepth`)

| Key | Model | Max Tokens | Output |
|-----|-------|-----------|--------|
| `quick` | `claude-haiku-4-5-20251001` | 350 | `{ summary }` |
| `standard` | `claude-sonnet-4-6` | 800 | `{ summary, paceAnalysis, keyMoments, improvements[], nextFocus }` |
| `deep` | `claude-sonnet-4-6` | 1500 | Standard + `{ strategyNote }` |

## Data Schema (user message JSON)

`position, trackName, carModel, totalLaps, currentLap, bestLapTime, lapTimes[], positions[], incidents, iRatingDelta, fuelLevels[], tyreTempAvg[], commentaryLog[]`

Non-obvious: `iRatingDelta` can be negative. `position: 0` = DNF.

## Prompt Rules

- Reference specific data points ("Lap 7 was your fastest at 1:42.3")
- JSON output; code strips markdown fences — don't waste tokens preventing them
- Keep schema description concise; document only non-obvious fields
- Test with demo mode data (should still produce useful analysis)

## API Notes

- Header: `anthropic-dangerous-direct-browser-access: true` (SimHub's embedded CEF)
- Key stored in `_settings.agentKey`, persisted via `saveSettings()`
- Button states: "Generate AI Analysis" → "Analyzing..." → "Regenerate" / "Retry"

## Testing

1. Enable demo mode → trigger checkered flag (or `showRaceResults(p, true)` in console) → click "Generate AI Analysis"
2. For prompt iteration without cost: log `systemPrompt` and `raceDataJSON` in `generateRaceAnalysis()`
