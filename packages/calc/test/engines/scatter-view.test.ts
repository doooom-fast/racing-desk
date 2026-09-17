/**
 * scatter-view safety-net snapshots — locks buildScatterBuckets.
 *
 * Already documented as "extracted from web client to fix native-app drift",
 * so this test exists primarily to lock TZ behavior and bucket aggregation
 * before any further refactoring.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildScatterBuckets, type ScatterSessionInput } from '../../src/engines/scatter-view'

const REAL_FIXTURES = join(__dirname, '..', 'fixtures', 'real')

interface RealSession {
  incidentCount: number | null
  metadata: Record<string, any> | null
  createdAt: string
}

const realSessions: RealSession[] = JSON.parse(
  readFileSync(join(REAL_FIXTURES, 'admin-sessions.json'), 'utf8'),
)

// Mirror the production derivation in apps/web/src/lib/queries/dashboard.ts:
const realScatterInput: ScatterSessionInput[] = realSessions.map((s) => {
  const meta = s.metadata ?? {}
  return {
    date: s.createdAt,
    iRatingDelta: Number(meta.iRatingDelta ?? 0),
    srDelta: Number(meta.srDelta ?? 0),
    incidents: Number(s.incidentCount ?? 0),
  }
})

// Sort buckets deterministically before snapshotting — Map iteration order
// is insertion order, which depends on input order, but for snapshot stability
// we want a canonical sort.
function sortBuckets(buckets: ReturnType<typeof buildScatterBuckets>) {
  return [...buckets].sort((a, b) => a.day - b.day || a.hour - b.hour)
}

describe('scatter-view — real admin fixture', () => {
  it('UTC bucketing matches snapshot', () => {
    expect(sortBuckets(buildScatterBuckets(realScatterInput, 'UTC'))).toMatchSnapshot()
  })
  it('America/New_York bucketing matches snapshot', () => {
    expect(sortBuckets(buildScatterBuckets(realScatterInput, 'America/New_York'))).toMatchSnapshot()
  })
})

describe('scatter-view — synthetic edge cases', () => {
  it('empty input returns empty array', () => {
    expect(buildScatterBuckets([], 'UTC')).toEqual([])
  })

  it('single session at known UTC midnight: snapshot', () => {
    const out = buildScatterBuckets(
      [{ date: '2026-03-15T00:00:00Z', iRatingDelta: 10, srDelta: 0.05, incidents: 1 }],
      'UTC',
    )
    expect(out).toMatchSnapshot()
  })

  it('TZ midnight crossing: same instant buckets differently in UTC vs Pacific', () => {
    // 2026-03-15T03:00:00Z is Sunday 03:00 UTC but Saturday 20:00 in LA
    const input = [{ date: '2026-03-15T03:00:00Z', iRatingDelta: 0, srDelta: 0, incidents: 0 }]
    const utc = buildScatterBuckets(input, 'UTC')
    const la = buildScatterBuckets(input, 'America/Los_Angeles')
    expect({ utc, la }).toMatchSnapshot()
  })

  it('multiple sessions in same bucket aggregate correctly: snapshot', () => {
    const input: ScatterSessionInput[] = [
      { date: '2026-03-15T18:00:00Z', iRatingDelta: 10, srDelta: 0.05, incidents: 2 },
      { date: '2026-03-15T18:30:00Z', iRatingDelta: -5, srDelta: -0.02, incidents: 4 },
      { date: '2026-03-15T18:45:00Z', iRatingDelta: 20, srDelta: 0.10, incidents: 0 },
    ]
    expect(sortBuckets(buildScatterBuckets(input, 'UTC'))).toMatchSnapshot()
  })

  it('invalid date string is silently skipped', () => {
    const out = buildScatterBuckets(
      [
        { date: 'not-a-date', iRatingDelta: 0, srDelta: 0, incidents: 0 },
        { date: '2026-03-15T12:00:00Z', iRatingDelta: 0, srDelta: 0, incidents: 0 },
      ],
      'UTC',
    )
    expect(out).toMatchSnapshot()
  })
})
