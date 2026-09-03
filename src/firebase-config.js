

import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyAshSfjG7Rz1kw57XdqKUxKCold6ZmKNTc",
  authDomain: "talent-resources-crm-f30c9.firebaseapp.com",
  projectId: "talent-resources-crm-f30c9",
  storageBucket: "talent-resources-crm-f30c9.firebasestorage.app",
  messagingSenderId: "377356993950",
  appId: "1:377356993950:web:96647331aea8bf5988428f"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

