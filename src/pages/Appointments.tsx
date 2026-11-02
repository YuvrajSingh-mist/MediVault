import { useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { useAppointments, useNow } from '../lib/data'
import { errorMessage } from '../lib/api'
import {
  daysUntil,
  formatDate,
  formatDayMonth,
  formatTime,
  fromDateInputValue,
  longDate,
  pluralize,
  toDateInputValue,
} from '../lib/format'
import type { Appointment } from '../types'
import { Icon } from '../components/Icons'
import {
  Badge,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Skeleton,
  Textarea,
} from '../components/ui'

export function AppointmentsPage() {
  const { activeUserId, profile } = useAuth()
  const { toast } = useToast()
  const appointments = useAppointments(activeUserId)
  const now = useNow(60_000)
  const zone = profile?.timezone

  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Appointment | null>(null)
  const [deleting, setDeleting] = useState(false)

  const { upcoming, past } = useMemo(() => {
    const list = appointments || []
    const cutoff = now.getTime() - 60 * 60 * 1000
    return {
      upcoming: list.filter((item) => (item.date?.toDate?.()?.getTime() || 0) >= cutoff),
      past: list.filter((item) => (item.date?.toDate?.()?.getTime() || 0) < cutoff).reverse(),
    }
  }, [appointments, now])

  async function remove() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'appointments', deleteTarget.id))
      toast('Appointment removed.', 'success')
      setDeleteTarget(null)
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Appointments"
        subtitle="Doctor visits get a reminder 24 hours before, delivered by email and push."
        actions={
          <Button icon="plus" onClick={() => setCreating(true)}>
            Add appointment
          </Button>
        }
      />

      <div className="grid" style={{ gap: 16 }}>
        <Card>
          <CardHead
            title="Upcoming"
            subtitle={upcoming.length > 0 ? pluralize(upcoming.length, 'scheduled visit') : 'Nothing on the calendar'}
            actions={<Badge tone="blue">{longDate(now, zone)}</Badge>}
          />
          {appointments === null ? (
            <div style={{ padding: 18, display: 'grid', gap: 10 }}>
              <Skeleton height={56} />
              <Skeleton height={56} />
            </div>
          ) : upcoming.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="No upcoming appointments"
              message="Add a visit with a date and time — MediVault will remind you the day before."
              action={
                <Button icon="plus" variant="soft" size="sm" onClick={() => setCreating(true)}>
                  Add appointment
                </Button>
              }
            />
          ) : (
            <div className="list">
              {upcoming.map((appointment) => (
                <AppointmentRow
                  key={appointment.id}
                  appointment={appointment}
                  zone={zone}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}
        </Card>

        {past.length > 0 ? (
          <Card>
            <CardHead title="Past visits" subtitle={`${past.length} archived appointment${past.length === 1 ? '' : 's'}`} />
            <div className="list">
              {past.map((appointment) => (
                <AppointmentRow
                  key={appointment.id}
                  appointment={appointment}
                  zone={zone}
                  muted
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          </Card>
        ) : null}

        <Card className="card-pad" style={{ background: 'var(--surface-2)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div className="service-icon">
              <Icon name="bell" size={15} />
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--ink)' }}>How the reminder works.</strong> The
              five-minute sweep looks for appointments inside the next 24 hours and creates one
              idempotent alert (<span className="mono">appt_&lt;id&gt;_t24</span>), so repeated
              scheduler runs never duplicate a notification.
            </div>
          </div>
        </Card>
      </div>

      <AppointmentForm
        open={creating}
        userId={activeUserId}
        onClose={() => setCreating(false)}
        onSaved={() => {
          toast('Appointment saved. A reminder will go out 24 hours before.', 'success')
          setCreating(false)
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this appointment?"
        message={`${deleteTarget?.doctorName || 'This visit'} on ${
          deleteTarget ? formatDate(deleteTarget.date, zone) : ''
        } will be removed from Firestore.`}
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </>
  )
}

function AppointmentRow({
  appointment,
  zone,
  muted = false,
  onDelete,
}: {
  appointment: Appointment
  zone?: string
  muted?: boolean
  onDelete?: (appointment: Appointment) => void
}) {
  const day = formatDayMonth(appointment.date, zone)
  const inDays = daysUntil(appointment.date, zone)

  return (
    <div className="list-row" style={{ opacity: muted ? 0.72 : 1 }}>
      <div
        style={{
          width: 54,
          flex: 'none',
          textAlign: 'center',
          background: muted ? 'var(--surface-2)' : 'var(--brand-50)',
          border: `1px solid ${muted ? 'var(--line)' : '#d9efe8'}`,
          borderRadius: 12,
          padding: '8px 0',
        }}
      >
        <div
          style={{
            fontSize: 19,
            fontWeight: 760,
            color: muted ? 'var(--muted)' : 'var(--brand-700)',
            lineHeight: 1.1,
          }}
        >
          {day.day}
        </div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.07em',
            color: muted ? 'var(--muted-2)' : 'var(--brand-600)',
          }}
        >
          {day.month}
        </div>
      </div>

      <div className="grow">
        <div className="title">
          {appointment.doctorName || 'Doctor appointment'}
          {appointment.speciality ? <Badge>{appointment.speciality}</Badge> : null}
        </div>
        <div className="sub">
          {[appointment.location, formatTime(appointment.date, zone)].filter(Boolean).join(' · ') ||
            'No location recorded'}
        </div>
        {appointment.notes ? (
          <div className="sub" style={{ color: 'var(--muted-2)', marginTop: 4 }}>
            {appointment.notes}
          </div>
        ) : null}
        <div style={{ marginTop: 7 }}>
          {inDays !== null && inDays >= 0 ? (
            <Badge tone={inDays <= 1 ? 'amber' : 'blue'} dot>
              {inDays === 0 ? 'Today' : inDays === 1 ? 'Tomorrow' : `in ${pluralize(inDays, 'day')}`}
            </Badge>
          ) : (
            <Badge>Completed</Badge>
          )}
        </div>
      </div>

      {onDelete ? (
        <button
          type="button"
          className="mini-btn danger"
          aria-label="Delete appointment"
          onClick={() => onDelete(appointment)}
        >
          <Icon name="trash" size={15} />
        </button>
      ) : null}
    </div>
  )
}

function AppointmentForm({
  open,
  userId,
  onClose,
  onSaved,
}: {
  open: boolean
  userId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [doctorName, setDoctorName] = useState('')
  const [speciality, setSpeciality] = useState('')
  const [location, setLocation] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('10:00')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    setDoctorName('')
    setSpeciality('')
    setLocation('')
    setDate(toDateInputValue(tomorrow))
    setTime('10:00')
    setNotes('')
    setError(null)
  }, [open])

  async function save() {
    if (!doctorName.trim()) {
      setError('Who is the appointment with?')
      return
    }
    const base = fromDateInputValue(date)
    if (!base) {
      setError('Choose a valid date.')
      return
    }
    const [hours, minutes] = time.split(':').map(Number)
    const when = new Date(base)
    when.setHours(Number.isFinite(hours) ? hours : 10, Number.isFinite(minutes) ? minutes : 0, 0, 0)

    setSaving(true)
    setError(null)
    try {
      await addDoc(collection(db, 'appointments'), {
        userId,
        doctorName: doctorName.trim(),
        speciality: speciality.trim(),
        location: location.trim(),
        date: Timestamp.fromDate(when),
        notes: notes.trim(),
        status: 'scheduled',
        createdAt: serverTimestamp(),
      })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an appointment"
      subtitle="A reminder is created automatically once the visit is within 24 hours."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save appointment
          </Button>
        </>
      }
    >
      {error ? (
        <div className="alert-box error">
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="form-grid">
        <div className="span-2">
          <Field label="Doctor" htmlFor="appt-doctor">
            <Input
              id="appt-doctor"
              value={doctorName}
              onChange={(event) => setDoctorName(event.target.value)}
              placeholder="Dr. Ananya Rao"
              autoFocus
            />
          </Field>
        </div>

        <Field label="Speciality" htmlFor="appt-speciality">
          <Input
            id="appt-speciality"
            value={speciality}
            onChange={(event) => setSpeciality(event.target.value)}
            placeholder="Cardiology"
          />
        </Field>

        <Field label="Location" htmlFor="appt-location">
          <Input
            id="appt-location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Apollo Hospital"
          />
        </Field>

        <Field label="Date" htmlFor="appt-date">
          <Input
            id="appt-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>

        <Field label="Time" htmlFor="appt-time">
          <Input
            id="appt-time"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
        </Field>

        <div className="span-2">
          <Field label="Notes" htmlFor="appt-notes" hint="Optional — what to bring, tests, questions.">
            <Textarea
              id="appt-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Bring last month's lipid profile."
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
