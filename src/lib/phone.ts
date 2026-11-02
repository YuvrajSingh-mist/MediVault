import {
  RecaptchaVerifier,
  linkWithPhoneNumber,
  unlink,
  type ConfirmationResult,
  type User,
} from 'firebase/auth'
import { USE_EMULATORS, auth } from './firebase'

/**
 * Phone helpers.
 *
 * The number is verified with Firebase Authentication's SMS check rather than a
 * home-grown OTP: Google sends the code, the verified number lands in the user's
 * ID token, and the `syncPhone` Cloud Function copies it onto the profile. That
 * keeps the app from texting numbers it has not proved.
 *
 * Normalisation is duplicated from functions/lib/sms.js on purpose - the browser
 * needs instant feedback while typing, without a round trip.
 */

export function normalisePhone(raw: string): string {
  const value = String(raw || '').trim()
  if (!value) return ''
  const digits = value.replace(/[^\d+]/g, '')
  if (!/\d/.test(digits)) return ''
  if (digits.startsWith('+')) return `+${digits.slice(1).replace(/\D/g, '')}`
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  return `+${digits.replace(/\D/g, '')}`
}

export function isValidPhone(raw: string): boolean {
  return /^\+\d{8,15}$/.test(normalisePhone(raw))
}

/** "+919876543210" -> "+91 98765 43210" for display only. */
export function prettyPhone(raw: string): string {
  const e164 = normalisePhone(raw)
  if (/^\+91\d{10}$/.test(e164)) {
    return `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`
  }
  return e164
}

/**
 * Fires the SMS. The caller must render `<div id={containerId}>` first, because
 * reCAPTCHA attaches to a real element.
 */
export async function startPhoneVerification(
  user: User,
  rawPhone: string,
  containerId: string,
): Promise<ConfirmationResult> {
  if (!isValidPhone(rawPhone)) {
    throw Object.assign(new Error('Enter a phone number with its country code.'), {
      code: 'app/invalid-phone',
    })
  }
  // The emulator has no reCAPTCHA site to talk to, so let the SDK skip it and
  // accept the number directly (the code appears in the Auth emulator log).
  if (USE_EMULATORS) auth.settings.appVerificationDisabledForTesting = true
  const verifier = new RecaptchaVerifier(auth, containerId, { size: 'invisible' })
  try {
    return await linkWithPhoneNumber(user, normalisePhone(rawPhone), verifier)
  } catch (err) {
    verifier.clear()
    throw err
  }
}

export async function confirmPhoneCode(result: ConfirmationResult, code: string) {
  return result.confirm(String(code || '').trim())
}

/** Unlinks the current number so a different one can be verified. */
export async function unlinkPhone(user: User) {
  return unlink(user, 'phone')
}

export function isAlreadyLinked(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '')
  return code === 'auth/provider-already-linked' || code === 'auth/credential-already-in-use'
}

/**
 * True when the failure is about the environment (quota, blocked reCAPTCHA,
 * network) rather than the user typing the wrong code. Those cases let the
 * onboarding step store the number as unverified instead of trapping the user.
 */
export function isInfrastructureFailure(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '')
  return (
    code === 'auth/quota-exceeded' ||
    code === 'auth/captcha-check-failed' ||
    code === 'auth/network-request-failed' ||
    code === 'auth/internal-error' ||
    code === 'auth/operation-not-allowed' ||
    code === 'auth/unauthorized-domain' ||
    code === 'auth/too-many-requests'
  )
}
