/**
 * Firestore Configuration & Initialization
 * Provides the Firestore database instance for the application.
 */

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const env = import.meta.env;

// Firebase config: prefer Vite env vars, fall back to the public project config.
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyC8CEyf1Rn67q-Rrf-F61gceCN3pleFktE',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'infralinkdb.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'infralinkdb',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'infralinkdb.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1095931592929',
  appId: env.VITE_FIREBASE_APP_ID || '1:1095931592929:web:2c740de1ec4891552137a0',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-ZEE06CK37M',
};

// Initialize Firebase App (reuse if already initialized)
let app;
try {
  app = initializeApp(firebaseConfig);
} catch (error) {
  // App already initialized, get the existing instance
  import('firebase/app').then(({ getApps, initializeApp }) => {
    const apps = getApps();
    if (apps.length > 0) {
      app = apps[0];
    }
  });
}

// Initialize Firestore
const db = getFirestore(app);

// Initialize Auth
const auth = getAuth(app);

export { db, auth, firebaseConfig };