import { getMessaging, getToken, isSupported } from 'firebase/messaging'
import { VAPID_KEY, USE_EMULATORS } from './firebase'

export type PushResult =
  | { status: 'registered'; token: string; message: string }
  | { status: 'unsupported' | 'denied' | 'missing-key' | 'error'; message: string }

/**
 * Opts the browser into Firebase Cloud Messaging notifications.
 *
 * Requires a VAPID key (Firebase console -> Cloud Messaging -> Web Push
 * certificates) and a deployed Hosting site, because the service worker fetches
 * the Firebase config from Hosting's reserved `/__/firebase/init.js`.
 */
export async function enableWebPush(): Promise<PushResult> {
  if (USE_EMULATORS) {
    return {
      status: 'unsupported',
      message:
        'Web push is not available with local emulators. In-app alerts and the mail outbox work here; deploy to Hosting to demo real push notifications.',
    }
  }
  if (!VAPID_KEY) {
    return {
      status: 'missing-key',
      message:
        'Add VITE_FIREBASE_VAPID_KEY to your environment (Firebase console → Cloud Messaging → Web Push certificates), then rebuild.',
    }
  }
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) {
    return { status: 'unsupported', message: 'This browser does not support web push notifications.' }
  }

  try {
    const supported = await isSupported()
    if (!supported) {
      return { status: 'unsupported', message: 'Firebase Messaging is not supported in this browser.' }
    }

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return {
        status: 'denied',
        message: 'Notification permission was not granted. You can enable it in the browser site settings.',
      }
    }

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
    await navigator.serviceWorker.ready

    const token = await getToken(getMessaging(), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    })

    if (!token) {
      return { status: 'error', message: 'FCM did not return a token. Check the VAPID key configuration.' }
    }

    return { status: 'registered', token, message: 'Browser notifications are enabled on this device.' }
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Could not enable push notifications.',
    }
  }
}
