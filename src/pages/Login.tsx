import { useEffect, useState } from 'react'
import {
  getRedirectResult,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
} from 'firebase/auth'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { auth, USE_EMULATORS, CLOUD_CONFIGURED } from '../lib/firebase'
import { errorMessage } from '../lib/api'
import { BrandMark, GoogleMark, Icon } from '../components/Icons'
import { AlertBox } from '../components/ui'

/**
 * MediVault sign-in.
 *
 * Google is the only identity provider. Google supplies exactly two pieces of
 * information - the account holder's name and email address - and Firebase
 * Authentication turns that into an ID token. There is no password form, no
 * sign-up form and no password reset: creating a MediVault account *is* the
 * first Google sign-in, and the profile document is provisioned server-side by
 * the `ensureUserProfile` Cloud Function.
 */

/** Firebase error codes where a redirect flow is the right recovery. */
const REDIRECT_FALLBACK = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/cancelled-popup-request',
])

export function LoginPage() {
  const { user, loading } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // If the popup could not open and we fell back to a full-page redirect, the
  // result (or the failure) is delivered here when the browser comes back.
  useEffect(() => {
    let cancelled = false
    getRedirectResult(auth)
      .then((credential) => {
        if (!cancelled && credential?.user) setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!loading && user) return <Navigate to="/" replace />

  async function onGoogle() {
    setError(null)
    setBusy(true)
    const provider = new GoogleAuthProvider()
    // Only what MediVault needs: the account holder's name and email address.
    provider.addScope('profile')
    provider.addScope('email')
    provider.setCustomParameters({ prompt: 'select_account' })

    try {
      await signInWithPopup(auth, provider)
    } catch (err) {
      const code = String((err as { code?: string })?.code || '')
      if (REDIRECT_FALLBACK.has(code)) {
        // Popups are blocked in this browser/environment - use a redirect.
        try {
          await signInWithRedirect(auth, provider)
          return
        } catch (redirectErr) {
          setError(errorMessage(redirectErr))
        }
      } else {
        setError(errorMessage(err))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <section className="auth-hero">
        <div className="brand">
          <BrandMark size={38} />
          <span className="brand-text">
            <span className="brand-name">MediVault</span>
            <span className="brand-sub">Cloud health reminders</span>
          </span>
        </div>

        <h1>
          Never miss a dose, <em>refill</em> or appointment.
        </h1>

        <div className="hero-stack">
          <span className="stack-chip">Firebase Hosting</span>
          <span className="stack-chip">Authentication</span>
          <span className="stack-chip">Firestore</span>
          <span className="stack-chip">Cloud Storage</span>
          <span className="stack-chip">Cloud Functions</span>
          <span className="stack-chip">Cloud Scheduler</span>
          <span className="stack-chip">FCM</span>
          <span className="stack-chip">Cloud Logging</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <h2>Sign in to MediVault</h2>

          {error ? (
            <div style={{ marginBottom: 14 }}>
              <AlertBox tone="error" icon="alert">
                {error}
              </AlertBox>
            </div>
          ) : null}

          <button type="button" className="google-btn" onClick={onGoogle} disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <GoogleMark size={18} />}
            <span>{busy ? 'Opening Google…' : 'Continue with Google'}</span>
          </button>

          <p className="auth-scope-line">
            <Icon name="shield" size={14} />
            <span>Uses your Google name and email. No password.</span>
          </p>

          {USE_EMULATORS ? (
            <div className="demo-note">Emulator mode. Nothing leaves this machine.</div>
          ) : !CLOUD_CONFIGURED ? (
            <div className="demo-note">
              No Firebase keys in <span className="mono">.env.local</span>.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
