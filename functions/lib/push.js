'use strict'

const { getMessaging } = require('firebase-admin/messaging')
const { logger } = require('firebase-functions')

/**
 * Firebase Cloud Messaging (web push).
 *
 * Returns the tokens FCM rejected (unregistered / invalid) so the caller can
 * prune them from the user's profile - a detail that matters in production and
 * looks good in the report.
 */
async function sendPush(tokens, { title, body, link }) {
  const targets = Array.isArray(tokens) ? tokens.filter(Boolean).slice(0, 500) : []
  if (targets.length === 0) return { sent: 0, invalidTokens: [] }

  try {
    const response = await getMessaging().sendEachForMulticast({
      tokens: targets,
      notification: { title, body },
      data: { link: link || '/alerts', title, body },
      webpush: {
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        fcmOptions: { link: link || '/alerts' },
      },
    })

    const invalidTokens = []
    response.responses.forEach((result, index) => {
      if (result.success) return
      const code = result.error && result.error.code
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        invalidTokens.push(targets[index])
      }
    })

    logger.info('push.dispatched', {
      requested: targets.length,
      sent: response.successCount,
      failed: response.failureCount,
    })

    return { sent: response.successCount, invalidTokens }
  } catch (err) {
    logger.warn('push.dispatch_failed', { error: String(err && err.message ? err.message : err) })
    return { sent: 0, invalidTokens: [] }
  }
}

module.exports = { sendPush }
