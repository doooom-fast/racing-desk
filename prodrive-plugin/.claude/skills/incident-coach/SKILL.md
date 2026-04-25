---
name: incident-coach
description: |
  Incident Coach — driver behavior tracking, rage detection, cool-down intervention, voice coaching.
  Use when working on aggression measurement, incident attribution, threat tracking, composure scoring,
  or when user mentions "rage," "incident coach," "cool-down," "behavior score," "voice coach."
---

# Incident Coach Skill

Research-backed driver behavior system. All modules are **fully implemented**.

## Architecture

### Overlay (JS)
| File | Lines | Purpose |
|------|-------|---------|
| `racecor-overlay/modules/js/incident-coach.js` | 650 | Threat parsing, leaderboard highlighting (◉/△/⚠), composure indicator, cool-down vignette, voice triggers |
| `racecor-overlay/modules/js/voice-coach.js` | 254 | Web Speech API TTS, priority queue (1-5), 3s min gap, rate 0.9 / pitch 0.85 |
| `racecor-overlay/modules/styles/incident-coach.css` | — | Vignette, composure states, threat badges |

### Extends existing modules
| Module | Integration |
|--------|------------|
| `spotter.js` | Stacking threat approach alerts |
| `incidents.js` | Incident count triggers attribution |
| `leaderboard.js` | Threat highlighting via CSS classes (ic-watch, ic-caution, ic-danger) |
| `drive-hud.js` | Track map danger zone rings |

### Plugin (C#)
| File | Lines | Purpose |
|------|-------|---------|
| `IncidentCoachEngine.cs` | 761 | Core engine: attribution, rage scoring, cool-down, session metrics |
| `IIncidentDetector.cs` | 35 | Sim-agnostic interface + `IRacingIncidentDetector` |
| `IncidentCoachModels.cs` | 80+ | ThreatLevel enum (None/Watch/Caution/Danger), NearbyDriver, ProximitySnapshot, BehaviorMetrics |

### HTTP API Properties (`RaceCorProDrive.Plugin.DS.IncidentCoach.*`)
`Active` (0/1), `LastIncidentLap` (int), `ThreatDrivers` (JSON[]), `ActiveAlert` (JSON), `RageScore` (0-100), `CooldownActive` (0/1), `SessionBehavior` (JSON)

### Settings (Settings.cs)
`IncidentCoachEnabled` (default: false), `IncidentCoachVoiceEnabled` (true), `IncidentCoachCooldownThreshold` (70), `IncidentCoachAlertSensitivity` (1.0)

## Implemented Constants

| Parameter | Value | Source |
|-----------|-------|--------|
| Cascade decay factor | 0.85 | Abou-Zeid 2011 |
| Rage decay window | 30s | Kerwin 2022 |
| Cool-down minimum | 20s | Research standard |
| Cool-down exit | rage < 30 AND gap > 2.5s | Kerwin following-distance |
| Alert ranges (Watch/Caution/Danger) | 1.5s / 2.5s / 3.5s | Speed-adjusted |
| Attribution thresholds | Primary: 40.0, Contributor: 25.0 | — |
| Breathing rhythm | 4-7-8 (in-hold-out) | Research standard |
| Min utterance gap | 3000ms | — |

## Voice Prompt Rules

1. Max 2 sentences — driver processing visual info at 30fps+
2. No questions during active racing
3. Calm, low pitch, slightly slow (rate 0.9, pitch 0.85)
4. 3s minimum gap between utterances
5. Urgent can interrupt informational, never reverse
6. Critical prompts repeat once if rage > 70 for 10s

## CRITICAL: No Hostile Attribution

Never frame other drivers as deliberate antagonists.

**Banned**: "He did that on purpose" / "He's targeting you" / "Get him back"
**Required**: "Contact logged. Focus forward." / "Incident with [Name]. Let's build a gap." / "That's racing. Focus on your line."

Empathy prompts ("Maybe they're having a rough race too") only during recovery phase, never active rage.

## Behavioral Proxies (rage scoring)

| Proxy | Weight |
|-------|--------|
| Throttle >95% within 3s of incident | High |
| Steering oscillation increase | Medium |
| Brake >90% approaching incident partner | High |
| Closing gap faster than baseline | Very High |
| Sustained full-throttle + weaving | Very High |
| Normal driving resumes within 10s | Reduces score |

## Multi-Session Trait Inference

High-trait drivers (consistently high rage, frequent cool-downs, retaliation attempts) get earlier, gentler interventions. Fast recovery = lower trait. Persists to local storage.

## Full Spec

`docs/FEATURE_SPEC_INCIDENT_COACH.md` — complete 8-phase implementation roadmap
