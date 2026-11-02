import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { refreshData, useAppointments, useDoseLogs, useMedicines, useNow } from '../lib/data'
import {
  buildDosePlan,
  countExpiring,
  countLowStock,
  daysUntil,
  formatDayMonth,
  formatTime,
  greeting,
  longDate,
  pluralize,
  timeLabel,
  todayKey,
} from '../lib/format'
import { api, errorMessage } from '../lib/api'
import type { DoseSlot } from '../types'
import { Icon } from '../components/Icons'
import { Badge, Button, Card, CardHead, EmptyState, Skeleton } from '../components/ui'

/**
 * The patient home screen answers one question: what do I take, and when.
 * Everything else on this page appears only when it needs a decision, which is
 * why stock and expiry show up as a single line rather than as counters.
 */
export function DashboardPage() {
  const { user, profile, activeUserId } = useAuth()
  const { toast } = useToast()
  const now = useNow(30_000)
  const zone = profile?.timezone

  const medicines = useMedicines(activeUserId)
  const appointments = useAppointments(activeUserId)
  const day = todayKey(zone)
  const logs = useDoseLogs(activeUserId, day)

  const [busySlot, setBusySlot] = useState<string | null>(null)
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

  const displayName = (profile?.displayName || user?.displayName || 'there').split(' ')[0]
  const lowStock = countLowStock(medicines || [])
  const expiring = countExpiring(medicines || [], zone, 30)
  const activeMeds = (medicines || []).filter((medicine) => medicine.active !== false)
  const loading = medicines === null

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
      refreshData()
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

  async function seed() {
    setSeeding(true)
    try {
      const result = await api.seedDemoData()
      if (!result.seeded) {
        toast(result.reason || 'Nothing to seed.', 'default')
        return
      }

      toast(
        `Sample data loaded · ${pluralize(result.medicines ?? 0, 'medicine')}, ${pluralize(
          result.appointments ?? 0,
          'appointment',
        )}.`,
        'success',
      )

      // Re-read every live query immediately. A Firestore listener can be a beat
      // behind a burst of server-side writes (or silently dead after a network
      // hiccup), which is why the dashboard used to look empty until a reload.
      refreshData()

      // Fire the engine once so the low-stock / expiry / dose alerts the sample
      // data is designed to produce show up straight away.
      try {
        const sweep = await api.runSweepNow()
        if (sweep.createdReminders > 0) {
          toast(`${pluralize(sweep.createdReminders, 'alert')} raised.`, 'success')
          refreshData()
        }
      } catch {
        // A throttled manual sweep is not an error the user needs to see here.
      }
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setSeeding(false)
    }
  }

  const lede =
    pending.length > 0
      ? `${pluralize(pending.length, 'dose')} still to take today${
          nextDose ? `, the next at ${timeLabel(nextDose.time)}` : ''
        }.`
      : slots.length > 0
        ? 'All of today’s doses are recorded.'
        : 'Nothing is scheduled for today.'

  const appointmentIn = upcoming ? daysUntil(upcoming.date, zone) : null

  return (
    <>
      <header className="home-head">
        <div>
          <div className="eyebrow">{longDate(now, zone)}</div>
          <h1>
            {greeting(now)}, {displayName}
          </h1>
          <p className="home-lede">{lede}</p>
        </div>
        <Link to="/medicines?new=1" className="btn btn-ghost btn-lg">
          <Icon name="plus" size={17} /> Add medicine
        </Link>
      </header>

      {!loading && lowStock + expiring > 0 ? (
        <div className="home-needs">
          {lowStock > 0 ? (
            <Link to="/medicines" className="home-need amber">
              <Icon name="alert" size={18} />
              {pluralize(lowStock, 'medicine')} {lowStock === 1 ? 'needs' : 'need'} a refill
              <Icon name="chevronRight" size={16} />
            </Link>
          ) : null}
          {expiring > 0 ? (
            <Link to="/medicines" className="home-need red">
              <Icon name="shield" size={18} />
              {pluralize(expiring, 'medicine')} {expiring === 1 ? 'expires' : 'expire'} within 30 days
              <Icon name="chevronRight" size={16} />
            </Link>
          ) : null}
        </div>
      ) : null}

      <Card className="home-today">
        <CardHead
          title="Today’s medicines"
          subtitle={
            slots.length > 0 ? `${taken} of ${slots.length} taken` : 'Nothing scheduled'
          }
          actions={
            slots.length > 0 ? (
              <Badge tone={pending.length > 0 ? 'amber' : 'brand'} dot>
                {pending.length > 0 ? `${pending.length} left` : 'Done'}
              </Badge>
            ) : null
          }
        />

        {loading ? (
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton height={64} />
            <Skeleton height={64} />
            <Skeleton height={64} />
          </div>
        ) : slots.length === 0 ? (
          activeMeds.length === 0 ? (
            <EmptyState
              icon="sparkles"
              title="Your vault is empty"
              message="Add a medicine and its times, or load a sample set to see how the reminders work."
              action={
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <Button size="lg" icon="sparkles" onClick={seed} loading={seeding}>
                    Load sample data
                  </Button>
                  <Link to="/medicines?new=1" className="btn btn-ghost btn-lg">
                    Add manually
                  </Link>
                </div>
              }
            />
          ) : (
            <EmptyState
              icon="clock"
              title="No doses scheduled today"
              message="Your medicines have no times set for today."
              action={
                <Link to="/medicines" className="btn btn-soft btn-lg">
                  Manage medicines
                </Link>
              }
            />
          )
        ) : (
          <div>
            {slots.map((slot) => {
              const takenOrSkipped = slot.status !== 'pending'
              return (
                <div key={slot.key} className={`home-dose${takenOrSkipped ? ' done' : ''}`}>
                  <div className="time">
                    <span className="t">{timeLabel(slot.time).replace(/\s?(am|pm)/, '')}</span>
                    <span className="s">{timeLabel(slot.time).includes('pm') ? 'PM' : 'AM'}</span>
                  </div>

                  <div className="what">
                    <div className="name">{slot.medicineName}</div>
                    <div className="dose">
                      {[slot.dosage, slot.form].filter(Boolean).join(' · ') || 'As prescribed'}
                    </div>
                    {slot.status === 'pending' && slot.lowStock ? (
                      <Badge tone="amber">Only a few left</Badge>
                    ) : null}
                  </div>

                  <div className="act">
                    {slot.status === 'pending' ? (
                      <>
                        <Button
                          size="lg"
                          className="btn-take"
                          icon="check"
                          onClick={() => logDose(slot, 'take')}
                          loading={busySlot === `${slot.key}:take`}
                        >
                          Take
                        </Button>
                        <button
                          type="button"
                          className="link-quiet"
                          onClick={() => logDose(slot, 'skip')}
                          disabled={busySlot === `${slot.key}:skip`}
                        >
                          Skip
                        </button>
                      </>
                    ) : (
                      <>
                        <Badge tone={slot.status === 'taken' ? 'brand' : 'default'} dot>
                          {slot.status === 'taken' ? 'Taken' : 'Skipped'}
                        </Badge>
                        <button
                          type="button"
                          className="link-quiet"
                          onClick={() => logDose(slot, 'undo')}
                          disabled={busySlot === `${slot.key}:undo`}
                        >
                          Undo
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card className="home-appt">
        <div className="home-appt-inner">
          {appointments === null ? (
            <Skeleton height={44} />
          ) : upcoming ? (
            <>
              <div className="when">
                <span className="d">{formatDayMonth(upcoming.date, zone).day}</span>
                <span className="m">{formatDayMonth(upcoming.date, zone).month}</span>
              </div>
              <div className="who">
                <div className="name">{upcoming.doctorName || 'Doctor appointment'}</div>
                <div className="dose">
                  {formatTime(upcoming.date, zone)}
                  {upcoming.location ? ` · ${upcoming.location}` : ''}
                </div>
              </div>
              <div className="in">
                {appointmentIn === 0 ? 'Today' : appointmentIn !== null ? `in ${pluralize(appointmentIn, 'day')}` : ''}
              </div>
              <Link to="/appointments" className="link-quiet">
                All appointments
              </Link>
            </>
          ) : (
            <>
              <div className="who">
                <div className="name">No appointment booked</div>
                <div className="dose">A reminder arrives 24 hours before each visit.</div>
              </div>
              <Link to="/appointments" className="btn btn-ghost btn-lg">
                Add appointment
              </Link>
            </>
          )}
        </div>
      </Card>
    </>
  )
}
