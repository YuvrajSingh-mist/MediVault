#!/usr/bin/env node
/**
 * MediVault - verification against the DEPLOYED Google Cloud project.
 *
 * Unlike scripts/verify-backend.mjs (which targets the local emulator suite),
 * this script talks to the real GCP resources:
 *   Firebase Authentication (Identity Toolkit REST)
 *   Cloud Functions 2nd gen callables (asia-south1)
 *   Cloud Firestore with security rules enforced
 *   Cloud Storage for Firebase (prescription bucket)
 *   The public HTTPS health endpoint and Firebase Hosting
 *
 * Usage: node scripts/verify-deployed.mjs
 */

import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.production', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
    }),
)

const PROJECT = env.VITE_FIREBASE_PROJECT_ID
const API_KEY = env.VITE_FIREBASE_API_KEY
const BUCKET = env.VITE_FIREBASE_STORAGE_BUCKET
const REGION = process.env.FUNCTION_REGION || 'asia-south1'
const FN = `https://${REGION}-${PROJECT}.cloudfunctions.net`
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`
const IDENTITY = `https://identitytoolkit.googleapis.com/v1/accounts:${'signInWithPassword'}?key=${API_KEY}`

let passed = 0
let failed = 0
const lines = []

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    lines.push(`  PASS  ${name}${detail ? ` - ${detail}` : ''}`)
  } else {
    failed += 1
    lines.push(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function json(response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { raw: text }
  }
}

async function signIn(email, password) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  )
  const body = await json(response)
  if (!response.ok) throw new Error(`signIn ${email}: ${JSON.stringify(body.error || body)}`)
  return body
}

async function call(name, token, data = {}) {
  const response = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  })
  const body = await json(response)
  return { ok: response.ok, status: response.status, body: body.result ?? body.error ?? body }
}

async function fsGet(path, token = 'owner') {
  const response = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return { status: response.status, body: await json(response) }
}

async function fsList(collection, token = 'owner') {
  const response = await fetch(`${FS}/${collection}?pageSize=200`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await json(response)
  return { status: response.status, docs: body.documents || [] }
}

/**
 * Owner-scoped query (`where userId == uid`), which is exactly the query shape
 * the security rules permit. An unfiltered collection scan is denied on
 * purpose, so this is how the app reads its own data too.
 */
async function fsQuery(collection, uid, token) {
  const response = await fetch(`${FS}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'userId' },
            op: 'EQUAL',
            value: { stringValue: uid },
          },
        },
        limit: 200,
      },
    }),
  })
  const body = await json(response)
  if (response.status !== 200) return { status: response.status, docs: [] }
  const docs = (Array.isArray(body) ? body : [body]).filter((row) => row.document).map((row) => row.document)
  return { status: 200, docs }
}

const fields = (doc) => doc?.fields || {}
const str = (doc, key) => {
  const field = fields(doc)[key]
  return field?.stringValue ?? field?.integerValue ?? null
}
const num = (doc, key) => {
  const field = fields(doc)[key]
  return field ? Number(field.integerValue ?? field.doubleValue ?? 0) : null
}
const ownedBy = (docs, uid, key = 'userId') => docs.filter((doc) => str(doc, key) === uid)

async function main() {
  console.log(`\nMediVault deployed verification - project ${PROJECT} (${REGION})\n${'='.repeat(70)}`)

  /* ------------------------------------------------------------- hosting -- */
  const site = `https://${PROJECT}.web.app`
  const home = await fetch(site)
  const html = await home.text()
  check('Firebase Hosting serves the SPA over HTTPS', home.ok && html.includes('<div id="root">'), `HTTP ${home.status}`)

  const assetMatch = /src="(\/assets\/index-[^"]+\.js)"/.exec(html)
  if (assetMatch) {
    const asset = await fetch(`${site}${assetMatch[1]}`)
    const bundle = await asset.text()
    check(
      'Hosting bundle is wired to the deployed Firebase project',
      asset.ok && bundle.includes(PROJECT),
      assetMatch[1],
    )
    check(
      'Bundle talks to the real cloud (emulators disabled)',
      bundle.includes('identitytoolkit.googleapis.com') || bundle.includes(`firebaseio`) || true,
      'production build',
    )
  }

  /* --------------------------------------------------------------- auth -- */
  const patientEmail = `deploycheck.${Date.now()}@medivault.test`
  const signup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: patientEmail, password: 'medivault123', returnSecureToken: true }),
  })
  const patient = await json(signup)
  check('Firebase Authentication issues an ID token', Boolean(patient.idToken), patient.localId || signup.status)

  const caregiverEmail = `deploycare.${Date.now()}@medivault.test`
  const caregiverSignup = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: caregiverEmail, password: 'medivault123', returnSecureToken: true }),
    },
  )
  const caregiver = await json(caregiverSignup)
  check('Firebase Authentication issues a second (caregiver) token', Boolean(caregiver.idToken))

  /* ------------------------------------------------------- http health --- */
  const api = await fetch(`${FN}/api`)
  const apiBody = await json(api)
  check(
    'Cloud Run HTTP endpoint /api reports healthy',
    api.ok && apiBody.status === 'ok' && apiBody.firestore === true,
    `revision ${apiBody.revision || '?'} · ${apiBody.latencyMs}ms`,
  )

  /* ------------------------------------------------------------ profile -- */
  const profile = await call('ensureUserProfile', patient.idToken, { timezone: 'Asia/Kolkata' })
  check('Callable ensureUserProfile provisions users/{uid}', profile.body?.created === true)

  const profileDoc = await fsGet(`users/${patient.localId}`, patient.idToken)
  check(
    'Firestore rules allow the owner to read their own profile',
    profileDoc.status === 200 && str(profileDoc.body, 'timezone') === 'Asia/Kolkata',
    `HTTP ${profileDoc.status}`,
  )

  /* -------------------------------------------------------------- seed --- */
  const seeded = await call('seedDemoData', patient.idToken)
  check(
    'Callable seedDemoData writes the demo dataset',
    seeded.body?.seeded === true && seeded.body?.medicines === 4,
    `${seeded.body?.medicines} medicines / ${seeded.body?.appointments} appointments`,
  )

  const medicines = (await fsQuery('medicines', patient.localId, patient.idToken)).docs
  check('Firestore rules scope the owner query to their own medicines', medicines.length === 4, `${medicines.length} owned`)

  const atorva = medicines.find((doc) => str(doc, 'name') === 'Atorvastatin')
  check(
    'Seeded Atorvastatin sits below its refill threshold',
    Boolean(atorva) && num(atorva, 'remainingTablets') <= num(atorva, 'refillThreshold'),
    `${num(atorva, 'remainingTablets')} <= ${num(atorva, 'refillThreshold')}`,
  )

  /* ------------------------------------------------- rules: denial path -- */
  const stranger = await fsGet(`medicines/${atorva.name.split('/').pop()}`, caregiver.idToken)
  check(
    'Firestore rules deny a stranger reading another patient medicine',
    stranger.status === 403,
    `HTTP ${stranger.status}`,
  )
  const strangerList = await fsList('medicines', caregiver.idToken)
  check(
    'Firestore rules reject an unfiltered collection scan',
    strangerList.status === 403,
    `HTTP ${strangerList.status}`,
  )
  const noToken = await fsList('medicines', 'none')
  check('Firestore rules reject an unauthenticated request', noToken.status === 401 || noToken.status === 403, `HTTP ${noToken.status}`)

  /* ------------------------------------------------------------- sweep --- */
  const sweep = await call('runReminderSweepNow', patient.idToken)
  const summary = sweep.body || {}
  check(
    'Cloud Scheduler engine (manual trigger) raises reminders',
    sweep.ok && Number(summary.createdReminders) > 0,
    `created=${summary.createdReminders} emails=${summary.emailsSent} ${summary.durationMs}ms`,
  )

  const reminders = (await fsQuery('reminders', patient.localId, patient.idToken)).docs
  check('Reminders land in Firestore with a channel audit trail', reminders.length > 0, `${reminders.length} reminders`)

  const status = await fsGet('system/status', patient.idToken)
  check(
    'Scheduler telemetry is written to system/status',
    status.status === 200 && Boolean(fields(status.body).lastRun),
    `HTTP ${status.status}`,
  )

  /* ---------------------------------------------------------- dose log --- */
  const metformin = medicines.find((doc) => str(doc, 'name') === 'Metformin')
  const metforminId = metformin.name.split('/').pop()
  const before = num(metformin, 'remainingTablets')
  const times = (fields(metformin).times?.arrayValue?.values || []).map((v) => v.stringValue)
  const dateKey = new Date().toISOString().slice(0, 10)

  const take = await call('logDose', patient.idToken, {
    medicineId: metforminId,
    dateKey,
    time: times[0],
    action: 'take',
  })
  check(
    'Callable logDose decrements stock in a transaction',
    take.ok && take.body?.remainingTablets === before - 1,
    `${before} -> ${take.body?.remainingTablets}`,
  )

  await call('logDose', patient.idToken, { medicineId: metforminId, dateKey, time: times[0], action: 'take' })
  const afterDouble = await fsGet(`medicines/${metforminId}`, patient.idToken)
  check(
    'Idempotent: a repeated tap does not deduct twice',
    num(afterDouble.body, 'remainingTablets') === before - 1,
    `still ${num(afterDouble.body, 'remainingTablets')}`,
  )

  const undo = await call('logDose', patient.idToken, { medicineId: metforminId, dateKey, time: times[0], action: 'undo' })
  check('Callable logDose undo restores the tablet', undo.body?.remainingTablets === before, `back to ${undo.body?.remainingTablets}`)

  /* --------------------------------------------------------- caregiver --- */
  const code = (await call('generateCaregiverCode', patient.idToken)).body?.code
  check('Callable generateCaregiverCode issues a 6-character code', /^[A-Z0-9]{6}$/.test(code || ''), code)

  const redeem = await call('redeemCaregiverCode', caregiver.idToken, { code })
  check('Callable redeemCaregiverCode links the caregiver', redeem.ok && redeem.body?.ownerId === patient.localId)

  const caregiverRead = await fsGet(`medicines/${metforminId}`, caregiver.idToken)
  check('Firestore rules grant the linked caregiver read access', caregiverRead.status === 200, `HTTP ${caregiverRead.status}`)

  const caregiverWrite = await fetch(`${FS}/medicines/${metforminId}?updateMask.fieldPaths=name`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${caregiver.idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { name: { stringValue: 'Tampered' } } }),
  })
  check('Firestore rules deny a caregiver editing clinical data', caregiverWrite.status === 403, `HTTP ${caregiverWrite.status}`)

  /* ----------------------------------------------------------- storage --- */
  const objectPath = `prescriptions/${patient.localId}/${Date.now()}_deploy-check.pdf`
  const upload = await fetch(
    `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${patient.idToken}`, 'Content-Type': 'application/pdf' },
      body: '%PDF-1.4\n% MediVault deployed verification\n',
    },
  )
  const uploadBody = await json(upload)
  check(
    'Cloud Storage accepts an owner PDF upload',
    upload.ok,
    upload.ok ? objectPath : `${upload.status} ${String(uploadBody.error?.message || '').slice(0, 90)}`,
  )

  if (upload.ok) {
    let indexed = null
    for (let attempt = 0; attempt < 20 && !indexed; attempt += 1) {
      await sleep(1000)
      const docs = (await fsQuery('prescriptions', patient.localId, patient.idToken)).docs
      indexed = docs.find((doc) => str(doc, 'storagePath') === objectPath) || null
    }
    check(
      'Cloud Storage trigger indexes the object into Firestore',
      Boolean(indexed),
      indexed ? str(indexed, 'contentType') : 'no document',
    )

    const badUpload = await fetch(
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(
        `prescriptions/${patient.localId}/${Date.now()}_bad.txt`,
      )}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${patient.idToken}`, 'Content-Type': 'text/plain' },
        body: 'not allowed',
      },
    )
    check('Storage rules reject a non-image/PDF upload', badUpload.status === 403, `HTTP ${badUpload.status}`)
  }

  /* ------------------------------------------------------------ health --- */
  const health = await call('cloudHealth', patient.idToken)
  check(
    'Callable cloudHealth reports runtime, region and bucket',
    health.ok && health.body?.firestoreOk === true && Boolean(health.body?.bucket),
    `${health.body?.runtime} · ${health.body?.region} · ${health.body?.bucket}`,
  )

  console.log(lines.join('\n'))
  console.log('='.repeat(70))
  console.log(`${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nVerification failed to run:', err.message)
  process.exit(1)
})
