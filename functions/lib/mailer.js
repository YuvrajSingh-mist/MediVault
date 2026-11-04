'use strict'

const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { logger } = require('firebase-functions')

/**
 * Email delivery.
 *
 * Two transports are supported, chosen in this order:
 *
 *   1. SendGrid, when SENDGRID_API_KEY + MAIL_FROM are set.
 *   2. SMTP, when SMTP_HOST + SMTP_USER + SMTP_PASS are set. A Gmail account
 *      with an app password works here, which is the cheapest way to send real
 *      mail from a project with no domain of its own.
 *
 * When neither is configured (class demo, offline emulator) the message is
 * still composed and stored in `mailOutbox` with status "logged". That keeps
 * the reminder pipeline demonstrable, but it also means nothing is delivered,
 * so the caller can tell the difference from the returned status.
 */
function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
}

function sendgridConfigured() {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.MAIL_FROM)
}

/** Which transport a send would use right now. */
function mailProvider() {
  if (sendgridConfigured()) return 'sendgrid'
  if (smtpConfigured()) return 'smtp'
  return 'outbox'
}

function fromAddress() {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM
  const name = process.env.MAIL_FROM_NAME || 'MediVault'
  return `${name} <${process.env.SMTP_USER}>`
}

async function sendViaSendGrid({ recipient, subject, text, html }) {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: recipient }] }],
      from: parseAddress(fromAddress()),
      subject,
      content: [
        { type: 'text/plain', value: text },
        ...(html ? [{ type: 'text/html', value: html }] : []),
      ],
      tracking_settings: { click_tracking: { enable: false } },
    }),
  })
  if (response.ok) return
  const detail = await response.text()
  throw new Error(`SendGrid ${response.status}: ${detail}`.slice(0, 400))
}

/** One pooled transport per container, so a sweep does not reconnect per mail. */
let smtpTransport = null
function transport() {
  if (smtpTransport) return smtpTransport
  // Loaded lazily: a deployment that only uses SendGrid never pays for it.
  const nodemailer = require('nodemailer')
  const port = Number(process.env.SMTP_PORT || 465)
  smtpTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
  return smtpTransport
}

async function sendViaSmtp({ recipient, subject, text, html }) {
  await transport().sendMail({
    from: fromAddress(),
    to: recipient,
    subject,
    text,
    ...(html ? { html } : {}),
  })
}

async function sendMail({ to, toUid, subject, text, html, tag = 'reminder' }) {
  const recipient = (to || '').trim()
  const provider = mailProvider()

  let status = 'logged'
  let error = null

  if (provider === 'sendgrid' && recipient) {
    try {
      await sendViaSendGrid({ recipient, subject, text, html })
      status = 'sent'
    } catch (err) {
      status = 'failed'
      error = String(err && err.message ? err.message : err)
    }
  } else if (provider === 'smtp' && recipient) {
    try {
      await sendViaSmtp({ recipient, subject, text, html })
      status = 'sent'
    } catch (err) {
      status = 'failed'
      error = String(err && err.message ? err.message : err)
    }
  }

  if (status === 'failed') {
    logger.error('email.delivery_failed', { to: recipient, provider, error })
  } else if (status === 'logged') {
    logger.warn('email.not_sent_no_provider', { to: recipient })
  }

  try {
    await getFirestore().collection('mailOutbox').add({
      to: recipient || null,
      toUid: toUid || null,
      subject,
      text,
      html: html || null,
      status,
      provider,
      error,
      tag,
      createdAt: FieldValue.serverTimestamp(),
    })
  } catch (err) {
    logger.warn('email.outbox_write_failed', { error: String(err) })
  }

  return { status, provider, error }
}

function parseAddress(value) {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value)
  if (match) return { email: match[2], name: match[1] || undefined }
  return { email: value }
}

/** Minimal, dependency-free HTML email wrapper. */
function wrapHtml(title, intro, bullets, footer) {
  const items = bullets
    .map(
      (line) =>
        `<li style="margin:0 0 10px 0;padding-left:4px;line-height:1.5">${escapeHtml(line)}</li>`,
    )
    .join('')
  return `<!doctype html><html><body style="margin:0;background:#f4f7f6;padding:24px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0f1f1c">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e9e6">
    <tr><td style="background:#0e7c66;padding:20px 24px;color:#ffffff;font-size:18px;font-weight:700">MediVault</td></tr>
    <tr><td style="padding:24px">
      <h1 style="margin:0 0 8px 0;font-size:20px;line-height:1.3">${escapeHtml(title)}</h1>
      <p style="margin:0 0 18px 0;color:#5b6b66;line-height:1.6">${escapeHtml(intro)}</p>
      <ul style="margin:0 0 18px 0;padding-left:20px;font-size:15px">${items}</ul>
      <p style="margin:0;color:#8a9995;font-size:12px;line-height:1.6">${escapeHtml(footer)}</p>
    </td></tr>
  </table>
</body></html>`
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

module.exports = { sendMail, wrapHtml, mailProvider }
