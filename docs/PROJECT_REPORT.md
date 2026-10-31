# MediVault — Cloud-Based Personal Medication, Prescription & Health Reminder System

**Project Report**

Cloud Computing — Group Project (3 members)
Platform: **Google Cloud Platform** (Firebase: Hosting, Authentication, Firestore, Cloud Storage,
Cloud Functions 2nd gen, Cloud Scheduler, FCM, SendGrid, Cloud Logging & Monitoring)

---

## Table of contents

1. [Abstract](#1-abstract)
2. [Problem statement](#2-problem-statement)
3. [Objectives](#3-objectives)
4. [Scope and limitations](#4-scope-and-limitations)
5. [Background: cloud model and service selection](#5-background-cloud-model-and-service-selection)
6. [System architecture](#6-system-architecture)
7. [Cloud services used](#7-cloud-services-used)
8. [Data model](#8-data-model)
9. [Implementation](#9-implementation)
10. [Security and IAM](#10-security-and-iam)
11. [Reliability, idempotency and timezones](#11-reliability-idempotency-and-timezones)
12. [Testing and results](#12-testing-and-results)
13. [Cost analysis](#13-cost-analysis)
14. [Deployment](#14-deployment)
15. [Team contribution](#15-team-contribution)
16. [Limitations and future work](#16-limitations-and-future-work)
17. [Conclusion](#17-conclusion)
18. [References](#18-references)
19. [Appendix A — Cloud Functions reference](#appendix-a--cloud-functions-reference)
20. [Appendix B — Configuration variables](#appendix-b--configuration-variables)
21. [Appendix C — Viva questions and answers](#appendix-c--viva-questions-and-answers)
22. [Appendix D — Demo dataset](#appendix-d--demo-dataset)

---

## 1. Abstract

Medication only works if it is taken. Yet adherence fails for mundane reasons: the schedule lives in
someone's head, the strip runs out unnoticed, an expiry date passes, a follow-up appointment is
forgotten, and a family member helping out has no reliable view of what was already taken.

**MediVault** is a cloud-native personal medication, prescription and health-reminder system built
entirely on Google Cloud Platform. A React single-page application is served from **Firebase
Hosting**; users authenticate with **Firebase Authentication**; their medicines, appointments,
reminders and dose history live in **Cloud Firestore**; prescriptions and reports are uploaded
straight to **Cloud Storage**; and all backend logic runs in **Cloud Functions for Firebase (2nd
generation)**, which are invoked by the browser (callables), by **Cloud Scheduler** every five
minutes, and by Cloud Storage upload events. Reminders fan out through **Firebase Cloud Messaging**
(browser push) and **SendGrid** (email), with a Firestore outbox as an auditable fallback. Execution
history, structured logs and a live health probe are surfaced in **Cloud Logging** and **Cloud
Monitoring**, and mirrored in an in-app *Cloud status* page so the deployment can be inspected during
a demonstration.

The result is a serverless system with no virtual machines to patch, per-user data isolation enforced
by declarative security rules, idempotent scheduled processing, transactional inventory updates, and
a caregiver-sharing model that grants read access and dose logging while withholding any ability to
edit clinical records. The backend is verified by an automated 30-assertion end-to-end suite that runs
against the Firebase Emulator Suite and covers authentication, security rules, storage triggers,
scheduling logic, idempotency, inventory transactions and the caregiver authorization path.

---

## 2. Problem statement

### 2.1 The adherence problem

Chronic and post-operative treatment depends on consistency. In practice, patients manage schedules
with paper slips, memory, or phone alarms that fire once and are dismissed. Three failure modes recur:

1. **Missed doses** — alarms are not tied to the actual prescription plan, and there is no record of
   whether a dose was taken or skipped.
2. **Silent stock-outs and expiry** — nobody notices that four tablets remain, or that a strip expired
   last week, until it matters.
3. **Lost prescriptions and appointments** — paper prescriptions are photographed, lost in a gallery,
   or never shown to the specialist who asks for "the last blood report".

### 2.2 The coordination problem

When a family member or hired caregiver helps, the information transfer is informal and unreliable:
phone calls, screenshots, "did you already take it?" There is no shared, trustworthy state, and no
audit trail of who administered a dose or when.

### 2.3 The systems problem

Existing apps are often single-device, single-user silos with no server-side enforcement. Health data
is unusually sensitive: a leak is not an inconvenience, it is harm. A student-grade application that
stores medical records in a shared database with client-side filtering is not acceptable, regardless
of how good the UI is.

**Therefore the project asks:** can a small team build a *secure, multi-user, event-driven health
reminder system* with serverless cloud primitives only — no servers, no database administration, and
no custom authentication — while still demonstrating the core cloud computing concepts of compute,
storage, scheduling, messaging, identity, and observability?

---

## 3. Objectives

| # | Objective | Success criterion |
|---|-----------|-------------------|
| O1 | Provide frictionless, standards-based authentication | Email/password + Google sign-in; profile provisioned server-side on first login |
| O2 | Let a patient maintain a complete medication record | Create/read/update/delete medicines with dosage, multiple daily times, stock counters, refill threshold and expiry |
| O3 | Deliver a trustworthy daily plan | Dashboard shows today's doses in local time with taken/skipped/pending state, and updates live across devices |
| O4 | Keep inventory accurate even under concurrency | Dose logging is transactional; double taps and two caregivers cannot corrupt the tablet count |
| O5 | Remind proactively and idempotently | A scheduled sweep raises dose, low-stock, expiry and 24-hour appointment reminders exactly once per period |
| O6 | Store prescriptions securely | Binary uploads go straight to private Cloud Storage with type/size rules; metadata is produced by a trusted trigger, not the client |
| O7 | Enable safe caregiver participation | A one-time 6-character code links accounts; caregivers read records and log doses but cannot edit or delete clinical data |
| O8 | Make the cloud visible | Deployed app, Cloud Logging entries, Cloud Scheduler runs, Firestore/Storage contents, and an in-app observability page |
| O9 | Prove it works | Automated end-to-end verification suite (30 assertions) plus a reproducible demo dataset |

---

## 4. Scope and limitations

**In scope**

* Web client (responsive, installable-ready PWA-style shell), desktop and mobile browsers.
* Single-tenant-per-user data model with caregiver delegation.
* Email and web-push notification channels.
* Timezone-aware scheduling in UTC-invoked infrastructure.
* Deployment to a public cloud offering (GCP/Firebase) with security rules and IAM.

**Out of scope (and why)**

* Native iOS/Android binaries — the browser is the shared target; FCM web push covers the mobile
  notification path.
* Clinical decision support, dosage recommendations or drug-interaction checking — safety-critical and
  outside a cloud computing course's remit.
* Payment, insurance and pharmacy integration.
* HIPAA/BAA compliance certification; the project implements the *mechanisms* (isolation, least
  privilege, audit trails) that compliance builds on, but certification is a legal process.

---

## 5. Background: cloud model and service selection

### 5.1 Why serverless PaaS rather than IaaS

A virtual-machine deployment (Compute Engine) would require patching, TLS termination, autoscaling,
process supervision and a database server — none of which are the learning objective, and all of which
are attack surface. The project therefore uses **managed platform services**:

* **No server management** — Cloud Functions runs on Cloud Run infrastructure managed by Google.
* **Pay per use** — idle costs approximately zero; a three-person project fits inside free tiers.
* **Event-driven by design** — schedulers, storage events and HTTPS calls are first-class triggers.
* **Built-in identity** — Firebase Authentication issues OIDC-style ID tokens that every service trusts.

### 5.2 Why Firebase on GCP

Firebase is Google Cloud's application platform. Its services are GCP services: Firestore is a
Google Cloud database, Cloud Functions for Firebase 2nd gen *is* Cloud Run Functions, Cloud Storage
for Firebase is a GCS bucket, and Cloud Scheduler invokes the deployed functions. Using Firebase SDKs
therefore demonstrates genuine GCP primitives with far less boilerplate than assembling IAM, VPC
connectors and API gateways by hand.

### 5.3 Comparative reasoning

| Option | Verdict |
|--------|---------|
| EC2/Lightsail + MySQL + cron | Rejected: heavy ops burden, no managed auth, weak demo of "cloud-native" ideas |
| Azure App Service + Cosmos DB + Functions | Viable; chosen GCP because Firebase gives auth + realtime + rules + storage triggers in one coherent stack |
| AWS Amplify (Cognito, DynamoDB, S3, EventBridge) | Viable; GCP chosen for the team's familiarity and Firestore's live-query model |
| **GCP serverless (chosen)** | Best fit: rules-as-code authorization, realtime sync for caregivers, event triggers for files, managed cron |

---

## 6. System architecture

### 6.1 Layered view

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Presentation        React 18 + TypeScript SPA (Vite build)                    │
│                     Firebase Hosting · global CDN · HTTPS · SPA rewrites      │
├──────────────────────────────────────────────────────────────────────────────┤
│ Identity            Firebase Authentication (email/password, Google)          │
│                     ID tokens attached to every Firestore/Storage/callable     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Application logic   Cloud Functions 2nd gen (nodejs20, us-central1)            │
│                     · Callables: logDose, caregiver, profile, health, demo     │
│                     · Triggers: onObjectFinalized, scheduled sweep/digest     │
│                     · HTTP: /api health probe                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ Data                Cloud Firestore (documents + security rules)              │
│                     Cloud Storage (private prescription bucket + rules)       │
├──────────────────────────────────────────────────────────────────────────────┤
│ Messaging           Firebase Cloud Messaging (web push)                       │
│                     SendGrid REST (email) + mailOutbox audit fallback         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Operations          Cloud Scheduler · Cloud Logging · Cloud Monitoring        │
│                     IAM service accounts · secrets for SendGrid               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Deployment view

```text
Browser ──HTTPS──► Firebase Hosting (CDN) ──► static SPA bundle
   │
   ├──Auth REST──► identitytoolkit.googleapis.com (Firebase Auth)
   ├──gRPC/WebChannel──► firestore.googleapis.com  (rules evaluated per request)
   ├──HTTPS──► storage.googleapis.com (signed upload/download through SDK)
   └──HTTPS──► cloudfunctions.net / cloudrun (callables, region us-central1)

Cloud Scheduler ──Pub/Sub-backed HTTP──► sweepReminders / dailyDigest (Cloud Run)
Cloud Storage finalize ──Eventarc──► onPrescriptionUploaded (Cloud Run)
All services ──► Cloud Logging ──► Logs Explorer / Monitoring / Alerting
```

### 6.3 Key runtime flows

**A. First sign-in and profile provisioning**

```text
User → Login page → Firebase Auth (signInWithPopup / signInWithEmailAndPassword)
     → ID token issued
     → AuthProvider calls ensureUserProfile({timezone})
     → Function creates users/{uid} with prefs, empty caregiver arrays, server timestamp
     → onSnapshot on users/{uid} renders the shell
```

**B. Logging a dose (transactional inventory)**

```text
User taps "Take"
 → callable logDose({medicineId, dateKey, time})
   → verify caller (owner or caregiver via users/{uid}.caregiverOf)
   → Firestore transaction:
        read medicine + existing doseLog
        if action = take and not already taken: remaining -= 1
        if action = skip after take: remaining += 1 (bounded by total)
        if action = undo: delete log, restore tablet
        write doseLogs/{medicineId}_{dateKey}_{HHmm} with loggedByRole
        update medicine.remainingTablets
   → mark the matching reminder as taken/read
 → client UI updates from onSnapshot (no manual refetch)
```

**C. Scheduled reminder sweep (Cloud Scheduler → Function)**

```text
Cloud Scheduler (every 5 min, UTC)
 → sweepReminders()
   → load active medicines (limit 500) and appointments in [-5 min, +25 h]
   → load owner profiles once (timezone + notification prefs)
   → for each medicine:
        convert "now" to the owner's wall clock
        dose: fire when 0 ≤ now − scheduled ≤ REMINDER_WINDOW_MINUTES
        low stock: remaining ≤ refillThreshold
        expiry: daysLeft ∈ {30,14,7,3,1,0}
   → for each appointment: fire once when 0 < msUntil ≤ 24 h
   → createReminder(id=deterministic) — create() fails if it already exists → exactly-once
   → group new reminders per user, deliver email (SendGrid/outbox) + push (FCM multicast)
   → mark reminders sent with channel audit trail
   → write system/status {lastRun, recentRuns} for the in-app observability page
```

**D. Prescription upload (client → Storage → trigger → Firestore)**

```text
Client → uploadBytesResumable(storage, "prescriptions/{uid}/{ts}_{name}")
       → Storage rules validate owner, <10 MB, image/* or application/pdf
       → object finalize event → onPrescriptionUploaded
       → doc id = sha1(path)[:20] (idempotent) → prescriptions/{id} with metadata
       → client polls the query by storagePath and shows the indexed record
```

---

## 7. Cloud services used

| Service | Role in MediVault | Configuration highlights |
|---------|-------------------|--------------------------|
| **Firebase Hosting** | Serves the compiled SPA over Google's CDN | `public: dist`, SPA rewrite to `/index.html`, immutable caching for hashed assets, `X-Frame-Options: DENY`, `nosniff`, referrer policy |
| **Firebase Authentication** | Identity for every user; ID tokens authorise Firestore, Storage and callables | Email/password + Google provider; profile mirrored into `users/{uid}` |
| **Cloud Firestore** | System of record for medicines, appointments, prescriptions, reminders, dose logs, telemetry | Native mode; live `onSnapshot` queries; composite indexes; rules-as-code |
| **Cloud Storage for Firebase** | Private bucket for prescriptions/reports | Path `prescriptions/{uid}/{file}`; 10 MB cap; image/PDF only; owner write, caregiver read |
| **Cloud Functions (2nd gen)** | All backend logic, on Cloud Run | `nodejs20`, `us-central1`, 256 MiB, `maxInstances: 10`, 16 exported functions |
| **Cloud Scheduler** | Time-based invocation | `sweepReminders`: `every 5 minutes` (UTC); `dailyDigest`: `0 8 * * *` (UTC); jobs created by deployment |
| **Firebase Cloud Messaging** | Browser/mobile push | Web push certificate (VAPID); tokens stored per profile; dead tokens pruned automatically |
| **SendGrid (via Functions)** | Email reminders | REST call with secret key; falls back to `mailOutbox` when unconfigured |
| **Cloud Logging** | Structured JSON logs for sweeps, doses, uploads, caregiver links | Fields such as `event`, `trigger`, `durationMs`, `createdReminders` are filterable |
| **Cloud Monitoring** | Uptime check + metrics for function latency/errors | `/api` health endpoint returns 200/503 with Firestore check |
| **IAM / service accounts** | Least privilege for functions and deployment | Admin SDK used only server-side; Firestore/Storage never publicly readable |

---

## 8. Data model

### 8.1 Collections

```text
users/{uid}
  uid                 string
  email               string
  displayName         string
  photoURL            string
  phone               string
  timezone            string  (IANA, e.g. "Asia/Kolkata")
  prefs               map { email, push, dose, lowStock, expiry, appointments : bool }
  caregivers          array<uid>   (people this patient invited)
  caregiverOf         array<uid>   (patients this user helps)
  caregiverCode       string|null  (6 chars, rotatable)
  fcmTokens           array<string>
  createdAt, lastSeenAt  timestamp

medicines/{medicineId}
  userId              string
  name, dosage, form  string
  times               array<"HH:mm">   (local wall clock)
  remainingTablets    number (int)
  totalTablets        number
  refillThreshold     number
  expiryDate          timestamp
  notes               string
  active              bool
  createdAt, updatedAt timestamp

appointments/{appointmentId}
  userId, doctorName, speciality, location, notes, status
  date                timestamp

prescriptions/{prescriptionId}          (server-written)
  userId, storagePath, fileName, contentType, size, kind, notes
  bucket, generation, uploadedAt

doseLogs/{medicineId}_{YYYY-MM-DD}_{HHmm}
  userId, medicineId, medicineName, dateKey, time
  status              "taken" | "skipped"
  loggedBy, loggedByRole ("owner" | "caregiver")
  takenAt, updatedAt

reminders/{deterministicId}
  userId, type (dose|lowstock|expiry|appointment)
  title, body, dueAt, dateKey, dedupeKey, link
  status ("new"|"sent"|"taken"), read, readAt, sentAt
  channels            array<"email:sent"|"push:sent"|"in-app">

mailOutbox/{id}                         (server-written)
  to, toUid, subject, text, html, status, provider, error, tag, createdAt

system/status, system/digest            (telemetry for /system page)
```

### 8.2 Why this model

* **Denormalised ownership (`userId` on every record)** makes security rules a single comparison
  instead of a join, and allows collection-wide queries scoped by equality — the cheapest Firestore
  query shape.
* **Deterministic document ids for reminders and dose logs** turn "insert" into an idempotent
  "create-if-absent" and make the manual and scheduled paths converge on the same record.
* **Time-of-day stored as local wall clock** (`"08:00"`) rather than a UTC timestamp avoids the
  daylight-saving and "08:00 means 08:00 everywhere" problem; conversion happens at evaluation time
  using the profile's IANA zone.
* **Server-written collections** (`prescriptions`, `reminders`, `mailOutbox`) are impossible to forge
  from the client, which is where most real-world "health app" leaks originate.

### 8.3 Indexes

```text
medicines      (userId ASC, createdAt DESC)
appointments   (userId ASC, date ASC)
prescriptions  (userId ASC, uploadedAt DESC)
reminders      (userId ASC, createdAt DESC)
doseLogs       (userId ASC, dateKey ASC)
medicines      (active ASC)           -- used by the global sweep
```

---

## 9. Implementation

### 9.1 Frontend (Member 1)

* **Vite + React 18 + TypeScript**, no UI framework: a small design system in `styles.css` and
  `components/ui.tsx` (cards, fields, badges, buttons, empty states) gives a calm clinical palette,
  accessible focus states and a responsive layout with a collapsible sidebar.
* **Routing** via React Router (`/`, `/medicines`, `/appointments`, `/prescriptions`, `/alerts`,
  `/caregiver`, `/settings`, `/system`) behind a protected shell.
* **State**: `AuthProvider` owns the auth subscription and profile; `ToastProvider` handles
  notifications. Data comes from `lib/data.ts` hooks built on `onSnapshot`, so two browser windows —
  for example a patient and a caregiver — stay in sync without polling.
* **Dashboard**: greeting + adherence summary, today's timeline in the owner's timezone with
  take/skip/undo, stats cards (medicines, remaining stock, alerts), next appointment, latest alerts,
  and a "Run sweep now" control for demonstrations.
* **Accessibility**: semantic landmarks, labelled controls, `aria-live` for toasts, contrast-checked
  colour tokens, and keyboard-reachable interactive elements.

### 9.2 Data, storage and security (Member 2)

* **Live hooks** (`useMedicines`, `useAppointments`, `usePrescriptions`, `useReminders`, `useDoseLogs`,
  `useSystemStatus`, `useMailOutbox`) scope every query by the *active* uid, which is either the
  signed-in user or the patient a caregiver selected.
* **Medicines** page: create/edit modal with validation (name, dosage, at least one time, stock
  consistency, expiry in the future), stock bars, refill and expiry countdowns, search and filters,
  and guarded delete.
* **Prescriptions** page: drag-and-drop upload with progress, client-side type/size checks mirroring
  the rules, then a polling wait for the trigger to index the object; the record shows file name,
  size, type, upload time, and supports open/download and delete (owner only).
* **Caregiver** page: generate/rotate a 6-character share code, redeem someone else's code, list and
  remove caregivers, leave a patient. The patient can switch the whole UI to a caregiver's records via
  the header switch.
* **Rules** are the enforcement point: Firestore rules compare `resource.data.userId` with
  `request.auth.uid`, consult `users/{uid}.caregiverOf` for delegation, forbid client writes to
  server-owned collections, and restrict reminder updates to the read/dismiss fields. Storage rules
  restrict writes to the owner's folder, enforce `<10 MB` and `image/*|application/pdf`, and allow
  caregivers read-only access.

### 9.3 Backend, scheduling and observability (Member 3)

* **`functions/index.js`** exposes 16 functions (Appendix A) with shared validation helpers and a
  uniform `HttpsError` surface that the client maps to friendly messages in `lib/api.ts`.
* **`logDose`** implements the inventory invariant in a transaction:
  `0 ≤ remainingTablets ≤ max(totalTablets, remaining)`, take decrements once, skip-after-take
  restores, undo deletes the log and restores; concurrent callers serialise on the document.
* **`lib/engine.js`** is the reminder engine. `createReminder` uses `doc(id).create()`, so a retry or a
  duplicate scheduler invocation cannot produce a second alert. Delivery groups items per user, sends
  one email and one push per batch, records `channels`, and writes a run summary into
  `system/status` (`lastRun`, `recentRuns[8]`).
* **`lib/time.js`** wraps `Intl.DateTimeFormat` with `hourCycle: 'h23'` to convert UTC instants into
  each user's wall clock — the reason an 08:00 dose fires at 08:00 in Kolkata and in Lisbon.
* **`lib/mailer.js`** posts to SendGrid when `SENDGRID_API_KEY` and `MAIL_FROM` are present, otherwise
  composes the same message and writes it to `mailOutbox` with `status: "logged"`. The demo therefore
  never depends on an external mailbox.
* **`lib/push.js`** sends multicast FCM messages and removes tokens that FCM reports as unregistered.
* **`onPrescriptionUploaded`** derives a stable document id from the object path (sha1 prefix) so
  retries and metadata updates are idempotent, and logs `storage.prescription_indexed`.
* **Observability**: every meaningful path logs structured JSON (`sweepReminders.completed`,
  `dose.logged`, `caregiver.linked`, `prescription.deleted`). The `Cloud status` page renders the
  architecture map, environment information, a live round-trip latency measurement via `cloudHealth`,
  the scheduler run history from `system/status`, and deep links into Cloud Logging/Monitoring.

---

## 10. Security and IAM

### 10.1 Authentication and authorisation

* All access requires a Firebase ID token. Callables fail closed with `unauthenticated`.
* Firestore rules implement three predicates: `isSelf`, `isCaregiverOf`, `isMyCaregiver`. Clinical
  writes require `isSelf`; caregivers can read and log doses only.
* Storage rules mirror the same model at the object level.
* The Admin SDK (used inside Functions) bypasses rules by design; that is exactly why the
  server-owned collections cannot be written by clients.

### 10.2 Threat model summary

| Threat | Control |
|--------|---------|
| Reading another patient's records | Rules scope by `userId`; verified with a 403 assertion in the test suite |
| Forging a prescription record | `prescriptions` is `allow write: if false`; only the Storage trigger writes it |
| Uploading malware/oversized files | 10 MB cap, MIME allow-list, private bucket, owner-only paths |
| Editing a reminder to hide a missed dose | Reminder updates limited to `read`, `readAt`, `status`, `acknowledgedBy` |
| Brute-forcing caregiver codes | 6 chars from a 31-symbol alphabet (≈ 887 million combinations), clash-checked, rotatable, max 10 caregivers |
| Reminder spam via the demo sweep | Server-side throttle: one manual sweep per 20 seconds |
| Credential leakage | SendGrid key in Functions secrets; client config contains only public identifiers |
| Token replay after logout | Firebase ID tokens are short-lived (1 hour) and refreshed by the SDK |
| Clickjacking / MIME sniffing | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, strict referrer policy |

### 10.3 IAM

The deploying account holds Owner/Editor for setup; the deployed functions run under the default
compute service account with Firestore and Storage access. No public bucket ACLs are granted, no
Firestore rules allow anonymous reads, and the only unauthenticated endpoint (`/api`) returns a
non-sensitive health summary.

---

## 11. Reliability, idempotency and timezones

| Concern | Approach |
|---------|----------|
| Scheduler at-least-once delivery | Deterministic reminder ids + `create()` semantics |
| Duplicate dose taps / two caregivers | Firestore transaction, state-aware arithmetic |
| Partial failures during fan-out | Per-item try/catch, `stats.failures`, error list in `system/status`, `logger.error` for alerting |
| Timezone drift / DST | Wall-clock times + IANA per profile + `Intl` conversion per evaluation |
| Retry storms | Scheduler `retryCount: 0` for sweeps (next run covers it), manual sweep throttled |
| Storage trigger retries | Idempotent document id derived from the object path |
| Stale FCM tokens | Invalid tokens pruned from the profile after each multicast |
| Cost blow-up | `SCOPE_LIMIT = 500` documents per sweep, `maxInstances: 10`, 256 MiB memory |

---

## 12. Testing and results

### 12.1 Automated end-to-end verification

`npm run verify` exercises the real emulated cloud stack — real Auth sign-ups, real rules evaluation,
real callables, a real Storage upload and trigger — with no mocks. Latest run:

```text
MediVault backend verification - project demo-medivault
================================================================
PASS  Firebase Auth: patient sign-up returns an ID token
PASS  Firebase Auth: caregiver sign-up returns an ID token
PASS  Cloud Function ensureUserProfile provisions the caregiver profile
PASS  Cloud Function ensureUserProfile creates the profile
PASS  Firestore: users/{uid} stores timezone + notification prefs
PASS  Cloud Function seedDemoData writes demo medicines - 4 medicines / 2 appointments
PASS  Firestore: medicines collection readable by owner - 4 owned
PASS  Firestore: Atorvastatin seeded below its refill threshold - 6 <= 7
PASS  Firestore rules: unrelated caregiver cannot read another patient medicine - HTTP 403
PASS  Firestore rules: a stranger query on medicines is rejected - HTTP 403
PASS  Cloud Storage: prescription PDF uploaded to private bucket - HTTP 200
PASS  Storage trigger: onPrescriptionUploaded indexes the object into Firestore
PASS  Storage trigger: metadata (content type + owner) written by Cloud Function
PASS  Storage rules: text/plain upload rejected (image/PDF only) - storage/unauthorized
PASS  Storage rules: a stranger cannot write into another patient folder
PASS  Cloud Scheduler logic: sweep fans out dose / stock / expiry / appointment reminders
PASS  Cloud Function: sweep records an execution row in system/status for observability
PASS  Firestore: reminders deduplicated by deterministic ids - appointment, dose, lowstock
PASS  Notification delivery: reminder emails queued in mailOutbox - (outbox/logged)
PASS  Idempotency: a second sweep within 20s is throttled
PASS  Cloud Function logDose takes a dose and decrements stock transactionally - 42 -> 41
PASS  Idempotency: tapping "Take" twice does not double-deduct inventory - still 41
PASS  Cloud Function logDose undo restores the tablet - back to 42
PASS  Cloud Function generateCaregiverCode issues a 6-character code
PASS  Cloud Function redeemCaregiverCode links the caregiver
PASS  Firestore: caregiver array on the patient profile updated
PASS  Firestore rules: linked caregiver can now read the patient medicine
PASS  Cloud Function logDose accepts a linked caregiver and records loggedByRole
PASS  Cloud Function sendTestEmail queues a test message
PASS  Cloud Function cloudHealth reports Firestore + runtime + bucket
================================================================
30 passed, 0 failed
```

### 12.2 Build and static checks

| Check | Result |
|-------|--------|
| `tsc --noEmit` (strict) | 0 errors |
| `vite build` | success, 73 modules |
| Bundle size | JS 683.0 kB (211.6 kB gzip), CSS 26.1 kB (6.0 kB gzip) |
| Firestore/Storage rules syntax | accepted by emulator rules runtime |
| Functions cold start (emulator) | ~2.0 s first invocation, then 20–70 ms per call |

Observed latencies during verification: `cloudHealth` 2–3 ms, `logDose` ~25 ms, a full sweep over
36 medicines 33–66 ms.

### 12.3 Manual UI test plan (executed during the recorded demo)

| # | Scenario | Expected result |
|---|----------|-----------------|
| M1 | Sign up with a new email | Profile created; dashboard loads with empty states |
| M2 | "Explore with demo data" | 4 medicines + 2 appointments seeded; dashboard populates |
| M3 | Add a medicine with two times | Appears in list and today's timeline |
| M4 | Edit stock and refill threshold | Stock bar and low-stock badge update live |
| M5 | Tap Take, then Undo | Remaining count decrements then restores; log removed |
| M6 | Upload a PDF prescription | Progress completes; record appears after the trigger indexes it |
| M7 | Upload a `.txt` file | Rejected client-side and by Storage rules |
| M8 | Run sweep now | New alerts appear in Alerts and on the dashboard |
| M9 | Generate code, redeem in a second browser | Caregiver sees the patient's records; switch works |
| M10 | Caregiver attempts to edit a medicine | Write denied by rules (UI hides the action; direct write returns 403) |
| M11 | Open Cloud status | Environment details, latency, scheduler run history render |
| M12 | Sign out and sign in as caregiver | Records visible under the caregiver's session |

### 12.4 Results discussion

* The **rules are the security boundary**, not the UI: the suite proves a stranger gets `403` and a
  linked caregiver gets `200` on the same document, with no application code involved.
* **Idempotency holds** at both levels: repeated dose taps leave stock at 41, and repeated sweeps
  produce no duplicate reminders (document ids collide by construction).
* **The scheduled path is demonstrable without waiting**: `runReminderSweepNow` uses the same engine
  as the cron, so a viva can show a scheduler-equivalent run in one second and then prove the real
  cron by forcing a Cloud Scheduler job in the console.
* **The upload trigger is the only writer** of prescription metadata, which removes an entire class of
  client-trust bugs.

---

## 13. Cost analysis

Assumptions: 3 users, ~10 medicines each, 4 doses/day, 5-minute sweeps (8,640 invocations/month),
one digest/day, ~30 uploads/month.

| Service | Monthly usage | Free tier | Estimated cost |
|---------|---------------|-----------|----------------|
| Cloud Functions (2nd gen) | ~9k invocations, <1 GB-s | 2M invocations, 400k GB-s | ₹0 |
| Cloud Scheduler | 2 jobs | 3 jobs free | ₹0 |
| Firestore | <100 MB, ~50k reads, ~20k writes | 1 GiB, 50k reads/day, 20k writes/day | ₹0 |
| Cloud Storage | <1 GB stored, <1 GB egress | 5 GB, 1 GB/day | ₹0 |
| Firebase Hosting | ~10 MB transfer/day | 10 GB/month | ₹0 |
| Firebase Auth | 3 users | Unlimited email/password | ₹0 |
| SendGrid | <30 emails | 100/day free | ₹0 |
| Cloud Logging | <50 MB | 50 GiB/month | ₹0 |
| **Total** | | | **≈ ₹0 / month** (well inside Blaze allowances) |

The design keeps sweeps bounded (`SCOPE_LIMIT`, `maxInstances`) so cost grows linearly and
predictably if the project were extended to real users.

---

## 14. Deployment

The full procedure is in [`README.md`](../README.md#6-deploy-to-google-cloud-platform). Summary:

1. Create the GCP project, enable the Blaze plan (required for 2nd-gen Functions and Scheduler).
2. Enable Email/Password and Google providers; create Firestore (Native) and the Storage bucket.
3. Register a Web app and place the SDK config in `.env.production` (`VITE_USE_EMULATORS=false`).
4. Optionally set the `SENDGRID_API_KEY` and `MAIL_FROM` function secrets.
5. `npm run build` → `firebase deploy` (hosting, functions, Firestore rules/indexes, Storage rules).
6. Verify in the console: Scheduler jobs exist, the Storage trigger is attached, logs appear.

---

## 15. Team contribution

| Member | Modules | Evidence of work |
|--------|---------|------------------|
| **Member 1** — Frontend, Hosting, Auth UX | React app, routing, design system, dashboard, login, settings, responsive layout, Hosting deployment | `src/pages/**`, `src/components/**`, `src/context/**`, `src/styles.css`, `firebase.json` |
| **Member 2** — Data, Storage, Security | Firestore schema and hooks, indexes, prescriptions upload, caregiver sharing, rules | `src/lib/data.ts`, `src/pages/Prescriptions.tsx`, `src/pages/Caregiver.tsx`, `firestore.rules`, `storage.rules`, `firestore.indexes.json` |
| **Member 3** — Functions, Scheduler, Observability, Docs | Reminder engine, callables, triggers, email/push, telemetry, test suite, documentation | `functions/**`, `scripts/verify-backend.mjs`, `docs/**`, `system/status` telemetry, Cloud Logging/Monitoring setup |

All members contribute to the presentation: Member 1 demonstrates the UI, Member 2 shows Firestore,
Storage and rules, Member 3 forces a Scheduler run and walks through Cloud Logging.

---

## 16. Limitations and future work

**Current limitations**

* Web push requires the user to grant permission and is unavailable in some private-browsing modes.
* The sweep scans at most 500 active medicines per run — fine for a course project, but a production
  system would shard by user or move to a task-queue fan-out (Cloud Tasks).
* Caregivers are read + log-dose only; there is no fine-grained per-medicine permission.
* No offline write queue beyond Firestore's built-in persistence; uploads require connectivity.
* Notification history is per-user Firestore documents, not a full delivery analytics pipeline.

**Future work**

* Cloud Tasks per-user fan-out and Firestore TTL for archival of old reminders.
* Vision API / Document AI to extract medicine names and dosages from an uploaded prescription.
* App Check (reCAPTCHA Enterprise) to harden callables against scripted abuse.
* BigQuery export + Looker Studio dashboard for adherence analytics.
* Multi-language support and a proper PWA install flow with background sync.

---

## 17. Conclusion

MediVault meets its objectives using only managed Google Cloud services. Authentication, data
isolation, storage, scheduling, messaging and observability are each delegated to the platform, and
the project's own code concentrates on the domain rules that matter: a correct dose plan, an inventory
counter that cannot drift, reminders that fire exactly once per period in the right timezone, and a
caregiver relationship that is useful without being dangerous.

The system demonstrates the practical meaning of cloud-native design: **stateless compute triggered
by events, declarative authorization evaluated at the data layer, and telemetry that makes the
deployment observable.** All eight required features are implemented and the backend is validated by
an automated 30-assertion suite against the real emulated services.

---

## 18. References

1. Google Cloud — *Cloud Functions (2nd gen) documentation*, https://cloud.google.com/functions/docs
2. Google Cloud — *Cloud Scheduler documentation*, https://cloud.google.com/scheduler/docs
3. Google Cloud — *Cloud Firestore documentation*, https://cloud.google.com/firestore/docs
4. Google Cloud — *Cloud Storage documentation*, https://cloud.google.com/storage/docs
5. Google Cloud — *Cloud Logging and Monitoring*, https://cloud.google.com/logging/docs
6. Firebase — *Security Rules language*, https://firebase.google.com/docs/rules
7. Firebase — *Cloud Messaging for web*, https://firebase.google.com/docs/cloud-messaging/js/client
8. Firebase — *Emulator Suite*, https://firebase.google.com/docs/emulator-suite
9. SendGrid — *v3 Mail Send API*, https://docs.sendgrid.com/api-reference/mail-send/mail-send
10. React — *Docs*, https://react.dev
11. Vite — *Guide*, https://vite.dev/guide
12. N. K. Choudhry et al., "The implications of therapeutic complexity on adherence to cardiovascular
    medications," *Archives of Internal Medicine*, 2011. (Context for the adherence problem.)

---

## Appendix A — Cloud Functions reference

| Export | Type | Trigger | Notes |
|--------|------|---------|-------|
| `sweepReminders` | `onSchedule` | `every 5 minutes` (UTC) | Dose/low-stock/expiry/appointment sweep, 300 s timeout |
| `dailyDigest` | `onSchedule` | `0 8 * * *` (UTC) | One summary email per user |
| `onPrescriptionUploaded` | `onObjectFinalized` | Storage finalize | Idempotent metadata indexing |
| `api` | `onRequest` | HTTPS `/api` | Health probe (200/503) for Cloud Monitoring |
| `ensureUserProfile` | `onCall` | client | Profile upsert, timezone adoption |
| `logDose` | `onCall` | client | Transactional take/skip/undo |
| `runReminderSweepNow` | `onCall` | client | Manual sweep, 20 s throttle |
| `seedDemoData` | `onCall` | client | Demo dataset |
| `generateCaregiverCode` | `onCall` | client | Rotating 6-character code |
| `redeemCaregiverCode` | `onCall` | client | Bidirectional link |
| `removeCaregiver`, `leaveCaregiver` | `onCall` | client | Revoke links |
| `registerFcmToken` | `onCall` | client | Add/remove push token |
| `sendTestEmail` | `onCall` | client | Delivery smoke test |
| `deletePrescription` | `onCall` | client | Owner-only Storage + Firestore delete |
| `cloudHealth` | `onCall` | client | Runtime/region/bucket/latency |

Common options: region `us-central1`, memory `256MiB`, `maxInstances: 10`.

---

## Appendix B — Configuration variables

**Web (`.env`, public by design)**

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=        # optional, web push
VITE_USE_EMULATORS=false        # true for local development
VITE_EMULATOR_PROXY=false       # true to proxy emulators through the dev server
```

**Functions (`functions/.env` or secrets)**

```dotenv
SENDGRID_API_KEY=               # secret - optional (outbox fallback)
MAIL_FROM="MediVault <reminders@example.com>"
APP_URL=https://<project>.web.app
REMINDER_WINDOW_MINUTES=5       # how late a dose may still alert (1-55)
```

---

## Appendix C — Viva questions and answers

**1. Why Cloud Functions instead of an always-on server?**
The workload is bursty and event-shaped (a cron tick, an upload, a user tap). Serverless removes
patching and capacity planning, scales to zero between runs, and each trigger is a first-class managed
event source.

**2. How do you stop one user reading another's data?**
Firestore rules compare `resource.data.userId` with `request.auth.uid`; queries are rejected at the
server, and collections the client must never write (`prescriptions`, `reminders`, `mailOutbox`) are
`allow write: if false`.

**3. What happens if the scheduler runs twice?**
Nothing duplicates: reminder ids are deterministic (`dose_<medId>_<date>_<hhmm>`) and created with
`create()`, which fails if the document exists. Delivery and inventory paths are equally idempotent.

**4. How is the tablet count kept correct with two caregivers?**
`logDose` runs a Firestore transaction over the medicine and the dose-log document, reads the previous
status, and applies state-aware arithmetic, so concurrent taps serialise instead of double-deducting.

**5. Where do prescriptions live, and who can read them?**
Private Cloud Storage at `prescriptions/{uid}/…`; Storage rules allow the owner to write (≤10 MB,
image/PDF) and caregivers to read. Firestore metadata is produced by the storage trigger.

**6. How do timezones work?**
Scheduler fires in UTC; each profile stores an IANA zone; the engine converts "now" into the user's
wall clock with `Intl.DateTimeFormat` before comparing with `"HH:mm"` schedule entries.

**7. How would you monitor this in production?**
Structured JSON logs (filterable by `event`), Cloud Monitoring metrics and uptime checks on `/api`,
plus an alert policy on function error rate; `system/status` mirrors run history in-app.

**8. What is the single biggest security risk in this design?**
A leaked SendGrid key or an over-permissive service account. Both are mitigated: the key lives in
Functions secrets, and functions run least-privilege with no public bucket access.

**9. What would break first at scale?**
The 500-document sweep scope. The fix is per-user Cloud Tasks fan-out or a partitioned scan, not a
bigger limit.

**10. Which parts are GCP and which are Firebase?**
All of it is GCP: Firestore, Cloud Storage, Cloud Functions on Cloud Run, Cloud Scheduler, Cloud
Logging/Monitoring, IAM. Firebase is the SDK/console layer over those services.

---

## Appendix D — Demo dataset

`seedDemoData` creates a realistic chronic-care dataset for the signed-in user:

| Medicine | Dosage | Times | Remaining | Threshold | Expiry | Purpose in the demo |
|----------|--------|-------|-----------|-----------|--------|---------------------|
| Metformin | 500 mg | 08:00, now, 21:00 | 42 / 60 | 10 | +210 days | Dose alerts, inventory changes |
| Atorvastatin | 10 mg | 21:00 | 6 / 30 | 7 | +95 days | Low-stock alert (6 ≤ 7) |
| Vitamin D3 | 1000 IU | 09:00 | 24 / 30 | 5 | +5 days | Short-dated stock |
| Salbutamol Inhaler | 100 mcg | as needed | 1 / 1 | 1 | +400 days | No schedule / rescue medication |

Plus two appointments: a cardiologist in ~20 hours (triggers the 24-hour reminder) and a dentist in
9 days. One Metformin time is set to the *current local minute*, so the first sweep immediately
produces a dose alert — the fastest possible demonstration of the scheduled pipeline.
