import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { refreshData, useMedicines } from '../lib/data'
import { errorMessage } from '../lib/api'
import {
  countExpiring,
  countLowStock,
  expiryState,
  formatDate,
  fromDateInputValue,
  isLowStock,
  pluralize,
  stockPercent,
  timeLabel,
  toDateInputValue,
  todayKey,
} from '../lib/format'
import type { Medicine } from '../types'
import { Icon } from '../components/Icons'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  Select,
  Skeleton,
  Textarea,
  Toggle,
  cx,
} from '../components/ui'

const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Inhaler', 'Drops', 'Ointment', 'Other']
const PRESETS: Array<{ label: string; time: string }> = [
  { label: 'Morning', time: '08:00' },
  { label: 'Noon', time: '14:00' },
  { label: 'Evening', time: '18:00' },
  { label: 'Night', time: '21:00' },
]

type Filter = 'all' | 'low' | 'expiring' | 'inactive'

export function MedicinesPage() {
  const { activeUserId, profile } = useAuth()
  const { toast } = useToast()
  const medicines = useMedicines(activeUserId)
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<Medicine | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Medicine | null>(null)
  const [deleting, setDeleting] = useState(false)

  const zone = profile?.timezone

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setCreating(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const filtered = useMemo(() => {
    const list = medicines || []
    const text = query.trim().toLowerCase()
    return list.filter((medicine) => {
      if (text && !`${medicine.name} ${medicine.dosage} ${medicine.form}`.toLowerCase().includes(text)) {
        return false
      }
      if (filter === 'low') return isLowStock(medicine)
      if (filter === 'expiring') {
        const state = expiryState(medicine, zone)
        return state.days !== null && state.days <= 30
      }
      if (filter === 'inactive') return medicine.active === false
      return true
    })
  }, [medicines, query, filter, zone])

  async function remove() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'medicines', deleteTarget.id))
      refreshData()
      toast(`${deleteTarget.name} removed.`, 'success')
      setDeleteTarget(null)
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setDeleting(false)
    }
  }

  const totalLow = countLowStock(medicines || [])
  const totalExpiring = countExpiring(medicines || [], zone, 30)

  return (
    <>
      <PageHeader
        title="Medicines"
        subtitle="Your medicines, stock and expiry dates."
        actions={
          <Button icon="plus" onClick={() => setCreating(true)}>
            Add medicine
          </Button>
        }
      />

      <div className="filters" style={{ marginBottom: 16 }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search medicines…" />
        <button type="button" className="filter-pill" data-active={filter === 'all'} onClick={() => setFilter('all')}>
          All {medicines ? `(${medicines.length})` : ''}
        </button>
        <button type="button" className="filter-pill" data-active={filter === 'low'} onClick={() => setFilter('low')}>
          Low stock {totalLow > 0 ? `(${totalLow})` : ''}
        </button>
        <button
          type="button"
          className="filter-pill"
          data-active={filter === 'expiring'}
          onClick={() => setFilter('expiring')}
        >
          Expiring {totalExpiring > 0 ? `(${totalExpiring})` : ''}
        </button>
        <button
          type="button"
          className="filter-pill"
          data-active={filter === 'inactive'}
          onClick={() => setFilter('inactive')}
        >
          Inactive
        </button>
      </div>

      {medicines === null ? (
        <div className="med-grid">
          {[0, 1, 2].map((index) => (
            <Card key={index} className="card-pad">
              <Skeleton height={42} width={42} />
              <div style={{ marginTop: 14 }}>
                <Skeleton height={16} width="60%" />
              </div>
              <div style={{ marginTop: 10 }}>
                <Skeleton height={12} width="80%" />
              </div>
              <div style={{ marginTop: 16 }}>
                <Skeleton height={6} />
              </div>
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon="pill"
            title={medicines.length === 0 ? 'No medicines yet' : 'Nothing matches this filter'}
            message={
              medicines.length === 0
                ? 'Add your first medicine to start a schedule. Each dose time becomes a reminder.'
                : 'Try a different search term or filter.'
            }
            action={
              medicines.length === 0 ? (
                <Button icon="plus" onClick={() => setCreating(true)}>
                  Add medicine
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <div className="med-grid">
          {filtered.map((medicine) => {
            const expiry = expiryState(medicine, zone)
            const percent = stockPercent(medicine)
            const low = isLowStock(medicine)
            return (
              <Card key={medicine.id} className="med-card">
                <div className="med-top">
                  <div className="med-avatar">{medicine.name.slice(0, 2).toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="med-name">{medicine.name}</div>
                    <div className="med-dose">
                      {[medicine.dosage, medicine.form].filter(Boolean).join(' · ') || 'No dosage set'}
                    </div>
                  </div>
                  <div className="med-actions">
                    <button
                      type="button"
                      className="mini-btn"
                      aria-label={`Edit ${medicine.name}`}
                      onClick={() => setEditing(medicine)}
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    <button
                      type="button"
                      className="mini-btn danger"
                      aria-label={`Delete ${medicine.name}`}
                      onClick={() => setDeleteTarget(medicine)}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                </div>

                <div className="chip-row">
                  {medicine.times && medicine.times.length > 0 ? (
                    medicine.times.map((time) => (
                      <span key={time} className="time-chip">
                        <Icon name="clock" size={12} /> {timeLabel(time)}
                      </span>
                    ))
                  ) : (
                    <span className="time-chip">As needed</span>
                  )}
                  {medicine.active === false ? <Badge>Inactive</Badge> : null}
                </div>

                <div>
                  <div className="med-foot" style={{ marginBottom: 6 }}>
                    <span>
                      {medicine.remainingTablets} of {medicine.totalTablets || medicine.remainingTablets} left
                    </span>
                    <span>{percent}%</span>
                  </div>
                  <div className={cx('stock-bar', low && (percent <= 25 ? 'critical' : 'low'))}>
                    <span style={{ width: `${percent}%` }} />
                  </div>
                </div>

                <div className="med-foot">
                  <span>{low ? `Refill at ${medicine.refillThreshold}` : `Threshold ${medicine.refillThreshold}`}</span>
                  {expiry.days === null ? (
                    <Badge>No expiry</Badge>
                  ) : expiry.tone === 'expired' ? (
                    <Badge tone="red">{expiry.label}</Badge>
                  ) : expiry.tone === 'warn' ? (
                    <Badge tone="amber">{expiry.label}</Badge>
                  ) : (
                    <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>
                      {formatDate(medicine.expiryDate, zone)}
                    </span>
                  )}
                </div>

                {low ? (
                  <div className="alert-box warn" style={{ fontSize: 12 }}>
                    <Icon name="alert" size={14} />
                    <span>
                      Only {pluralize(medicine.remainingTablets, 'tablet')} left. MediVault will remind
                      you daily until you refill.
                    </span>
                  </div>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}

      <MedicineForm
        open={creating || Boolean(editing)}
        medicine={editing}
        userId={activeUserId}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={(name, mode) => {
          toast(`${name} ${mode === 'create' ? 'added' : 'updated'}.`, 'success')
          setCreating(false)
          setEditing(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.name || 'medicine'}?`}
        message={
          <>
            This removes the medicine, its schedule and its history. Alerts already delivered stay
            in your alert feed. This cannot be undone.
          </>
        }
        loading={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={remove}
      />

      <p style={{ marginTop: 16, fontSize: 11.5, color: 'var(--muted-2)' }}>
        Stored in Cloud Firestore · {medicines?.length || 0} documents · today is{' '}
        {todayKey(zone)}
      </p>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Add / edit form                                                            */
/* -------------------------------------------------------------------------- */

function MedicineForm({
  open,
  medicine,
  userId,
  onClose,
  onSaved,
}: {
  open: boolean
  medicine: Medicine | null
  userId: string
  onClose: () => void
  onSaved: (name: string, mode: 'create' | 'update') => void
}) {
  const [name, setName] = useState('')
  const [dosage, setDosage] = useState('')
  const [form, setForm] = useState('Tablet')
  const [times, setTimes] = useState<string[]>([])
  const [newTime, setNewTime] = useState('08:00')
  const [remaining, setRemaining] = useState('30')
  const [total, setTotal] = useState('30')
  const [threshold, setThreshold] = useState('7')
  const [expiry, setExpiry] = useState('')
  const [notes, setNotes] = useState('')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (medicine) {
      setName(medicine.name)
      setDosage(medicine.dosage || '')
      setForm(medicine.form || 'Tablet')
      setTimes(medicine.times || [])
      setRemaining(String(medicine.remainingTablets ?? 0))
      setTotal(String(medicine.totalTablets ?? medicine.remainingTablets ?? 0))
      setThreshold(String(medicine.refillThreshold ?? 0))
      setExpiry(toDateInputValue(medicine.expiryDate))
      setNotes(medicine.notes || '')
      setActive(medicine.active !== false)
    } else {
      setName('')
      setDosage('')
      setForm('Tablet')
      setTimes(['08:00', '21:00'])
      setNewTime('08:00')
      setRemaining('30')
      setTotal('30')
      setThreshold('7')
      setExpiry('')
      setNotes('')
      setActive(true)
    }
  }, [open, medicine])

  function addTime(value: string) {
    const time = value.slice(0, 5)
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError('Pick a valid time.')
      return
    }
    setTimes((current) => (current.includes(time) ? current : [...current, time].sort()))
    setError(null)
  }

  function removeTime(value: string) {
    setTimes((current) => current.filter((time) => time !== value))
  }

  /*
   * A pack cannot hold fewer tablets than the user says are left, so every
   * stock value is checked as a whole number and against the pack size before
   * anything is written. The old code quietly raised the pack size to fit, which
   * hid typos instead of flagging them.
   */
  const stockErrors = (() => {
    const issues: { remaining?: string; total?: string; threshold?: string } = {}
    const check = (raw: string, label: string): number | null => {
      const trimmed = raw.trim()
      if (!trimmed) return 0
      if (!/^\d{1,6}$/.test(trimmed)) {
        issues[label as 'remaining' | 'total' | 'threshold'] = 'Use a whole number, 0 or more.'
        return null
      }
      return Number(trimmed)
    }
    const remainingValue = check(remaining, 'remaining')
    const totalValue = check(total, 'total')
    const thresholdValue = check(threshold, 'threshold')

    if (remainingValue !== null && totalValue !== null) {
      if (totalValue === 0 && remainingValue > 0) {
        issues.total = 'Set the pack size before counting remaining tablets.'
      } else if (remainingValue > totalValue) {
        issues.remaining = `Only ${totalValue} in the pack, so ${remainingValue} left is not possible.`
      }
    }
    if (thresholdValue !== null && totalValue !== null && totalValue > 0 && thresholdValue > totalValue) {
      issues.threshold = `Refill threshold cannot be above the pack size (${totalValue}).`
    }
    return { issues, remainingValue, totalValue, thresholdValue }
  })()

  const stockProblem =
    stockErrors.issues.remaining || stockErrors.issues.total || stockErrors.issues.threshold || null

  async function save() {
    setError(null)
    if (!name.trim()) {
      setError('Give the medicine a name.')
      return
    }
    if (name.trim().length > 80) {
      setError('Medicine name is too long. Keep it under 80 characters.')
      return
    }
    if (dosage.trim().length > 40) {
      setError('Dosage is too long. Keep it under 40 characters.')
      return
    }
    if (notes.trim().length > 600) {
      setError('Notes are too long. Keep them under 600 characters.')
      return
    }
    if (times.length > 12) {
      setError('That is a lot of doses. Keep it to 12 times a day or fewer.')
      return
    }
    if (times.length === 0 && active) {
      setError('Add at least one daily dose time, or mark the medicine inactive.')
      return
    }
    if (stockProblem) {
      setError(stockProblem)
      return
    }
    const remainingValue = stockErrors.remainingValue ?? 0
    const totalValue = stockErrors.totalValue ?? 0
    const thresholdValue = stockErrors.thresholdValue ?? 0

    const payload = {
      name: name.trim(),
      dosage: dosage.trim(),
      form,
      times: times.length > 0 ? times : [],
      remainingTablets: remainingValue,
      totalTablets: totalValue,
      refillThreshold: thresholdValue,
      expiryDate: expiry ? Timestamp.fromDate(fromDateInputValue(expiry) as Date) : null,
      notes: notes.trim(),
      active,
      updatedAt: serverTimestamp(),
    }

    setSaving(true)
    try {
      if (medicine) {
        await updateDoc(doc(db, 'medicines', medicine.id), payload)
        refreshData()
        onSaved(payload.name, 'update')
      } else {
        await addDoc(collection(db, 'medicines'), {
          ...payload,
          userId,
          createdAt: serverTimestamp(),
        })
        // A brand-new document only lands in `orderBy('createdAt')` queries once
        // the server resolves the timestamp, so ask for a fresh read here.
        refreshData()
        onSaved(payload.name, 'create')
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const remainingPreview = Number(remaining) || 0
  const totalPreview = Number(total) || 0
  const percent = totalPreview > 0 ? Math.min(100, Math.round((remainingPreview / totalPreview) * 100)) : 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={medicine ? `Edit ${medicine.name}` : 'Add a medicine'}
      subtitle="Dose times follow your profile timezone."
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {medicine ? 'Save changes' : 'Add medicine'}
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
          <Field label="Medicine name" htmlFor="med-name">
            <Input
              id="med-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Metformin"
              autoFocus
            />
          </Field>
        </div>

        <Field label="Dosage" htmlFor="med-dosage" hint="Free text, e.g. 500 mg or 2 puffs.">
          <Input
            id="med-dosage"
            value={dosage}
            onChange={(event) => setDosage(event.target.value)}
            placeholder="500 mg"
          />
        </Field>

        <Field label="Form" htmlFor="med-form">
          <Select id="med-form" value={form} onChange={(event) => setForm(event.target.value)}>
            {FORMS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>

        <div className="span-2">
          <Field
            label="Daily dose times"
            hint="Each time becomes a daily reminder. Leave empty for as-needed medicine."
          >
            <div className="chip-row" style={{ marginBottom: 8 }}>
              {times.length === 0 ? (
                <span className="muted" style={{ fontSize: 12.5 }}>
                  No scheduled doses (as needed).
                </span>
              ) : (
                times.map((time) => (
                  <span key={time} className="time-chip">
                    <Icon name="clock" size={12} /> {timeLabel(time)}
                    <button type="button" onClick={() => removeTime(time)} aria-label={`Remove ${time}`}>
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                ))
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Input
                type="time"
                value={newTime}
                onChange={(event) => setNewTime(event.target.value)}
                style={{ maxWidth: 150 }}
                aria-label="New dose time"
              />
              <Button variant="soft" icon="plus" onClick={() => addTime(newTime)} type="button">
                Add time
              </Button>
            </div>
            <div className="chip-row" style={{ marginTop: 8 }}>
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="filter-pill"
                  style={{ height: 27, fontSize: 11.5 }}
                  onClick={() => addTime(preset.time)}
                >
                  + {preset.label} {preset.time}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Tablets remaining" htmlFor="med-remaining" error={stockErrors.issues.remaining}>
          <Input
            id="med-remaining"
            type="number"
            inputMode="numeric"
            min={0}
            max={999999}
            step={1}
            value={remaining}
            onChange={(event) => setRemaining(event.target.value)}
          />
        </Field>

        <Field label="Total in pack" htmlFor="med-total" error={stockErrors.issues.total}>
          <Input
            id="med-total"
            type="number"
            inputMode="numeric"
            min={0}
            max={999999}
            step={1}
            value={total}
            onChange={(event) => setTotal(event.target.value)}
          />
        </Field>

        <Field
          label="Refill threshold"
          htmlFor="med-threshold"
          hint="Alert when stock drops to this."
          error={stockErrors.issues.threshold}
        >
          <Input
            id="med-threshold"
            type="number"
            inputMode="numeric"
            min={0}
            max={999999}
            step={1}
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
        </Field>

        <Field label="Expiry date" htmlFor="med-expiry" hint="Alerts at 30, 14, 7, 3, 1 and 0 days.">
          <Input
            id="med-expiry"
            type="date"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          />
        </Field>

        <div className="span-2">
          <div className="med-foot" style={{ marginBottom: 6 }}>
            <span>Stock preview</span>
            <span>
              {remainingPreview} / {totalPreview} · {percent}%
            </span>
          </div>
          <div className={cx('stock-bar', remainingPreview <= Number(threshold) && 'low')}>
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>

        <div className="span-2">
          <Field label="Notes" htmlFor="med-notes" hint="Optional: instructions, prescriber, side effects.">
            <Textarea
              id="med-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Take with food."
            />
          </Field>
        </div>

        <div className="span-2">
          <Toggle
            checked={active}
            onChange={setActive}
            label="Active medicine"
            description="Inactive medicines stay listed and stop sending reminders."
          />
        </div>
      </div>
    </Modal>
  )
}
