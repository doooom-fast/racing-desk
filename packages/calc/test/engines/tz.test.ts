/**
 * Tests for TZ helpers in src/lib/tz.ts.
 *
 * The clock-time fix hinged on these: when-engine and next-race-ideas used to
 * bucket by `Date.getUTCHours()` / `getUTCDay()`, so a Pacific-coast racer who
 * started a session at 11pm local (06:00 UTC next day) got scored as "early
 * morning Sunday" instead of "late Saturday." These helpers must consistently
 * return the clock-hour and day-of-week the user actually experienced.
 */

import { describe, it, expect } from 'vitest'
import { getHourInTz, getDayInTz, isValidTimeZone } from '../../src/engines/tz'

describe('isValidTimeZone', () => {
  it('accepts real IANA names', () => {
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true)
    expect(isValidTimeZone('Europe/London')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Asia/Tokyo')).toBe(true)
  })

  it('rejects nonsense', () => {
    expect(isValidTimeZone('Atlantis/Poseidon')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone(null)).toBe(false)
    expect(isValidTimeZone(undefined)).toBe(false)
  })
})

describe('getHourInTz', () => {
  it('returns the UTC hour when timeZone is UTC', () => {
    // 14:00 UTC is 14:00 in UTC
    const d = new Date('2026-03-15T14:00:00Z')
    expect(getHourInTz(d, 'UTC')).toBe(14)
  })

  it('shifts west-coast US timestamps by 7h during DST', () => {
    // March 15 2026 is DST in LA → UTC-7
    // 06:00 UTC = 23:00 (11pm) previous day local in LA
    const d = new Date('2026-03-15T06:00:00Z')
    expect(getHourInTz(d, 'America/Los_Angeles')).toBe(23)
  })

  it('handles midnight wrap', () => {
    // 07:00 UTC = 00:00 local in LA during DST
    const d = new Date('2026-03-15T07:00:00Z')
    expect(getHourInTz(d, 'America/Los_Angeles')).toBe(0)
  })

  it('handles Tokyo (UTC+9)', () => {
    // 14:00 UTC = 23:00 in Tokyo
    const d = new Date('2026-03-15T14:00:00Z')
    expect(getHourInTz(d, 'Asia/Tokyo')).toBe(23)
  })

  it('falls back to UTC hour on invalid tz', () => {
    const d = new Date('2026-03-15T14:00:00Z')
    expect(getHourInTz(d, 'Not/A_Real_Zone')).toBe(14)
  })
})

describe('getDayInTz', () => {
  it('matches Date.getUTCDay() for UTC timezone', () => {
    const d = new Date('2026-03-15T14:00:00Z') // Sunday
    expect(getDayInTz(d, 'UTC')).toBe(0)
  })

  it('rolls back a day when local time is the previous calendar day', () => {
    // 03:00 UTC Monday = 20:00 (Sunday) local in LA (UTC-7 during DST)
    const d = new Date('2026-03-16T03:00:00Z') // Monday 03:00 UTC
    expect(getDayInTz(d, 'America/Los_Angeles')).toBe(0) // Sunday local
  })

  it('rolls forward a day when local time is the next calendar day', () => {
    // 21:00 UTC Sunday = 06:00 Monday local in Tokyo (UTC+9)
    const d = new Date('2026-03-15T21:00:00Z') // Sunday 21:00 UTC
    expect(getDayInTz(d, 'Asia/Tokyo')).toBe(1) // Monday local
  })

  it('falls back to UTC day on invalid tz', () => {
    const d = new Date('2026-03-15T14:00:00Z') // Sunday UTC
    expect(getDayInTz(d, 'Not/A_Real_Zone')).toBe(0)
  })
})

describe('cross-check: the 2am-Monday scenario from the Pacific-coast user', () => {
  // The bug report: "dashboard says I race well at 2am Mondays" — user races
  // at 6pm Pacific on Sundays. The UTC-bucketing code was reporting their
  // Sunday evening sessions as Monday 02:00-03:00 UTC. With the TZ-aware
  // helpers, the same timestamp should resolve back to Sunday 18:00 local.
  it('18:00 PT Sunday resolves to hour 18, Sunday', () => {
    // Sunday Mar 15 2026, 18:00 America/Los_Angeles (UTC-7 DST) = Monday 01:00 UTC
    const d = new Date('2026-03-16T01:00:00Z')
    expect(getHourInTz(d, 'America/Los_Angeles')).toBe(18)
    expect(getDayInTz(d, 'America/Los_Angeles')).toBe(0) // Sunday
  })
})
