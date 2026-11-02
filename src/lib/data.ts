import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type Query,
} from 'firebase/firestore'
import { db } from './firebase'
import type {
  Appointment,
  DoseLog,
  MailOutboxItem,
  Medicine,
  Reminder,
  SystemStatus,
} from '../types'

/**
 * Live Firestore subscriptions. Every hook returns `null` while the first
 * snapshot is in flight (pages render skeletons), then keeps itself in sync.
 * Security rules mean these queries only ever expose the signed-in user's own
 * records.
 */

function mapDocs<T>(docs: Array<{ id: string; data: () => unknown }>): T[] {
  return docs.map((item) => ({ ...(item.data() as object), id: item.id }) as T)
}

/* -------------------------------------------------------------------------- */
/* Refresh bus                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A Firestore observer is closed permanently as soon as it reports an error -
 * the SDK does not re-open it. On a flaky network (or after a function writes a
 * burst of documents) that left a page frozen on stale data until the user
 * reloaded the whole app, which is exactly the "I had to refresh" symptom.
 *
 * `subscribeLive` re-opens the listener with backoff, and `refreshData()` lets
 * any code that just mutated data ask every live query to re-read immediately
 * instead of waiting for the next snapshot.
 */
let dataVersion = 0
const versionListeners = new Set<() => void>()

function subscribeToVersion(listener: () => void) {
  versionListeners.add(listener)
  return () => {
    versionListeners.delete(listener)
  }
}

/** Call after a mutation so every live list re-reads its data right away. */
export function refreshData() {
  dataVersion += 1
  versionListeners.forEach((listener) => listener())
}

function useDataVersion(): number {
  return useSyncExternalStore(
    subscribeToVersion,
    () => dataVersion,
    () => dataVersion,
  )
}

/** Live query with automatic reconnection. */
function subscribeLive<T>(
  build: () => Query<DocumentData>,
  onData: (items: T[]) => void,
  label: string,
) {
  let closed = false
  let unsubscribe: (() => void) | null = null
  let timer: number | null = null
  let attempt = 0

  const start = () => {
    if (closed) return
    unsubscribe = onSnapshot(
      build(),
      (snap) => {
        attempt = 0
        onData(mapDocs<T>(snap.docs))
      },
      (err) => {
        console.warn(`${label} subscription lost, reconnecting…`, err.message)
        unsubscribe?.()
        unsubscribe = null
        const delay = Math.min(15_000, 600 * 2 ** attempt)
        attempt += 1
        timer = window.setTimeout(start, delay)
      },
    )
  }

  start()

  return () => {
    closed = true
    if (timer !== null) window.clearTimeout(timer)
    unsubscribe?.()
  }
}

/**
 * Resets a list to its loading state only when the target user changes, so a
 * `refreshData()` (after seeding, for example) swaps in fresh data without
 * flashing skeletons. Call from inside the subscription effect.
 */
function useDidTargetChange() {
  const keyRef = useRef<string | undefined>(undefined)
  return (key: string) => {
    const changed = keyRef.current !== key
    keyRef.current = key
    return changed
  }
}

/* -------------------------------------------------------------------------- */
/* Collections                                                                */
/* -------------------------------------------------------------------------- */

export function useMedicines(userId?: string) {
  const [items, setItems] = useState<Medicine[] | null>(null)
  const version = useDataVersion()
  const didTargetChange = useDidTargetChange()

  useEffect(() => {
    if (!userId) {
      setItems(null)
      return
    }
    if (didTargetChange(userId)) setItems(null)
    return subscribeLive<Medicine>(
      () =>
        query(
          collection(db, 'medicines'),
          where('userId', '==', userId),
          orderBy('createdAt', 'desc'),
        ),
      setItems,
      'medicines',
    )
  }, [userId, version])

  return items
}

export function useAppointments(userId?: string) {
  const [items, setItems] = useState<Appointment[] | null>(null)
  const version = useDataVersion()
  const didTargetChange = useDidTargetChange()

  useEffect(() => {
    if (!userId) {
      setItems(null)
      return
    }
    if (didTargetChange(userId)) setItems(null)
    return subscribeLive<Appointment>(
      () =>
        query(
          collection(db, 'appointments'),
          where('userId', '==', userId),
          orderBy('date', 'asc'),
        ),
      setItems,
      'appointments',
    )
  }, [userId, version])

  return items
}

export function useReminders(userId?: string, max = 60) {
  const [items, setItems] = useState<Reminder[] | null>(null)
  const version = useDataVersion()
  const didTargetChange = useDidTargetChange()

  useEffect(() => {
    if (!userId) {
      setItems(null)
      return
    }
    if (didTargetChange(userId)) setItems(null)
    return subscribeLive<Reminder>(
      () =>
        query(
          collection(db, 'reminders'),
          where('userId', '==', userId),
          orderBy('createdAt', 'desc'),
          limit(max),
        ),
      setItems,
      'reminders',
    )
  }, [userId, max, version])

  return items
}

export function useDoseLogs(userId: string | undefined, day: string) {
  const [items, setItems] = useState<DoseLog[] | null>(null)
  const version = useDataVersion()
  const didTargetChange = useDidTargetChange()

  useEffect(() => {
    if (!userId) {
      setItems(null)
      return
    }
    if (didTargetChange(`${userId}:${day}`)) setItems(null)
    return subscribeLive<DoseLog>(
      () =>
        query(
          collection(db, 'doseLogs'),
          where('userId', '==', userId),
          where('dateKey', '==', day),
        ),
      setItems,
      'doseLogs',
    )
  }, [userId, day, version])

  return items
}

export function useSystemStatus() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const version = useDataVersion()

  useEffect(() => {
    return onSnapshot(
      doc(db, 'system', 'status'),
      (snap) => setStatus(snap.exists() ? ({ ...snap.data(), id: snap.id } as SystemStatus) : null),
      () => setStatus(null),
    )
  }, [version])

  return status
}

export function useMailOutbox(uid?: string, max = 8) {
  const [items, setItems] = useState<MailOutboxItem[] | null>(null)
  const version = useDataVersion()
  const didTargetChange = useDidTargetChange()

  useEffect(() => {
    if (!uid) {
      setItems(null)
      return
    }
    if (didTargetChange(uid)) setItems(null)
    return subscribeLive<MailOutboxItem>(
      () =>
        query(
          collection(db, 'mailOutbox'),
          where('toUid', '==', uid),
          orderBy('createdAt', 'desc'),
          limit(max),
        ),
      setItems,
      'mailOutbox',
    )
  }, [uid, max, version])

  return items
}

/** Re-renders on an interval so "today", clocks and relative times stay fresh. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

export function useUnreadCount(reminders: Reminder[] | null): number {
  return useMemo(() => (reminders || []).filter((item) => !item.read).length, [reminders])
}
