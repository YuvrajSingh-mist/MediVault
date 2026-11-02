import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { useSmsOutbox, useNow, useSystemStatus } from '../lib/data'
import { api, errorMessage } from '../lib/api'
import { PROJECT_ID, USE_EMULATORS } from '../lib/firebase'
import { formatDateTime, relativeTime } from '../lib/format'
import type { CloudHealth } from '../types'
import { Icon, type IconName } from '../components/Icons'
import {
  AlertBox,
  Badge,
  Button,
  Card,
  CardHead,
  PageHeader,
  Skeleton,
  cx,
} from '../components/ui'

const ARCHITECTURE: Array<{ title: string; detail: string; icon: IconName }> = [
  { title: 'Firebase Hosting', detail: 'Serves the compiled React SPA over a global CDN with HTTPS.', icon: 'cloud' },
  { title: 'Firebase Authentication', detail: 'Google sign-in with a verified mobile number; ID tokens authorise every request.', icon: 'lock' },
  { title: 'Cloud Firestore', detail: 'Live document store for medicines, appointments, reminders and dose logs.', icon: 'database' },
  { title: 'Cloud Storage', detail: 'Private bucket with owner-scoped security rules and a finalize trigger.', icon: 'file' },
  { title: 'Cloud Functions (2nd gen)', detail: 'Runs on Cloud Run: callables, Storage trigger and HTTP health endpoint.', icon: 'activity' },
  { title: 'Cloud Scheduler', detail: 'Invokes sweepReminders every 5 minutes and dailyDigest at 08:00 UTC.', icon: 'clock' },
  { title: 'FCM + Twilio', detail: 'Fan-out to browser push and SMS; outbox fallback keeps it auditable.', icon: 'bell' },
  { title: 'Cloud Logging & Monitoring', detail: 'Structured JSON logs, uptime check on /api and scheduler run history.', icon: 'shield' },
]

export function SystemPage() {
  const { user, profile } = useAuth()
  const { toast } = useToast()
  const status = useSystemStatus()
  const sms = useSmsOutbox(user?.uid)
  const now = useNow(30_000)
  const [health, setHealth] = useState<CloudHealth | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [loadingHealth, setLoadingHealth] = useState(true)
  const [sweeping, setSweeping] = useState(false)

  const loadHealth = useCallback(async () => {
    setLoadingHealth(true)
    try {
      const result = await api.cloudHealth()
      setHealth(result)
      setHealthError(null)
    } catch (err) {
      setHealthError(errorMessage(err))
      setHealth(null)
    } finally {
      setLoadingHealth(false)
    }
  }, [])

  useEffect(() => {
    void loadHealth()
  }, [loadHealth])

  async function runSweep() {
    setSweeping(true)
    try {
      const summary = await api.runSweepNow()
      toast(
        `Sweep ${summary.trigger} finished in ${summary.durationMs} ms · ${summary.createdReminders} reminders created.`,
        'success',
      )
      await loadHealth()
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setSweeping(false)
    }
  }

  const projectId = health?.projectId || PROJECT_ID
  const lastRun = status?.lastRun
  const recentRuns = status?.recentRuns || []
  const tokens = profile?.fcmTokens?.length || 0

  const consoleLinks: Array<{ label: string; url: string }> = [
    {
      label: 'Cloud Functions',
      url: `https://console.cloud.google.com/functions/list?project=${projectId}`,
    },
    {
      label: 'Cloud Scheduler',
      url: `https://console.cloud.google.com/cloudscheduler?project=${projectId}`,
    },
    {
      label: 'Firestore data',
      url: `https://console.firebase.google.com/project/${projectId}/firestore/data`,
    },
    {
      label: 'Cloud Storage',
      url: `https://console.firebase.google.com/project/${projectId}/storage`,
    },
    {
      label: 'Authentication users',
      url: `https://console.firebase.google.com/project/${projectId}/authentication/users`,
    },
    {
      label: 'Cloud Logging',
      url: `https://console.cloud.google.com/logs/query?project=${projectId}`,
    },
    {
      label: 'Cloud Monitoring',
      url: `https://console.cloud.google.com/monitoring?project=${projectId}`,
    },
    {
      label: 'IAM & admin',
      url: `https://console.cloud.google.com/iam-admin/iam?project=${projectId}`,
    },
  ]

  return (
    <>
      <PageHeader
        title="Cloud status"
        subtitle="What the Cloud Functions, scheduler and SMS sender are doing right now."
        actions={
          <>
            <Button variant="ghost" icon="refresh" onClick={() => void loadHealth()} loading={loadingHealth}>
              Re-check
            </Button>
            <Button icon="sparkles" onClick={runSweep} loading={sweeping}>
              Run sweep now
            </Button>
          </>
        }
      />

      {USE_EMULATORS ? (
        <div style={{ marginBottom: 16 }}>
          <AlertBox tone="warn" icon="info">
            You are on the local Firebase Emulator Suite. Everything below is real behaviour of the
            same code that runs on Google Cloud. Deploy with <span className="mono">npm run deploy</span>{' '}
            to point this page at your GCP project.
          </AlertBox>
        </div>
      ) : null}

      <div className="grid stats" style={{ marginBottom: 16 }}>
        <Card className="stat">
          <div className="stat-icon">
            <Icon name="activity" size={18} />
          </div>
          <div>
            <div className="stat-label">Functions region</div>
            <div className="stat-value" style={{ fontSize: 18 }}>
              {health?.region || '-'}
            </div>
            <div className="stat-sub">revision {health?.revision || '…'}</div>
          </div>
        </Card>
        <Card className="stat">
          <div className="stat-icon blue">
            <Icon name="database" size={18} />
          </div>
          <div>
            <div className="stat-label">Firestore round-trip</div>
            <div className="stat-value" style={{ fontSize: 18 }}>
              {health ? `${health.latencyMs} ms` : '-'}
            </div>
            <div className="stat-sub">{health?.firestoreOk ? 'read succeeded' : 'not reachable'}</div>
          </div>
        </Card>
        <Card className="stat">
          <div className="stat-icon violet">
            <Icon name="clock" size={18} />
          </div>
          <div>
            <div className="stat-label">Last scheduler run</div>
            <div className="stat-value" style={{ fontSize: 18 }}>
              {lastRun?.durationMs !== undefined ? `${lastRun.durationMs} ms` : '-'}
            </div>
            <div className="stat-sub">
              {lastRun?.finishedAt ? relativeTime(lastRun.finishedAt) : 'waiting for first run'}
            </div>
          </div>
        </Card>
        <Card className="stat">
          <div className="stat-icon amber">
            <Icon name="bell" size={18} />
          </div>
          <div>
            <div className="stat-label">Push devices</div>
            <div className="stat-value" style={{ fontSize: 18 }}>{tokens}</div>
            <div className="stat-sub">{health?.smsProvider === 'twilio' ? 'Twilio SMS on' : 'SMS → outbox'}</div>
          </div>
        </Card>
      </div>

      <div className="grid two-col" style={{ gap: 16 }}>
        <div className="grid" style={{ gap: 16 }}>
          <Card>
            <CardHead
              title="Services in use"
              subtitle={`Project ${projectId}`}
              actions={<Badge tone={health?.firestoreOk ? 'brand' : 'amber'} dot>{health?.firestoreOk ? 'Healthy' : 'Checking'}</Badge>}
            />
            <div>
              <ServiceRow
                icon="lock"
                name="Firebase Authentication"
                detail={user?.email ? `Signed in as ${user.email}` : 'No session'}
                ok={Boolean(user)}
              />
              <ServiceRow
                icon="database"
                name="Cloud Firestore"
                detail={
                  healthError
                    ? healthError
                    : health
                      ? `${health.firestoreOk ? 'Reachable' : 'Degraded'} · ${health.latencyMs} ms · native mode`
                      : 'Checking…'
                }
                ok={Boolean(health?.firestoreOk)}
                loading={loadingHealth}
              />
              <ServiceRow
                icon="file"
                name="Cloud Storage"
                detail={health?.bucket ? `Bucket ${health.bucket}` : 'Bucket not resolved'}
                ok={Boolean(health?.bucket)}
                loading={loadingHealth}
              />
              <ServiceRow
                icon="activity"
                name="Cloud Functions · 2nd gen"
                detail={health ? `${health.runtime} · ${health.revision}` : 'Callable cloudHealth pending'}
                ok={Boolean(health)}
                loading={loadingHealth}
              />
              <ServiceRow
                icon="clock"
                name="Cloud Scheduler"
                detail={
                  lastRun
                    ? `Last ${lastRun.trigger} run ${relativeTime(lastRun.finishedAt)} · sweep every 5 min`
                    : 'Job deployed; no recorded run yet'
                }
                ok={Boolean(lastRun)}
              />
              <ServiceRow
                icon="bell"
                name="Firebase Cloud Messaging"
                detail={tokens > 0 ? `${tokens} device token(s) registered` : 'No device registered yet'}
                ok={tokens > 0}
              />
              <ServiceRow
                icon="phone"
                name="SMS delivery"
                detail={
                  health?.smsProvider === 'twilio'
                    ? 'Twilio credentials configured'
                    : 'No Twilio credentials. Messages are recorded in smsOutbox.'
                }
                ok={Boolean(health)}
                warn={health?.smsProvider !== 'twilio'}
              />
              <ServiceRow
                icon="shield"
                name="Cloud Logging"
                detail="Structured JSON logs from every function invocation"
                ok
              />
            </div>
          </Card>

          <Card>
            <CardHead
              title="Scheduler telemetry"
              subtitle={
                status?.schedule
                  ? `sweep: ${status.schedule.sweep} · digest: ${status.schedule.digest}`
                  : 'system/status document'
              }
              actions={
                lastRun ? <Badge tone={lastRun.failures > 0 ? 'red' : 'brand'} dot>{lastRun.trigger}</Badge> : null
              }
            />
            {!lastRun ? (
              <div style={{ padding: 18, display: 'grid', gap: 10 }}>
                <Skeleton height={40} />
                <Skeleton height={40} />
              </div>
            ) : (
              <>
                <div className="card-pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
                  <Metric label="Medicines scanned" value={lastRun.scannedMedicines} />
                  <Metric label="Appointments scanned" value={lastRun.scannedAppointments} />
                  <Metric label="Alerts created" value={lastRun.createdReminders} tone="brand" />
                  <Metric label="Users notified" value={lastRun.notifiedUsers} />
                  <Metric label="SMS sent" value={lastRun.smsSent} />
                  <Metric label="Pushes sent" value={lastRun.pushesSent} />
                  <Metric label="Failures" value={lastRun.failures} tone={lastRun.failures > 0 ? 'red' : undefined} />
                  <Metric label="Duration" value={`${lastRun.durationMs} ms`} />
                </div>

                {lastRun.errors && lastRun.errors.length > 0 ? (
                  <div style={{ padding: '0 18px 14px' }}>
                    <AlertBox tone="error" icon="alert">
                      {lastRun.errors.join(' · ')}
                    </AlertBox>
                  </div>
                ) : null}

                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Run</th>
                        <th>Trigger</th>
                        <th>When</th>
                        <th>Alerts</th>
                        <th>Notified</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentRuns.map((run) => (
                        <tr key={`${run.runId}-${run.at}`}>
                          <td className="mono">{run.runId}</td>
                          <td>
                            <Badge tone={run.trigger === 'scheduled' ? 'brand' : 'blue'}>{run.trigger}</Badge>
                          </td>
                          <td>{formatDateTime(run.at)}</td>
                          <td>{run.createdReminders}</td>
                          <td>{run.notifiedUsers}</td>
                          <td>{run.durationMs} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {lastRun.revision ? (
                  <div style={{ padding: '10px 18px', fontSize: 11.5, color: 'var(--muted-2)' }} className="mono">
                    Cloud Run revision {lastRun.revision} · project {lastRun.projectId || projectId}
                  </div>
                ) : null}
              </>
            )}
          </Card>

          <Card>
            <CardHead
              title="Requested data flow"
              subtitle="One sweep, eight Google Cloud services"
              actions={<Icon name="arrowRight" size={16} />}
            />
            <div className="card-pad arch">
              {ARCHITECTURE.map((item, index) => (
                <div key={item.title} className="arch-step">
                  <span className="idx">{index + 1}</span>
                  <Icon name={item.icon} size={15} />
                  <div>
                    <strong>{item.title}</strong>
                    <div className="muted" style={{ fontSize: 11.8, marginTop: 1 }}>
                      {item.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="grid" style={{ gap: 16 }}>
          <Card>
            <CardHead
              title="SMS outbox"
              subtitle="Every reminder text composed by the backend"
              actions={<Badge>{sms?.length || 0}</Badge>}
            />
            {sms === null ? (
              <div style={{ padding: 18 }}>
                <Skeleton height={40} />
              </div>
            ) : sms.length === 0 ? (
              <div style={{ padding: 18, fontSize: 12.5, color: 'var(--muted)' }}>
                No texts yet. Run a sweep so a reminder is due, or send a test SMS from Settings.
              </div>
            ) : (
              <div className="list">
                {sms.map((item) => (
                  <div key={item.id} className="list-row" style={{ padding: '11px 16px' }}>
                    <div className={cx('alert-icon', item.status === 'failed' && 'expiry')}>
                      <Icon name="phone" size={15} />
                    </div>
                    <div className="grow">
                      <div className="title" style={{ fontSize: 12.5 }}>
                        {item.body}
                      </div>
                      <div className="sub" style={{ fontSize: 11.5 }}>
                        {item.to} · {relativeTime(item.createdAt)}
                      </div>
                      {item.error ? (
                        <div className="sub" style={{ color: 'var(--red-fg)', fontSize: 11 }}>
                          {item.error}
                        </div>
                      ) : null}
                    </div>
                    <Badge tone={item.status === 'sent' ? 'brand' : item.status === 'failed' ? 'red' : 'amber'}>
                      {item.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="Cloud console" subtitle="Open the real resources behind this demo" />
            <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {USE_EMULATORS ? (
                <AlertBox tone="warn" icon="info">
                  Console links activate after you deploy to a real project and rebuild without the
                  emulator flag.
                </AlertBox>
              ) : null}
              {consoleLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="btn btn-ghost"
                  style={{ justifyContent: 'space-between' }}
                >
                  <span>{link.label}</span>
                  <Icon name="external" size={14} />
                </a>
              ))}
            </div>
          </Card>

          <Card>
            <CardHead title="Logs & deployment" subtitle="Commands used during the viva" />
            <div className="card-pad">
              <pre className="code">{`# tail structured logs
firebase functions:log --only sweepReminders

# deploy only the backend
firebase deploy --only functions

# deploy hosting + rules + indexes
firebase deploy --only hosting,firestore,storage

# full release
npm run deploy`}</pre>
              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--muted-2)' }}>
                Snapshot taken {formatDateTime(now)} · {health?.time ? `health at ${formatDateTime(health.time)}` : 'health pending'}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card className="card-pad" style={{ marginTop: 16, background: 'var(--surface-2)' }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>Five-minute viva checklist</div>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.6, color: 'var(--muted)', lineHeight: 1.9 }}>
          <li>Firebase Hosting: reload the deployed URL and show the HTTPS certificate.</li>
          <li>Firestore: create a medicine here, then show the document in the console.</li>
          <li>Cloud Storage: show the bucket, its rules and the storage trigger wired to Cloud Functions.</li>
          <li>Cloud Scheduler: run “Run sweep now”, then show the job’s next execution time and this run’s document.</li>
          <li>Cloud Logging: filter by <span className="mono">reminder_sweep</span> and show the JSON payload with counts and duration.</li>
        </ol>
      </Card>
    </>
  )
}

function ServiceRow({
  icon,
  name,
  detail,
  ok,
  warn = false,
  loading = false,
}: {
  icon: IconName
  name: string
  detail: string
  ok: boolean
  warn?: boolean
  loading?: boolean
}) {
  return (
    <div className="service-row">
      <div className="service-icon">
        <Icon name={icon} size={15} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 650 }}>{name}</div>
        <div style={{ fontSize: 11.8, color: 'var(--muted)', marginTop: 1 }}>{detail}</div>
      </div>
      {loading ? (
        <span className="spinner" style={{ color: 'var(--muted-2)' }} />
      ) : (
        <span className={cx('status-dot', !ok && (warn ? 'idle' : 'down'))} title={ok ? 'Active' : 'Inactive'} />
      )}
    </div>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone?: 'brand' | 'red'
}) {
  return (
    <div>
      <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted-2)', fontWeight: 700 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 740,
          letterSpacing: '-0.02em',
          marginTop: 2,
          color: tone === 'red' ? 'var(--red-fg)' : tone === 'brand' ? 'var(--brand-700)' : 'var(--ink)',
        }}
      >
        {value}
      </div>
    </div>
  )
}
