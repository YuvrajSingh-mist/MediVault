import { useEffect, useRef, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import type { ConfirmationResult } from 'firebase/auth'
import { db, PROJECT_ID, USE_EMULATORS } from '../lib/firebase'
import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { api, errorMessage } from '../lib/api'
import { enableWebPush } from '../lib/notifications'
import {
  confirmPhoneCode,
  isValidPhone,
  prettyPhone,
  startPhoneVerification,
  unlinkPhone,
} from '../lib/phone'
import {
  alertPermission,
  requestAlertPermission,
  showBrowserAlert,
  type AlertPermission,
} from '../lib/alerts'
import { formatDate } from '../lib/format'
import type { NotificationPrefs } from '../types'
import {
  AlertBox,
  Avatar,
  Badge,
  Button,
  Card,
  CardHead,
  Field,
  Input,
  PageHeader,
  Select,
  Toggle,
} from '../components/ui'

const TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Dhaka',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Jakarta',
  'Africa/Nairobi',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
]

const PREF_LABELS: Array<{ key: keyof NotificationPrefs; label: string; description: string }> = [
  {
    key: 'sms',
    label: 'SMS reminders',
    description: 'One short text per sweep, sent to your verified number. Delivered by Twilio, or recorded in the SMS outbox when no credentials are set.',
  },
  {
    key: 'push',
    label: 'Browser & mobile push',
    description: 'Firebase Cloud Messaging notifications to every device you register.',
  },
  {
    key: 'dose',
    label: 'Dose reminders',
    description: 'A nudge at each scheduled medicine time in your local timezone.',
  },
  {
    key: 'lowStock',
    label: 'Low stock alerts',
    description: 'When a medicine reaches its refill threshold, once per day until replenished.',
  },
  {
    key: 'expiry',
    label: 'Expiry reminders',
    description: 'At 30, 14, 7, 3, 1 and 0 days before a medicine expires.',
  },
  {
    key: 'appointments',
    label: 'Appointment reminders',
    description: 'A reminder 24 hours before each doctor visit.',
  },
]

export function SettingsPage() {
  const { user, profile, signOutUser } = useAuth()
  const { toast } = useToast()
  const [displayName, setDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushMessage, setPushMessage] = useState<string | null>(null)
  const [alertState, setAlertState] = useState<AlertPermission>(() => alertPermission())
  const [alertBusy, setAlertBusy] = useState(false)
  const [smsBusy, setSmsBusy] = useState(false)

  // Mobile number verification
  const [phoneInput, setPhoneInput] = useState('')
  const [phoneCode, setPhoneCode] = useState('')
  const [phoneStage, setPhoneStage] = useState<'idle' | 'code'>('idle')
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const phoneConfirmation = useRef<ConfirmationResult | null>(null)

  useEffect(() => {
    setDisplayName(profile?.displayName || '')
  }, [profile?.displayName])

  const prefs: NotificationPrefs = {
    sms: true,
    push: true,
    dose: true,
    lowStock: true,
    expiry: true,
    appointments: true,
    ...(profile?.prefs || {}),
  }

  async function saveProfile() {
    if (!profile) return
    setSaving(true)
    try {
      // `phone` is deliberately absent: it is written by the phone-verification
      // callables and Firestore rules reject client edits to it.
      await updateDoc(doc(db, 'users', profile.uid), {
        displayName: displayName.trim() || profile.displayName,
      })
      toast('Profile updated.', 'success')
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function changeTimezone(value: string) {
    if (!profile) return
    try {
      await updateDoc(doc(db, 'users', profile.uid), { timezone: value })
      toast(`Schedule timezone set to ${value}.`, 'success')
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  async function togglePref(key: keyof NotificationPrefs, value: boolean) {
    if (!profile) return
    try {
      await updateDoc(doc(db, 'users', profile.uid), { [`prefs.${key}`]: value })
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  async function enableWebsiteAlerts() {
    setAlertBusy(true)
    try {
      const result = await requestAlertPermission()
      setAlertState(result.permission)
      toast(result.message, result.permission === 'granted' ? 'success' : 'error')
    } finally {
      setAlertBusy(false)
    }
  }

  async function sendTestAlert() {
    const shown = showBrowserAlert('MediVault · test alert', 'Website alerts are working on this device.', {
      tag: 'medivault-test',
    })
    if (shown) toast('Sent — check your desktop notifications.', 'success')
    else toast('Enable website alerts first.', 'error')
  }

  async function enablePush() {
    setPushBusy(true)
    setPushMessage(null)
    try {
      const result = await enableWebPush()
      setPushMessage(result.message)
      if (result.status === 'registered') {
        await api.registerFcmToken(result.token)
        toast('This device will now receive push notifications.', 'success')
      } else if (result.status !== 'unsupported') {
        toast(result.message, 'error')
      }
    } catch (err) {
      setPushMessage(errorMessage(err))
      toast(errorMessage(err), 'error')
    } finally {
      setPushBusy(false)
    }
  }

  async function sendTestSms() {
    setSmsBusy(true)
    try {
      const result = await api.sendTestSms()
      toast(
        result.status === 'sent'
          ? `Test SMS sent through ${result.provider}.`
          : `Message composed and logged via ${result.provider} (no Twilio credentials configured).`,
        'success',
      )
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setSmsBusy(false)
    }
  }

  async function sendPhoneCode(replace = false) {
    if (!user) return
    setPhoneError(null)
    if (!isValidPhone(phoneInput)) {
      setPhoneError('Enter the number in full, including the country code.')
      return
    }
    // Unlinking the current number is irreversible until the new one is proved,
    // so it only happens after an explicit second click.
    if (user.phoneNumber && !replace) {
      setConfirmReplace(true)
      return
    }
    setPhoneBusy(true)
    setConfirmReplace(false)
    try {
      if (user.phoneNumber) await unlinkPhone(user)
      phoneConfirmation.current = await startPhoneVerification(user, phoneInput, 'settings-recaptcha')
      setPhoneStage('code')
      toast(`Code sent to ${prettyPhone(phoneInput)}.`, 'success')
    } catch (err) {
      setPhoneError(errorMessage(err))
    } finally {
      setPhoneBusy(false)
    }
  }

  async function confirmPhone() {
    if (!phoneConfirmation.current || !user) return
    setPhoneError(null)
    setPhoneBusy(true)
    try {
      await confirmPhoneCode(phoneConfirmation.current, phoneCode)
      await user.getIdToken(true)
      await api.syncPhone()
      setPhoneStage('idle')
      setPhoneInput('')
      setPhoneCode('')
      toast('Number verified. SMS reminders are on.', 'success')
    } catch (err) {
      setPhoneError(errorMessage(err))
    } finally {
      setPhoneBusy(false)
    }
  }

  const registeredDevices = profile?.fcmTokens?.length || 0
  const tzOptions = profile?.timezone
    ? [...new Set([profile.timezone, ...TIMEZONES])]
    : TIMEZONES

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Profile, schedule timezone and how MediVault reaches you."
        actions={
          <Button variant="ghost" icon="logout" onClick={() => void signOutUser()}>
            Sign out
          </Button>
        }
      />

      <div className="grid two-col" style={{ gap: 16 }}>
        <div className="grid" style={{ gap: 16 }}>
          <Card>
            <CardHead
              title="Your profile"
              subtitle="Stored in users/{uid} in Cloud Firestore."
              actions={<Badge tone="brand">{profile?.email || user?.email}</Badge>}
            />
            <div className="card-pad">
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
                <Avatar name={profile?.displayName} email={profile?.email} photoURL={profile?.photoURL} size="lg" />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{profile?.displayName || 'MediVault user'}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {user?.providerData?.[0]?.providerId === 'google.com' ? 'Google sign-in' : 'Email & password'}
                    {profile?.createdAt ? ` · joined ${formatDate(profile.createdAt)}` : ''}
                  </div>
                </div>
              </div>

              <div className="form-grid">
                <Field label="Display name" htmlFor="profile-name">
                  <Input
                    id="profile-name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </Field>
                <Field
                  label="Mobile"
                  htmlFor="profile-phone"
                  hint={
                    profile?.phoneVerified
                      ? 'Verified — SMS reminders go here.'
                      : 'Not verified — no texts are sent yet.'
                  }
                >
                  <Input id="profile-phone" value={profile?.phone ? prettyPhone(profile.phone) : 'Not set'} readOnly />
                </Field>
                <div className="span-2">
                  <Field
                    label="Schedule timezone"
                    htmlFor="profile-tz"
                    hint="Dose times are wall-clock times in this zone — Cloud Scheduler converts them on every sweep."
                  >
                    <Select
                      id="profile-tz"
                      value={profile?.timezone || 'UTC'}
                      onChange={(event) => void changeTimezone(event.target.value)}
                    >
                      {tzOptions.map((zone) => (
                        <option key={zone} value={zone}>
                          {zone}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <Button onClick={saveProfile} loading={saving}>
                  Save profile
                </Button>
                <Button variant="ghost" onClick={() => void api.ensureProfile({})}>
                  Sync with Auth
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="Notifications" subtitle="Preferences live on your profile and are read by the reminder engine." />
            <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 4 }}>
              {PREF_LABELS.map((item) => (
                <Toggle
                  key={item.key}
                  checked={prefs[item.key]}
                  onChange={(value) => void togglePref(item.key, value)}
                  label={item.label}
                  description={item.description}
                />
              ))}
            </div>
          </Card>
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <Card>
            <CardHead
              title="Website alerts"
              subtitle="In-app toasts and desktop notifications — no key required"
            />
            <div className="card-pad">
              <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.65, marginBottom: 12 }}>
                The app watches your own <span className="mono">reminders</span> collection live, so a
                sweep wakes the page instantly. Allow notifications to also get a desktop pop-up while
                the tab is in the background.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  variant="soft"
                  icon="bell"
                  onClick={enableWebsiteAlerts}
                  loading={alertBusy}
                  disabled={alertState === 'granted' || alertState === 'unsupported'}
                >
                  {alertState === 'granted' ? 'Enabled on this browser' : 'Enable website alerts'}
                </Button>
                <Button variant="ghost" icon="mail" onClick={sendTestAlert} disabled={alertState !== 'granted'}>
                  Send a test alert
                </Button>
              </div>
              <div style={{ marginTop: 10 }}>
                <Badge tone={alertState === 'granted' ? 'brand' : alertState === 'denied' ? 'amber' : 'default'} dot>
                  {alertState === 'granted'
                    ? 'Desktop notifications allowed'
                    : alertState === 'denied'
                      ? 'Blocked in browser settings'
                      : alertState === 'unsupported'
                        ? 'Not supported by this browser'
                        : 'Permission not granted yet'}
                </Badge>
              </div>
              {alertState === 'denied' ? (
                <div style={{ marginTop: 10 }}>
                  <AlertBox tone="warn">
                    Notifications are blocked for this site. Re-allow them from the padlock icon in the
                    address bar, then reload.
                  </AlertBox>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHead title="Push notifications" subtitle={`${registeredDevices} device${registeredDevices === 1 ? '' : 's'} registered`} />
            <div className="card-pad">
              <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.65, marginBottom: 12 }}>
                Register this browser with Firebase Cloud Messaging. Tokens are stored on your profile
                and invalidated tokens are pruned automatically after a failed send.
              </p>
              <Button
                variant="soft"
                icon="bell"
                onClick={enablePush}
                loading={pushBusy}
                disabled={USE_EMULATORS}
              >
                {USE_EMULATORS ? 'Requires Hosting deployment' : 'Enable on this device'}
              </Button>
              {pushMessage ? (
                <div style={{ marginTop: 12 }}>
                  <AlertBox tone={USE_EMULATORS ? 'warn' : 'info'}>{pushMessage}</AlertBox>
                </div>
              ) : null}
              {registeredDevices > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <Badge tone="brand" dot>
                    {registeredDevices} active token{registeredDevices === 1 ? '' : 's'}
                  </Badge>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHead
              title="Mobile number"
              subtitle="Reminders are sent by SMS to this number"
              actions={
                <Badge tone={profile?.phoneVerified ? 'brand' : 'amber'} dot>
                  {profile?.phoneVerified ? 'Verified' : 'Not verified'}
                </Badge>
              }
            />
            <div className="card-pad">
              <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.65, marginBottom: 12 }}>
                {profile?.phoneVerified
                  ? `Texts go to ${profile.phone ? prettyPhone(profile.phone) : 'your number'}. Verifying a new one replaces it.`
                  : 'This number is on file but unproved, so the reminder engine will not text it. Verify it to switch SMS on.'}
              </p>

              {phoneStage === 'idle' ? (
                <>
                  <Field label="Mobile number" htmlFor="settings-phone">
                    <Input
                      id="settings-phone"
                      value={phoneInput}
                      onChange={(event) => setPhoneInput(event.target.value)}
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder={profile?.phone ? prettyPhone(profile.phone) : '+91 98765 43210'}
                    />
                  </Field>
                  <div id="settings-recaptcha" />
                  <Button variant="soft" icon="phone" onClick={() => void sendPhoneCode()} loading={phoneBusy}>
                    {profile?.phoneVerified ? 'Replace number' : 'Verify number'}
                  </Button>
                  {confirmReplace ? (
                    <div style={{ marginTop: 12 }}>
                      <AlertBox tone="warn" icon="alert">
                        <div style={{ marginBottom: 8 }}>
                          Sending a code removes {profile?.phone ? prettyPhone(profile.phone) : 'the current number'}{' '}
                          from this account first. If the new number is never verified, SMS reminders stay off
                          until you verify again.
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <Button size="sm" onClick={() => void sendPhoneCode(true)} loading={phoneBusy}>
                            Yes, replace it
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmReplace(false)}>
                            Keep current
                          </Button>
                        </div>
                      </AlertBox>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <Field label="6-digit code" htmlFor="settings-code" hint={`Sent to ${prettyPhone(phoneInput)}.`}>
                    <Input
                      id="settings-code"
                      value={phoneCode}
                      onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      style={{ letterSpacing: '0.4em', fontFamily: 'var(--mono)' }}
                    />
                  </Field>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button icon="check" onClick={confirmPhone} loading={phoneBusy}>
                      Confirm
                    </Button>
                    <Button variant="ghost" onClick={() => setPhoneStage('idle')} disabled={phoneBusy}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}

              {phoneError ? (
                <div style={{ marginTop: 12 }}>
                  <AlertBox tone="error">{phoneError}</AlertBox>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHead title="SMS delivery" subtitle="Twilio via Cloud Functions" />
            <div className="card-pad">
              <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.65, marginBottom: 12 }}>
                Without Twilio credentials the function still composes the message and writes it to
                <span className="mono"> smsOutbox</span> with status <span className="mono">logged</span>.
                That makes delivery demonstrable offline — and auditable in production.
              </p>
              <Button
                variant="ghost"
                icon="phone"
                onClick={sendTestSms}
                loading={smsBusy}
                disabled={!profile?.phoneVerified}
              >
                Send a test SMS
              </Button>
            </div>
          </Card>

          <Card>
            <CardHead title="Cloud environment" />
            <div className="card-pad">
              <dl className="kv">
                <dt>Project</dt>
                <dd>{PROJECT_ID}</dd>
                <dt>Mode</dt>
                <dd>{USE_EMULATORS ? 'Local emulators' : 'Google Cloud'}</dd>
                <dt>Region</dt>
                <dd>asia-south1</dd>
                <dt>Account uid</dt>
                <dd className="mono" style={{ fontSize: 11 }}>
                  {user?.uid}
                </dd>
              </dl>
            </div>
          </Card>
        </div>
      </div>

    </>
  )
}
