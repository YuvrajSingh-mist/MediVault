import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'
import type { CloudHealth, SweepSummary, UserProfile } from '../types'

/**
 * Thin, typed wrappers around the Cloud Functions callables.
 * Everything that needs to be trusted (stock counts, caregiver links, email
 * delivery, sweep throttling) is implemented server-side.
 */

async function call<TResult>(name: string, data: Record<string, unknown> = {}): Promise<TResult> {
  const fn = httpsCallable<Record<string, unknown>, TResult>(functions, name)
  const result = await fn(data)
  return result.data
}

export interface LogDoseResult {
  status: 'taken' | 'skipped' | 'pending'
  remainingTablets: number
  role: 'owner' | 'caregiver'
}

export interface RedeemResult {
  ownerId: string
  ownerName: string
  ownerEmail: string
}

export interface SeedResult {
  seeded: boolean
  reason?: string
  medicines?: number
  appointments?: number
  hint?: string
}

export const api = {
  ensureProfile: (data: { timezone?: string; displayName?: string | null }) =>
    call<{ created: boolean; profile: UserProfile }>('ensureUserProfile', data),

  logDose: (data: { medicineId: string; dateKey: string; time: string; action: 'take' | 'skip' | 'undo' }) =>
    call<LogDoseResult>('logDose', data),

  runSweepNow: () => call<SweepSummary>('runReminderSweepNow'),

  seedDemoData: () => call<SeedResult>('seedDemoData'),

  generateCaregiverCode: () => call<{ code: string }>('generateCaregiverCode'),

  redeemCaregiverCode: (code: string) => call<RedeemResult>('redeemCaregiverCode', { code }),

  removeCaregiver: (caregiverUid: string) => call<{ removed: boolean }>('removeCaregiver', { caregiverUid }),

  leaveCaregiver: (ownerUid: string) => call<{ left: boolean }>('leaveCaregiver', { ownerUid }),

  registerFcmToken: (token: string, remove = false) =>
    call<{ registered: boolean }>('registerFcmToken', { token, remove }),

  sendTestEmail: () => call<{ status: string; provider: string }>('sendTestEmail'),

  deletePrescription: (prescriptionId: string) =>
    call<{ deleted: boolean }>('deletePrescription', { prescriptionId }),

  cloudHealth: () => call<CloudHealth>('cloudHealth'),
}

/** Turns Firebase / callable errors into something a user can act on. */
export function errorMessage(error: unknown): string {
  if (!error) return 'Something went wrong. Please try again.'
  const err = error as { code?: string; message?: string; name?: string }
  const code = err.code || ''
  const raw = err.message || ''

  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'That email and password combination does not match an account.'
  }
  if (code === 'auth/email-already-in-use') return 'An account with this email already exists. Try signing in.'
  if (code === 'auth/weak-password') return 'Use a password with at least 6 characters.'
  if (code === 'auth/invalid-email') return 'Please enter a valid email address.'
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait a minute and try again.'
  if (code === 'auth/popup-closed-by-user') return 'Google sign-in was cancelled.'
  if (code === 'auth/popup-blocked') return 'Your browser blocked the pop-up. Allow pop-ups for this site and retry.'
  if (code === 'auth/operation-not-allowed') {
    return 'This sign-in method is not enabled in Firebase Authentication yet.'
  }
  if (code === 'auth/network-request-failed') {
    return 'Cannot reach Firebase Authentication. If you are using the emulators, start them with "npm run emulators".'
  }
  if (code === 'functions/unavailable' || code === 'functions/internal') {
    return 'Cloud Functions could not be reached. Start the emulators ("npm run emulators") or check that the functions are deployed.'
  }
  if (code === 'functions/not-found') {
    return 'That function is not deployed. Run "npm run deploy:functions".'
  }

  // Callables return the server-side HttpsError message here.
  const cleaned = raw
    .replace(/^Firebase:\s*/i, '')
    .replace(/^functions\/[a-z-]+:\s*/i, '')
    .replace(/^internal:\s*/i, '')
    .trim()

  if (cleaned) return cleaned
  return 'Something went wrong. Please try again.'
}
