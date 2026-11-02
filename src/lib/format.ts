import type { Timestamp } from 'firebase/firestore'
import type { DoseLog, DoseSlot, Medicine } from '../types'

export const DAY_MS = 86_400_000

export type DateLike = Timestamp | Date | string | number | null | undefined

export function toDate(value: DateLike): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate()
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function safeZone(timeZone?: string): string {
  if (!timeZone) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
    return timeZone
  } catch {
    return 'UTC'
  }
}

/** "YYYY-MM-DD" in the given timezone. */
export function dateKey(date: DateLike, timeZone?: string): string {
  const value = toDate(date) || new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function todayKey(timeZone?: string): string {
  return dateKey(new Date(), timeZone)
}

/** Minutes since local midnight in a timezone. */
export function minutesNow(timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0)
  return (get('hour') % 24) * 60 + get('minute')
}

export function parseTime(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || '')
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** "08:30" -> "8:30 am" */
export function timeLabel(value: string): string {
  const minutes = parseTime(value)
  if (minutes === null) return value
  const hour24 = Math.floor(minutes / 60)
  const minute = minutes % 60
  const suffix = hour24 >= 12 ? 'pm' : 'am'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`
}

export function formatDate(value: DateLike, timeZone?: string): string {
  const date = toDate(value)
  if (!date) return '-'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeZone(timeZone),
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

export function formatDateTime(value: DateLike, timeZone?: string): string {
  const date = toDate(value)
  if (!date) return '-'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeZone(timeZone),
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

export function formatTime(value: DateLike, timeZone?: string): string {
  const date = toDate(value)
  if (!date) return '-'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

export function formatDayMonth(value: DateLike, timeZone?: string): { day: string; month: string } {
  const date = toDate(value)
  if (!date) return { day: '--', month: '---' }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeZone(timeZone),
    day: '2-digit',
    month: 'short',
  }).formatToParts(date)
  return {
    day: parts.find((part) => part.type === 'day')?.value || '--',
    month: (parts.find((part) => part.type === 'month')?.value || '---').toUpperCase(),
  }
}

export function longDate(value: DateLike = new Date(), timeZone?: string): string {
  const date = toDate(value) || new Date()
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeZone(timeZone),
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** Whole days from `from` to `target` (positive = in the future). */
export function daysUntil(target: DateLike, timeZone?: string, from: Date = new Date()): number | null {
  const date = toDate(target)
  if (!date) return null
  const a = dateKey(from, timeZone)
  const b = dateKey(date, timeZone)
  const parse = (key: string) => {
    const [y, m, d] = key.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((parse(b) - parse(a)) / DAY_MS)
}

export function relativeTime(value: DateLike): string {
  const date = toDate(value)
  if (!date) return '-'
  const diffMs = date.getTime() - Date.now()
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const table: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000_000],
    ['month', 2_592_000_000],
    ['week', 604_800_000],
    ['day', DAY_MS],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ]
  for (const [unit, size] of table) {
    if (Math.abs(diffMs) >= size) return formatter.format(Math.round(diffMs / size), unit)
  }
  return 'just now'
}

export function bytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 KB'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function initials(name?: string, email?: string): string {
  const source = (name || email || 'MediVault').trim()
  const words = source.split(/[\s._-]+/).filter(Boolean)
  if (words.length === 0) return 'MV'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

export function greeting(date = new Date()): string {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function toDateInputValue(value: DateLike): string {
  const date = toDate(value)
  if (!date) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function fromDateInputValue(value: string): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

export function toDateInputTime(value: DateLike): string {
  const date = toDate(value)
  if (!date) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function isLowStock(medicine: Medicine): boolean {
  return Number(medicine.remainingTablets) <= Number(medicine.refillThreshold)
}

export function stockPercent(medicine: Medicine): number {
  const total = Number(medicine.totalTablets) || 0
  const remaining = Number(medicine.remainingTablets) || 0
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((remaining / total) * 100)))
}

export function expiryState(medicine: Medicine, timeZone?: string): {
  days: number | null
  tone: 'ok' | 'warn' | 'expired'
  label: string
} {
  const days = daysUntil(medicine.expiryDate, timeZone)
  if (days === null) return { days: null, tone: 'ok', label: 'No expiry set' }
  if (days < 0) return { days, tone: 'expired', label: `Expired ${Math.abs(days)}d ago` }
  if (days <= 30) return { days, tone: 'warn', label: days === 0 ? 'Expires today' : `Expires in ${days}d` }
  return { days, tone: 'ok', label: `Expires ${formatDate(medicine.expiryDate, timeZone)}` }
}

/** Merges medicine schedules with today's dose logs into a sorted plan. */
export function buildDosePlan(
  medicines: Medicine[],
  logs: DoseLog[],
  day: string,
): DoseSlot[] {
  const logMap = new Map(logs.map((log) => [`${log.medicineId}_${log.time}`, log]))
  const slots: DoseSlot[] = []
  for (const medicine of medicines) {
    if (medicine.active === false) continue
    for (const time of medicine.times || []) {
      if (parseTime(time) === null) continue
      const log = logMap.get(`${medicine.id}_${time}`)
      slots.push({
        key: `${medicine.id}_${time}`,
        medicineId: medicine.id,
        medicineName: medicine.name,
        dosage: medicine.dosage || '',
        form: medicine.form || '',
        time,
        status: log ? (log.status === 'taken' ? 'taken' : 'skipped') : 'pending',
        lowStock: isLowStock(medicine),
      })
    }
  }
  void day
  return slots.sort((a, b) => (parseTime(a.time) || 0) - (parseTime(b.time) || 0))
}

export function countLowStock(medicines: Medicine[]): number {
  return medicines.filter((medicine) => medicine.active !== false && isLowStock(medicine)).length
}

export function countExpiring(medicines: Medicine[], timeZone?: string, withinDays = 30): number {
  return medicines.filter((medicine) => {
    if (medicine.active === false) return false
    const days = daysUntil(medicine.expiryDate, timeZone)
    return days !== null && days <= withinDays
  }).length
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : plural || `${singular}s`}`
}
