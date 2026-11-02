'use strict'

const { getFirestore } = require('firebase-admin/firestore')
const { HttpsError } = require('firebase-functions/v2/https')
const { createDefaultProfile } = require('./profile')

/**
 * Access control shared by all callables.
 *
 * The Firestore rules enforce the same thing for direct client access; the
 * callables re-check server-side because clients never get to be trusted.
 */
async function requireUser(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Please sign in to continue.')
  }
  const db = getFirestore()
  const ref = db.doc(`users/${request.auth.uid}`)
  const snap = await ref.get()
  if (snap.exists) return { uid: request.auth.uid, profile: snap.data() }

  // Self-healing: a signed-in user always gets a profile. This keeps callables
  // working when someone signs in on a new device (or redeems a caregiver code)
  // before the client-side ensureUserProfile call has landed.
  const { profile } = await createDefaultProfile({
    ...(request.auth.token || {}),
    uid: request.auth.uid,
  })
  await ref.set(profile, { merge: true })
  return { uid: request.auth.uid, profile }
}

function isCaregiverOf(profile, ownerId) {
  return Array.isArray(profile && profile.caregiverOf) && profile.caregiverOf.includes(ownerId)
}

/**
 * Verifies that `uid` may read `ownerId`'s health records.
 * Returns "owner" | "caregiver", throws otherwise.
 */
async function requireAccess(uid, ownerId) {
  if (!ownerId) throw new HttpsError('invalid-argument', 'Missing record owner.')
  if (uid === ownerId) return 'owner'
  const snap = await getFirestore().doc(`users/${uid}`).get()
  const profile = snap.exists ? snap.data() : null
  if (isCaregiverOf(profile, ownerId)) return 'caregiver'
  throw new HttpsError('permission-denied', 'You do not have access to this record.')
}

module.exports = { requireUser, requireAccess, isCaregiverOf }
