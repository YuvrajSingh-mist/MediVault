import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import {
  useAppointments,
  useDoseLogs,
  useMedicines,
  useNow,
  useReminders,
} from '../lib/data'
import {
  buildDosePlan,
  countExpiring,
  countLowStock,
  daysUntil,
  formatDate,
  formatDayMonth,
  formatTime,
  greeting,
  longDate,
  pluralize,
  relativeTime,
  timeLabel,
  todayKey,
} from '../lib/format'
import { api, errorMessage } from '../lib/api'
import type { DoseSlot, ReminderType } from '../types'
import { Icon } from '../components/Icons'
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  Skeleton,
  StatCard,
  cx,
} from '../components/ui'

const TYPE_ICON: Record<ReminderType, 'pill' | 'alert' | 'shield' | 'calendar' | 'mail' | 'cloud'> = {
  dose: 'pill',
  lowstock: 'alert',
  expiry: 'shield',
  appointment: 'calendar',
  digest: 'mail',
  system: 'cloud',
}

export function DashboardPage() {
  const { user, profile, activeUserId, isCaregiverView, patients } = useAuth()
  const { toast } = useToast()
  const now = useNow(30_000)
  const zone = profile?.timezone

  const medicines = useMedicines(activeUserId)
  const appointments = useAppointments(activeUserId)
  const reminders = useReminders(activeUserId, 25)
  const day = todayKey(zone)
  const logs = useDoseLogs(activeUserId, day)

  const [busySlot, setBusySlot] = useState<string | null>(null)
  const [sweeping, setSweeping] = useState(false)
  const [seeding, setSeeding] = useState(false)

  const slots = useMemo(() => buildDosePlan(medicines || [], logs || [], day), [medicines, logs, day])
  const taken = slots.filter((slot) => slot.status === 'taken').length
  const pending = slots.filter((slot) => slot.status === 'pending')
  const nextDose = pending[0]

  const upcoming = useMemo(() => {
    const list = (appointments || []).filter((item) => {
      const date = item.date?.toDate?.()
      return date ? date.getTime() >= now.getTime() - 3_600_000 : false
    })
    return list[0]
  }, [appointments, now])

  const patientName = patients.find((patient) => patient.uid === activeUserId)?.name
  const displayName = isCaregiverView
    ? patientName || 'your patient'
    : (profile?.displayName || user?.displayName || 'there').split(' ')[0]

  const lowStock = countLowStock(medicines || [])
  const expiring = countExpiring(medicines || [], zone, 30)
  const activeMeds = (medicines || []).filter((medicine) => medicine.active !== false)
  const recentAlerts = (reminders || []).slice(0, 3)
  const unread = (reminders || []).filter((item) => !item.read).length

  async function logDose(slot: DoseSlot, action: 'take' | 'skip' | 'undo') {
    if (!activeUserId) return
    setBusySlot(`${slot.key}:${action}`)
    try {
      const result = await api.logDose({
        medicineId: slot.medicineId,
        dateKey: day,
        time: slot.time,
        action,
      })
      if (action === 'take') {
        toast(`Dose logged · ${pluralize(result.remainingTablets, 'tablet')} left`, 'success')
      } else if (action === 'skip') {
        toast('Dose skipped.', 'default')
      } else {
        toast('Dose entry removed.', 'default')
      }
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setBusySlot(null)
    }
  }

  async function runSweep() {
    setSweeping(true)
    try {
      const summary = await api.runSweepNow()
      if (summary.createdReminders > 0) {
        toast(
          `Sweep finished in ${summary.durationMs} ms · ${pluralize(summary.createdReminders, 'new reminder')}, ${pluralize(summary.emailsSent, 'email')} sent.`,
          'success',
        )
      } else {
        toast(
          `Sweep ran in ${summary.durationMs} ms. Nothing is due in this 5-minute window — try again soon.`,
        )
      }
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setSweeping(false)
    }
  }

  async function seed() {
    setSeeding(true)
    try {
      const result = await api.seedDemoData()
      if (result.seeded) toast('Sample medicines and appointments created.', 'success')
      else toast(result.reason || 'Nothing to seed.', 'default')
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setSeeding(false)
    }
  }

  const loading = medicines === null

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{longDate(now, zone)}</div>
          <h1 style={{ marginTop: 4 }}>
            {greeting(now)}, {displayName}
          </h1>
          <p>
            {isCaregiverView
              ? `You are helping ${patientName || 'this patient'} stay on schedule.`
              : pending.length > 0
                ? `${pluralize(pending.length, 'dose')} still to take today${nextDose ? ` · next at ${timeLabel(nextDose.time)}` : ''}.`
                : 'Every scheduled dose for today is done. Nicely handled.'}
          </p>
        </div>
        <div className="page-actions">
          {!isCaregiverView ? (
            <Button variant="ghost" icon="refresh" onClick={runSweep} loading={sweeping}>
              Run reminder sweep
            </Button>
          ) : null}
          <Link to="/medicines?new=1" className="btn btn-primary">
            <Icon name="plus" size={17} /> Add medicine
          </Link>
        </div>
      </div>

      <div className="grid stats" style={{ marginBottom: 18 }}>
        <StatCard
          label="Active medicines"
          value={loading ? <Skeleton height={26} width={44} /> : activeMeds.length}
          sub={loading ? '' : `${pluralize(slots.length, 'scheduled dose')} today`}
          icon="pill"
        />
        <StatCard
          label="Doses today"
          value={
            loading ? (
              <Skeleton height={26} width={62} />
            ) : (
              <>
                {taken}
                <small> / {slots.length}</small>
              </>
            )
          }
          sub={pending.length > 0 ? `Next ${nextDose ? timeLabel(nextDose.time) : ''}` : 'All caught up'}
          icon="check"
          tone="blue"
        />
        <StatCard
          label="Refills needed"
          value={loading ? <Skeleton height={26} width={36} /> : lowStock}
          sub={lowStock > 0 ? 'At or below refill threshold' : 'Stock levels look healthy'}
          icon="alert"
          tone={lowStock > 0 ? 'amber' : 'brand'}
        />
        <StatCard
          label="Expiring in 30 days"
          value={loading ? <Skeleton height={26} width={36} /> : expiring}
          sub={expiring > 0 ? 'Check the expiry dates' : 'Nothing expiring soon'}
          icon="shield"
          tone={expiring > 0 ? 'red' : 'brand'}
        />
      </div>

      {!loading && activeMeds.length === 0 ? (
        <Card className="card-pad" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="stat-icon" style={{ width: 44, height: 44, borderRadius: 13 }}>
              <Icon name="sparkles" size={21} />
            </div>
            <div style={{ flex: 1, minWidth: 240 }}>
              <h2 style={{ fontSize: 16, fontWeight: 720, letterSpacing: '-0.02em' }}>
                Your vault is empty — let’s fill it
              </h2>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 5, maxWidth: '62ch' }}>
                Add a medicine with its dosage times, or load a realistic sample dataset. The sample
                includes a low-stock medicine and one expiring in five days so the alert engine is
                demonstrable right away.
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <Button icon="sparkles" onClick={seed} loading={seeding}>
                  Load sample data
                </Button>
                <Link to="/medicines?new=1" className="btn btn-ghost">
                  <Icon name="plus" size={16} /> Add manually
                </Link>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid two-col">
        <Card>
          <CardHead
            title="Today's schedule"
            subtitle={`${taken} of ${slots.length} doses taken · ${day}`}
            actions={
              <Badge tone={pending.length > 0 ? 'amber' : 'brand'} dot>
                {pending.length > 0 ? `${pending.length} pending` : 'Complete'}
              </Badge>
            }
          />

          {loading ? (
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Skeleton height={44} />
              <Skeleton height={44} />
              <Skeleton height={44} />
            </div>
          ) : slots.length === 0 ? (
            <EmptyState
              icon="clock"
              title="No doses scheduled today"
              message="Add dosage times to a medicine and they will appear here, with reminders delivered by Cloud Scheduler."
              action={
                <Link to="/medicines" className="btn btn-soft btn-sm">
                  Manage medicines
                </Link>
              }
            />
          ) : (
            <div className="list">
              {slots.map((slot) => (
                <div key={slot.key} className={cx('list-row', 'dose-row', slot.status === 'taken' && 'done')}>
                  <div className="time-col">
                    <div className="t">{timeLabel(slot.time).replace(/\s?(am|pm)/, '')}</div>
                    <div className="s">{timeLabel(slot.time).includes('pm') ? 'PM' : 'AM'}</div>
                  </div>
                  <div className="grow">
                    <div className="title">
                      {slot.medicineName}
                      {slot.status === 'taken' ? (
                        <Badge tone="brand" dot>
                          Taken
                        </Badge>
                      ) : slot.status === 'skipped' ? (
                        <Badge>Skipped</Badge>
                      ) : slot.lowStock ? (
                        <Badge tone="amber" dot>
                          Low stock
                        </Badge>
                      ) : null}
                    </div>
                    <div className="sub">
                      {[slot.dosage, slot.form].filter(Boolean).join(' · ') || 'As prescribed'}
                    </div>
                  </div>
                  <div className="dose-actions">
                    {slot.status === 'pending' ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => logDose(slot, 'skip')}
                          loading={busySlot === `${slot.key}:skip`}
                        >
                          Skip
                        </Button>
                        <Button
                          size="sm"
                          icon="check"
                          onClick={() => logDose(slot, 'take')}
                          loading={busySlot === `${slot.key}:take`}
                        >
                          Take
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => logDose(slot, 'undo')}
                        loading={busySlot === `${slot.key}:undo`}
                      >
                        Undo
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="grid" style={{ gap: 14 }}>
          <Card>
            <CardHead
              title="Next appointment"
              actions={
                <Link to="/appointments" className="btn-link">
                  All <Icon name="chevronRight" size={14} />
                </Link>
              }
            />
            {appointments === null ? (
              <div style={{ padding: 18 }}>
                <Skeleton height={54} />
              </div>
            ) : upcoming ? (
              <div style={{ padding: 18, display: 'flex', gap: 14 }}>
                <div
                  style={{
                    width: 54,
                    flex: 'none',
                    textAlign: 'center',
                    background: 'var(--brand-50)',
                    border: '1px solid #d9efe8',
                    borderRadius: 12,
                    padding: '8px 0',
                  }}
                >
                  <div style={{ fontSize: 19, fontWeight: 760, color: 'var(--brand-700)', lineHeight: 1.1 }}>
                    {formatDayMonth(upcoming.date, zone).day}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.07em',
                      color: 'var(--brand-600)',
                    }}
                  >
                    {formatDayMonth(upcoming.date, zone).month}
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {upcoming.doctorName || 'Doctor appointment'}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 2 }}>
                    {[upcoming.speciality, upcoming.location].filter(Boolean).join(' · ') ||
                      'No location recorded'}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Badge tone="blue">{formatTime(upcoming.date, zone)}</Badge>
                    {daysUntil(upcoming.date, zone) !== null ? (
                      <Badge>
                        {daysUntil(upcoming.date, zone) === 0
                          ? 'Today'
                          : `in ${pluralize(daysUntil(upcoming.date, zone) as number, 'day')}`}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon="calendar"
                title="No upcoming appointments"
                message="Add a doctor visit and MediVault will remind you 24 hours before."
                action={
                  <Link to="/appointments" className="btn btn-soft btn-sm">
                    Add appointment
                  </Link>
                }
              />
            )}
          </Card>

          <Card>
            <CardHead
              title="Latest alerts"
              subtitle={unread > 0 ? `${pluralize(unread, 'unread alert')}` : 'You are all caught up'}
              actions={
                <Link to="/alerts" className="btn-link">
                  Open <Icon name="chevronRight" size={14} />
                </Link>
              }
            />
            {reminders === null ? (
              <div style={{ padding: 18 }}>
                <Skeleton height={40} />
              </div>
            ) : recentAlerts.length === 0 ? (
              <EmptyState
                icon="bell"
                title="No alerts yet"
                message="Run a reminder sweep (or wait for Cloud Scheduler) and new alerts will appear here."
              />
            ) : (
              <div className="list">
                {recentAlerts.map((alert) => (
                  <Link key={alert.id} to="/alerts" className="list-row" style={{ color: 'inherit' }}>
                    <div className={cx('alert-icon', alert.type)}>
                      <Icon name={TYPE_ICON[alert.type] || 'bell'} size={15} />
                    </div>
                    <div className="grow">
                      <div className="title" style={{ fontSize: 13.2 }}>
                        {alert.title}
                      </div>
                      <div className="sub">{alert.body}</div>
                    </div>
                    <div style={{ textAlign: 'right', flex: 'none' }}>
                      <div style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>
                        {relativeTime(alert.createdAt)}
                      </div>
                      {!alert.read ? <span className="status-dot" style={{ marginTop: 6, display: 'inline-block' }} /> : null}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {!isCaregiverView ? (
            <Card className="card-pad" style={{ background: 'var(--surface-2)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div className="service-icon">
                  <Icon name="cloud" size={15} />
                </div>
                <div>
                  <div style={{ fontWeight: 650, fontSize: 13 }}>Serverless reminder pipeline</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.55 }}>
                    Cloud Scheduler invokes <span className="mono">sweepReminders</span> every 5 minutes.
                    It checks doses, stock, expiry and appointments, then writes alert documents and
                    fans out email + push. See the evidence on{' '}
                    <Link to="/system">Cloud status</Link>.
                  </div>
                  {profile?.prefs?.email === false ? (
                    <div style={{ marginTop: 6 }}>
                      <Badge tone="amber">Email reminders are off</Badge>
                    </div>
                  ) : null}
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 18, fontSize: 11.5, color: 'var(--muted-2)' }}>
        Data read live from Cloud Firestore · schedule evaluated for {zone || 'UTC'} ·{' '}
        {formatDate(now, zone)}
      </div>
    </>
  )
}
