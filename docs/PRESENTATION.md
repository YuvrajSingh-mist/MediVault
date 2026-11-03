# MediVault: 10-Minute Recording Script

**Format:** slides + live screen capture of the deployed app. **Length:** 10:00 hard cap.

**New split:** Member 1 opens, presents the architecture and workflow, then demos the site: **0:00–4:00**.
Member 2 takes **4:00–7:00**. Member 3 takes **7:00–10:00**. Member 1 is scripted word for word below;
the other two have their decided slot, slide and click path, to be scripted next.

---

## The plan at a glance

| Slide | Content | Owner | Time |
|---|---|---|---|
| 1 | Title, group, team names | M1 | 0:00–0:20 |
| 2 | The problem | M1 | 0:20–0:55 |
| 3 | What MediVault does | M1 | 0:55–1:20 |
| 4 | Architecture and workflow | M1 | 1:20–2:20 |
| 5 | **Demo 1** live site: sign-in, dashboard, dose, stock guard, alerts | M1 | 2:20–4:00 |
| 6 | Data model and security rules | M2 | 4:00–4:40 |
| 7 | **Demo 2**: rules in the console, alert fan-out, mail outbox | M2 | 4:40–7:00 |
| 8 | Scheduled path and observability | M3 | 7:00–7:30 |
| 9 | **Demo 3**: Cloud status, sweep, Scheduler, Logging | M3 | 7:30–9:10 |
| 10 | Verification results and close | M3 | 9:10–10:00 |

Seven slides and three demo segments. Record each member's block separately and join them; each block
starts on its own slide, so a cut never lands mid-sentence.

---

## Before you record

### Prepare the account (do this once, the day before)

1. Use a **dedicated demo Google account**, not your personal one. The sign-in pop-up shows the email
   address, and you do not want that in a submitted video.
2. Sign in at <https://medivault-gcp-23875.web.app>.
3. If the vault is empty, click **Load sample data** on the dashboard. It writes four medicines and two
   appointments, and runs one sweep so alerts exist. It only works while the account has no medicines.
4. Open **Settings → Website alerts → Send a test alert** and allow notifications in the browser. On
   macOS, also check that Focus / Do Not Disturb is off, or the banner never appears on camera.
5. Leave **one dose untaken** for the demo, and leave a few alerts **unread** so the badge is visible.

### Windows and tabs, ready before you hit record

| Tab | What to open |
|---|---|
| 1 | `https://medivault-gcp-23875.web.app`, signed in, on **Dashboard** |
| 2 | Firebase console → Firestore → `medicines` collection (M2 uses it) |
| 3 | Firebase console → Firestore → **Rules** tab (M2 uses it) |
| 4 | Cloud console → Cloud Scheduler, and Cloud Logging (M3 uses them) |
| 5 | Terminal in the repo, ready for `npm run verify:deployed` (M3 runs it) |

Also:

- Browser zoom 110–125 %. 1080p. Hidden dock and menu bar if your recorder allows it.
- Close every personal tab, chat and notification.
- Cursor highlight on, if you have one. Move the pointer, pause on the element, then click.
- Do a silent rehearsal of the clicks once. The clicks are the part that overruns.

**Fallback:** if the deployed site misbehaves on the day, use the emulators (`npm run emulators` and
`npm run dev` at `http://127.0.0.1:5173`) and the same click path, then say "local emulator suite" once.
Everything below still works; only the URL changes.

---

# Member 1: 0:00 to 4:00

Target: about 560 spoken words, which is 3:45 of talking, leaving 15 seconds for clicks and breaths.
Read it twice out loud with a timer before recording.

## 0:00–0:20 · Slide 1 · Title

*Slide: MediVault, group number, three names, course code. Keep it plain.*

> "Good evening. We are Group __, and this is MediVault, a medication and appointment reminder system
> that runs entirely on managed Google Cloud services. I am Member 1. I will cover the problem, the
> architecture and the workflow, then show the running application."

*Do not read the names off the slide. They are already there.*

## 0:20–0:55 · Slide 2 · The problem

*Slide: four short lines, one per failure: missed dose, quiet stock-out, silent expiry, forgotten
visit. No stock photos.*

> "Medication only works when it is taken on time, and adherence fails for ordinary reasons. The
> schedule lives in someone's head. A strip runs out and nobody notices until the pharmacy is shut. An
> expiry date passes quietly. A follow-up appointment is forgotten. And when a family member helps, the
> handover is a phone call, with no shared record.
>
> The second problem is trust. Health data is sensitive, so the browser cannot be the thing that decides
> who may read a record."

## 0:55–1:20 · Slide 3 · What MediVault does

*Slide: the six screens as small thumbnails, or one line per feature.*

> "MediVault answers both. Google sign-in, so we never see a password. A medicine cabinet that holds
> dosage, daily times, tablet count, refill threshold and expiry. Today's plan, where a dose can be
> taken, skipped or undone. Alerts for low stock, expiry and appointments, on the page, on the desktop
> and by email. And a scheduler that runs the checks whether the app is open or not."

## 1:20–2:20 · Slide 4 · Architecture and workflow

*Slide: the system architecture diagram from `docs/architecture/`. Point at each layer as you name it. Do
not read the diagram box by box.*

> "There are four moving parts.
>
> The React app is compiled to static files and served by Firebase Hosting from Google's CDN. Firebase
> Authentication issues an ID token, and every read, every upload and every function call carries it.
>
> The browser writes only what it owns. Every document carries a userId, and Firestore rules compare
> that field with the token. So isolation lives in the data layer, not in the interface.
>
> Behind it, Cloud Functions, second generation, so they run as Cloud Run services in asia-south1, hold
> the logic that has to be authoritative. Logging a dose is a Firestore transaction, so two taps or two
> devices cannot decrement stock twice. Cloud Scheduler calls a sweep every five minutes. It checks due
> doses, stock, expiry and appointments, writes one reminder document per event, and fans that document
> out to four channels.
>
> That document is the workflow: one write to Firestore, and every open tab shows it through a live
> listener."

*Point at the arrow from Scheduler to Functions, then Functions to Firestore, then Firestore to the
browser. Three gestures, not ten.*

## 2:20–4:00 · Demo 1 · Live site

Follow these beats in order. Narration is about 160 words, so there is room to breathe.

**2:20 · Sign in**

[Tab 1. If you are already signed in, skip to 2:35 and trim this in editing.]

> "Let me show it running. This is the deployed build, talking to the real project, not a mock-up."

[Click **Continue with Google**, pick the demo account, wait for the dashboard.]

**2:35 · Dashboard**

[Point at the date and timezone chip, then the refill and expiry cards, then the dose rows, then the
appointment card at the bottom.]

> "Today's plan is built from each medicine's times, in the profile's timezone. The cards above the list
> are the warnings: how many medicines need a refill, and how many expire soon. Under the plan sits the
> next appointment and how many days away it is."

**2:55 · Take, then undo**

[Click **Take** on the first dose. Point at the toast that reports the new tablet count, and at the
**Only a few left** badge on a low-stock row. Click **Undo**.]

> "Marking a dose taken is not a checkbox. It calls a Cloud Function, which runs a transaction: read the
> medicine and the existing log, decrement the count exactly once, write the audit row. The toast reports
> the new count. Undo reverses it, and it cannot push the count above the pack."

**3:15 · Medicines and the stock guard**

[Open **Medicines**. Click the **Low stock** filter. Open a low-stock medicine, Atorvastatin in this
data.]

> "Each medicine is an ordinary document: dosage, form, times, stock, refill threshold, expiry."

[Set **Total in pack** to `20`, then type `23` in **Tablets remaining**. An error appears under the
field. Point at it, then press Cancel.]

> "Watch this. The pack holds twenty, so twenty-three left is impossible, and the form says so before
> anything is saved. The same rule is in Firestore and in the function that decrements stock, so a
> crafted request cannot get past it either."

*Cancel, do not save. The demo data stays untouched.*

**3:45 · Website alerts**

[Open **Settings** → **Website alerts** → **Send a test alert**. The OS banner appears; leave it up for
two seconds.]

> "Same document, second channel. And because it is per device, it can be turned off here without
> losing the alerts in the list."

[Point at **Turn off website alerts**, do not click, or click and click back on.]

**3:55 · Handoff**

[Go back to **Dashboard**.]

> "That is the patient surface. Member 2 will show how the data behind it is protected, and how one
> alert becomes four channels."

*Stop recording. Start Member 2's block on slide 6.*

---

# Member 2: 4:00 to 7:00

**Decided split:** 40 seconds on the data model and rules, then the console demo. The point of this block
is *authority*: the interface is not what protects the data.

## 4:00–4:40 · Slide 6 · Data model and security

Slide: one document shown as a field list (`userId`, `name`, `times`, `remainingTablets`,
`totalTablets`, `refillThreshold`, `expiryDate`) next to the four lines of the create rule.

Talking points:

- Every document carries the owning `userId`. That one denormalised field turns authorization into an
  equality check instead of a join.
- Rules compare `request.auth.uid` with that field for read, write and delete.
- The create rule also type-checks: name is a non-empty string, times is a list, stock is a whole number,
  and `remainingTablets` can never exceed `totalTablets`.
- `prescriptions` and `mailOutbox` are written by functions only. A browser cannot write them at all.
- Ownership and creation time are immutable on update.

## 4:40–7:00 · Demo 2

| Time | Screen | Action |
|---|---|---|
| 4:40 | Firebase console → Firestore → `medicines` | Open one document, point at `userId`, `times`, `remainingTablets`. |
| 5:00 | Firebase console → Firestore → Rules | Scroll to the `medicines` block, point at the create rule and the `isSelf` check. |
| 5:25 | App → **Medicines** | Show the **Low stock** filter, then the refill threshold field on a medicine. |
| 5:50 | App → **Settings → Notifications** | Walk the six toggles: email, push, dose, low stock, expiry, appointments. |
| 6:10 | App → **Alerts** | Show the type filters and one alert's channels line. |
| 6:35 | Firebase console → Firestore → `mailOutbox` | Open the newest document: recipient, subject, status `logged`, and which channels fired. |

Lines to hit, not to read:

- "The rule is doing the work here, not a `where` clause in the client."
- "Turning off a category here changes what the next sweep sends. It does not delete the alert."
- "One alert document, four delivery channels, and the outbox proves what was composed."

End with: "Member 3 will show the scheduled side, and what the system reports about itself."

---

# Member 3: 7:00 to 10:00

**Decided split:** the scheduled path, then the evidence, then the close. This is the block that proves
the cloud is doing work, so every claim needs a visible number.

## 7:00–7:30 · Slide 8 · Scheduled path and observability

Talking points:

- Cloud Scheduler invokes `sweepReminders` every 5 minutes and `dailyDigest` at 08:00 UTC.
- At-least-once delivery means the scheduler can fire twice, so reminder ids are deterministic and
  created only if absent. That is the idempotency answer before anyone asks.
- Every run writes a summary back into Firestore, so the product can report on its own cloud usage
  without opening the console.

## 7:30–9:10 · Demo 3

| Time | Screen | Action |
|---|---|---|
| 7:30 | `https://medivault-gcp-23875.web.app/system` | Type the URL, it has no menu entry. Point at Functions region, Firestore round-trip, last run. |
| 7:50 | Same page | Click **Run sweep now**. Read out medicines scanned, alerts created, duration. |
| 8:15 | Same page, Scheduler telemetry | Show the eight-run history and the 5-minute schedule. |
| 8:40 | Cloud console → Cloud Scheduler | Show the job, its frequency and next run time. **Force run**. |
| 9:00 | Cloud Logging | Filter `sweep`, open one entry, point at `createdReminders` and `durationMs`. The manual button logs `manual_sweep.completed`, the scheduler logs `sweepReminders.completed`. |

Lines: "the same engine the scheduler calls", "the run history is a Firestore document, not a screenshot",
"the log entry carries the counts the page just showed".

## 9:10–10:00 · Verification and close

Run `npm run verify:deployed` in the terminal. Six checks run without a token and all six pass; the
signed-in suite is listed as skipped. Read the four that matter: HTTPS and bundle, `/api` health,
unauthenticated callable rejected, unauthenticated Firestore read rejected. Then one sentence on the
emulator suite: thirty assertions, including a second Take not deducting a second tablet and a second
sweep inside twenty seconds being throttled.

Close:

> "MediVault is a small system, deliberately. Six screens, sixteen functions, one data layer that
> decides who can read what, and a scheduler that does not care whether anyone is watching. Thank you.
> We are happy to take questions."

---

## Handoff cues

Keep these three sentences exact. They are the seams between the recorded blocks.

| Cut | Last line |
|---|---|
| M1 → M2 | "Member 2 will show how the data behind it is protected, and how one alert becomes four channels." |
| M2 → M3 | "Member 3 will show the scheduled side, and what the system reports about itself." |
| M3 ends | "Thank you. We are happy to take questions." |

---

## If something goes wrong

| Problem | Immediate fallback |
|---|---|
| Notification banner does not appear | Check Focus mode, then the padlock icon → Notifications → Allow, then click the test button again |
| Sign-in pop-up shows your personal email | Cut that segment and start on the dashboard; say "already signed in" |
| A dose was already marked taken | Use **Skip** then **Undo** on another dose; the counter still moves |
| Vault is empty | **Load sample data** on the dashboard, wait for the toast, then continue |
| Sweep says "A sweep just ran" | Wait 20 seconds and click again, or show the run history already on screen |
| Website is down mid-recording | Switch to `npm run emulators` + `npm run dev`, same clicks, say "local emulator suite" |
| Running long | Drop the Settings walk in M2, then the Logging entry in M3. Never cut the architecture or the stock guard |

---

## Recording settings

- 1920×1080, 30 fps, system audio muted, voice recorded separately and aligned in editing.
- Zoom the browser to 110–125 % so the text survives a projector.
- Lower-third label at each cut: "Member 1, Frontend, Hosting and Architecture",
  "Member 2, Data Model and Security", "Member 3, Functions and Observability".
- 1080p H.264 at about 4 Mbps keeps ten minutes near 300 MB.
