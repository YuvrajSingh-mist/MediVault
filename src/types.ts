import type { Timestamp } from 'firebase/firestore'

export type UserRole = 'owner' | 'caregiver'

export interface NotificationPrefs {
  email: boolean
  push: boolean
  dose: boolean
  lowStock: boolean
  expiry: boolean
  appointments: boolean
}

export interface UserProfile {
  uid: string
  email: string
  displayName: string
  photoURL?: string
  phone?: string
  timezone: string
  caregiverCode?: string | null
  caregivers?: string[]
  caregiverOf?: string[]
  prefs?: Partial<NotificationPrefs>
  fcmTokens?: string[]
  createdAt?: Timestamp
  lastSeenAt?: Timestamp
}

export interface Medicine {
  id: string
  userId: string
  name: string
  dosage: string
  form: string
  times: string[]
  remainingTablets: number
  totalTablets: number
  refillThreshold: number
  expiryDate?: Timestamp | null
  notes?: string
  active: boolean
  createdAt?: Timestamp
  updatedAt?: Timestamp
}

export interface Appointment {
  id: string
  userId: string
  doctorName: string
  speciality?: string
  location?: string
  date: Timestamp
  notes?: string
  status?: string
  createdAt?: Timestamp
}

export interface Prescription {
  id: string
  userId: string
  storagePath: string
  fileName: string
  contentType: string
  size: number
  kind?: string
  notes?: string
  uploadedAt?: Timestamp
  bucket?: string
}

export type ReminderType = 'dose' | 'lowstock' | 'expiry' | 'appointment' | 'digest' | 'system'

export interface Reminder {
  id: string
  userId: string
  type: ReminderType
  title: string
  body: string
  medicineId?: string
  appointmentId?: string
  dateKey?: string
  dueAt?: Timestamp
  read: boolean
  status: string
  channels?: string[]
  createdAt?: Timestamp
  sentAt?: Timestamp
}

export interface DoseLog {
  id: string
  userId: string
  medicineId: string
  medicineName?: string
  dateKey: string
  time: string
  status: 'taken' | 'skipped'
  loggedBy?: string
  loggedByRole?: UserRole
}

export interface MailOutboxItem {
  id: string
  to: string | null
  subject: string
  text: string
  status: 'sent' | 'logged' | 'failed'
  provider: string
  tag?: string
  error?: string | null
  createdAt?: Timestamp
}

export interface SweepSummary {
  runId?: string
  trigger: string
  actorUid?: string | null
  startedAt?: string
  finishedAt?: string
  durationMs: number
  scannedMedicines: number
  scannedAppointments: number
  createdReminders: number
  notifiedUsers: number
  emailsSent: number
  pushesSent: number
  failures: number
  errors?: string[]
  projectId?: string | null
  revision?: string | null
}

export interface SystemStatus {
  lastRun?: SweepSummary
  recentRuns?: Array<{
    runId: string
    at: string
    trigger: string
    durationMs: number
    createdReminders: number
    notifiedUsers: number
    actorUid?: string | null
  }>
  schedule?: { sweep: string; digest: string }
  updatedAt?: Timestamp
}

export interface CloudHealth {
  projectId: string | null
  region: string
  revision: string
  runtime: string
  bucket: string | null
  firestoreOk: boolean
  latencyMs: number
  mailProvider: string
  sweepWindowMinutes: number
  time: string
}

export interface PatientOption {
  uid: string
  name: string
  email: string
}

/** A single computed dose slot for the day. */
export interface DoseSlot {
  key: string
  medicineId: string
  medicineName: string
  dosage: string
  form: string
  time: string
  status: 'pending' | 'taken' | 'skipped'
  reminderId?: string
  lowStock: boolean
}
