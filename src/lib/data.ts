import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { db } from './firebase'
import type {
  Appointment,
  DoseLog,
  MailOutboxItem,
  Medicine,
  PatientOption,
  Prescription,
  Reminder,
  SystemStatus,
} from '../types'

/**
 * Live Firestore subscriptions. Every hook returns `null` while the first
 * snapshot is in flight (pages render skeletons), then keeps itself in sync.
 * Security rules mean these queries only ever expose the signed-in user's own
 * records - or a patient they care for.
 */

function mapDocs<T>(docs: Array<{ id: string; data: () => unknown }>): T[] {
  return docs.map((item) => ({ ...(item.data() as object), id: item.id }) as T)
}

export function useMedicines(userId?: string) {
  const [items, setItems] = useState<Medicine[] | null>(null)
  useEffect(() => {
    if (!userId) {
      setItems(null)
      return
    }
    setItems(null)
    const q = query(
      collection(db, 'medicines'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
    )
    return onSnapshot(
      q,
      (snap) => setItems(mapDocs<Medicine>(snap.docs)),
      (err) => {
        console.warn('medicines subscription failed', err.message)
        setItems([])
      },
    )
  }, [userId])
  return items
}

export function useAppointments(userId?: string) {
  const [items, setItems] = useState<Appointment[] | null>(null)
  useEffect(() => {
    if (!userId) {
      setItems(null)
      return
    }
    setItems(null)
    const q = query(
      collection(db, 'appointments'),
      where('userId', '==', userId),
      orderBy('date', 'asc'),
    )
    return onSnapshot(
      q,
      (snap) => setItems(mapDocs<Appointment>(snap.docs)),
      (err) => {
        console.warn('appointments subscription failed', err.message)
        setItems([])
      },
    )
  }, [userId])
  return items
}

export function usePrescriptions(userId?: string) {
  const [items, setItems] = useState<Prescription[] | null>(null)
  useEffect(() => {
    if (!userId) {
      setItems(null)
      return
    }
    setItems(null)
    const q = query(
      collection(db, 'prescriptions'),
      where('userId', '==', userId),
      orderBy('uploadedAt', 'desc'),
    )
    return onSnapshot(
      q,
      (snap) => setItems(mapDocs<Prescription>(snap.docs)),
      (err) => {
        console.warn('prescriptions subscription failed', err.message)
        setItems([])
      },
    )
  }, [userId])
  return items
}

export function useReminders(userId?: string, max = 60) {
  const [items, setItems] = useState<Reminder[] | null>(null)
  useEffect(() => {
    if (!userId) {
      setItems(null)
      return
    }
    setItems(null)
    const q = query(
      collection(db, 'reminders'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(max),
    )
    return onSnapshot(
      q,
      (snap) => setItems(mapDocs<Reminder>(snap.docs)),
      (err) => {
        console.warn('reminders subscription failed', err.message)
        setItems([])
      },
    )
  }, [userId, max])
  return items
}

export function useDoseLogs(userId: string | undefined, day: string) {
  const [items, setItems] = useState<DoseLog[] | null>(null)
  useEffect(() => {
    if (!userId) {
      setItems(null)
      return
    }
    setItems(null)
    const q = query(
      collection(db, 'doseLogs'),
      where('userId', '==', userId),
      where('dateKey', '==', day),
    )
    return onSnapshot(
      q,
      (snap) => setItems(mapDocs<DoseLog>(snap.docs)),
      (err) => {
        console.warn('doseLogs subscription failed', err.message)
        setItems([])
      },
    )
  }, [userId, day])
  return items
}

export function useSystemStatus() {
  const [status, setStatus] = useState<SystemStatus | null>(null)
  useEffect(() => {
    return onSnapshot(
      doc(db, 'system', 'status'),
      (snap) => setStatus(snap.exists() ? ({ ...snap.data(), id: snap.id } as SystemStatus) : null),
      () => setStatus(null),
    )
  }, [])
  return status
}

export function useMailOutbox(uid?: string, max = 8) {
  const [items, setItems] = useState<MailOutboxItem[] | null>(null)
  useEffect(() => {
    if (!uid) {
      setItems(null)
      return
    }
    const q = query(
      collection(db, 'mailOutbox'),
      where('toUid', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(max),
    )
    return onSnapshot(
      q,
      (snap) => setItems(mapDocs<MailOutboxItem>(snap.docs)),
      (err) => {
        console.warn('mailOutbox subscription failed', err.message)
        setItems([])
      },
    )
  }, [uid, max])
  return items
}

/** Loads user profiles by id (used for patients / caregivers lists). */
export function useProfiles(uids: string[]) {
  const key = uids.join(',')
  const [profiles, setProfiles] = useState<PatientOption[]>([])
  useEffect(() => {
    let cancelled = false
    if (!key) {
      setProfiles([])
      return
    }
    Promise.all(
      key.split(',').map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, 'users', uid))
          if (!snap.exists()) return null
          return {
            uid,
            name: (snap.get('displayName') as string) || 'Unknown',
            email: (snap.get('email') as string) || '',
          } satisfies PatientOption
        } catch {
          return null
        }
      }),
    ).then((rows) => {
      if (!cancelled) setProfiles(rows.filter((row): row is PatientOption => Boolean(row)))
    })
    return () => {
      cancelled = true
    }
  }, [key])
  return profiles
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
