import { useEffect, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db, PROJECT_ID, USE_EMULATORS } from '../lib/firebase'
import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { api, errorMessage } from '../lib/api'
import { enableWebPush } from '../lib/notifications'
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
    key: 'email',
    label: 'Email reminders',
    description: 'One email per sweep listing what is due.',
  },
  {
    key: 'push',
    label: 'Browser & mobile push',
    description: 'Pop-ups on every device you turn on.',
  },
  {
    key: 'dose',
    label: 'Dose reminders',
    description: 'A nudge at each scheduled medicine time.',
  },
  {
    key: 'lowStock',
    label: 'Low stock alerts',
    description: 'When stock reaches your refill level, once a day.',
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
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushMessage, setPushMessage] = useState<string | null>(null)
  const [alertState, setAlertState] = useState<AlertPermission>(() => alertPermission())
  const [alertBusy, setAlertBusy] = useState(false)
  const [emailBusy, setEmailBusy] = useState(false)

  useEffect(() => {
    setDisplayName(profile?.displayName || '')
    setPhone(profile?.phone || '')
  }, [profile?.displayName, profile?.phone])

  const prefs: NotificationPrefs = {
    email: true,
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
      await updateDoc(doc(db, 'users', profile.uid), {
        displayName: displayName.trim() || profile.displayName,
        phone: phone.trim(),
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
    if (shown) toast('Sent. Check your desktop notifications.', 'success')
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

  async function sendTestEmail() {
    setEmailBusy(true)
    try {
      const result = await api.sendTestEmail()
      toast(
        result.status === 'sent'
          ? `Test email sent through ${result.provider}.`
          : `Email composed and logged via ${result.provider} (no SendGrid key configured).`,
        'success',
      )
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setEmailBusy(false)
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
              subtitle="Your name, number and timezone."
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
                <Field label="Phone" htmlFor="profile-phone" hint="Optional, for your records.">
                  <Input
                    id="profile-phone"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+91 98765 43210"
                  />
                </Field>
                <div className="span-2">
                  <Field
                    label="Schedule timezone"
                    htmlFor="profile-tz"
                    hint="Dose times use this timezone."
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
                  Refresh profile
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="Notifications" subtitle="Choose what MediVault reminds you about." />
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
              subtitle="Pop-ups while the page is open"
            />
            <div className="card-pad">
              <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.65, marginBottom: 12 }}>
                Allow notifications and a new alert pops up even when the tab is in the background.
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
                Turn on pop-ups for this browser. Each device is saved on your profile, and dead
                ones are removed automatically.
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
            <CardHead title="Email delivery" subtitle="SendGrid via Cloud Functions" />
            <div className="card-pad">
              <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.65, marginBottom: 12 }}>
                With no SendGrid key a message is saved in
                <span className="mono"> mailOutbox</span> with status <span className="mono">logged</span>{' '}
                instead of being sent.
              </p>
              <Button variant="ghost" icon="mail" onClick={sendTestEmail} loading={emailBusy}>
                Send a test email
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
