import { useMemo, useState } from 'react'
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { useReminders, useUnreadCount } from '../lib/data'
import { api, errorMessage } from '../lib/api'
import { formatDateTime, relativeTime } from '../lib/format'
import type { Reminder, ReminderType } from '../types'
import { Icon } from '../components/Icons'
import {
  Badge,
  Button,
  Card,
  CardHead,
  EmptyState,
  PageHeader,
  Skeleton,
  cx,
} from '../components/ui'

const TYPE_META: Record<ReminderType, { label: string; icon: 'pill' | 'alert' | 'shield' | 'calendar' | 'mail' | 'cloud' }> = {
  dose: { label: 'Dose', icon: 'pill' },
  lowstock: { label: 'Refill', icon: 'alert' },
  expiry: { label: 'Expiry', icon: 'shield' },
  appointment: { label: 'Appointment', icon: 'calendar' },
  digest: { label: 'Digest', icon: 'mail' },
  system: { label: 'System', icon: 'cloud' },
}

type Filter = 'all' | 'unread' | 'dose' | 'lowstock' | 'expiry' | 'appointment'

export function AlertsPage() {
  const { activeUserId, isCaregiverView } = useAuth()
  const { toast } = useToast()
  const reminders = useReminders(activeUserId, 80)
  const unread = useUnreadCount(reminders)
  const [filter, setFilter] = useState<Filter>('all')
  const [sweeping, setSweeping] = useState(false)
  const [marking, setMarking] = useState(false)

  const filtered = useMemo(() => {
    const list = reminders || []
    if (filter === 'all') return list
    if (filter === 'unread') return list.filter((item) => !item.read)
    return list.filter((item) => item.type === filter)
  }, [reminders, filter])

  async function markAllRead() {
    const targets = (reminders || []).filter((item) => !item.read)
    if (targets.length === 0) return
    setMarking(true)
    try {
      const batch = writeBatch(db)
      targets.forEach((item) => {
        batch.update(doc(db, 'reminders', item.id), { read: true, readAt: serverTimestamp() })
      })
      await batch.commit()
      toast(`${targets.length} alert${targets.length === 1 ? '' : 's'} marked as read.`, 'success')
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setMarking(false)
    }
  }

  async function markOne(item: Reminder) {
    try {
      await writeBatch(db)
        .update(doc(db, 'reminders', item.id), { read: true, readAt: serverTimestamp() })
        .commit()
    } catch (err) {
      toast(errorMessage(err), 'error')
    }
  }

  async function runSweep() {
    setSweeping(true)
    try {
      const summary = await api.runSweepNow()
      toast(
        summary.createdReminders > 0
          ? `Sweep done · ${summary.createdReminders} new alert(s) in ${summary.durationMs} ms.`
          : `Sweep done in ${summary.durationMs} ms — nothing due in this window.`,
        'success',
      )
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setSweeping(false)
    }
  }

  const counts = useMemo(() => {
    const list = reminders || []
    return {
      all: list.length,
      unread: list.filter((item) => !item.read).length,
      dose: list.filter((item) => item.type === 'dose').length,
      lowstock: list.filter((item) => item.type === 'lowstock').length,
      expiry: list.filter((item) => item.type === 'expiry').length,
      appointment: list.filter((item) => item.type === 'appointment').length,
    }
  }, [reminders])

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Every alert is produced by the reminder engine and stored in Firestore — email and push delivery channels are recorded on each document."
        actions={
          <>
            <Button
              variant="ghost"
              icon="check"
              onClick={markAllRead}
              loading={marking}
              disabled={!unread}
            >
              Mark all read
            </Button>
            {!isCaregiverView ? (
              <Button icon="refresh" onClick={runSweep} loading={sweeping}>
                Run sweep
              </Button>
            ) : null}
          </>
        }
      />

      <div className="filters" style={{ marginBottom: 16 }}>
        {(
          [
            ['all', 'All'],
            ['unread', 'Unread'],
            ['dose', 'Doses'],
            ['lowstock', 'Refills'],
            ['expiry', 'Expiry'],
            ['appointment', 'Appointments'],
          ] as Array<[Filter, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="filter-pill"
            data-active={filter === value}
            onClick={() => setFilter(value)}
          >
            {label} {counts[value] > 0 ? `(${counts[value]})` : ''}
          </button>
        ))}
      </div>

      <Card>
        <CardHead
          title="Notification feed"
          subtitle={
            reminders === null
              ? 'Loading…'
              : `${counts.all} alert${counts.all === 1 ? '' : 's'} · ${counts.unread} unread`
          }
          actions={<Badge tone={unread ? 'amber' : 'brand'} dot>{unread ? `${unread} unread` : 'All read'}</Badge>}
        />

        {reminders === null ? (
          <div style={{ padding: 18, display: 'grid', gap: 10 }}>
            <Skeleton height={48} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="bell"
            title={counts.all === 0 ? 'No alerts yet' : 'Nothing in this view'}
            message={
              counts.all === 0
                ? 'Cloud Scheduler checks doses, stock, expiry and appointments every five minutes. You can also run the sweep manually to see it happen now.'
                : 'Try another filter, or mark alerts as read to clear this view.'
            }
            action={
              !isCaregiverView && counts.all === 0 ? (
                <Button icon="refresh" variant="soft" size="sm" onClick={runSweep} loading={sweeping}>
                  Run a sweep now
                </Button>
              ) : null
            }
          />
        ) : (
          <div>
            {filtered.map((item) => {
              const meta = TYPE_META[item.type] || TYPE_META.system
              return (
                <div key={item.id} className={cx('alert-row', !item.read && 'unread')}>
                  <div className={cx('alert-icon', item.type)}>
                    <Icon name={meta.icon} size={16} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="alert-title">{item.title}</div>
                    <div className="alert-body">{item.body}</div>
                    <div className="alert-meta">
                      <Badge tone="default">{meta.label}</Badge>
                      <span>{relativeTime(item.createdAt)}</span>
                      <span>·</span>
                      <span>{formatDateTime(item.createdAt)}</span>
                      {item.channels && item.channels.length > 0 ? (
                        <>
                          <span>·</span>
                          <span className="mono">{item.channels.join(' · ')}</span>
                        </>
                      ) : null}
                      <span className="mono" style={{ color: 'var(--muted-2)' }}>
                        {item.id}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                    {!item.read ? (
                      <>
                        <span className="status-dot" />
                        <button type="button" className="btn-link" onClick={() => void markOne(item)}>
                          Mark read
                        </button>
                      </>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>Read</span>
                    )}
                    {item.status === 'taken' ? <Badge tone="brand">Taken</Badge> : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <p style={{ marginTop: 14, fontSize: 11.5, color: 'var(--muted-2)' }}>
        Alert ids are deterministic (e.g. <span className="mono">dose_&lt;medicineId&gt;_&lt;date&gt;_0800</span>),
        which makes the scheduler idempotent: retries can never duplicate a notification.
      </p>
    </>
  )
}
