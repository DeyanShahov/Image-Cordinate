/**
 * Firebase Configuration & Initialization
 *
 * NOTE: The Firebase Web SDK config below is NOT a secret. It only identifies the
 * project (it is shipped to every browser by design). Access control is enforced by
 * Firebase Auth settings and Security Rules, plus the "Authorized domains" list in
 * the Firebase Console. Overriding via Vite env variables (.env) is optional.
 */

import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getAnalytics, isSupported } from 'firebase/analytics';

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

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Auth with LOCAL persistence (session survives browser restart)
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error('Failed to set auth persistence:', err);
});

// Initialize Analytics (browser only, when supported)
let analytics = null;
if (typeof window !== 'undefined') {
  isSupported()
    .then((supported) => {
      if (supported) analytics = getAnalytics(app);
    })
    .catch(() => {
      /* analytics not available - ignore */
    });
}

export { app, auth, analytics };