#!/usr/bin/env node
/**
 * Guard against committing credentials.
 *
 * The repository is public and gets handed over, so a leaked key in any commit
 * is a real problem. This scans every file git tracks (not the working tree,
 * not node_modules) for the shapes that providers actually use, and for files
 * that should never be tracked at all.
 *
 * Run before committing:  npm run check:secrets
 * Exit code 1 means something must be fixed before the commit goes out.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const FORBIDDEN_FILES = [
  /(^|\/)\.env$/,
  /(^|\/)\.env\.(local|production|development)$/,
  /(^|\/)functions\/\.env$/,
  /\.pem$/,
  /\.p12$/,
  /(^|\/)service-?account[^/]*\.json$/i,
  /(^|\/)deployer\.json$/i,
]

const PATTERNS = [
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['Google private key', /-----BEGIN (RSA |EC )?PRIVATE KEY-----/],
  ['SendGrid key', /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['Stripe key', /\b(sk|rk)_(live|test)_[A-Za-z0-9]{20,}/],
  ['Resend key', /\bre_[A-Za-z0-9]{20,}/],
  ['Twilio auth token', /\bTWILIO_AUTH_TOKEN\s*=\s*[0-9a-f]{32}\b/],
  ['Twilio account SID', /\bTWILIO_ACCOUNT_SID\s*=\s*AC[0-9a-f]{32}\b/],
  ['Firebase private key id', /"private_key_id"\s*:\s*"[0-9a-f]{40}"/],
  ['JSON web token', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
]

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)

let problems = 0
const flag = (file, message) => {
  problems += 1
  console.log(`  FAIL  ${file}  ${message}`)
}

for (const file of files) {
  if (FORBIDDEN_FILES.some((rule) => rule.test(file))) {
    flag(file, 'this file must never be tracked')
    continue
  }

  let body
  try {
    body = readFileSync(file, 'utf8')
  } catch {
    continue // binary, and binaries are not where these keys live
  }
  if (body.includes('\0')) continue

  for (const [name, pattern] of PATTERNS) {
    if (pattern.test(body)) flag(file, `looks like a ${name}`)
  }
}

console.log('')
if (problems > 0) {
  console.log(`${problems} problem(s). Remove the value, rotate the credential, and commit again.`)
  process.exit(1)
}
console.log(`No credentials found in ${files.length} tracked files.`)
