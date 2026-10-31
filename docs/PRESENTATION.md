# MediVault — 10-Minute Presentation Script & Slide Outline

**Deliverable:** recorded video demonstrating architecture, implementation and functionality.
**Length:** 10:00 hard cap. **Speakers:** three members. **Format:** slides + live screen capture.

---

## Before you record — 10-minute checklist

**Terminals (start 5 minutes early, leave running)**

```bash
# terminal 1 — emulated cloud stack (Auth, Firestore, Storage, Functions, UI)
npm run emulators

# terminal 2 — web app
npm run dev

# terminal 3 — ready to run, but DO NOT execute yet
npm run verify
```

* Browser window 1: `http://127.0.0.1:5173` (patient).
* Browser window 2: `http://127.0.0.1:5173` in a private window (caregiver).
* Browser tab 3: `http://127.0.0.1:4000` (Emulator UI — Firestore, Storage, Auth tabs).
* Browser tab 4: **GCP console** — Cloud Scheduler and Cloud Logging, already logged in.
* Close notifications, set the display to 1080p, hide the macOS dock, enlarge the browser zoom to 110–125 %.
* Have a sample PDF (`prescription.pdf`) on the desktop for the upload step.

**If you are demonstrating the deployed GCP project instead of local emulators**, replace the local
URLs with `https://<project>.web.app`, and show *Firebase console → Firestore / Storage* and *Cloud
console → Scheduler / Logging* for the cloud evidence. Keep the same timings.

**Golden rule:** rehearse the click path twice. Every second lost to a wrong menu is a second of
narration lost.

---

## Slide outline (12 slides)

| # | Slide | Owner | Time |
|---|-------|-------|------|
| 1 | Title — MediVault, team names, course | M1 | 0:00–0:30 |
| 2 | Problem: adherence, stock-outs, lost prescriptions, caregiver coordination | M1 | 0:30–1:20 |
| 3 | Objectives and the 8 required features | M1 | 1:20–2:00 |
| 4 | Architecture diagram (the one from the README) | M3 | 2:00–3:00 |
| 5 | GCP services table + why serverless | M3 | 3:00–3:45 |
| 6 | Data model + security rules (owner vs caregiver) | M2 | 3:45–4:45 |
| 7 | **Demo 1** — sign-in, dashboard, today's doses | M1 | 4:45–6:00 |
| 8 | **Demo 2** — medicines, dose logging, prescription upload | M2 | 6:00–7:15 |
| 9 | **Demo 3** — sweep, alerts, Scheduler run, Cloud Logging | M3 | 7:15–8:30 |
| 10 | **Demo 4** — caregiver sharing | M2 | 8:30–9:10 |
| 11 | Verification results + bundle metrics | M3 | 9:10–9:40 |
| 12 | Conclusion, team split, thank you | All | 9:40–10:00 |

---

## Full script

> Narration is written to be spoken at ~150 words per minute. Square brackets are *actions on screen*,
> not spoken. Trim the bracketed asides first if you run long.

---

### 0:00 – 0:30 · Slide 1 · Member 1

> "Good morning. We are Group __, and this is **MediVault** — a cloud-based personal medication,
> prescription and health reminder system built entirely on Google Cloud Platform. Everything you are
> about to see runs on managed Google Cloud services: Firebase Hosting, Authentication, Cloud
> Firestore, Cloud Storage, Cloud Functions on Cloud Run, and Cloud Scheduler. No virtual machines, no
> database server, no cron daemon of our own."

---

### 0:30 – 1:20 · Slide 2 · Member 1

> "Here is the problem we set out to solve. Medication only works when it is taken consistently, but
> adherence fails for ordinary reasons. The schedule lives in someone's memory. A strip runs out and
> nobody notices until the pharmacy is closed. An expiry date passes silently. A follow-up appointment
> is forgotten. And when a family member helps, the handover is a phone call — *did you already take
> it?* — with no shared record.
>
> The second half of the problem is technical. Health data is sensitive. A reminder app that filters
> records in the browser, or that lets a client write whatever it wants into the database, is not
> acceptable even if the interface looks convincing. So we wanted a design where the **data layer**
> enforces who may read and write — not the interface."

---

### 1:20 – 2:00 · Slide 3 · Member 1

> "Our objectives map directly onto the eight required features. Users sign up or sign in with email
> or Google. They add, edit and delete medicines with dosages, multiple daily times, tablet counts and
> expiry dates. They upload prescriptions as images or PDFs. A dashboard shows today's plan and lets
> them mark doses taken, skipped or undone. The system raises low-stock and expiry alerts, reminds them
> of appointments twenty-four hours ahead, and can share the whole record with a caregiver through a
> six-character code. Finally, the deployed app can prove its own cloud usage — logs, scheduler runs,
> and live environment details are visible from inside the product."

---

### 2:00 – 3:00 · Slide 4 · Member 3

> "This is the architecture. The React application is compiled to static files and served by **Firebase
> Hosting** over Google's CDN. **Firebase Authentication** issues an ID token, and every Firestore
> read, every Storage upload and every function call carries that token.
>
> **Cloud Functions** — second generation, which means they actually run as Cloud Run services — sit in
> the middle and are triggered in three different ways. The browser calls them directly for dose
> logging, caregiver codes and profile provisioning. **Cloud Scheduler** invokes the reminder sweep
> every five minutes and the daily digest at eight UTC. And **Cloud Storage** raises a finalize event
> whenever a prescription lands in the private bucket, which triggers the indexing function.
>
> Data lives in **Firestore** and the prescription bucket. Reminders fan out through **Firebase Cloud
> Messaging** for browser push and **SendGrid** for email — and when SendGrid is not configured,
> messages are still composed into a Firestore outbox so the pipeline stays auditable. Everything logs
> to **Cloud Logging** and **Cloud Monitoring**, and the scheduler writes its run history back into
> Firestore, which is what the in-app status page reads."

---

### 3:00 – 3:45 · Slide 5 · Member 3

> "Why serverless rather than a virtual machine? Our workload is bursty and event-shaped: a cron tick,
> an upload, a user tap. Cloud Functions scale to zero, need no patching, and each trigger is a managed
> event source — we never write polling or a job queue. Cloud Scheduler gives us managed cron with
> at-least-once delivery. Firestore and Storage are fully managed and replicated. Authentication is a
> managed identity provider. The whole project fits comfortably inside the free monthly allowances,
> which also means it is cheap to run after submission.
>
> The one trade-off we accepted: at-least-once delivery means the scheduler can fire twice, so our
> reminder engine had to be idempotent by design. We will see that in a moment."

---

### 3:45 – 4:45 · Slide 6 · Member 2

> "This is the data model. Every document carries the `userId` that owns it — the profile, each
> medicine, each appointment, each prescription, each reminder and each dose log. That single
> denormalised field is what makes authorization a cheap equality check instead of a join.
>
> On top of it we write **Firestore security rules**. An owner can read and write their own records. A
> caregiver can read them, and can update only the four fields that represent acknowledgement on a
> reminder — but can never edit a medicine, an appointment or a prescription. Two collections can never
> be written by a browser at all: prescriptions, which are created by the Storage trigger, and
> mailOutbox, which is created by the email function.
>
> Security rules exist for Cloud Storage too: the path is `prescriptions/{userId}/file`, only that user
> may upload, uploads are capped at ten megabytes, and only images or PDFs are accepted. Caregivers get
> read access to the same path. And the caregiver relationship itself is a one-time six-character code
> — roughly 887 million combinations, clash-checked, rotatable, capped at ten caregivers per patient."

---

### 4:45 – 6:00 · Demo 1 · Member 1

> [Browser 1, login page] "Let me show it running. This is the app against the local emulator suite of
> Google Cloud services — same code, same rules, just a local project id."

[Click **Explore with demo data**]

> "That button signs in with a demo account and calls a Cloud Function called `seedDemoData`, which
> writes four medicines and two appointments. This is the dashboard."

[Scroll slowly through the dashboard]

> "Today's schedule is built from each medicine's times, converted into the profile's timezone — this
> account is set to Asia/Kolkata. Each row is a dose with Take, Skip and Undo. The cards above count
> medicines, tablets left and unread alerts. On the right, the next appointment — the cardiologist in
> about twenty hours — and the latest alerts."

[Click **Take** on a dose]

> "Marking a dose taken does not just change a checkbox. It calls the `logDose` Cloud Function, which
> runs a Firestore transaction: it reads the medicine and the existing dose log, decrements the tablet
> count exactly once, and writes the log with the caller's role. Watch the counter change."

---

### 6:00 – 7:15 · Demo 2 · Member 2

[Open **Medicines**]

> "Medicines are ordinary Firestore documents, but the rules shape them: the name must be a non-empty
> string, the times must be a list, the remaining count must be a non-negative integer, and `userId`
> must equal the caller. The ownership field and the creation timestamp are immutable after creation —
> an update that touches them is rejected."

[Open a medicine, change stock, save; show the stock bar update]

> "Editing propagates instantly because the page is a live Firestore query — an `onSnapshot`
> subscription — not a fetch on page load."

[Open **Prescriptions**, drag in `prescription.pdf`]

> "Uploads go straight from the browser to Cloud Storage. The file never passes through our own
> server, and the bucket is private. The security rules accepted it because it is a PDF under ten
> megabytes in my own folder. As soon as the object finalizes, the `onPrescriptionUploaded` function
> fires, hashes the object path into a stable document id, and writes the metadata into Firestore. The
> page waits for that indexed record to appear — which is exactly what you see here."

[Try uploading a `.txt` file — it is rejected]

> "A text file is refused by the same rules. This is the important part: the client check is a
> convenience, the rule is the guarantee."

---

### 7:15 – 8:30 · Demo 3 · Member 3

[Open **Alerts**, then the **Cloud status** page]

> "Now the scheduled path. In production, Cloud Scheduler invokes `sweepReminders` every five minutes.
> For the demo we call the same engine on demand, so we do not have to wait."

[Click **Run sweep now**]

> "The engine scans active medicines and appointments, loads each owner's profile once for timezone and
> notification preferences, and then evaluates four things: is a dose due in the last five minutes, is
> stock at or below the refill threshold, is the expiry within thirty, fourteen, seven, three, one or
> zero days, and is an appointment within twenty-four hours. New alerts appear here — you can see a
> dose alert, a low-stock alert for Atorvastatin, and an appointment reminder."

[Point at one alert: show channels]

> "Each alert records which channels were used — email, push, or in-app only. Because SendGrid is not
> configured locally, the email is composed and written to the `mailOutbox` collection, so you can still
> audit it."

[Switch to the Emulator UI → Firestore → reminders; then Cloud status page]

> "The same run wrote its summary to `system/status`. The Cloud status page reads it: documents
> scanned, alerts created, users notified, duration, and the last eight runs. This is the in-app mirror
> of Cloud Logging."

[Optional, if showing the deployed project: Cloud console → Cloud Scheduler → **Force run** → Logs]

> "In the deployed project, forcing the scheduler job produces the same result, and Cloud Logging shows
> the structured entry — `reminder_sweep` with `createdReminders`, `durationMs` and `notifiedUsers`. A
> dose log shows up as `dose.logged`, and a prescription upload as `storage.prescription_indexed`."

---

### 8:30 – 9:10 · Demo 4 · Member 2

[Open **Care circle**, click generate]

> "Caregiver sharing. The patient generates a six-character code; it is stored on their profile and is
> validated by a Cloud Function, not by the client. Our second browser window is a different account."

[Browser 2, sign in as caregiver, paste the code]

> "Redeeming the code links both profiles in a transaction: the patient's `caregivers` array and the
> caregiver's `caregiverOf` array. From that moment the rules allow the caregiver to read the patient's
> records. The header here lets a caregiver switch between their own records and the patient they look
> after."

[Show the patient's dashboard in the caregiver view; try to edit a medicine]

> "The caregiver can see the plan and log doses — the dose log records `loggedByRole: caregiver`, which
> appears in the audit trail — but the edit and delete controls are not available, and a direct write
> would be rejected by the rules with a permission error. Read access, dose logging, no clinical
> edits."

---

### 9:10 – 9:40 · Slide 11 · Member 3

> "We did not just click around. We wrote an end-to-end verification suite that runs against the real
> emulated services — real sign-ups, real rules, real callables, a real storage upload and trigger. It
> has thirty assertions and all thirty pass."

[Show terminal output or the slide listing the checks]

> "It proves the negative cases too: a stranger reading another patient's medicine gets HTTP 403, a
> text upload is rejected, a write into another user's folder is rejected, a second tap on Take does
> not deduct a second tablet, and a second sweep within twenty seconds is throttled. The production
> build is type-checked with zero errors and ships as about 211 kilobytes of gzipped JavaScript."

---

### 9:40 – 10:00 · Slide 12 · All three

> **Member 1:** "To summarise: MediVault turns a daily health routine into an event-driven cloud system."
> **Member 2:** "Firestore and Storage hold the data, and security rules — not the interface — decide who
> can touch it."
> **Member 3:** "Cloud Functions, Cloud Scheduler and Cloud Storage triggers do the work, and Cloud
> Logging and Monitoring make it observable." 
> **Member 1 (closing):** "Thank you. We are happy to take questions."

---

## Backup plans

| Problem during recording | Immediate fallback |
|---------------------------|--------------------|
| Emulators fail to start | Use the deployed `https://<project>.web.app` environment instead (same click path) |
| Port already in use | `lsof -i :8080` → kill the stale emulator, restart `npm run emulators` |
| Sweep shows no alerts | The seeded dose is due at the current minute; re-run the sweep after 60 s, or point at the low-stock and appointment alerts that are always present |
| Emulator UI slow | Skip it; the Cloud status page shows the same run data from `system/status` |
| Internet down | Everything you need is local except the GCP console screenshots — have those as static images on a slide |
| Running over time | Cut Demo 4 (caregiver) to 20 s, then drop the Cloud status walkthrough; never cut the problem statement or the architecture |

---

## Viva preparation (likely questions)

1. **Which services are GCP, and which are "Firebase"?** All of them are GCP; Firebase is the SDK and
   console layer over Firestore, Cloud Storage, Cloud Run Functions, Scheduler and Logging.
2. **What happens if the scheduler fires twice?** Nothing; reminder ids are deterministic and created
   with create-if-absent semantics.
3. **How is inventory protected?** A transaction over the medicine and dose-log documents, with
   state-aware arithmetic.
4. **How do rules know a caregiver is legitimate?** They read the caller's `caregiverOf` array, written
   only by the `redeemCaregiverCode` function.
5. **Why not write prescriptions metadata from the client?** Because a client can lie; the Storage
   trigger derives it from the object that actually exists.
6. **What would you change at scale?** Replace the bounded global sweep with per-user Cloud Tasks
   fan-out, add App Check, and export analytics to BigQuery.
7. **Where is the cost risk?** Unbounded scans and instance count; both are capped by `SCOPE_LIMIT` and
   `maxInstances`.

---

## Recording settings

* 1920×1080, 30 fps, system audio muted, voice-over recorded separately and aligned in editing.
* Zoom the browser to 110–125 % so text is legible on a projector.
* Use a cursor highlight tool if available; otherwise move the pointer deliberately and pause on each
  clicked element.
* Add lower-third labels ("Member 1 — Frontend & Hosting") when each speaker takes over.
* Keep the final file under the submission limit (typically 200–500 MB); 1080p H.264 at ~4 Mbps for
  10 minutes is roughly 300 MB.
