/**
 * Website (browser) alerts.
 *
 * Two independent channels put a reminder in front of the user while they are
 * on the site, and both work without any configuration:
 *
 *  1. In-app toast - driven by the live `reminders` subscription, so a sweep
 *     from Cloud Scheduler lights up the page within a second.
 *  2. Native desktop notification through the standard Web Notifications API
 *     (no FCM/VAPID key needed). This is what most people mean by "website
 *     alerts": the OS shows a pop-up even when the tab is in the background.
 *
 * Firebase Cloud Messaging stays the third channel - it is the only one that
 * can reach the device when the site is closed, and it needs the VAPID key.
 */

export type AlertPermission = 'unsupported' | 'default' | 'granted' | 'denied'

export function alertPermission(): AlertPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission as AlertPermission
}

/** Asks the browser for permission to show desktop notifications. */
export async function requestAlertPermission(): Promise<{
  permission: AlertPermission
  message: string
}> {
  if (alertPermission() === 'unsupported') {
    return { permission: 'unsupported', message: 'This browser cannot show desktop notifications.' }
  }
  if (Notification.permission === 'granted') {
    return { permission: 'granted', message: 'Website alerts are already on for this browser.' }
  }
  const permission = await Notification.requestPermission()
  if (permission === 'granted') {
    return { permission: 'granted', message: 'Website alerts enabled — you will see doses and refills as they fire.' }
  }
  return {
    permission: permission as AlertPermission,
    message: 'Permission was not granted. You can allow notifications from the site settings icon in the address bar.',
  }
}

/**
 * Shows a native notification. Returns false when the browser or the user's
 * permission settings do not allow it, so callers can fall back to the toast.
 */
export function showBrowserAlert(
  title: string,
  body: string,
  options: { tag?: string; onClick?: () => void } = {},
): boolean {
  if (alertPermission() !== 'granted') return false
  try {
    const notification = new Notification(title, {
      body,
      tag: options.tag,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
      options.onClick?.()
    }
    return true
  } catch {
    return false
  }
}

const SEEN_KEY = (uid: string) => `medivault:alerts:seen:${uid}`

export function readSeenAlerts(uid: string): string[] {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY(uid))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.slice(-120) : []
  } catch {
    return []
  }
}

export function writeSeenAlerts(uid: string, ids: Iterable<string>) {
  try {
    window.localStorage.setItem(SEEN_KEY(uid), JSON.stringify([...ids].slice(-120)))
  } catch {
    // Storage can be unavailable in private modes - notifications still work.
  }
}
