import { initializeApp, FirebaseApp } from 'firebase/app'
import { getAuth, Auth } from 'firebase/auth'
import { getFirestore, Firestore } from 'firebase/firestore'
import { getFunctions, Functions } from 'firebase/functions'

// Firebase config for tk-archive-cd9d0 (TK Archive DAM - production).
// Pulled fresh from `firebase apps:sdkconfig` — the previous values here
// were a stale/mismatched app registration (wrong appId, wrong apiKey).
// Firestore/Storage reads never surfaced it since those don't validate the
// API key the same way; it only broke once real Firebase Auth (sign-in,
// password reset) started actually being used.
const firebaseConfig = {
  apiKey: 'AIzaSyBDT0iZjCvWgcj5eDoFunQAimTk8tV-PQo',
  authDomain: 'tk-archive-cd9d0.firebaseapp.com',
  projectId: 'tk-archive-cd9d0',
  storageBucket: 'tk-archive-cd9d0.firebasestorage.app',
  messagingSenderId: '385214208563',
  appId: '1:385214208563:web:7bf7cbb28af31f93522146',
}

const app: FirebaseApp = initializeApp(firebaseConfig)
export const auth: Auth = getAuth(app)
export const db: Firestore = getFirestore(app)
export const functions: Functions = getFunctions(app)
