import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { useReminders } from '../lib/data'
import {
  readSeenAlerts,
  showBrowserAlert,
  writeSeenAlerts,
} from '../lib/alerts'
import type { Reminder } from '../types'

/**
 * Turns the live `reminders` subscription into website alerts.
 *
 * The very first snapshot only *learns* which alert ids already exist - it never
 * notifies, otherwise opening the app would replay yesterday's doses. Every
 * alert that appears afterwards (from Cloud Scheduler or a manual sweep) is
 * pushed to the in-app toast stack, and to the OS as a native notification when
 * the tab is not in focus and permission was granted.
 *
 * Rendered once, inside the router, by the app shell.
 */
const SKIPPED_TYPES = new Set(['digest'])

export function LiveAlerts() {
  const { activeUserId } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const reminders = useReminders(activeUserId, 30)

  const seenRef = useRef<Set<string>>(new Set())
  const primedRef = useRef(false)
  const targetRef = useRef('')

  useEffect(() => {
    if (!reminders) return

    const uid = activeUserId || 'guest'
    if (targetRef.current !== uid) {
      targetRef.current = uid
      primedRef.current = false
      seenRef.current = new Set(readSeenAlerts(uid))
    }

    if (!primedRef.current) {
      // Prime with what already exists, mirroring the newest 120 ids to storage.
      reminders.forEach((item) => seenRef.current.add(item.id))
      primedRef.current = true
      writeSeenAlerts(uid, seenRef.current)
      return
    }

    const fresh = reminders.filter((item) => !seenRef.current.has(item.id) && !item.read)
    if (fresh.length === 0) return

    const notify = (item: Reminder) => {
      if (SKIPPED_TYPES.has(item.type)) return
      toast(item.title, item.type === 'dose' ? 'success' : 'default')

      // Native notification is only worth it when the tab is in the background;
      // otherwise it duplicates the toast.
      const backgrounded = typeof document !== 'undefined' && document.hidden
      if (!backgrounded) return
      showBrowserAlert(item.title, item.body, {
        tag: item.id,
        onClick: () => navigate('/alerts'),
      })
    }

    fresh.slice(0, 3).forEach((item) => {
      seenRef.current.add(item.id)
      notify(item)
    })
    if (fresh.length > 3) {
      toast(`${fresh.length - 3} more alerts arrived. Open Alerts to see them.`, 'default')
    }
    writeSeenAlerts(uid, seenRef.current)
  }, [reminders, activeUserId, toast, navigate])

  return null
}
