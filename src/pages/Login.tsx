import { useState, type FormEvent } from 'react'
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
  type User,
} from 'firebase/auth'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { auth, USE_EMULATORS, CLOUD_CONFIGURED } from '../lib/firebase'
import { api, errorMessage } from '../lib/api'
import { browserTimezone } from '../lib/format'
import { BrandMark, Icon } from '../components/Icons'
import { AlertBox, Button, Field, Input } from '../components/ui'

const DEMO_EMAIL = 'demo@medivault.app'
const DEMO_PASSWORD = 'medivault123'

export function LoginPage() {
  const { user, loading } = useAuth()
  const { toast } = useToast()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<'email' | 'google' | 'demo' | 'reset' | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!loading && user) return <Navigate to="/" replace />

  async function finishSignup(userRecord: User, displayName: string) {
    const trimmed = displayName.trim()
    if (trimmed) {
      await updateProfile(userRecord, { displayName: trimmed })
      await userRecord.getIdToken(true)
    }
    await api
      .ensureProfile({ timezone: browserTimezone(), displayName: trimmed || null })
      .catch(() => undefined)
  }

  async function onEmailSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    if (mode === 'signup' && password.length < 6) {
      setError('Use a password with at least 6 characters.')
      return
    }

    setBusy('email')
    try {
      if (mode === 'signup') {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
        await finishSignup(credential.user, name || email.split('@')[0])
        toast('Account created. Welcome to MediVault.', 'success')
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function onGoogle() {
    setError(null)
    setBusy('google')
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      await signInWithPopup(auth, provider)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function onDemo() {
    setError(null)
    setBusy('demo')
    try {
      let record: User
      try {
        const credential = await signInWithEmailAndPassword(auth, DEMO_EMAIL, DEMO_PASSWORD)
        record = credential.user
      } catch {
        const credential = await createUserWithEmailAndPassword(auth, DEMO_EMAIL, DEMO_PASSWORD)
        record = credential.user
        await finishSignup(record, 'Demo Patient')
      }
      await record.getIdToken(true)
      toast('Signed in as the demo patient. Seeding sample data…', 'success')

      // The profile is created by ensureUserProfile; give it a moment, then seed.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const result = await api.seedDemoData()
          if (result.seeded) toast('Sample medicines and appointments added.', 'success')
          return
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 700))
        }
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function onReset() {
    if (!email.trim()) {
      setError('Enter your email first, then request a reset link.')
      return
    }
    setError(null)
    setBusy('reset')
    try {
      await sendPasswordResetEmail(auth, email.trim())
      toast('Password reset email sent.', 'success')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
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

        <div>
          <span className="eyebrow" style={{ color: '#7ee0c8' }}>
            Google Cloud Platform · Serverless
          </span>
          <h1 style={{ marginTop: 10 }}>
            Never miss a dose, <em>refill</em> or appointment again.
          </h1>
          <p className="lead">
            A personal medication vault that schedules reminders, watches expiry dates and refill
            thresholds, stores prescriptions securely, and keeps a caregiver in the loop — built on
            Firebase and Google Cloud.
          </p>

          <div className="hero-points">
            <div className="hero-point">
              <span className="tile">
                <Icon name="clock" size={16} />
              </span>
              <div>
                <strong>Timezone-aware schedules</strong>
                <span>Doses trigger exactly when your local clock says so.</span>
              </div>
            </div>
            <div className="hero-point">
              <span className="tile">
                <Icon name="shield" size={16} />
              </span>
              <div>
                <strong>Private by design</strong>
                <span>Security rules scope every record and file to its owner.</span>
              </div>
            </div>
            <div className="hero-point">
              <span className="tile">
                <Icon name="cloud" size={16} />
              </span>
              <div>
                <strong>Serverless, always on</strong>
                <span>Cloud Scheduler wakes Cloud Functions every five minutes.</span>
              </div>
            </div>
          </div>
        </div>

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
          <h2>{mode === 'signin' ? 'Welcome back' : 'Create your vault'}</h2>
          <p className="sub">
            {mode === 'signin'
              ? 'Sign in to see today’s schedule, refills and alerts.'
              : 'One account keeps your medicines, prescriptions and reminders together.'}
          </p>

          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              data-active={mode === 'signin'}
              onClick={() => {
                setMode('signin')
                setError(null)
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              data-active={mode === 'signup'}
              onClick={() => {
                setMode('signup')
                setError(null)
              }}
            >
              Sign up
            </button>
          </div>

          {error ? (
            <div style={{ marginBottom: 14 }}>
              <AlertBox tone="error" icon="alert">
                {error}
              </AlertBox>
            </div>
          ) : null}

          <form onSubmit={onEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {mode === 'signup' ? (
              <Field label="Full name" htmlFor="name">
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Asha Menon"
                  autoComplete="name"
                />
              </Field>
            ) : null}

            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </Field>

            <Field
              label="Password"
              htmlFor="password"
              hint={mode === 'signup' ? 'At least 6 characters.' : undefined}
            >
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
              />
            </Field>

            <Button type="submit" size="lg" loading={busy === 'email'} block>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          {mode === 'signin' ? (
            <div style={{ textAlign: 'right', marginTop: 8 }}>
              <button type="button" className="btn-link" onClick={onReset} disabled={busy !== null}>
                {busy === 'reset' ? 'Sending…' : 'Forgot password?'}
              </button>
            </div>
          ) : null}

          <div className="divider">or</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Button variant="ghost" size="lg" onClick={onGoogle} loading={busy === 'google'} block>
              <Icon name="user" size={17} /> Continue with Google
            </Button>
            <Button variant="soft" size="lg" onClick={onDemo} loading={busy === 'demo'} block icon="sparkles">
              Explore with demo data
            </Button>
          </div>

          {USE_EMULATORS ? (
            <div className="demo-note">
              <strong>Emulator mode.</strong> Auth, Firestore, Storage and Functions run locally.
              Create any account you like — nothing leaves this machine. Demo login:{' '}
              <span className="mono">{DEMO_EMAIL}</span> / <span className="mono">{DEMO_PASSWORD}</span>
            </div>
          ) : !CLOUD_CONFIGURED ? (
            <div className="demo-note">
              No Firebase project configured yet. Add your keys to <span className="mono">.env.local</span>{' '}
              to point this app at Google Cloud.
            </div>
          ) : (
            <div className="demo-note">
              Your data is stored in your own Google Cloud project. Sign in with email/password or
              Google — both are handled by Firebase Authentication.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
