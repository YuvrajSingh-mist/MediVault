'use strict'

const crypto = require('node:crypto')
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore')
const { logger } = require('firebase-functions')
const { zonedParts, parseHHMM, daysBetweenKeys, formatInZone, safeZone } = require('./time')
const { sendMail, wrapHtml } = require('./mailer')
const { sendPush } = require('./push')

/**
 * ---------------------------------------------------------------------------
 * The reminder engine
 * ---------------------------------------------------------------------------
 * One idempotent sweep does everything Cloud Scheduler asks for:
 *
 *   1. Dose reminders   - every medicine time that just came due (per timezone)
 *   2. Low stock        - remainingTablets <= refillThreshold (once per day)
 *   3. Expiry           - 30/14/7/3/1/0 days before expiryDate
 *   4. Appointments     - once, when the appointment is inside the next 24 h
 *
 * Every document id is deterministic (`dose_<medicineId>_<date>_<hhmm>`), so a
 * duplicated, retried or overlapping scheduler run can never notify twice -
 * that idempotency is what makes at-least-once scheduling safe.
 *
 * Created reminders are then grouped per user and delivered through email
 * (SendGrid or the mailOutbox fallback) and Firebase Cloud Messaging.
 */

const APP_URL = process.env.APP_URL || 'http://localhost:5173'
const WINDOW_MINUTES = clampInt(process.env.REMINDER_WINDOW_MINUTES, 5, 1, 55)
const SCOPE_LIMIT = 500
const EXPIRY_THRESHOLDS = [30, 14, 7, 3, 1, 0]
const TYPE_LABELS = {
  dose: 'Medication',
  lowstock: 'Low stock',
  expiry: 'Expiry',
  appointment: 'Appointment',
  digest: 'Daily summary',
  system: 'System',
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

const db = () => getFirestore()

/* -------------------------------------------------------------------------- */
/* Reminder creation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Creates a reminder only if it does not exist yet.
 * @returns {Promise<boolean>} true when this sweep created it
 */
async function createReminder(id, data) {
  try {
    await db()
      .collection('reminders')
      .doc(id)
      .create({
        ...data,
        read: false,
        status: 'pending',
        channels: [],
        createdAt: FieldValue.serverTimestamp(),
      })
    return true
  } catch (err) {
    if (err && (err.code === 6 || err.code === 'already-exists')) return false
    throw err
  }
}

function prefsOf(user) {
  const prefs = (user && user.prefs) || {}
  return {
    email: prefs.email !== false,
    push: prefs.push !== false,
    dose: prefs.dose !== false,
    lowStock: prefs.lowStock !== false,
    expiry: prefs.expiry !== false,
    appointments: prefs.appointments !== false,
  }
}

/* -------------------------------------------------------------------------- */
/* Sweep                                                                      */
/* -------------------------------------------------------------------------- */

async function sweep({ trigger = 'scheduled', now = new Date(), actorUid = null } = {}) {
  const startedAt = Date.now()
  const stats = {
    scannedMedicines: 0,
    scannedAppointments: 0,
    createdReminders: 0,
    notifiedUsers: 0,
    emailsSent: 0,
    pushesSent: 0,
    failures: 0,
  }
  const errors = []
  /** @type {Map<string, {items: Array<{title:string, body:string, link:string, id:string}>}>} */
  const outbox = new Map()

  const queue = (userId, item) => {
    if (!outbox.has(userId)) outbox.set(userId, { items: [] })
    outbox.get(userId).items.push(item)
  }

  try {
    const [medicinesSnap, appointmentsSnap] = await Promise.all([
      db().collection('medicines').where('active', '==', true).limit(SCOPE_LIMIT).get(),
      db()
        .collection('appointments')
        .where('date', '>=', Timestamp.fromDate(new Date(now.getTime() - 5 * 60000)))
        .where('date', '<=', Timestamp.fromDate(new Date(now.getTime() + 25 * 3600000)))
        .limit(SCOPE_LIMIT)
        .get(),
    ])

    stats.scannedMedicines = medicinesSnap.size
    stats.scannedAppointments = appointmentsSnap.size

    // ---- load every owner profile once (timezone + notification prefs) -----
    const ownerIds = new Set()
    medicinesSnap.docs.forEach((doc) => ownerIds.add(doc.get('userId')))
    appointmentsSnap.docs.forEach((doc) => ownerIds.add(doc.get('userId')))
    const users = await loadUsers([...ownerIds].filter(Boolean))

    // ---- 1. dose + 2. low stock + 3. expiry -------------------------------
    for (const doc of medicinesSnap.docs) {
      const medicine = doc.data()
      const user = users.get(medicine.userId)
      if (!user) continue
      const prefs = prefsOf(user)
      const zone = safeZone(user.timezone)
      const local = zonedParts(now, zone)

      try {
        // Dose reminders -----------------------------------------------------
        const times = Array.isArray(medicine.times) ? medicine.times : []
        if (prefs.dose) {
          for (const time of times) {
            const dueMinutes = parseHHMM(time)
            if (dueMinutes === null) continue
            const diff = local.minutes - dueMinutes
            // Fire when the dose is due now, or up to WINDOW_MINUTES late
            // (Cloud Scheduler is at-least-once and can jitter).
            if (diff < 0 || diff > WINDOW_MINUTES) continue

            const id = `dose_${doc.id}_${local.dateKey}_${time.replace(':', '')}`
            const title = `Time for ${medicine.name}`
            const body = [medicine.dosage, medicine.form].filter(Boolean).join(' · ')
            const created = await createReminder(id, {
              userId: medicine.userId,
              type: 'dose',
              title,
              body: body ? `Take ${body} as prescribed.` : 'Take as prescribed.',
              medicineId: doc.id,
              dateKey: local.dateKey,
              dueAt: Timestamp.fromDate(now),
              dedupeKey: id,
              link: '/medicines',
            })
            if (created) {
              stats.createdReminders += 1
              queue(medicine.userId, {
                id,
                title,
                body: `${time} · ${body || 'scheduled dose'}`,
                link: '/dashboard',
              })
            }
          }
        }

        // Low stock ----------------------------------------------------------
        const remaining = Number(medicine.remainingTablets)
        const threshold = Number(medicine.refillThreshold)
        if (
          prefs.lowStock &&
          Number.isFinite(remaining) &&
          Number.isFinite(threshold) &&
          remaining <= threshold
        ) {
          const id = `lowstock_${doc.id}_${local.dateKey}`
          const title = `Refill ${medicine.name} soon`
          const body = `Only ${remaining} tablet${remaining === 1 ? '' : 's'} left (refill threshold ${threshold}).`
          const created = await createReminder(id, {
            userId: medicine.userId,
            type: 'lowstock',
            title,
            body,
            medicineId: doc.id,
            dateKey: local.dateKey,
            dueAt: Timestamp.fromDate(now),
            dedupeKey: id,
            link: '/medicines',
          })
          if (created) {
            stats.createdReminders += 1
            queue(medicine.userId, { id, title, body, link: '/medicines' })
          }
        }

        // Expiry -------------------------------------------------------------
        const expiry = toDate(medicine.expiryDate)
        if (prefs.expiry && expiry) {
          const expiryKey = zonedParts(expiry, zone).dateKey
          const daysLeft = daysBetweenKeys(local.dateKey, expiryKey)
          if (EXPIRY_THRESHOLDS.includes(daysLeft)) {
            const id = `expiry_${doc.id}_${local.dateKey}_d${daysLeft}`
            const title =
              daysLeft === 0
                ? `${medicine.name} expires today`
                : `${medicine.name} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`
            const body = `${medicine.name} expires on ${expiryKey}. Dispose of expired medicine safely.`
            const created = await createReminder(id, {
              userId: medicine.userId,
              type: 'expiry',
              title,
              body,
              medicineId: doc.id,
              dateKey: local.dateKey,
              dueAt: Timestamp.fromDate(expiry),
              dedupeKey: id,
              link: '/medicines',
            })
            if (created) {
              stats.createdReminders += 1
              queue(medicine.userId, { id, title, body, link: '/medicines' })
            }
          }
        }
      } catch (err) {
        stats.failures += 1
        errors.push(`medicine ${doc.id}: ${messageOf(err)}`)
        logger.error('sweep.medicine_failed', { medicineId: doc.id, error: messageOf(err) })
      }
    }

    // ---- 4. appointment reminders ----------------------------------------
    for (const doc of appointmentsSnap.docs) {
      const appointment = doc.data()
      const user = users.get(appointment.userId)
      if (!user || !prefsOf(user).appointments) continue
      const when = toDate(appointment.date)
      if (!when) continue
      const msUntil = when.getTime() - now.getTime()
      if (msUntil <= 0 || msUntil > 24 * 3600000) continue

      try {
        const id = `appt_${doc.id}_t24`
        const zone = safeZone(user.timezone)
        const title = `Appointment with ${appointment.doctorName || 'your doctor'} tomorrow`
        const body = `${formatInZone(when, zone)}${appointment.location ? ` · ${appointment.location}` : ''}`
        const created = await createReminder(id, {
          userId: appointment.userId,
          type: 'appointment',
          title,
          body,
          appointmentId: doc.id,
          dueAt: Timestamp.fromDate(when),
          dateKey: zonedParts(now, zone).dateKey,
          dedupeKey: id,
          link: '/appointments',
        })
        if (created) {
          stats.createdReminders += 1
          queue(appointment.userId, { id, title, body, link: '/appointments' })
        }
      } catch (err) {
        stats.failures += 1
        errors.push(`appointment ${doc.id}: ${messageOf(err)}`)
      }
    }

    // ---- delivery ---------------------------------------------------------
    for (const [userId, payload] of outbox.entries()) {
      const user = users.get(userId)
      if (!user) continue
      const prefs = prefsOf(user)
      const items = payload.items
      const channels = []

      try {
        if (prefs.email && user.email) {
          const result = await sendMail({
            to: user.email,
            toUid: userId,
            subject: `MediVault · ${items.length} reminder${items.length === 1 ? '' : 's'} for you`,
            text: textEmail(user, items),
            html: wrapHtml(
              `${items.length} reminder${items.length === 1 ? '' : 's'}`,
              `Hello ${user.displayName || 'there'}, here is what needs your attention:`,
              items.map((item) => `${item.title} — ${item.body}`),
              `You are receiving this because reminder emails are enabled in MediVault. Update preferences in Settings. ${APP_URL}`,
            ),
            tag: 'reminder-sweep',
          })
          if (result.status === 'sent') stats.emailsSent += 1
          channels.push(`email:${result.status}`)
        }

        if (prefs.push && Array.isArray(user.fcmTokens) && user.fcmTokens.length > 0) {
          const head = items[0]
          const push = await sendPush(user.fcmTokens, {
            title:
              items.length === 1
                ? head.title
                : `MediVault · ${items.length} reminders`,
            body:
              items.length === 1
                ? head.body
                : items.map((item) => `${item.title}`).join(' · '),
            link: `${APP_URL}${head.link || '/alerts'}`,
          })
          if (push.sent > 0) stats.pushesSent += 1
          channels.push(`push:${push.sent > 0 ? 'sent' : 'skipped'}`)
          if (push.invalidTokens.length > 0) {
            await db()
              .doc(`users/${userId}`)
              .update({ fcmTokens: FieldValue.arrayRemove(...push.invalidTokens) })
              .catch(() => {})
          }
        }

        if (channels.length === 0) channels.push('in-app')

        const batch = db().batch()
        items.forEach((item) => {
          batch.update(db().collection('reminders').doc(item.id), {
            status: 'sent',
            sentAt: FieldValue.serverTimestamp(),
            channels,
          })
        })
        await batch.commit()
        stats.notifiedUsers += 1
      } catch (err) {
        stats.failures += 1
        errors.push(`delivery ${userId}: ${messageOf(err)}`)
        logger.error('sweep.delivery_failed', { userId, error: messageOf(err) })
      }
    }
  } catch (err) {
    stats.failures += 1
    errors.push(messageOf(err))
    logger.error('sweep.failed', { error: messageOf(err) })
  }

  const summary = {
    trigger,
    actorUid,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    ...stats,
    errors: errors.slice(0, 10),
  }

  await recordRun(summary)
  logSummary(summary)
  return summary
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function textEmail(user, items) {
  const lines = [
    `Hello ${user.displayName || 'there'},`,
    '',
    'Here is what needs your attention:',
    '',
    ...items.map((item) => `• ${item.title} — ${item.body}`),
    '',
    `Open MediVault: ${APP_URL}`,
    'You can change reminder preferences in Settings.',
  ]
  return lines.join('\n')
}

async function loadUsers(uids) {
  const map = new Map()
  if (uids.length === 0) return map
  const refs = uids.map((uid) => db().doc(`users/${uid}`))
  const snaps = await db().getAll(...refs)
  for (const snap of snaps) {
    if (snap.exists) map.set(snap.id, snap.data())
  }
  return map
}

function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value.toDate === 'function') return value.toDate()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function messageOf(err) {
  return String(err && err.message ? err.message : err)
}

async function recordRun(summary) {
  try {
    const ref = db().doc('system/status')
    const snap = await ref.get()
    const previous = snap.exists ? snap.data() : {}
    const runs = Array.isArray(previous.recentRuns) ? previous.recentRuns : []
    runs.unshift({
      runId: crypto.randomUUID().slice(0, 8),
      at: summary.finishedAt,
      trigger: summary.trigger,
      durationMs: summary.durationMs,
      createdReminders: summary.createdReminders,
      notifiedUsers: summary.notifiedUsers,
      actorUid: summary.actorUid,
    })

    await ref.set(
      {
        lastRun: {
          ...summary,
          runId: runs[0].runId,
          projectId: process.env.GCLOUD_PROJECT || null,
          revision: process.env.K_REVISION || null,
        },
        recentRuns: runs.slice(0, 12),
        schedule: { sweep: 'every 5 minutes', digest: '0 8 * * *' },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  } catch (err) {
    logger.warn('status.write_failed', { error: messageOf(err) })
  }
}

function logSummary(summary) {
  const line = {
    event: 'reminder_sweep',
    trigger: summary.trigger,
    durationMs: summary.durationMs,
    scannedMedicines: summary.scannedMedicines,
    scannedAppointments: summary.scannedAppointments,
    createdReminders: summary.createdReminders,
    notifiedUsers: summary.notifiedUsers,
    emailsSent: summary.emailsSent,
    pushesSent: summary.pushesSent,
    failures: summary.failures,
  }
  if (summary.failures > 0) logger.warn(line)
  else logger.info(line)
}

/* -------------------------------------------------------------------------- */
/* Daily digest                                                               */
/* -------------------------------------------------------------------------- */

async function dailyDigest({ now = new Date() } = {}) {
  const usersSnap = await db().collection('users').limit(SCOPE_LIMIT).get()
  const results = { users: 0, emailsSent: 0, pushesSent: 0, skipped: 0 }

  for (const userDoc of usersSnap.docs) {
    const user = userDoc.data()
    if (!user.email) {
      results.skipped += 1
      continue
    }
    const prefs = prefsOf(user)
    if (!prefs.email && !prefs.push) {
      results.skipped += 1
      continue
    }

    try {
      const zone = safeZone(user.timezone)
      const { dateKey } = zonedParts(now, zone)

      const medsSnap = await db()
        .collection('medicines')
        .where('userId', '==', userDoc.id)
        .get()

      const doses = []
      let lowStock = 0
      let expiring = 0
      for (const medDoc of medsSnap.docs) {
        const med = medDoc.data()
        if (med.active === false) continue
        if (Array.isArray(med.times)) {
          med.times.forEach((time) => doses.push(`${time} · ${med.name}${med.dosage ? ` (${med.dosage})` : ''}`))
        }
        if (Number(med.remainingTablets) <= Number(med.refillThreshold)) lowStock += 1
        const expiry = toDate(med.expiryDate)
        if (expiry && daysBetweenKeys(dateKey, zonedParts(expiry, zone).dateKey) <= 30) expiring += 1
      }

      const apptsSnap = await db()
        .collection('appointments')
        .where('userId', '==', userDoc.id)
        .where('date', '>=', Timestamp.fromDate(now))
        .limit(3)
        .get()

      const appointments = apptsSnap.docs.map((doc) => {
        const appt = doc.data()
        return `${formatInZone(toDate(appt.date), zone)} · ${appt.doctorName || 'Appointment'}`
      })

      if (doses.length === 0 && appointments.length === 0 && lowStock === 0 && expiring === 0) {
        results.skipped += 1
        continue
      }

      doses.sort()
      const bullets = [
        ...doses.slice(0, 8).map((line) => `Dose — ${line}`),
        ...appointments.map((line) => `Appointment — ${line}`),
        ...(lowStock > 0 ? [`${lowStock} medicine${lowStock === 1 ? '' : 's'} need a refill`] : []),
        ...(expiring > 0 ? [`${expiring} medicine${expiring === 1 ? '' : 's'} expire within 30 days`] : []),
      ]

      if (prefs.email) {
        const result = await sendMail({
          to: user.email,
          toUid: userDoc.id,
          subject: `MediVault · your day at a glance (${dateKey})`,
          text: bullets.map((line) => `• ${line}`).join('\n'),
          html: wrapHtml('Your day at a glance', `Good morning ${user.displayName || ''}, here is your plan for ${dateKey}.`, bullets, `Open MediVault: ${APP_URL}`),
          tag: 'daily-digest',
        })
        if (result.status === 'sent') results.emailsSent += 1
      }

      if (prefs.push && Array.isArray(user.fcmTokens) && user.fcmTokens.length > 0) {
        const push = await sendPush(user.fcmTokens, {
          title: 'MediVault · your day at a glance',
          body: `${doses.length} dose${doses.length === 1 ? '' : 's'} scheduled${lowStock ? ` · ${lowStock} refill${lowStock === 1 ? '' : 's'} needed` : ''}`,
          link: `${APP_URL}/dashboard`,
        })
        if (push.sent > 0) results.pushesSent += 1
      }

      results.users += 1
    } catch (err) {
      logger.error('digest.user_failed', { userId: userDoc.id, error: messageOf(err) })
    }
  }

  logger.info({ event: 'daily_digest', ...results })
  await db().doc('system/digest').set(
    { lastRunAt: FieldValue.serverTimestamp(), ...results },
    { merge: true },
  )
  return results
}

module.exports = { sweep, dailyDigest, createReminder, TYPE_LABELS }
