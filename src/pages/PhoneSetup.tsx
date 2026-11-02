import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthProvider'
import { api, errorMessage } from '../lib/api'
import {
  confirmPhoneCode,
  isAlreadyLinked,
  isInfrastructureFailure,
  isValidPhone,
  normalisePhone,
  prettyPhone,
  startPhoneVerification,
  unlinkPhone,
} from '../lib/phone'
import { AlertBox, Badge, Button, Card, Field, Input } from '../components/ui'
import { BrandMark, Icon } from '../components/Icons'
import type { ConfirmationResult } from 'firebase/auth'

/**
 * First-run step: every account needs a phone number before the dashboard,
 * because SMS is the reminder channel. The number is proved with Firebase
 * Authentication's SMS check, then `syncPhone` copies the verified value onto
 * the profile.
 *
 * If the check cannot run at all (SMS quota exhausted, reCAPTCHA blocked), the
 * number is still stored - unverified - so the user is never locked out of
 * their own vault. The engine will not text an unverified number.
 */
export function PhoneSetupPage() {
  const { user, profile } = useAuth()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'number' | 'code'>('number')
  const [sending, setSending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const confirmation = useRef<ConfirmationResult | null>(null)

  useEffect(() => {
    if (profile?.phone && !phone) setPhone(prettyPhone(profile.phone))
  }, [profile?.phone, phone])

  async function sendCode() {
    if (!user) return
    setError(null)
    setNotice(null)
    if (!isValidPhone(phone)) {
      setError('Enter the number in full, including the country code.')
      return
    }
    setSending(true)
    try {
      if (user.phoneNumber) {
        // Already proved a different number on this account.
        await unlinkPhone(user)
      }
      confirmation.current = await startPhoneVerification(user, phone, 'recaptcha-container')
      setStage('code')
      setNotice(`A 6-digit code is on its way to ${prettyPhone(phone)}.`)
    } catch (err) {
      if (isAlreadyLinked(err)) {
        setError('This account already has a verified number. Send a code to replace it.')
      } else if (isInfrastructureFailure(err)) {
        // Do not trap the user behind a broken SMS pipeline.
        try {
          const saved = await api.savePhone(normalisePhone(phone))
          setNotice(
            `We could not send a code right now, so ${prettyPhone(saved.phone)} is saved unverified. You can verify it later in Settings.`,
          )
          setStage('number')
        } catch (saveErr) {
          setError(errorMessage(saveErr))
        }
      } else {
        setError(errorMessage(err))
      }
    } finally {
      setSending(false)
    }
  }

  async function confirm() {
    if (!confirmation.current) return
    setError(null)
    if (!/^\d{6}$/.test(code.trim())) {
      setError('The code is six digits.')
      return
    }
    setConfirming(true)
    try {
      await confirmPhoneCode(confirmation.current, code)
      await user?.getIdToken(true)
      await api.syncPhone()
      // The live profile snapshot flips phoneVerified, which unblocks the gate.
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setConfirming(false)
    }
  }

  async function skipVerification() {
    setError(null)
    try {
      const saved = await api.savePhone(normalisePhone(phone))
      setNotice(`${prettyPhone(saved.phone)} is saved. Verify it in Settings to switch SMS reminders on.`)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="auth" style={{ gridTemplateColumns: '1fr' }}>
      <div style={{ maxWidth: 560, width: '100%', margin: '0 auto', padding: '48px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <BrandMark size={38} />
          <div>
            <div style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>One last step</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              Signed in as {profile?.email || user?.email}
            </div>
          </div>
        </div>

        <Card>
          <div className="card-pad">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div className="stat-icon brand" style={{ flex: 'none' }}>
                <Icon name="phone" size={18} />
              </div>
              <h2 style={{ fontSize: 17, fontWeight: 720, letterSpacing: '-0.02em', margin: 0 }}>
                Where should reminders go?
              </h2>
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: '8px 0 18px' }}>
              MediVault texts you when a dose is due, stock is running out or a visit is coming up.
              We only use this number for those reminders.
            </p>

            {stage === 'number' ? (
              <>
                <Field
                  label="Mobile number"
                  htmlFor="onboarding-phone"
                  hint="India numbers can be typed as 98765 43210. We add the +91."
                >
                  <Input
                    id="onboarding-phone"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+91 98765 43210"
                  />
                </Field>
                <div id="recaptcha-container" />
                <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                  <Button icon="phone" onClick={sendCode} loading={sending}>
                    Send code
                  </Button>
                  <Button variant="ghost" onClick={skipVerification} disabled={!isValidPhone(phone)}>
                    Save without verifying
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Field label="6-digit code" htmlFor="onboarding-code" hint={`Sent to ${prettyPhone(phone)}.`}>
                  <Input
                    id="onboarding-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    style={{ letterSpacing: '0.4em', fontFamily: 'var(--mono)' }}
                  />
                </Field>
                <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                  <Button icon="check" onClick={confirm} loading={confirming}>
                    Verify and continue
                  </Button>
                  <Button variant="ghost" onClick={() => setStage('number')} disabled={confirming}>
                    Change number
                  </Button>
                </div>
              </>
            )}

            {error ? (
              <div style={{ marginTop: 14 }}>
                <AlertBox tone="error">{error}</AlertBox>
              </div>
            ) : null}
            {notice ? (
              <div style={{ marginTop: 14 }}>
                <AlertBox tone="info">{notice}</AlertBox>
              </div>
            ) : null}

            <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge tone={profile?.phoneVerified ? 'brand' : 'default'} dot>
                {profile?.phoneVerified ? 'Number verified' : 'Not verified yet'}
              </Badge>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                Unverified numbers receive no texts.
              </span>
            </div>

            {profile?.phone && !profile?.phoneVerified ? (
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 14, lineHeight: 1.6 }}>
                Already saved a number? Saving without verifying keeps you in the app, but no texts
                are sent until the code is confirmed. You can finish that in Settings.
              </p>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  )
}
