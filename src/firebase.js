import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

const firebaseConfig = {
  apiKey: 'AIzaSyBDT0iZjCvWgcj5eDoFunQAimTk8tV-PQo',
  authDomain: 'tk-archive-cd9d0.firebaseapp.com',
  projectId: 'tk-archive-cd9d0',
  storageBucket: 'tk-archive-cd9d0.firebasestorage.app',
  messagingSenderId: '385214208563',
  appId: '1:385214208563:web:7bf7cbb28af31f93522146',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app)
