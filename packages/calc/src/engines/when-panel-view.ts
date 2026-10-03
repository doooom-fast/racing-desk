/**
 * Pre-computed view-model for the Strengths / Watch Out panel.
 *
 * Extracted from `apps/web/src/app/drive/dashboard/WhenInsightsPanel.tsx`
 * so the same paragraph + averages can be emitted by the dashboard API
 * (for native apps to render verbatim) as well as consumed by the web
 * component. Previously the panel helpers lived inside the React
 * component's file — meaning native would have had to re-implement
 * them in Swift to render matching copy. This module is the single
 * source of truth.
 */

import type { WhenProfile, WhenInsight } from './when-engine.js'

/** One side of the Strengths/Watch Out panel, fully pre-rendered. */
export interface WhenPanelSide {
  /** Window label — e.g. "Sundays" (peakDays/worstDays string from profile). */
  days: string
  /** Hour window — e.g. "7pm – 10pm". */
  hours: string
  /** Signed iRating delta averaged across the window ("+296" or null). */
  avgIRatingDelta: number | null
  /** Natural-language paragraph (matches the web's exact copy). */
  paragraph: string
  /** Up to 3 bullets (from `WhenProfile.insights` filtered by side). */
  bullets: WhenInsight[]
}

export interface WhenPanelView {
  strengths: WhenPanelSide | null
  watchOut: WhenPanelSide | null
}

/** Public entry point — returns both sides of the panel. */
export function buildWhenPanelView(profile: WhenProfile | null): WhenPanelView {
  if (!profile) return { strengths: null, watchOut: null }

  return {
    strengths: {
      days: `${profile.peakDays}s`,
      hours: profile.peakHours,
      avgIRatingDelta: windowAvgDelta(profile, profile.peakHourStart, profile.windowSize),
      paragraph: buildPeakParagraph(profile),
      bullets: profile.insights.filter(i => i.type === 'positive' || i.type === 'neutral').slice(0, 3),
    },
    watchOut: {
      days: profile.worstDays,
      hours: profile.worstHours,
      avgIRatingDelta: windowAvgDelta(profile, profile.worstHourStart, profile.windowSize),
      paragraph: buildAvoidParagraph(profile),
      bullets: profile.insights.filter(i => i.type === 'negative').slice(0, 3),
    },
  }
}

// ── Window aggregation ─────────────────────────────────────────────────

function windowAvgDelta(profile: WhenProfile, start: number, size: number): number | null {
  let totalDelta = 0, count = 0
  for (let i = 0; i < size; i++) {
    const slice = profile.byHour[(start + i) % 24]
    if (slice.avgIRatingDelta !== null && slice.sessionCount > 0) {
      totalDelta += slice.avgIRatingDelta
      count++
    }
  }
  return count > 0 ? totalDelta / count : null
}

function aggregateWindow(profile: WhenProfile, start: number) {
  let sessions = 0, wins = 0, inc = 0, incCount = 0
  for (let i = 0; i < profile.windowSize; i++) {
    const h = profile.byHour[(start + i) % 24]
    sessions += h.sessionCount
    if (h.sessionCount > 0) {
      wins += h.winRate * h.sessionCount
      inc += h.avgIncidents * h.sessionCount
      incCount += h.sessionCount
    }
  }
  return {
    sessions,
    winRate: sessions > 0 ? wins / sessions : 0,
    avgIncidents: incCount > 0 ? inc / incCount : 0,
  }
}

function computeOverallBaselines(profile: WhenProfile) {
  let totalWins = 0, totalInc = 0, totalRaces = 0, incCount = 0
  for (const h of profile.byHour) {
    if (h.sessionCount > 0) {
      totalWins += h.winRate * h.sessionCount
      totalInc += h.avgIncidents * h.sessionCount
      totalRaces += h.sessionCount
      incCount += h.sessionCount
    }
  }
  return {
    winRate: totalRaces > 0 ? totalWins / totalRaces : 0,
    avgIncidents: incCount > 0 ? totalInc / incCount : 0,
  }
}

// ── Natural-language verbs ─────────────────────────────────────────────

function incidentVerb(windowAvg: number, baseline: number): string {
  if (baseline <= 0) return 'sit at'
  const delta = (windowAvg - baseline) / baseline
  if (Math.abs(delta) < 0.15) return 'hold at'
  return delta < 0 ? 'drop to' : 'rise to'
}

function winRateVerb(windowRate: number, baseline: number): string {
  const diffPct = windowRate - baseline
  if (Math.abs(diffPct) < 0.03) return 'sits at'
  return diffPct > 0 ? 'climbs to' : 'falls to'
}

// ── Paragraph builders (copy-for-copy identical to the web component) ──

export function buildPeakParagraph(profile: WhenProfile): string {
  const overall = computeOverallBaselines(profile)
  const win = aggregateWindow(profile, profile.peakHourStart)
  const parts: string[] = []

  if (win.sessions > 0) {
    parts.push(`Based on ${win.sessions} races in this window`)
    parts.push(`your win rate ${winRateVerb(win.winRate, overall.winRate)} ${(win.winRate * 100).toFixed(0)}%`)
    parts.push(`incidents ${incidentVerb(win.avgIncidents, overall.avgIncidents)} ${win.avgIncidents.toFixed(1)} on average`)
  }
  return parts.length > 0 ? parts.join(', ') + '.' : ''
}

export function buildAvoidParagraph(profile: WhenProfile): string {
  const overall = computeOverallBaselines(profile)
  const win = aggregateWindow(profile, profile.worstHourStart)
  const parts: string[] = []

  if (win.sessions > 0) {
    parts.push(`Across ${win.sessions} races here`)
    parts.push(`win rate ${winRateVerb(win.winRate, overall.winRate)} ${(win.winRate * 100).toFixed(0)}%`)
    parts.push(`incidents ${incidentVerb(win.avgIncidents, overall.avgIncidents)} ${win.avgIncidents.toFixed(1)} on average`)
  }
  return parts.length > 0 ? parts.join(', ') + '.' : ''
}
