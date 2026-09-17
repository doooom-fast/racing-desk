/**
 * previous-races safety-net snapshots — locks buildPreviousRaceCards.
 *
 * Covers the pairing rule (race ↔ practice ↔ qualifying within 8h on
 * the same track), session-type tab classification, position-badge
 * label/color, and per-card view-model formatting. The native app
 * and the web RaceCard both render this output verbatim, so any
 * unintended formatting drift surfaces here before it hits clients.
 */
import { describe, it, expect } from 'vitest'
import {
  buildPreviousRaceCards,
  type PreviousRaceInput,
} from '../../src/engines/previous-races'

function input(overrides: Partial<PreviousRaceInput>): PreviousRaceInput {
  return {
    id: overrides.id ?? 's1',
    carModel: overrides.carModel ?? 'BMW M4 GT3',
    manufacturer: overrides.manufacturer ?? 'BMW',
    trackName: overrides.trackName ?? 'Sebring',
    finishPosition: overrides.finishPosition ?? null,
    incidentCount: overrides.incidentCount ?? 0,
    sessionType: overrides.sessionType ?? 'race',
    category: overrides.category ?? 'road',
    metadata: overrides.metadata ?? null,
    gameName: overrides.gameName ?? 'iracing',
    createdAt: overrides.createdAt ?? '2026-04-28T18:00:00Z',
  }
}

describe('previous-races — empty + degenerate', () => {
  it('empty input returns empty array', () => {
    expect(buildPreviousRaceCards([], 'UTC')).toEqual([])
  })
})

describe('previous-races — pairing window', () => {
  it('pairs a race with same-track practice + qualifying inside 8h', () => {
    const cards = buildPreviousRaceCards(
      [
        input({ id: 'p', sessionType: 'practice', createdAt: '2026-04-28T16:00:00Z' }),
        input({ id: 'q', sessionType: 'qualifying', createdAt: '2026-04-28T17:30:00Z' }),
        input({
          id: 'r',
          sessionType: 'race',
          finishPosition: 4,
          metadata: { bestLapTime: 89.234, fieldSize: 24, completedLaps: 30 },
          createdAt: '2026-04-28T18:00:00Z',
        }),
      ],
      'UTC',
    )

    expect(cards).toHaveLength(1)
    expect(cards[0].session.id).toBe('r')
    expect(cards[0].practiceSession?.id).toBe('p')
    expect(cards[0].qualifyingSession?.id).toBe('q')
    expect(cards[0].viewModel.positionDisplay).toBe('P4')
    expect(cards[0].viewModel.fieldSizeLabel).toBe('of 24')
    expect(cards[0].viewModel.bestLapLabel).toBe('1:29.234')
  })

  it('does not pair a practice that is more than 8h before the race', () => {
    const cards = buildPreviousRaceCards(
      [
        input({ id: 'p', sessionType: 'practice', createdAt: '2026-04-28T08:00:00Z' }),
        input({ id: 'r', sessionType: 'race', finishPosition: 1, createdAt: '2026-04-28T18:00:00Z' }),
      ],
      'UTC',
    )
    // Both stand alone — no pairing because the gap is 10h.
    expect(cards).toHaveLength(2)
    const race = cards.find(c => c.session.id === 'r')!
    expect(race.practiceSession).toBeUndefined()
  })

  it('does not pair a practice on a different track', () => {
    const cards = buildPreviousRaceCards(
      [
        input({ id: 'p', sessionType: 'practice', trackName: 'Daytona', createdAt: '2026-04-28T16:00:00Z' }),
        input({ id: 'r', sessionType: 'race', trackName: 'Sebring', createdAt: '2026-04-28T18:00:00Z' }),
      ],
      'UTC',
    )
    expect(cards).toHaveLength(2)
    const race = cards.find(c => c.session.id === 'r')!
    expect(race.practiceSession).toBeUndefined()
  })
})

describe('previous-races — position display + color', () => {
  it.each([
    [1, 'P1', '#F5CA47'], // gold
    [2, 'P2', '#C7C7C7'], // silver
    [3, 'P3', '#DA944E'], // bronze
    [7, 'P7', '#54D483'], // top10
    [22, 'P22', '#7B7B85'], // dim
  ])('finish position %i renders as %s with color %s', (pos, label, hex) => {
    const cards = buildPreviousRaceCards(
      [input({ finishPosition: pos, metadata: { fieldSize: 30, completedLaps: 30 } })],
      'UTC',
    )
    expect(cards[0].viewModel.positionDisplay).toBe(label)
    expect(cards[0].viewModel.positionColorHex).toBe(hex)
  })

  it('completedLaps > 0 with no finishPosition is DNF', () => {
    const cards = buildPreviousRaceCards(
      [input({ finishPosition: null, metadata: { completedLaps: 12, fieldSize: 24 } })],
      'UTC',
    )
    expect(cards[0].viewModel.positionDisplay).toBe('DNF')
    expect(cards[0].viewModel.positionColorHex).toBe('#E46767')
    expect(cards[0].viewModel.fieldSizeLabel).toBeNull()
  })

  it('completedLaps == 0 with no finishPosition is no-show "—"', () => {
    const cards = buildPreviousRaceCards(
      [input({ finishPosition: null, metadata: { completedLaps: 0, fieldSize: 24 } })],
      'UTC',
    )
    expect(cards[0].viewModel.positionDisplay).toBe('—')
    expect(cards[0].viewModel.positionColorHex).toBe('#7B7B85')
  })
})

describe('previous-races — session-type tab', () => {
  it('classifies practice as practices', () => {
    const cards = buildPreviousRaceCards(
      [input({ id: 'p', sessionType: 'openPractice' })],
      'UTC',
    )
    expect(cards[0].viewModel.sessionTypeTab).toBe('practices')
    expect(cards[0].viewModel.positionDisplay).toBeNull()
  })

  it('classifies time trial via sessionType as time_trials with TT badge', () => {
    const cards = buildPreviousRaceCards(
      [input({ id: 'tt', sessionType: 'timeTrial' })],
      'UTC',
    )
    expect(cards[0].viewModel.sessionTypeTab).toBe('time_trials')
    expect(cards[0].viewModel.positionDisplay).toBe('TT')
    expect(cards[0].viewModel.positionColorHex).toBe('#70B8DB')
  })

  it('classifies time trial via metadata.eventType as time_trials', () => {
    const cards = buildPreviousRaceCards(
      [input({ id: 'tt', sessionType: 'race', metadata: { eventType: 'Time Trial' } })],
      'UTC',
    )
    expect(cards[0].viewModel.sessionTypeTab).toBe('time_trials')
    expect(cards[0].viewModel.positionDisplay).toBe('TT')
  })
})

describe('previous-races — formatting', () => {
  it('formats best lap as m:ss.fff', () => {
    const cards = buildPreviousRaceCards(
      [input({ metadata: { bestLapTime: 73.012, completedLaps: 10 }, finishPosition: 5 })],
      'UTC',
    )
    expect(cards[0].viewModel.bestLapLabel).toBe('1:13.012')
  })

  it('renders missing best lap as em dash', () => {
    const cards = buildPreviousRaceCards([input({ finishPosition: 5 })], 'UTC')
    expect(cards[0].viewModel.bestLapLabel).toBe('—')
  })

  it('humanises camelCase session label', () => {
    const cards = buildPreviousRaceCards([input({ sessionType: 'openPractice' })], 'UTC')
    expect(cards[0].viewModel.sessionLabel).toBe('Open Practice')
  })

  it('emits "iRacing" for the canonical game name', () => {
    const cards = buildPreviousRaceCards([input({ gameName: 'iracing' })], 'UTC')
    expect(cards[0].viewModel.gameLabel).toBe('iRacing')
  })

  it('formats date in the user TZ', () => {
    const cards = buildPreviousRaceCards(
      [input({ createdAt: '2026-04-29T03:00:00Z' })],
      'America/Los_Angeles', // 2026-04-28 20:00 local
    )
    expect(cards[0].viewModel.dateLabel).toBe('Apr 28')
  })

  it('appends track config when present in metadata', () => {
    const cards = buildPreviousRaceCards(
      [input({ trackName: 'Sebring', metadata: { iracingTrackConfig: 'National' } })],
      'UTC',
    )
    expect(cards[0].viewModel.trackLabel).toBe('Sebring — National')
  })
})

describe('previous-races — ordering', () => {
  it('returns newest-first', () => {
    const cards = buildPreviousRaceCards(
      [
        input({ id: 'old', createdAt: '2026-04-25T18:00:00Z' }),
        input({ id: 'mid', createdAt: '2026-04-27T18:00:00Z' }),
        input({ id: 'new', createdAt: '2026-04-29T18:00:00Z' }),
      ],
      'UTC',
    )
    expect(cards.map(c => c.session.id)).toEqual(['new', 'mid', 'old'])
  })
})
