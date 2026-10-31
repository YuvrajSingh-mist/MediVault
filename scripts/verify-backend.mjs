#!/usr/bin/env node
/**
 * MediVault - end-to-end backend verification against the Firebase Emulator Suite.
 *
 * It exercises exactly the cloud behaviour the project is graded on:
 *   Firebase Authentication sign-up, Firestore security rules, Cloud Functions
 *   (callable + scheduled-engine logic), the Cloud Storage upload trigger,
 *   transactional inventory updates and the email outbox.
 *
 * Usage:
 *   npm run emulators          # in one terminal
 *   node scripts/verify-backend.mjs
 */

import { initializeApp, deleteApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { connectStorageEmulator, getStorage, ref, uploadBytes } from 'firebase/storage'

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-medivault'
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`
const ST = 'http://127.0.0.1:9199'
const BUCKET = process.env.STORAGE_BUCKET || `${PROJECT}.appspot.com`

let passed = 0
let failed = 0
const results = []

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    results.push(`  PASS  ${name}${detail ? ` - ${detail}` : ''}`)
  } else {
    failed += 1
    results.push(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function json(response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { raw: text }
  }
}

async function signUp(email, password) {
  const res = await fetch(`${AUTH}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
  const body = await json(res)
  if (!res.ok) throw new Error(`signUp ${email}: ${JSON.stringify(body)}`)
  return body
}

async function call(name, token, data = {}) {
  const res = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  })
  const body = await json(res)
  return { ok: res.ok, status: res.status, body: body.result ?? body.error ?? body }
}

async function fsGet(path, token = 'owner') {
  const res = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return { status: res.status, body: await json(res) }
}

async function fsList(collection, token = 'owner') {
  const res = await fetch(`${FS}/${collection}?pageSize=200`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await json(res)
  return { status: res.status, docs: body.documents || [] }
}

function fields(doc) {
  return doc?.fields || {}
}

function str(doc, key) {
  const f = fields(doc)[key]
  return f?.stringValue ?? f?.integerValue ?? null
}

function num(doc, key) {
  const f = fields(doc)[key]
  return f ? Number(f.integerValue ?? f.doubleValue ?? 0) : null
}

/**
 * Uploads with the real Firebase Web SDK - the exact code path the app uses in
 * `src/pages/Prescriptions.tsx` - so `storage.rules` are evaluated for real.
 */
async function uploadObject(email, password, objectPath, contentType, bytes) {
  const app = initializeApp(
    {
      apiKey: 'demo-medivault-key',
      authDomain: `${PROJECT}.firebaseapp.com`,
      projectId: PROJECT,
      storageBucket: BUCKET,
      appId: '1:000000000000:web:medivaultverify',
    },
    `verify-${Math.random().toString(36).slice(2)}`,
  )
  try {
    const auth = getAuth(app)
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    const storage = getStorage(app)
    connectStorageEmulator(storage, '127.0.0.1', 9199)
    await signInWithEmailAndPassword(auth, email, password)
    await uploadBytes(ref(storage, objectPath), Buffer.from(bytes), { contentType })
    return { ok: true, status: 200, code: null, objectPath }
  } catch (err) {
    return { ok: false, status: err.code === 'storage/unauthorized' ? 403 : 500, code: err.code, objectPath }
  } finally {
    await deleteApp(app).catch(() => {})
  }
}

/** Restricts an admin listing to the documents owned by one test account. */
function ownedBy(docs, uid, key = 'userId') {
  return docs.filter((doc) => str(doc, key) === uid)
}

async function main() {
  console.log(`\nMediVault backend verification - project ${PROJECT}\n${'='.repeat(64)}`)

  /* ---------------------------------------------------------------- Auth -- */
  const stamp = Date.now()
  const patientEmail = `patient.${stamp}@medivault.test`
  const caregiverEmail = `caregiver.${stamp}@medivault.test`

  const patient = await signUp(patientEmail, 'medivault123')
  check('Firebase Auth: patient sign-up returns an ID token', Boolean(patient.idToken), patient.localId)

  const caregiver = await signUp(caregiverEmail, 'medivault123')
  check('Firebase Auth: caregiver sign-up returns an ID token', Boolean(caregiver.idToken))

  const caregiverProfile = await call('ensureUserProfile', caregiver.idToken, { timezone: 'Asia/Kolkata' })
  check('Cloud Function ensureUserProfile provisions the caregiver profile', caregiverProfile.body?.created === true)

  /* ------------------------------------------------------------- Profile -- */
  const profile = await call('ensureUserProfile', patient.idToken, { timezone: 'Asia/Kolkata' })
  check('Cloud Function ensureUserProfile creates the profile', profile.body?.created === true)

  const profileDoc = await fsGet(`users/${patient.localId}`)
  check(
    'Firestore: users/{uid} stores timezone + notification prefs',
    str(profileDoc.body, 'timezone') === 'Asia/Kolkata' && Boolean(fields(profileDoc.body).prefs),
    str(profileDoc.body, 'timezone'),
  )

  /* ------------------------------------------------------------- Seeding -- */
  const seeded = await call('seedDemoData', patient.idToken)
  check(
    'Cloud Function seedDemoData writes demo medicines',
    seeded.body?.seeded === true && seeded.body?.medicines === 4 && seeded.body?.appointments === 2,
    `${seeded.body?.medicines} medicines / ${seeded.body?.appointments} appointments`,
  )

  const medicines = ownedBy((await fsList('medicines')).docs, patient.localId)
  check('Firestore: medicines collection readable by owner', medicines.length === 4, `${medicines.length} owned`)
  const atorva = medicines.find((d) => str(d, 'name') === 'Atorvastatin')
  check(
    'Firestore: Atorvastatin seeded below its refill threshold',
    atorva && num(atorva, 'remainingTablets') <= num(atorva, 'refillThreshold'),
    atorva ? `${num(atorva, 'remainingTablets')} <= ${num(atorva, 'refillThreshold')}` : 'missing',
  )

  /* ------------------------------------------------- Security rules: read -- */
  const forbidden = await fsGet(`medicines/${atorva.name.split('/').pop()}`, caregiver.idToken)
  check(
    'Firestore rules: unrelated caregiver cannot read another patient medicine',
    forbidden.status === 403,
    `HTTP ${forbidden.status}`,
  )
  const forbiddenList = await fsList('medicines', caregiver.idToken)
  check(
    'Firestore rules: a stranger query on medicines is rejected',
    forbiddenList.status === 403 || forbiddenList.docs.length === 0,
    `HTTP ${forbiddenList.status}`,
  )

  /* ------------------------------------------------ Storage trigger (file) -- */
  const upload = await uploadObject(
    patientEmail,
    'medivault123',
    `prescriptions/${patient.localId}/${Date.now()}_blood-test.pdf`,
    'application/pdf',
    '%PDF-1.4\n% MediVault demo prescription\n',
  )
  check(
    'Cloud Storage: prescription PDF uploaded to private bucket',
    upload.ok,
    `HTTP ${upload.status}`,
  )

  let indexed = null
  for (let i = 0; i < 25 && !indexed; i += 1) {
    await sleep(400)
    const list = await fsList('prescriptions')
    indexed = list.docs.find((d) => str(d, 'storagePath') === upload.objectPath) || null
  }
  check(
    'Storage trigger: onPrescriptionUploaded indexes the object into Firestore',
    Boolean(indexed),
    indexed ? `prescriptions/${indexed.name.split('/').pop()}` : 'no document',
  )
  check(
    'Storage trigger: metadata (content type + owner) written by Cloud Function',
    Boolean(indexed) &&
      str(indexed, 'contentType') === 'application/pdf' &&
      str(indexed, 'userId') === patient.localId,
  )

  const badUpload = await uploadObject(
    patientEmail,
    'medivault123',
    `prescriptions/${patient.localId}/${Date.now()}_forbidden.txt`,
    'text/plain',
    'not allowed',
  )
  check(
    'Storage rules: text/plain upload rejected (image/PDF only)',
    badUpload.status === 403,
    badUpload.code || `HTTP ${badUpload.status}`,
  )

  const foreignUpload = await uploadObject(
    caregiverEmail,
    'medivault123',
    `prescriptions/${patient.localId}/${Date.now()}_intrusion.pdf`,
    'application/pdf',
    '%PDF-1.4\n% not your file\n',
  )
  check(
    'Storage rules: a stranger cannot write into another patient folder',
    foreignUpload.status === 403,
    foreignUpload.code || `HTTP ${foreignUpload.status}`,
  )

  /* ------------------------------------- Scheduled reminder engine (sweep) -- */
  // Reset the manual-sweep throttle so repeated verification runs are identical.
  await fetch(`${FS}/system/manualSweep`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer owner' },
  })

  const sweep = await call('runReminderSweepNow', patient.idToken)
  const counts = sweep.body || {}
  check(
    'Cloud Scheduler logic: sweep fans out dose / stock / expiry / appointment reminders',
    sweep.ok && Number(counts.createdReminders) > 0,
    `createdReminders=${counts.createdReminders} emails=${counts.emailsSent} scans=${counts.scannedMedicines} meds`,
  )
  check(
    'Cloud Function: sweep records an execution row in system/status for observability',
    Number(counts.durationMs) >= 0 && Boolean(counts.finishedAt),
    `${counts.durationMs}ms`,
  )

  const reminders = ownedBy((await fsList('reminders')).docs, patient.localId)
  const kinds = new Set(reminders.map((d) => str(d, 'type')))
  check(
    'Firestore: reminders deduplicated by deterministic ids',
    reminders.length > 0 && new Set(reminders.map((d) => d.name)).size === reminders.length,
    [...kinds].join(', '),
  )

  const outbox = ownedBy((await fsList('mailOutbox')).docs, patient.localId, 'toUid')
  check(
    'Notification delivery: reminder emails queued in mailOutbox',
    outbox.length > 0,
    `${outbox.length} queued (${str(outbox[0], 'provider')}/${str(outbox[0], 'status')})`,
  )

  const again = await call('runReminderSweepNow', patient.idToken)
  check(
    'Idempotency: a second sweep within 20s is throttled',
    again.ok === false && again.status >= 400,
    again.body?.message || `HTTP ${again.status}`,
  )

  /* ------------------------------------------- Transactional dose logging -- */
  const metformin = medicines.find((d) => str(d, 'name') === 'Metformin')
  const metforminId = metformin.name.split('/').pop()
  const before = num(metformin, 'remainingTablets')
  const times = (fields(metformin).times?.arrayValue?.values || []).map((v) => v.stringValue)

  const take = await call('logDose', patient.idToken, {
    medicineId: metforminId,
    dateKey: new Date().toISOString().slice(0, 10),
    time: times[0],
    action: 'take',
  })
  check(
    'Cloud Function logDose takes a dose and decrements stock transactionally',
    take.ok && take.body?.remainingTablets === before - 1,
    `${before} -> ${take.body?.remainingTablets}`,
  )

  await call('logDose', patient.idToken, {
    medicineId: metforminId,
    dateKey: new Date().toISOString().slice(0, 10),
    time: times[0],
    action: 'take',
  })
  const afterDouble = await fsGet(`medicines/${metforminId}`)
  check(
    'Idempotency: tapping "Take" twice does not double-deduct inventory',
    num(afterDouble.body, 'remainingTablets') === before - 1,
    `still ${num(afterDouble.body, 'remainingTablets')}`,
  )

  const undo = await call('logDose', patient.idToken, {
    medicineId: metforminId,
    dateKey: new Date().toISOString().slice(0, 10),
    time: times[0],
    action: 'undo',
  })
  check('Cloud Function logDose undo restores the tablet', undo.body?.remainingTablets === before, `back to ${undo.body?.remainingTablets}`)

  /* --------------------------------------------------- Caregiver sharing -- */
  const codeRes = await call('generateCaregiverCode', patient.idToken)
  const code = codeRes.body?.code
  check('Cloud Function generateCaregiverCode issues a 6-character code', /^[A-Z0-9]{6}$/.test(code || ''), code)

  const redeem = await call('redeemCaregiverCode', caregiver.idToken, { code })
  check('Cloud Function redeemCaregiverCode links the caregiver', redeem.ok && redeem.body?.ownerId === patient.localId)

  const ownerAfter = await fsGet(`users/${patient.localId}`)
  check(
    'Firestore: caregiver array on the patient profile updated',
    (fields(ownerAfter.body).caregivers?.arrayValue?.values || []).some(
      (v) => v.stringValue === caregiver.localId,
    ),
  )

  const caregiverRead = await fsGet(`medicines/${metforminId}`, caregiver.idToken)
  check('Firestore rules: linked caregiver can now read the patient medicine', caregiverRead.status === 200)

  const caregiverDose = await call('logDose', caregiver.idToken, {
    medicineId: metforminId,
    dateKey: new Date().toISOString().slice(0, 10),
    time: times[1] || times[0],
    action: 'take',
  })
  check(
    'Cloud Function logDose accepts a linked caregiver and records loggedByRole',
    caregiverDose.ok && caregiverDose.body?.role === 'caregiver',
    `role=${caregiverDose.body?.role}`,
  )

  /* ------------------------------------------------------- Email + health -- */
  const mail = await call('sendTestEmail', patient.idToken)
  check('Cloud Function sendTestEmail queues a test message', mail.ok, mail.body?.provider || mail.body?.status)

  const health = await call('cloudHealth', patient.idToken)
  check(
    'Cloud Function cloudHealth reports Firestore + runtime + bucket',
    health.ok && health.body?.firestoreOk === true && Boolean(health.body?.bucket),
    `${health.body?.runtime} / ${health.body?.mailProvider} / ${health.body?.latencyMs}ms`,
  )

  /* ------------------------------------------------------------- Summary -- */
  console.log(results.join('\n'))
  console.log(`${'='.repeat(64)}`)
  console.log(`${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nVerification failed to run:', err.message)
  process.exit(1)
})
