import { initializeApp, FirebaseApp } from 'firebase/app'
import { getAuth, Auth } from 'firebase/auth'
import { getFirestore, Firestore } from 'firebase/firestore'
import { getFunctions, Functions } from 'firebase/functions'

// Firebase config for tk-archive-cd9d0 (TK Archive DAM - production)
const firebaseConfig = {
  apiKey: 'AIzaSyBa4YK3b9b-3GSaF4zEQKDKE5Z0rN5vxMk',
  authDomain: 'tk-archive-cd9d0.firebaseapp.com',
  projectId: 'tk-archive-cd9d0',
  storageBucket: 'tk-archive-cd9d0.appspot.com',
  messagingSenderId: '896824491699',
  appId: '1:896824491699:web:f54d9d2af7a7cfc86e3e44',
}

const app: FirebaseApp = initializeApp(firebaseConfig)
export const auth: Auth = getAuth(app)
export const db: Firestore = getFirestore(app)
export const functions: Functions = getFunctions(app)
