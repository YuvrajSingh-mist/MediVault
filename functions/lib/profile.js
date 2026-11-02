'use strict'

const { FieldValue } = require('firebase-admin/firestore')
const { normalisePhone } = require('./sms')

const DEFAULT_PREFS = {
  sms: true,
  push: true,
  dose: true,
  lowStock: true,
  expiry: true,
  appointments: true,
}

function safeZone(zone) {
  if (typeof zone !== 'string' || !zone.trim()) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return null
  }
}

/**
 * The user profile document shape, shared by ensureUserProfile and by the
 * self-healing path in lib/access.js so both always produce the same record.
 */
function buildDefaultProfile(uid, token = {}, data = {}) {
  return {
    uid,
    email: token.email || data.email || '',
    displayName:
      token.name || data.displayName || (token.email || '').split('@')[0] || 'MediVault user',
    photoURL: token.picture || '',
    // Firebase Auth only puts phone_number in the token once the number has
    // been verified, so a token-borne number is already trustworthy.
    phone: normalisePhone(token.phone_number) || '',
    // Only a Cloud Function sets this, after Firebase Auth has proved the
    // number. The reminder engine refuses to text an unverified number.
    phoneVerified: Boolean(token.phone_number),
    timezone: safeZone(data.timezone) || 'UTC',
    caregiverCode: null,
    caregivers: [],
    caregiverOf: [],
    prefs: DEFAULT_PREFS,
    fcmTokens: [],
    createdAt: FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
  }
}

async function createDefaultProfile(token = {}, data = {}) {
  const profile = buildDefaultProfile(token.uid || token.sub, token, data)
  return { profile }
}

module.exports = { DEFAULT_PREFS, safeZone, buildDefaultProfile, createDefaultProfile }
