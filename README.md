# MediVault

**A cloud-native personal medication, prescription and health-reminder system built on Google Cloud Platform.**

MediVault keeps a patient's medicine cabinet, dose plan, prescriptions, refill/expiry warnings and
doctor appointments in one place, and shares the schedule with a trusted caregiver — without ever
running a server. The React app is served from Firebase Hosting, every read/write goes through
Firebase Authentication and Firestore security rules, binary files live in Cloud Storage, and all
background work (reminder fan-out, prescription indexing, email/push delivery) runs in Cloud
Functions triggered by Cloud Scheduler and Cloud Storage events.

```
React + TypeScript (Vite)
        │
        ▼
Firebase Hosting  ── HTTPS, global CDN, SPA rewrites
        │
        ▼
Firebase Authentication  ── email/password + Google, ID tokens
        │
        ▼
Cloud Functions for Firebase (2nd gen, Cloud Run)  ◄── Cloud Scheduler (every 5 min, 08:00 UTC)
        │                                            ◄── Cloud Storage finalize events
        ├──► Cloud Firestore   (health records, reminders, dose logs, telemetry)
        ├──► Cloud Storage     (prescriptions, reports)
        ├──► SendGrid          (email reminders, outbox fallback)
        └──► Firebase Cloud Messaging (browser/mobile push)
        │
        ▼
Cloud Logging + Cloud Monitoring  ── structured logs, uptime check, scheduler history
```

---

## 1. Feature checklist

| # | Requirement | Where it lives | Cloud services exercised |
|---|-------------|----------------|--------------------------|
| 1 | Sign up / sign in (email + Google) | `src/pages/Login.tsx`, `src/context/AuthProvider.tsx` | Firebase Authentication, `ensureUserProfile` callable |
| 2 | Add / edit / remove medicine | `src/pages/Medicines.tsx` | Firestore + security rules |
| 3 | Upload a prescription image/PDF | `src/pages/Prescriptions.tsx` | Cloud Storage, `onPrescriptionUploaded` trigger |
| 4 | Medication schedule dashboard | `src/pages/Dashboard.tsx` | Firestore live queries, `logDose` callable |
| 5 | Low-stock and expiry alerts | `functions/lib/engine.js`, `src/pages/Alerts.tsx` | Cloud Scheduler → Cloud Functions → Firestore/FCM/SendGrid |
| 6 | Doctor appointment reminders (24 h) | `src/pages/Appointments.tsx`, reminder engine | Cloud Scheduler, Firestore, email/push |
| 7 | Caregiver sharing (6-character code) | `src/pages/Caregiver.tsx` | Callables + Firestore rules delegation |
| 8 | Deployed app with logs visible in GCP | `src/pages/System.tsx` | Cloud Logging, Cloud Monitoring, `system/status` telemetry |

Extras that make the demo convincing:

* **Transactional inventory** — `logDose` runs a Firestore transaction so two people tapping *Take*
  at the same time can never double-deduct stock, and *Undo* restores it.
* **Idempotent reminder engine** — deterministic document ids make every scheduled run safe to
  retry (at-least-once delivery is the norm for schedulers).
* **Timezone-correct scheduling** — Scheduler fires in UTC; each profile carries an IANA timezone and
  the engine converts "now" into the user's local wall clock before matching `08:00` doses.
* **Guarded demo controls** — `seedDemoData` and a throttled `runReminderSweepNow` let you drive the
  whole pipeline live during a viva without waiting for the cron.
* **Auditability** — every reminder record stores the channels used (`email:sent`, `push:sent`,
  `in-app`), and emails are also written to `mailOutbox` when SendGrid is not configured.

---

## 2. Technology stack

| Layer | Choice |
|-------|--------|
| Frontend | React 18, TypeScript 5, Vite 7, React Router 6, hand-written CSS (no UI kit) |
| Auth | Firebase Authentication (email/password + Google popup) |
| Data | Cloud Firestore (Native mode) |
| Files | Cloud Storage for Firebase (private bucket, 10 MB / image+PDF rules) |
| Compute | Cloud Functions for Firebase **2nd gen** (`nodejs20`, region `us-central1`, 256 MiB, max 10 instances) |
| Scheduling | Cloud Scheduler jobs created by `onSchedule` |
| Messaging | Firebase Cloud Messaging (web push) + SendGrid REST API (email) |
| Observability | Cloud Logging (structured JSON), Cloud Monitoring, in-app **Cloud status** page |
| Hosting | Firebase Hosting with immutable asset caching + SPA rewrite |
| Source layout | `src/` (web), `functions/` (backend), rules at repo root |

---

## 3. Repository layout

```text
MedVault/
├── firebase.json              # Hosting, Firestore, Storage, Functions, Emulator ports
├── .firebaserc                # Default project alias (demo-medivault locally)
├── firestore.rules            # Owner + caregiver authorisation model
├── firestore.indexes.json     # Composite indexes used by the live queries
├── storage.rules              # Private prescription folder, 10 MB, image/PDF only
├── .env.example               # Every VITE_* variable the web app reads
├── index.html
├── vite.config.ts             # Dev server, optional single-origin emulator proxy
├── src/
│   ├── main.tsx, App.tsx      # Router + providers
│   ├── lib/firebase.ts        # SDK bootstrap, emulator wiring
│   ├── lib/api.ts             # Typed callable wrappers + friendly error mapping
│   ├── lib/data.ts            # Firestore live hooks (onSnapshot)
│   ├── lib/format.ts          # Dates, stock maths, countdowns
│   ├── lib/notifications.ts   # FCM token registration + foreground messages
│   ├── context/               # AuthProvider, ToastProvider
│   ├── components/            # Layout, nav, icons, shared UI primitives
│   └── pages/                 # Login, Dashboard, Medicines, Appointments,
│                              # Prescriptions, Alerts, Caregiver, Settings, System
├── functions/
│   ├── index.js               # 16 exported Cloud Functions
│   └── lib/
│       ├── engine.js          # Reminder sweep + daily digest (idempotent)
│       ├── time.js            # Timezone/wall-clock helpers
│       ├── mailer.js          # SendGrid client + Firestore outbox fallback
│       ├── push.js            # FCM multicast + dead-token cleanup
│       └── access.js          # Owner/caregiver authorisation helpers
├── scripts/verify-backend.mjs # 30-check end-to-end test against the emulators
└── docs/
    ├── PROJECT_REPORT.md      # Submission report
    └── PRESENTATION.md        # 10-minute video script + slide outline
```

---

## 4. Run it locally (no billing account needed)

### Prerequisites

* Node.js **20 LTS** (the Functions runtime; Node 22+ also works for the emulators)
* Java 11+ (Firestore/Storage emulators)
* `npm`, and the Firebase CLI (`npm i -g firebase-tools`, or use `npx firebase`)

### Steps

```bash
# 1. install web + backend dependencies
npm install
cd functions && npm install && cd ..

# 2. start the whole cloud stack locally (Auth, Firestore, Storage, Functions, Hosting, UI)
npm run emulators        # Emulator UI: http://127.0.0.1:4000

# 3. in a second terminal, start the Vite dev server
npm run dev              # App: http://127.0.0.1:5173
```

The web app auto-detects development mode and connects to the emulators, so **no** `.env` file is
required for local work. Sign in with any address you invent, or press **“Explore with demo data”**
on the login screen, which creates an account, seeds four medicines and two appointments, and drops
you on the dashboard.

Demo credentials used throughout the docs: `demo@medivault.app` / `medivault123` (or any account you
create — everything stays on your machine).

### Emulator ports

| Emulator | Port | URL |
|----------|------|-----|
| Authentication | 9099 | `http://127.0.0.1:9099` |
| Firestore | 8080 | `http://127.0.0.1:8080` |
| Functions | 5001 | `http://127.0.0.1:5001/demo-medivault/us-central1` |
| Storage | 9199 | `http://127.0.0.1:9199` |
| Hosting | 5000 | `http://127.0.0.1:5000` |
| Emulator UI | 4000 | `http://127.0.0.1:4000` |

> **Sandboxed browser?** Some managed browsers block extra `localhost` ports. Set
> `VITE_EMULATOR_PROXY=true` in `.env.local` and Vite will proxy Auth, Firestore, Functions and
> Storage through `http://127.0.0.1:5173` so everything is single-origin.

---

## 5. Verify the backend end to end

With the emulators running:

```bash
npm run verify
```

The script signs up two real accounts against the Auth emulator and then exercises the cloud
behaviour the project is graded on — **30 assertions**, no mocks:

```text
  PASS  Firebase Auth: patient sign-up returns an ID token
  PASS  Cloud Function ensureUserProfile creates the profile
  PASS  Firestore: users/{uid} stores timezone + notification prefs
  PASS  Cloud Function seedDemoData writes demo medicines - 4 medicines / 2 appointments
  PASS  Firestore rules: unrelated caregiver cannot read another patient medicine - HTTP 403
  PASS  Firestore rules: a stranger query on medicines is rejected - HTTP 403
  PASS  Cloud Storage: prescription PDF uploaded to private bucket
  PASS  Storage trigger: onPrescriptionUploaded indexes the object into Firestore
  PASS  Storage rules: text/plain upload rejected (image/PDF only) - storage/unauthorized
  PASS  Storage rules: a stranger cannot write into another patient folder - storage/unauthorized
  PASS  Cloud Scheduler logic: sweep fans out dose / stock / expiry / appointment reminders
  PASS  Idempotency: a second sweep within 20s is throttled
  PASS  Cloud Function logDose takes a dose and decrements stock transactionally - 42 -> 41
  PASS  Idempotency: tapping "Take" twice does not double-deduct inventory - still 41
  PASS  Cloud Function logDose undo restores the tablet - back to 42
  PASS  Cloud Function generateCaregiverCode issues a 6-character code
  PASS  Cloud Function redeemCaregiverCode links the caregiver
  PASS  Firestore rules: linked caregiver can now read the patient medicine
  PASS  Cloud Function logDose accepts a linked caregiver and records loggedByRole
  PASS  Notification delivery: reminder emails queued in mailOutbox
  PASS  Cloud Function cloudHealth reports Firestore + runtime + bucket
  ...
  30 passed, 0 failed
```

---

## 6. Deploy to Google Cloud Platform

### 6.1 Create and prepare the project

```bash
# create the project (or use an existing one) and point the CLI at it
gcloud projects create medivault-<yourname> --name="MediVault"
gcloud config set project medivault-<yourname>
firebase login
firebase use --add                     # choose the project, alias "default"
```

In the [Firebase console](https://console.firebase.google.com/):

1. **Upgrade to the Blaze (pay-as-you-go) plan** — Cloud Functions 2nd gen and Scheduler require it.
   The workload here stays inside the free monthly allowances.
2. **Authentication → Sign-in method**: enable *Email/Password* and *Google*.
3. **Firestore Database**: create a database in *Native mode*, region `asia-south1` (or nearest).
4. **Storage**: create the default bucket.
5. **Project settings → Your apps → Web**: register a web app and copy the SDK config.
6. **Cloud Messaging → Web Push certificates**: generate a VAPID key pair (optional, for push).

### 6.2 Configure the web app

```bash
cp .env.example .env.production      # or .env
```

Fill in the values from the console (they are public by design — access is controlled by rules):

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=medivault-<yourname>.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=medivault-<yourname>
VITE_FIREBASE_STORAGE_BUCKET=medivault-<yourname>.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_VAPID_KEY=...          # optional
VITE_USE_EMULATORS=false
```

### 6.3 Optional: real email delivery (SendGrid)

```bash
firebase functions:secrets:set SENDGRID_API_KEY   # paste the API key
firebase functions:secrets:set MAIL_FROM          # e.g. "MediVault <reminders@yourdomain.com>"
```

Without a key, every email is still composed and written to the `mailOutbox` collection, so the
reminder pipeline remains fully demonstrable and auditable.

### 6.4 Deploy

```bash
npm run build
firebase deploy --only firestore:rules,firestore:indexes,storage
firebase deploy --only functions
firebase deploy --only hosting
# or simply:
npm run deploy
```

What gets created:

* Hosting site with the compiled SPA and cache/security headers (`firebase.json`).
* 16 functions in `us-central1` (Cloud Run services behind the scenes).
* Two Cloud Scheduler jobs: `sweepReminders` (every 5 minutes, UTC) and `dailyDigest` (08:00 UTC).
* A Storage `finalize` trigger on the prescriptions prefix.

After the first deploy, set the app URL used inside reminder emails:

```bash
firebase functions:config:unset  # (legacy, not needed)
# simplest: redeploy functions with the env var, or set APP_URL in functions/.env:
echo 'APP_URL=https://medivault-<yourname>.web.app' > functions/.env
firebase deploy --only functions
```

### 6.5 Prove it in the console (this is the demo)

| What to show | Where |
|--------------|-------|
| Hosting, HTTPS, CDN | Firebase console → Hosting, or the `.web.app` URL |
| Firestore documents | Firebase console → Firestore → `medicines`, `reminders`, `doseLogs` |
| Storage files | Firebase console → Storage → `prescriptions/{uid}/…` |
| Scheduler → Function run | Cloud console → Cloud Scheduler → `firebase-schedule-sweepReminders-…` → **Force run** |
| Execution logs | Cloud console → Cloud Logging, filter `resource.type="cloud_run_revision"` |
| Metrics / uptime | Cloud console → Cloud Monitoring; uptime check on `/api` |
| Auth users | Firebase console → Authentication |

A useful Cloud Logging query:

```text
resource.type="cloud_run_revision"
resource.labels.service_name=~"sweepreminders|logdose|onprescriptionuploaded"
severity>=INFO
```

Structured entries such as `reminder_sweep`, `dose.logged`, `storage.prescription_indexed` and
`caregiver.linked` are emitted as JSON, so they are filterable by field.

---

## 7. Data model (Cloud Firestore)

```text
users/{uid}
  uid, email, displayName, photoURL, phone
  timezone               IANA zone, used by the reminder engine
  prefs { email, push, dose, lowStock, expiry, appointments }
  caregivers[]           uids invited by this patient
  caregiverOf[]          uids of patients this user helps
  caregiverCode          current 6-character share code
  fcmTokens[]            registered web-push tokens
  createdAt, lastSeenAt

medicines/{medicineId}
  userId, name, dosage, form
  times[]                local wall-clock "HH:mm" strings
  remainingTablets, totalTablets, refillThreshold
  expiryDate (timestamp), notes, active
  createdAt, updatedAt

appointments/{appointmentId}
  userId, doctorName, speciality, location, date, notes, status

prescriptions/{prescriptionId}      # written by the Storage trigger only
  userId, storagePath, fileName, contentType, size, kind, notes
  bucket, generation, uploadedAt

doseLogs/{medicineId_dateKey_hhmm}  # written by the logDose transaction
  userId, medicineId, medicineName, dateKey, time
  status (taken|skipped), loggedBy, loggedByRole, takenAt

reminders/{reminderId}              # written by the sweep, read by the UI
  userId, type (dose|lowstock|expiry|appointment)
  title, body, dueAt, dateKey, dedupeKey, link
  status, read, channels[] (email:sent / push:sent / in-app)

mailOutbox/{mailId}                 # email audit trail (SendGrid or fallback)
system/status, system/digest        # scheduler telemetry rendered on /system
```

Deterministic reminder ids (the idempotency contract):

```text
dose_<medicineId>_<YYYY-MM-DD>_<HHmm>
lowstock_<medicineId>_<YYYY-MM-DD>
expiry_<medicineId>_<YYYY-MM-DD>_d<daysLeft>
appt_<appointmentId>_t24
```

Composite indexes shipped in `firestore.indexes.json`: `medicines(userId, createdAt)`,
`appointments(userId, date)`, `prescriptions(userId, uploadedAt)`,
`reminders(userId, createdAt)`, `doseLogs(userId, dateKey)`, `medicines(active)`.

---

## 8. Security model

| Control | Implementation |
|---------|----------------|
| Authentication | Firebase Auth; every callable rejects unauthenticated calls (`requireUser`) |
| Per-user isolation | Firestore rules compare `resource.data.userId` with `request.auth.uid` |
| Caregiver delegation | Rules read `users/{uid}.caregiverOf` / `.caregivers`; owner-only writes to clinical data |
| Server-owned collections | `prescriptions`, `reminders` (create) and `mailOutbox` are `allow write: if false`; only the Admin SDK (Functions) writes them |
| Storage hardening | `prescriptions/{uid}/{file}` — owner write, caregiver read, `< 10 MB`, `image/*` or `application/pdf` |
| Input validation | Every callable validates types, ranges and id shapes before touching Firestore |
| Abuse guards | Manual sweep throttled to once per 20 s; share codes are 6 chars from a 31-symbol alphabet and clash-checked; max 10 caregivers per patient |
| Secrets | SendGrid key and sender live in Cloud Functions secrets, never in the bundle |
| Transport | HTTPS only (Hosting + Cloud Run), strict security headers in `firebase.json` |
| Least privilege | Functions run as the default service account; Firestore/Storage are never public |

`scripts/verify-backend.mjs` asserts the negative cases too: a stranger gets `HTTP 403` for another
patient's medicine, and both a `text/plain` upload and a write into someone else's folder are
rejected by Storage rules.

---

## 9. Cloud Functions reference

| Function | Type | Trigger | Purpose |
|----------|------|---------|---------|
| `sweepReminders` | scheduled | Cloud Scheduler, every 5 min (UTC) | Dose / low-stock / expiry / appointment scan + fan-out |
| `dailyDigest` | scheduled | Cloud Scheduler, 08:00 UTC | Morning summary email per user |
| `onPrescriptionUploaded` | storage trigger | object finalize | Indexes the file into `prescriptions/` |
| `api` | HTTP | `/api` | Health endpoint for the Cloud Monitoring uptime check |
| `ensureUserProfile` | callable | client | Idempotent profile provisioning after sign-in |
| `logDose` | callable | client | Transactional take/skip/undo + stock update |
| `runReminderSweepNow` | callable | client (demo) | Runs the sweep immediately, throttled |
| `seedDemoData` | callable | client (demo) | Seeds 4 medicines + 2 appointments |
| `generateCaregiverCode` | callable | client | Rotates the patient's 6-character code |
| `redeemCaregiverCode` | callable | client | Links a caregiver in both directions |
| `removeCaregiver` / `leaveCaregiver` | callable | client | Revokes the link |
| `registerFcmToken` | callable | client | Stores/removes a web-push token |
| `sendTestEmail` | callable | client | Proves SendGrid (or outbox) wiring |
| `deletePrescription` | callable | client | Owner-only Storage + Firestore delete |
| `cloudHealth` | callable | client | Runtime, region, bucket, latency for `/system` |

---

## 10. Team split (3 members)

| Member | Ownership | Concrete artefacts |
|--------|-----------|--------------------|
| **Member 1 — Frontend & hosting** | React app, routing, design system, auth flows, dashboard, deployment to Firebase Hosting | `src/pages/**`, `src/components/**`, `src/context/**`, `src/styles.css`, `firebase.json` hosting block |
| **Member 2 — Data, storage & security** | Firestore schema, live queries, indexes, Storage uploads, rules, caregiver sharing UI | `src/lib/data.ts`, `src/pages/Prescriptions.tsx`, `src/pages/Caregiver.tsx`, `firestore.rules`, `storage.rules`, `firestore.indexes.json` |
| **Member 3 — Cloud Functions, scheduler, observability** | Reminder engine, callables, triggers, email/push, logging, deployment docs | `functions/**`, `scripts/verify-backend.mjs`, `docs/**`, Cloud Scheduler/Monitoring setup |

All three present in the video: Member 1 drives the UI demo, Member 2 shows Firestore/Storage and
rules, Member 3 shows the Scheduler run and Cloud Logging.

---

## 11. Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite dev server (emulators expected on the usual ports) |
| `npm run emulators` | Firebase Emulator Suite for the whole cloud stack |
| `npm run build` | Type-check (`tsc --noEmit`) then production build into `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm run verify` | 30-check backend end-to-end verification |
| `npm run deploy` | Build then `firebase deploy` (hosting + functions + rules) |
| `npm run deploy:hosting` | Hosting only |
| `npm run deploy:functions` | Functions only |
| `npm run deploy:rules` | Firestore rules/indexes + Storage rules |

---

## 12. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `Cannot reach Firebase Authentication` in the app | Emulators are not running (`npm run emulators`), or the browser blocks the extra ports — use `VITE_EMULATOR_PROXY=true` |
| `auth/network-request-failed` | Same as above; also check `.firebaserc` project id matches `demo-medivault` for local work |
| `The query requires an index` | Run `npm run deploy:rules` (indexes) or click the console link in the error |
| `FirebaseError: internal` from a callable | Read the Functions emulator terminal — the stack trace is printed there |
| Port 8080 already in use | A stale Firestore emulator is running: `lsof -i :8080` then `kill <pid>` |
| `functions: Node version unsupported` | Install Node 20 (`nvm install 20 && nvm use 20`) |
| Push notifications never arrive | VAPID key missing, browser permission denied, or the service worker is stale — re-register in **Settings → Push notifications** |

---

## 13. Documentation

* [`docs/PROJECT_REPORT.md`](docs/PROJECT_REPORT.md) — full submission report: problem statement,
  objectives, architecture, services, implementation, security, results, conclusion.
* [`docs/PRESENTATION.md`](docs/PRESENTATION.md) — 10-minute video script with slide outline,
  per-speaker timings and a demo checklist.

---

## 14. Licence and academic note

Built as a Cloud Computing course project (3-member group) on Google Cloud Platform. The code is
provided for academic evaluation; the Firebase project, SendGrid account and any deployed resources
belong to the team that created them.
