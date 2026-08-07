import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

// Firebase config for tk-archive-dam (TK Archive DAM production)
const firebaseConfig = {
  apiKey: 'AIzaSyD-SRNAkjh2qtuuUrhBjWxJ5Y0XSnXDRxo',
  authDomain: 'tk-archive-dam.firebaseapp.com',
  projectId: 'tk-archive-dam',
  storageBucket: 'tk-archive-dam.firebasestorage.app',
  messagingSenderId: '627649269834',
  appId: '1:627649269834:web:953ad9888ab8f2628696b3',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app)
