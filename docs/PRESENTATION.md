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
* Browser window 2: `http://127.0.0.1:5173` in a second window, same account (used to prove
  cross-window live updates and alerts).
* Browser tab 3: `http://127.0.0.1:4000` (Emulator UI — Firestore, Storage, Auth tabs).
* Browser tab 4: **GCP console** — Cloud Scheduler and Cloud Logging, already logged in.
* Close notifications, set the display to 1080p, hide the macOS dock, enlarge the browser zoom to 110–125 %.
* Allow notifications for `localhost` (or the deployed URL) in advance, so the desktop-alert
  step does not stall on a browser permission prompt.

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
| 2 | Problem: missed doses, stock-outs unnoticed, expiry dates, forgotten appointments | M1 | 0:30–1:20 |
| 3 | Objectives and the feature set | M1 | 1:20–2:00 |
| 4 | Architecture diagram (the one from the README) | M3 | 2:00–3:00 |
| 5 | GCP services table + why serverless | M3 | 3:00–3:45 |
| 6 | Data model + security rules (per-user isolation) | M2 | 3:45–4:45 |
| 7 | **Demo 1** — sign-in, dashboard, today's doses | M1 | 4:45–6:00 |
| 8 | **Demo 2** — medicines, dose logging, website alerts | M2 | 6:00–7:15 |
| 9 | **Demo 3** — sweep, alerts, Scheduler run, Cloud Logging | M3 | 7:15–8:30 |
| 10 | Verification results + bundle metrics | M3 | 8:30–9:10 |
| 11 | Conclusion, team split, thank you | All | 9:10–10:00 |

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

> "Our objectives map directly onto the required features. Users sign in with Google — one click, no
> password for us to store. They add, edit and delete medicines with dosages, multiple daily times,
> tablet counts and expiry dates. A dashboard shows today's plan and lets
> them mark doses taken, skipped or undone. The system raises low-stock and expiry alerts, reminds them
> of appointments twenty-four hours ahead. Alerts reach them four ways — a toast in the page, a
> desktop notification, web push, and email — all driven by the same Firestore document. Finally, the
> deployed app can prove its own cloud usage: logs, scheduler runs and live environment details are
> visible from inside the product. We deliberately kept the interface to six screens rather than
> adding features we could not demo end to end."

---

### 2:00 – 3:00 · Slide 4 · Member 3

> "This is the architecture. The React application is compiled to static files and served by **Firebase
> Hosting** over Google's CDN. **Firebase Authentication** issues an ID token, and every Firestore
> read, every Storage upload and every function call carries that token.
>
> **Cloud Functions** — second generation, which means they actually run as Cloud Run services — sit in
> the middle and are triggered in three different ways. The browser calls them directly for dose
> logging and profile provisioning. **Cloud Scheduler** invokes the reminder sweep
> every five minutes and the daily digest at eight UTC. And **Cloud Storage** raises a finalize event
> whenever a prescription lands in the private bucket, which triggers the indexing function.
>
> Data lives in **Firestore**, with binary objects in a private Storage bucket that only a trusted trigger writes metadata for. Reminders fan out through **Firebase Cloud
> Messaging** for browser push and **Twilio** for SMS — and when Twilio is not configured,
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
> On top of it we write **Firestore security rules**. A user can read and write only documents whose
> `userId` equals their token's uid, and reminder acknowledgement is limited to the four fields that
> represent state, so an alert can never be rewritten into a fake one. Two collections can never be
> written by a browser at all: `prescriptions`, which is created by the Storage trigger, and
> `smsOutbox`, which is created by the SMS function.
>
> Security rules exist for Cloud Storage too: the path is `prescriptions/{userId}/file`, only that user
> may upload, uploads are capped at ten megabytes, and only images or PDFs are accepted.
>
> The same delegation model that lets a caregiver read a patient's records is still implemented in the
> rules and in three callables, but we removed it from the interface — we would rather defend a small
> surface completely than demo a large one shallowly."

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

[Click **Load sample data** on an empty vault — the dashboard fills in without a reload]

> "Watch what happens after this write: today's doses and the next appointment appear by themselves. The
> mutations bump a version counter that every live query subscribes to, so we never ask the user to
> refresh the page."

[Open **/system** in the second window, leave the dashboard visible, then click **Run sweep now**]

> "That second window is writing to Firestore as this one watches. A new reminder document just landed
> and it popped up here as a toast, and the bell badge on the Alerts item went up on its own — no
> polling, no refresh. Only alerts created after the page opened are announced, because the component
> primes itself with the ids that already exist."

[Minimise the window, trigger a sweep again from the other window, then restore]

> "Same document, second channel: because the tab was hidden, the Web Notifications API also raised a
> real desktop notification. And in Settings there is the permission request and a test button, so you
> can show the OS pop-up on demand. That is the website-alert layer — it is what the user actually sees."

[Settings → Website alerts → Send a test alert]

> "Behind it sit the other two channels. FCM push reaches the device when the tab is closed, and SMS
> goes through Twilio — or into `smsOutbox` when no credentials are configured, which keeps delivery
> auditable in the demo."

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

> "Each alert records which channels were used — SMS, push, or in-app only. Because Twilio is not
> configured locally, the message is composed and written to the `smsOutbox` collection, so you can still
> audit it."

[Switch the other window to the Alerts page — it updated with no reload]

> "The same run wrote its summary to `system/status`. The Cloud status page reads it: documents
> scanned, alerts created, users notified, duration, and the last eight runs. This is the in-app mirror
> of Cloud Logging."

[Optional, if showing the deployed project: Cloud console → Cloud Scheduler → **Force run** → Logs]

> "In the deployed project, forcing the scheduler job produces the same result, and Cloud Logging shows
> the structured entry — `reminder_sweep` with `createdReminders`, `durationMs` and `notifiedUsers`. A
> dose log shows up as `dose.logged`, and a prescription upload as `storage.prescription_indexed`."

---

### 8:30 – 9:10 · Slide 10 · Member 3

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
| Running over time | Drop the Cloud status walkthrough, then the live alert demo; never cut the problem statement or the architecture |

---

## Viva preparation (likely questions)

1. **Which services are GCP, and which are "Firebase"?** All of them are GCP; Firebase is the SDK and
   console layer over Firestore, Cloud Storage, Cloud Run Functions, Scheduler and Logging.
2. **What happens if the scheduler fires twice?** Nothing; reminder ids are deterministic and created
   with create-if-absent semantics.
3. **How is inventory protected?** A transaction over the medicine and dose-log documents, with
   state-aware arithmetic.
4. **Why did you remove features instead of adding more?** Because every additional surface needs its
   own rules, tests and demo time; the six screens that remain are the ones we can prove end to end.
   Prescription uploads and caregiver sharing survive as tested backend capabilities.
5. **How does a desktop notification differ from a web push?** The desktop notification is raised by
   the open tab through the Web Notifications API; web push goes through FCM and a service worker, so
   it still arrives when the tab is closed.
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
