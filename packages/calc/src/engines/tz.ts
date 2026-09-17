/**
 * Timezone helpers used by calc modules. Mirrors the relevant subset of
 * apps/web/src/lib/tz.ts. Deliberately a copy — web-api doesn't share a
 * runtime with web, and the tz file in web pulls in cookie utilities that
 * have no business inside the calc layer.
 */

export const DEFAULT_TZ = 'UTC'

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== 'string') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const hourFormatterCache = new Map<string, Intl.DateTimeFormat>()
function hourFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = hourFormatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' })
    hourFormatterCache.set(timeZone, f)
  }
  return f
}

const weekdayFormatterCache = new Map<string, Intl.DateTimeFormat>()
function weekdayFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = weekdayFormatterCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
    weekdayFormatterCache.set(timeZone, f)
  }
  return f
}

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

export function getHourInTz(date: Date, timeZone: string): number {
  if (!isValidTimeZone(timeZone)) return date.getUTCHours()
  const parts = hourFormatter(timeZone).formatToParts(date)
  const hourPart = parts.find(p => p.type === 'hour')
  if (!hourPart) return date.getUTCHours()
  const h = parseInt(hourPart.value, 10)
  return Number.isNaN(h) ? date.getUTCHours() : h
}

export function getDayInTz(date: Date, timeZone: string): number {
  if (!isValidTimeZone(timeZone)) return date.getUTCDay()
  const parts = weekdayFormatter(timeZone).formatToParts(date)
  const weekdayPart = parts.find(p => p.type === 'weekday')
  if (!weekdayPart) return date.getUTCDay()
  const idx = WEEKDAY_TO_INDEX[weekdayPart.value]
  return idx === undefined ? date.getUTCDay() : idx
}
