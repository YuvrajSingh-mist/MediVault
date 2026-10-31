import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage'

/**
 * Firebase / Google Cloud bootstrap.
 *
 * The project talks to the real cloud when `VITE_FIREBASE_*` is configured.
 * Locally (`npm run dev`) it defaults to the Firebase Emulator Suite so the
 * whole stack - Auth, Firestore, Storage and Cloud Functions - can be exercised
 * on a laptop without a billing account.
 */

const env = import.meta.env

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'demo-medivault-key',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'demo-medivault.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'demo-medivault',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-medivault.appspot.com',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: env.VITE_FIREBASE_APP_ID || '1:000000000000:web:medivaultdemo',
}

export const PROJECT_ID = config.projectId
export const CLOUD_CONFIGURED = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID)

const explicitEmulator = env.VITE_USE_EMULATORS
export const USE_EMULATORS =
  explicitEmulator === 'true' || (explicitEmulator === undefined && Boolean(env.DEV))

/**
 * Optional single-origin mode: reach every emulator through the Vite dev server
 * (see `vite.config.ts`). Needed only in sandboxed browsers that refuse to open
 * extra localhost ports; the default multi-port setup is the normal workflow.
 */
export const EMULATOR_PROXY = env.VITE_EMULATOR_PROXY === 'true'

export const VAPID_KEY = env.VITE_FIREBASE_VAPID_KEY as string | undefined

const app = initializeApp(config)

export const auth: Auth = getAuth(app)
export const db: Firestore = getFirestore(app)
export const storage: FirebaseStorage = getStorage(app)
export const functions: Functions = getFunctions(app, 'us-central1')

if (USE_EMULATORS) {
  if (EMULATOR_PROXY) {
    const host = window.location.hostname
    const port = Number(window.location.port) || 5173
    connectAuthEmulator(auth, `${window.location.origin}/__emu/auth`, { disableWarnings: true })
    connectFirestoreEmulator(db, host, port)
    connectStorageEmulator(storage, host, port)
    connectFunctionsEmulator(functions, host, port)
  } else {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
    connectStorageEmulator(storage, '127.0.0.1', 9199)
    connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  }
}

export const modeLabel = USE_EMULATORS ? 'Local emulators' : `GCP · ${config.projectId}`
