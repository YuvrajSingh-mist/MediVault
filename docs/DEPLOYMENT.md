# MediVault — deployment runbook

Everything below was executed to produce the live instance:

| | |
|---|---|
| App URL | **https://medivault-gcp-23875.web.app** |
| Firebase / GCP project | `medivault-gcp-23875` |
| Project number | `686331285299` |
| Billing | Blaze (pay as you go), billing account linked |
| Firestore | Native mode, `asia-south1` |
| Cloud Storage | `medivault-gcp-23875-files`, `asia-south1` |
| Cloud Functions | 2nd gen, `nodejs22`, `asia-south1`, 256 MiB, `maxInstances: 10` |
| Cloud Scheduler | `sweepReminders` every 5 minutes · `dailyDigest` `0 8 * * *` |
| Web app id | `1:686331285299:web:fd91bf73faf40de681f846` |

---

## 1. One-time setup that was done from the CLI

```bash
PROJ=medivault-gcp-23875

gcloud projects create "$PROJ" --name="MediVault"
gcloud billing projects link "$PROJ" --billing-account=<BILLING_ACCOUNT_ID>

gcloud services enable \
  firebase.googleapis.com firebasehosting.googleapis.com firebaserules.googleapis.com \
  identitytoolkit.googleapis.com securetoken.googleapis.com \
  firestore.googleapis.com storage.googleapis.com storage-api.googleapis.com \
  cloudfunctions.googleapis.com cloudbuild.googleapis.com run.googleapis.com \
  eventarc.googleapis.com pubsub.googleapis.com cloudscheduler.googleapis.com \
  artifactregistry.googleapis.com runtimeconfig.googleapis.com \
  cloudresourcemanager.googleapis.com iam.googleapis.com serviceusage.googleapis.com \
  logging.googleapis.com monitoring.googleapis.com --project="$PROJ"

# Register Firebase resources on the GCP project
GOOGLE_APPLICATION_CREDENTIALS=~/.config/medivault/deployer.json \
  npx firebase-tools projects:addfirebase "$PROJ"

gcloud firestore databases create --project="$PROJ" \
  --location=asia-south1 --type=firestore-native

gcloud storage buckets create "gs://$PROJ-files" --project="$PROJ" \
  --location=asia-south1 --uniform-bucket-level-access

# Web app + SDK config
npx firebase-tools apps:create WEB "MediVault Web" --project="$PROJ"
npx firebase-tools apps:sdkconfig WEB 1:686331285299:web:fd91bf73faf40de681f846 --project="$PROJ"
```

Non-interactive deploys run with a dedicated service account instead of an interactive
`firebase login`:

```bash
gcloud iam service-accounts create medivault-deployer --project="$PROJ"
gcloud projects add-iam-policy-binding "$PROJ" \
  --member="serviceAccount:medivault-deployer@$PROJ.iam.gserviceaccount.com" --role="roles/owner"
gcloud iam service-accounts keys create ~/.config/medivault/deployer.json \
  --iam-account="medivault-deployer@$PROJ.iam.gserviceaccount.com" --project="$PROJ"

export GOOGLE_APPLICATION_CREDENTIALS=~/.config/medivault/deployer.json
```

`firebase-tools` picks the key up through Application Default Credentials, so `firebase deploy`
works headlessly.

---

## 2. Two console clicks that cannot be done over the API

Both are Firebase-console-only operations (no public API exists for them). After they are done the
deployed app is fully functional; nothing needs redeploying for the Google one.

1. **Enable Google as the sign-in provider**
   <https://console.firebase.google.com/project/medivault-gcp-23875/authentication/providers>
   → *Sign-in method* → **Google** → toggle **Enable** → pick a support email → **Save**.
   This creates the OAuth web client that the handler at
   `medivault-gcp-23875.firebaseapp.com/__/auth/handler` needs. Email/password stays **disabled** —
   Google is the only method.

2. **Provision Cloud Storage for Firebase**
   <https://console.firebase.google.com/project/medivault-gcp-23875/storage>
   → **Get started** (default bucket, `asia-south1`).
   This creates the `service-686331285299@gcp-sa-firebasestorage` service agent that the
   `firebasestorage.googleapis.com` gateway needs; without it every upload returns
   `412 A required service account is missing necessary permissions`.

After step 2, if the console creates the bucket as `<project>.firebasestorage.app`, update
`.env.production` / `functions/.env` / `firebase.json` `storage.bucket` to that name and redeploy
(`npm run deploy`), or keep the pre-created `medivault-gcp-23875-files` bucket and simply deploy the
storage rules:

```bash
firebase deploy --only storage --project medivault-gcp-23875
```

---

## 3. Shipping a build

```bash
npm run build                 # tsc --noEmit + vite build (uses .env.production)
firebase deploy --project medivault-gcp-23875
```

Without an interactive Firebase login, the two REST helpers below do the same Hosting and rules
releases with the Cloud SDK token:

```bash
python3 scripts/deploy-hosting.py
python3 scripts/deploy-rules.py
```

What gets deployed:

| Target | Content |
|---|---|
| `hosting` | `dist/` with SPA rewrites, long-cache hashed assets, no-cache `index.html` |
| `functions` | 16 callables/triggers, `asia-south1`, Node 22 |
| `firestore` | `firestore.rules` + composite indexes |
| `storage` | `storage.rules` for the prescription bucket |

Artifact Registry cleanup policy is set to keep 3 days of container images
(`firebase functions:artifacts:setpolicy --location=asia-south1 --days=3`), which keeps the monthly
bill at the free-tier end.

### Turning on real email

The project ships with no mail transport, so every composed message is written to `mailOutbox` with
`status: "logged"` and nothing is delivered. Two transports are supported; set up either one. The live
instance runs the Gmail option below.

**SMTP, for example Gmail.** No domain and no paid account are needed:

```bash
# Google account > Security > 2-Step Verification > App passwords > Mail
# Put these in functions/.env, which is git-ignored:
#   SMTP_HOST=smtp.gmail.com
#   SMTP_PORT=465
#   SMTP_SECURE=true
#   SMTP_USER=you@gmail.com
#   SMTP_PASS=<the 16-character app password, no spaces>
#   MAIL_FROM=MediVault <you@gmail.com>
npm run deploy:functions
```

**SendGrid**, better once you have a domain:

```bash
firebase functions:secrets:set SENDGRID_API_KEY     # Settings > API Keys, Mail Send scope
firebase functions:secrets:set MAIL_FROM            # a verified sender address
npm run deploy:functions
```

SendGrid wins when both are configured. A new SendGrid account is in "Single Sender Verification"
mode: `MAIL_FROM` must be the address you verified under *Settings > Sender Authentication*,
otherwise the API returns a 403 that the function records as a failed delivery.

Verify from the app: *Settings > Send a test email*. The result is the newest document in
`mailOutbox`. `status: "sent"` means the provider accepted it, `status: "failed"` stores the
provider's reason in `error`, and `provider: "outbox"` means no transport was configured and no
message left the server. Remove the credentials to fall back to the outbox without changing code.

---

## 4. Verifying the live deployment

```bash
npm run verify:deployed
```

`scripts/verify-deployed.mjs` checks the real project — no emulator involved. Six assertions run
every time, without credentials:

* Firebase Hosting serves the SPA over HTTPS and the bundle is wired to `medivault-gcp-23875`.
* The bundle carries no emulator hostnames.
* The Cloud Run HTTP endpoint `api` reports `status: ok` with Firestore reachable.
* Callables reject an anonymous caller (401) and rules reject an anonymous read (401).

The remaining assertions need two real sessions, because Google is the only enabled identity
provider:

```bash
VERIFY_ID_TOKEN="<patient id token>" VERIFY_CAREGIVER_TOKEN="<caregiver id token>" npm run verify:deployed
```

With those tokens:

* Identity Toolkit's token is accepted and `ensureUserProfile` provisions `users/{uid}`; rules let the owner read it.
* `seedDemoData` writes 4 medicines + 2 appointments; Atorvastatin lands below its refill threshold.
* Rules deny a stranger (403) and deny an unfiltered collection scan (403).
* `runReminderSweepNow` raises reminders, writes `system/status` telemetry.
* `logDose` decrements stock transactionally, is idempotent, and undo restores it.
* Caregiver code generation + redemption links the pair; rules then grant read and still deny writes.
* Cloud Storage accepts an owner PDF, the storage trigger indexes it into Firestore, and a
  `text/plain` upload is rejected.
* `cloudHealth` reports `nodejs22 · asia-south1 · <bucket>`.

> Email/password is disabled on this project, so the script cannot create throwaway accounts. Grab
> the tokens from a signed-in browser session (`firebase.auth().currentUser.getIdToken()` in the
> console) or leave them unset and accept the skip.

---

## 5. Cost shape

Free-tier eligibility plus the cheap choices keep this near zero for a course demo:

| Service | Setting | Effect |
|---|---|---|
| Cloud Functions | 256 MiB, `maxInstances: 10`, 2nd gen | scale-to-zero, no idle container cost |
| Cloud Scheduler | 2 jobs | first 3 jobs free per month |
| Firestore | Native, on-demand | 50k reads / 20k writes per day free |
| Cloud Storage | `asia-south1`, standard | 5 GB free, `10 MB` per-file cap in rules |
| Firebase Hosting | global CDN | 10 GB storage + 360 MB/day egress free |
| Artifact Registry | 3-day cleanup policy | images do not accumulate |

Set a budget alert on the billing account (Billing → Budgets & alerts) so a runaway demo cannot cost
more than a coffee.
