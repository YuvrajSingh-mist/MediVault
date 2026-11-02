'use strict'

const crypto = require('node:crypto')
const { initializeApp } = require('firebase-admin/app')
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
const { setGlobalOptions } = require('firebase-functions/v2')
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { onObjectFinalized } = require('firebase-functions/v2/storage')
const { logger } = require('firebase-functions')

const { sweep, dailyDigest } = require('./lib/engine')
const { requireUser, requireAccess } = require('./lib/access')
const { sendSms, normalisePhone, isValidPhone } = require('./lib/sms')
const { zonedParts, parseHHMM, minutesToHHMM, safeZone } = require('./lib/time')

initializeApp()
const db = getFirestore()
db.settings({ ignoreUndefinedProperties: true })

setGlobalOptions({
  region: 'asia-south1',
  memory: '256MiB',
  maxInstances: 10,
})

const REGION = 'asia-south1'
const APP_URL = process.env.APP_URL || 'http://localhost:5173'
/**
 * Cloud Storage bucket used for prescriptions. Set explicitly (functions/.env
 * -> STORAGE_BUCKET) so the storage trigger and the health check always agree
 * with the bucket the web app uploads to, instead of relying on the project's
 * default bucket.
 */
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || undefined
const DEFAULT_PREFS = {
  sms: true,
  push: true,
  dose: true,
  lowStock: true,
  expiry: true,
  appointments: true,
}

/* ========================================================================== */
/* Scheduled jobs (Cloud Scheduler -> Cloud Functions)                        */
/* ========================================================================== */

/**
 * The heart of MediVault. Cloud Scheduler invokes this every 5 minutes; each
 * run scans due doses, low stock, expiry and appointment windows and fans the
 * notifications out through email + FCM. Deterministic reminder ids make the
 * job safe to retry.
 */
exports.sweepReminders = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'UTC',
    timeoutSeconds: 300,
    retryCount: 0,
  },
  async () => {
    const summary = await sweep({ trigger: 'scheduled' })
    logger.info('sweepReminders.completed', summary)
  },
)

/** Daily 08:00 digest of the day's doses, refills and appointments. */
exports.dailyDigest = onSchedule(
  {
    schedule: '0 8 * * *',
    timeZone: 'UTC',
    timeoutSeconds: 300,
    retryCount: 0,
  },
  async () => {
    const result = await dailyDigest({ now: new Date() })
    logger.info('dailyDigest.completed', result)
  },
)

/* ========================================================================== */
/* Storage trigger (Cloud Storage -> Cloud Functions)                         */
/* ========================================================================== */

/**
 * Fires whenever a file lands in Cloud Storage under prescriptions/{uid}/.
 * The document id is derived from the object path, so retries and metadata
 * updates are idempotent. This is the "secure file handling" layer: clients
 * upload binary data straight to Storage (never through a server), and the
 * metadata that the UI reads is produced by this trusted backend.
 */
exports.onPrescriptionUploaded = onObjectFinalized(
  { bucket: STORAGE_BUCKET, memory: '256MiB', timeoutSeconds: 120 },
  async (event) => {
    const object = event.data
    const filePath = object.name || ''
    const match = /^prescriptions\/([^/]+)\/(.+)$/.exec(filePath)
    if (!match) {
      logger.debug('storage.ignored_object', { filePath })
      return
    }

    const [, userId, fileName] = match
    if (fileName.startsWith('.')) return

    const id = crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 20)
    const meta = object.metadata || {}

    await db
      .collection('prescriptions')
      .doc(id)
      .set(
        {
          userId,
          storagePath: filePath,
          fileName: decodeURIComponent(fileName.replace(/^\d+_/, '')),
          contentType: object.contentType || 'application/octet-stream',
          size: Number(object.size) || 0,
          kind: meta.kind || 'prescription',
          notes: meta.notes || '',
          uploadedAt: FieldValue.serverTimestamp(),
          bucket: object.bucket,
          generation: object.generation,
        },
        { merge: true },
      )

    logger.info('storage.prescription_indexed', {
      userId,
      filePath,
      size: object.size,
      contentType: object.contentType,
      prescriptionId: id,
    })
  },
)

/* ========================================================================== */
/* HTTP endpoint - health check for Cloud Monitoring uptime checks            */
/* ========================================================================== */

exports.api = onRequest({ cors: true, timeoutSeconds: 30 }, async (req, res) => {
  const startedAt = Date.now()
  let firestoreOk = false
  try {
    await db.doc('system/status').get()
    firestoreOk = true
  } catch (err) {
    logger.error('api.firestore_check_failed', { error: String(err) })
  }

  res.status(firestoreOk ? 200 : 503).json({
    status: firestoreOk ? 'ok' : 'degraded',
    service: 'medivault-api',
    region: REGION,
    revision: process.env.K_REVISION || 'local',
    projectId: process.env.GCLOUD_PROJECT || null,
    firestore: firestoreOk,
    latencyMs: Date.now() - startedAt,
    path: req.path,
    time: new Date().toISOString(),
  })
})

/* ========================================================================== */
/* Profile lifecycle                                                          */
/* ========================================================================== */

/**
 * Idempotently creates the user profile document after the first sign-in.
 * Keeping this in a callable (instead of an auth trigger) means the client can
 * await it and immediately render a complete dashboard.
 */
exports.ensureUserProfile = onCall({ cors: true }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Sign in first.')
  }
  const uid = request.auth.uid
  const token = request.auth.token || {}
  const data = request.data || {}
  const ref = db.doc(`users/${uid}`)
  const snap = await ref.get()

  if (!snap.exists) {
    const timezone = safeZone(data.timezone) || 'UTC'
    const profile = {
      uid,
      email: token.email || data.email || '',
      displayName: token.name || data.displayName || (token.email || '').split('@')[0] || 'MediVault user',
      photoURL: token.picture || '',
      phone: normalisePhone(token.phone_number) || '',
      phoneVerified: Boolean(token.phone_number),
      timezone,
      caregiverCode: null,
      caregivers: [],
      caregiverOf: [],
      prefs: DEFAULT_PREFS,
      fcmTokens: [],
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    }
    await ref.set(profile)
    logger.info('profile.created', { uid, timezone })
    return { created: true, profile }
  }

  const existing = snap.data()
  const patch = { lastSeenAt: FieldValue.serverTimestamp() }
  // Only fill in a timezone if the profile has none yet; never fight the user.
  if (!existing.timezone && data.timezone) {
    patch.timezone = safeZone(data.timezone)
  }
  // Adopt the Auth display name when the stored one was auto-derived from the
  // email at signup time (this is what happens during the sign-up flow).
  const autoName = (existing.email || '').split('@')[0]
  const requestedName = (data.displayName || token.name || '').trim()
  if (requestedName && (!existing.displayName || existing.displayName === autoName)) {
    patch.displayName = requestedName
  }
  // A verified phone on the Auth account is authoritative; mirror it so the
  // reminder engine can text the user even if they verified on another device.
  const verifiedPhone = normalisePhone(token.phone_number)
  if (verifiedPhone && (existing.phone !== verifiedPhone || existing.phoneVerified !== true)) {
    patch.phone = verifiedPhone
    patch.phoneVerified = true
  }
  await ref.update(patch)
  return { created: false, profile: { ...existing, ...patch } }
})

/* ========================================================================== */
/* Dose logging (transactional stock updates)                                 */
/* ========================================================================== */

/**
 * Marks a scheduled dose as taken / skipped / undone.
 *
 * Runs in a Firestore transaction so the tablet counter can never drift, even
 * with two caregivers tapping "Take" at the same moment. Caregivers may log
 * doses for the patient they look after - which is exactly the sort of
 * server-side authorization the project needs to demonstrate.
 */
exports.logDose = onCall({ cors: true }, async (request) => {
  const { uid } = await requireUser(request)
  const data = request.data || {}
  const medicineId = String(data.medicineId || '')
  const dateKey = String(data.dateKey || '')
  const time = String(data.time || '')
  const action = String(data.action || 'take')

  if (!/^[A-Za-z0-9_-]{1,200}$/.test(medicineId)) {
    throw new HttpsError('invalid-argument', 'A valid medicine is required.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new HttpsError('invalid-argument', 'A valid date is required.')
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new HttpsError('invalid-argument', 'A valid dose time (HH:mm) is required.')
  }
  if (!['take', 'skip', 'undo'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Unsupported action.')
  }

  const medicineRef = db.doc(`medicines/${medicineId}`)
  const logRef = db.doc(`doseLogs/${medicineId}_${dateKey}_${time.replace(':', '')}`)

  const result = await db.runTransaction(async (tx) => {
    const [medicineSnap, logSnap] = await Promise.all([tx.get(medicineRef), tx.get(logRef)])
    if (!medicineSnap.exists) {
      throw new HttpsError('not-found', 'That medicine no longer exists.')
    }
    const medicine = medicineSnap.data()
    const role = await requireAccess(uid, medicine.userId)
    const existing = logSnap.exists ? logSnap.data() : null
    const previousStatus = existing ? existing.status : null

    const stock = Number(medicine.remainingTablets) || 0
    const total = Number(medicine.totalTablets) || stock
    let remaining = stock

    if (action === 'undo') {
      if (previousStatus === 'taken') remaining = Math.min(stock + 1, Math.max(total, stock + 1))
      tx.delete(logRef)
    } else {
      if (action === 'take' && previousStatus !== 'taken') remaining = Math.max(0, stock - 1)
      if (action === 'skip' && previousStatus === 'taken') remaining = Math.min(stock + 1, Math.max(total, stock + 1))

      tx.set(
        logRef,
        {
          userId: medicine.userId,
          medicineId,
          medicineName: medicine.name || '',
          dateKey,
          time,
          status: action === 'take' ? 'taken' : 'skipped',
          loggedBy: uid,
          loggedByRole: role,
          takenAt: action === 'take' ? FieldValue.serverTimestamp() : null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
    }

    if (remaining !== stock) {
      tx.update(medicineRef, {
        remainingTablets: remaining,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    return {
      status: action === 'undo' ? 'pending' : action === 'take' ? 'taken' : 'skipped',
      remainingTablets: remaining,
      role,
      ownerId: medicine.userId,
    }
  })

  // Keep the alert feed in sync with what the user just did.
  if (action === 'take') {
    const reminderId = `dose_${medicineId}_${dateKey}_${time.replace(':', '')}`
    await db
      .doc(`reminders/${reminderId}`)
      .set(
        {
          userId: result.ownerId,
          status: 'taken',
          read: true,
          readAt: FieldValue.serverTimestamp(),
          acknowledgedBy: uid,
        },
        { merge: true },
      )
      .catch((err) => logger.warn('reminder.ack_failed', { reminderId, error: String(err) }))
  }

  logger.info('dose.logged', { uid, medicineId, dateKey, time, action, ...result })
  return result
})

/* ========================================================================== */
/* Manual / demo controls                                                     */
/* ========================================================================== */

/** Runs the reminder engine immediately (the "Run sweep now" demo button). */
exports.runReminderSweepNow = onCall({ cors: true, timeoutSeconds: 300 }, async (request) => {
  const { uid } = await requireUser(request)

  // Cheap abuse guard: at most one manual sweep every 20 seconds.
  const throttleRef = db.doc('system/manualSweep')
  const allowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(throttleRef)
    const last = snap.exists ? snap.get('lastAt') : null
    const lastMs = last && typeof last.toDate === 'function' ? last.toDate().getTime() : 0
    if (Date.now() - lastMs < 20000) return false
    tx.set(throttleRef, { lastAt: FieldValue.serverTimestamp(), lastBy: uid }, { merge: true })
    return true
  })

  if (!allowed) {
    throw new HttpsError('resource-exhausted', 'A sweep just ran. Try again in a few seconds.')
  }

  const summary = await sweep({ trigger: 'manual', actorUid: uid })
  logger.info('manual_sweep.completed', { uid, ...summary })
  return summary
})

/** Seeds a realistic dataset so the demo works on a brand-new account. */
exports.seedDemoData = onCall({ cors: true }, async (request) => {
  const { uid, profile } = await requireUser(request)

  const existing = await db.collection('medicines').where('userId', '==', uid).limit(1).get()
  if (!existing.empty) {
    return { seeded: false, reason: 'This account already has medicines.' }
  }

  const zone = safeZone(profile.timezone)
  const now = new Date()
  const local = zonedParts(now, zone)

  // One dose due right now, so the very first sweep produces a dose alert and
  // the dashboard is immediately demonstrable on a brand-new account.
  const soon = minutesToHHMM(local.minutes)
  const day = 86400000

  const medicines = [
    {
      name: 'Metformin',
      dosage: '500 mg',
      form: 'Tablet',
      times: ['08:00', soon, '21:00'],
      remainingTablets: 42,
      totalTablets: 60,
      refillThreshold: 10,
      expiryDate: Timestamp.fromDate(new Date(now.getTime() + 210 * day)),
      notes: 'Take with food.',
      active: true,
    },
    {
      name: 'Atorvastatin',
      dosage: '10 mg',
      form: 'Tablet',
      times: ['21:00'],
      remainingTablets: 6,
      totalTablets: 30,
      refillThreshold: 7,
      expiryDate: Timestamp.fromDate(new Date(now.getTime() + 95 * day)),
      notes: 'Cholesterol - evening dose.',
      active: true,
    },
    {
      name: 'Vitamin D3',
      dosage: '1000 IU',
      form: 'Capsule',
      times: ['09:00'],
      remainingTablets: 24,
      totalTablets: 30,
      refillThreshold: 5,
      expiryDate: Timestamp.fromDate(new Date(now.getTime() + 5 * day)),
      notes: 'Weekly blood work in December.',
      active: true,
    },
    {
      name: 'Salbutamol Inhaler',
      dosage: '100 mcg',
      form: 'Inhaler',
      times: [],
      remainingTablets: 1,
      totalTablets: 1,
      refillThreshold: 1,
      expiryDate: Timestamp.fromDate(new Date(now.getTime() + 400 * day)),
      notes: 'Rescue inhaler - as needed.',
      active: true,
    },
  ]

  const batch = db.batch()
  medicines.forEach((medicine) => {
    const ref = db.collection('medicines').doc()
    batch.set(ref, {
      ...medicine,
      userId: uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  })

  const appointments = [
    {
      doctorName: 'Dr. Ananya Rao',
      speciality: 'Cardiology',
      location: 'Apollo Hospital, Bengaluru',
      date: Timestamp.fromDate(new Date(now.getTime() + 20 * 3600000)),
      notes: 'Bring last month lipid profile.',
      status: 'scheduled',
    },
    {
      doctorName: 'Dr. Vikram Shah',
      speciality: 'Dentist',
      location: 'SmileWorks Clinic',
      date: Timestamp.fromDate(new Date(now.getTime() + 9 * day)),
      notes: 'Routine cleaning.',
      status: 'scheduled',
    },
  ]
  appointments.forEach((appointment) => {
    const ref = db.collection('appointments').doc()
    batch.set(ref, {
      ...appointment,
      userId: uid,
      createdAt: FieldValue.serverTimestamp(),
    })
  })

  await batch.commit()
  logger.info('demo.seeded', { uid, medicines: medicines.length, appointments: appointments.length })

  return {
    seeded: true,
    medicines: medicines.length,
    appointments: appointments.length,
    hint: 'Run a reminder sweep to see dose, low-stock, expiry and appointment alerts.',
  }
})

/* ========================================================================== */
/* Caregiver sharing                                                          */
/* ========================================================================== */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function generateCode(length = 6) {
  const bytes = crypto.randomBytes(length)
  let code = ''
  for (let i = 0; i < length; i += 1) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return code
}

exports.generateCaregiverCode = onCall({ cors: true }, async (request) => {
  const { uid } = await requireUser(request)

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode(6)
    const clash = await db.collection('users').where('caregiverCode', '==', code).limit(1).get()
    if (!clash.empty) continue
    await db.doc(`users/${uid}`).update({
      caregiverCode: code,
      caregiverCodeUpdatedAt: FieldValue.serverTimestamp(),
    })
    logger.info('caregiver.code_generated', { uid })
    return { code, expires: 'Rotate any time by generating a new code.' }
  }
  throw new HttpsError('internal', 'Could not allocate a share code. Please retry.')
})

exports.redeemCaregiverCode = onCall({ cors: true }, async (request) => {
  const { uid } = await requireUser(request)
  const code = String((request.data || {}).code || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{4,10}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Enter the 6-character share code.')
  }

  const matches = await db.collection('users').where('caregiverCode', '==', code).limit(1).get()
  if (matches.empty) {
    throw new HttpsError('not-found', 'That share code is not valid any more.')
  }
  const ownerDoc = matches.docs[0]
  const ownerId = ownerDoc.id
  if (ownerId === uid) {
    throw new HttpsError('failed-precondition', 'You cannot redeem your own share code.')
  }

  const ownerRef = db.doc(`users/${ownerId}`)
  const selfRef = db.doc(`users/${uid}`)

  await db.runTransaction(async (tx) => {
    const [ownerSnap, selfSnap] = await Promise.all([tx.get(ownerRef), tx.get(selfRef)])
    if (!ownerSnap.exists) {
      throw new HttpsError('not-found', 'That patient profile no longer exists.')
    }
    const caregivers = ownerSnap.get('caregivers') || []
    if (caregivers.includes(uid)) return
    if (caregivers.length >= 10) {
      throw new HttpsError('resource-exhausted', 'This patient already has 10 caregivers.')
    }
    tx.set(ownerRef, { caregivers: FieldValue.arrayUnion(uid) }, { merge: true })
    // merge:true keeps this working even if the caller has not signed in through
    // the app yet (their profile document is created by ensureUserProfile).
    tx.set(selfRef, { caregiverOf: FieldValue.arrayUnion(ownerId) }, { merge: true })
    void selfSnap
  })

  logger.info('caregiver.linked', { ownerId, caregiverUid: uid })
  return {
    ownerId,
    ownerName: ownerDoc.get('displayName') || ownerDoc.get('email') || 'Patient',
    ownerEmail: ownerDoc.get('email') || '',
  }
})

exports.removeCaregiver = onCall({ cors: true }, async (request) => {
  const { uid } = await requireUser(request)
  const caregiverUid = String((request.data || {}).caregiverUid || '')
  if (!caregiverUid) throw new HttpsError('invalid-argument', 'Missing caregiver.')

  const ownerRef = db.doc(`users/${uid}`)
  const caregiverRef = db.doc(`users/${caregiverUid}`)

  await db.runTransaction(async (tx) => {
    const ownerSnap = await tx.get(ownerRef)
    const caregivers = ownerSnap.get('caregivers') || []
    if (!caregivers.includes(caregiverUid)) {
      throw new HttpsError('not-found', 'That caregiver is not linked to your account.')
    }
    tx.update(ownerRef, { caregivers: FieldValue.arrayRemove(caregiverUid) })
    tx.set(caregiverRef, { caregiverOf: FieldValue.arrayRemove(uid) }, { merge: true })
  })

  logger.info('caregiver.removed', { ownerId: uid, caregiverUid })
  return { removed: true }
})

exports.leaveCaregiver = onCall({ cors: true }, async (request) => {
  const { uid } = await requireUser(request)
  const ownerId = String((request.data || {}).ownerUid || '')
  if (!ownerId) throw new HttpsError('invalid-argument', 'Missing patient.')

  await db.runTransaction(async (tx) => {
    const ownerRef = db.doc(`users/${ownerId}`)
    const ownerSnap = await tx.get(ownerRef)
    const caregivers = ownerSnap.get('caregivers') || []
    if (!caregivers.includes(uid)) {
      throw new HttpsError('not-found', 'You are not linked to this patient.')
    }
    tx.update(ownerRef, { caregivers: FieldValue.arrayRemove(uid) })
    tx.set(db.doc(`users/${uid}`), { caregiverOf: FieldValue.arrayRemove(ownerId) }, { merge: true })
  })

  logger.info('caregiver.left', { ownerId, caregiverUid: uid })
  return { left: true }
})

/* ========================================================================== */
/* Notifications + prescriptions                                              */
/* ========================================================================== */

exports.registerFcmToken = onCall({ cors: true }, async (request) => {
  const { uid } = await requireUser(request)
  const token = String((request.data || {}).token || '')
  const remove = Boolean((request.data || {}).remove)

  if (!token || token.length > 4096) {
    throw new HttpsError('invalid-argument', 'A valid FCM token is required.')
  }

  await db.doc(`users/${uid}`).update({
    fcmTokens: remove ? FieldValue.arrayRemove(token) : FieldValue.arrayUnion(token),
  })

  return { registered: !remove }
})

/**
 * Mirrors the phone number that Firebase Auth has already verified onto the
 * profile. The client cannot set `phoneVerified` itself (Firestore rules
 * forbid it), so this is the only way a number becomes textable.
 */
exports.syncPhone = onCall({ cors: true }, async (request) => {
  const { uid } = await requireUser(request)
  const verified = normalisePhone(request.auth.token.phone_number)
  if (!verified) {
    throw new HttpsError(
      'failed-precondition',
      'No verified phone on this account yet. Complete the SMS check first.',
    )
  }

  await db.doc(`users/${uid}`).set(
    { phone: verified, phoneVerified: true, lastSeenAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
  logger.info('phone.verified', { uid, phone: verified })
  return { phone: verified, phoneVerified: true }
})

/**
 * Records a number the user typed when verification could not run (for example
 * no SMS quota left). It is stored but marked unverified, so the reminder
 * engine will not text it until a real verification succeeds.
 */
exports.savePhone = onCall({ cors: true }, async (request) => {
  const { uid } = await requireUser(request)
  const raw = String((request.data || {}).phone || '')
  if (!isValidPhone(raw)) {
    throw new HttpsError('invalid-argument', 'That does not look like a phone number.')
  }
  const phone = normalisePhone(raw)

  await db.doc(`users/${uid}`).set(
    { phone, phoneVerified: false, lastSeenAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
  logger.info('phone.saved_unverified', { uid })
  return { phone, phoneVerified: false }
})

exports.sendTestSms = onCall({ cors: true }, async (request) => {
  const { uid, profile } = await requireUser(request)
  if (!profile.phone) throw new HttpsError('failed-precondition', 'No phone number on this account.')
  if (!profile.phoneVerified) {
    throw new HttpsError('failed-precondition', 'Verify your phone number first.')
  }

  const provider = process.env.TWILIO_ACCOUNT_SID ? 'Twilio' : 'the SMS outbox'
  const result = await sendSms({
    to: profile.phone,
    toUid: uid,
    body: `MediVault test reminder - Cloud Functions, ${provider} and Firestore are connected. ${APP_URL}`,
    tag: 'test',
  })
  logger.info('test_sms.requested', { uid, status: result.status, provider: result.provider })
  return result
})

exports.deletePrescription = onCall({ cors: true }, async (request) => {
  const { uid } = await requireUser(request)
  const prescriptionId = String((request.data || {}).prescriptionId || '')
  if (!prescriptionId) throw new HttpsError('invalid-argument', 'Missing prescription.')

  const ref = db.doc(`prescriptions/${prescriptionId}`)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Prescription not found.')

  const ownerId = snap.get('userId')
  const role = await requireAccess(uid, ownerId)
  if (role !== 'owner') {
    throw new HttpsError('permission-denied', 'Only the patient can delete a prescription.')
  }

  const storagePath = snap.get('storagePath')
  if (storagePath) {
    await getStorage().bucket(snap.get('bucket')).file(storagePath).delete({ ignoreNotFound: true })
  }
  await ref.delete()

  logger.info('prescription.deleted', { uid, prescriptionId, storagePath })
  return { deleted: true }
})

/* ========================================================================== */
/* Cloud status for the in-app observability page                             */
/* ========================================================================== */

exports.cloudHealth = onCall({ cors: true }, async (request) => {
  await requireUser(request)
  const startedAt = Date.now()
  let firestoreOk = false
  try {
    await db.doc('system/status').get()
    firestoreOk = true
  } catch (err) {
    logger.warn('cloudHealth.firestore_failed', { error: String(err) })
  }

  let bucket = STORAGE_BUCKET || null
  if (!bucket) {
    try {
      bucket = getStorage().bucket().name
    } catch (err) {
      void err
    }
  }

  return {
    projectId: process.env.GCLOUD_PROJECT || null,
    region: REGION,
    revision: process.env.K_REVISION || 'emulator',
    runtime: `nodejs${process.version.replace('v', '').split('.')[0]}`,
    bucket,
    firestoreOk,
    latencyMs: Date.now() - startedAt,
    smsProvider: process.env.TWILIO_ACCOUNT_SID ? 'twilio' : 'outbox',
    sweepWindowMinutes: Number(process.env.REMINDER_WINDOW_MINUTES || 5),
    time: new Date().toISOString(),
  }
})

/* Small module-level export used by tests / emulator debugging. */
exports.__internals = { parseHHMM }
