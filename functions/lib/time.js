'use strict'

/**
 * Timezone-aware helpers shared by the reminder engine.
 *
 * Medicines store their schedule as local wall-clock times ("08:00", "21:30")
 * and every user profile carries an IANA timezone. Cloud Scheduler fires in
 * UTC, so every sweep converts "now" into each user's local calendar before
 * deciding what is due. This keeps 08:00 doses at 08:00 for users in India,
 * the US and everywhere else.
 */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

function safeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return 'UTC'
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
    return timeZone
  } catch {
    return 'UTC'
  }
}

/** Wall-clock parts of `date` in `timeZone`. */
function zonedParts(date, timeZone) {
  const zone = safeZone(timeZone)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  })
  const parts = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  const hour = Number(parts.hour) % 24
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
    hour,
    minute: Number(parts.minute),
    zone,
  }
}

/** "08:30" -> 510. Returns null for malformed input. */
function parseHHMM(value) {
  if (typeof value !== 'string') return null
  const match = HHMM.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** 510 -> "08:30" */
function minutesToHHMM(minutes) {
  const m = ((Number(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Whole-day difference between two "YYYY-MM-DD" keys (b - a). */
function daysBetweenKeys(a, b) {
  const parse = (key) => {
    const [y, m, d] = key.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((parse(b) - parse(a)) / 86400000)
}

/** Human-readable time in a zone, e.g. "Sat, 01 Nov 2026, 08:00". */
function formatInZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeZone(timeZone),
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

module.exports = {
  safeZone,
  zonedParts,
  parseHHMM,
  minutesToHHMM,
  daysBetweenKeys,
  formatInZone,
}
