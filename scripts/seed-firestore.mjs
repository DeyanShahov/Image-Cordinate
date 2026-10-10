/**
 * Seed Firestore with default technicians, company and project documents.
 *
 * Uses the client SDK with the same config as the app (firestore.rules are open
 * until 2026-11-04, so unauthenticated writes are allowed during setup).
 *
 * Run:  node scripts/seed-firestore.mjs
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  addDoc,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyC8CEyf1Rn67q-Rrf-F61gceCN3pleFktE',
  authDomain: 'infralinkdb.firebaseapp.com',
  projectId: 'infralinkdb',
  storageBucket: 'infralinkdb.firebasestorage.app',
  messagingSenderId: '1095931592929',
  appId: '1:1095931592929:web:2c740de1ec4891552137a0',
  measurementId: 'G-ZEE06CK37M',
};

const TECHNICIANS = ['Anatoliy', 'Alex', 'Deyan', 'Todor', 'Stoqn', 'Tony'];

const DEFAULT_COMPANY = {
  id: 'infralink',
  name: 'InfraLink',
  slug: 'infralink',
  active: true,
  settings: {
    requireProject: true,
  },
};

const DEFAULT_PROJECT = {
  code: 'м10 до м80',
  name: 'Траса М10-М80',
  active: true,
  assignedTechnicians: [],
};

async function main() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  console.log('[seed] Project:', firebaseConfig.projectId);

  // 1. Company root document (fixed id for stable references)
  await setDoc(doc(db, 'companies', DEFAULT_COMPANY.id), {
    ...DEFAULT_COMPANY,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  console.log('[seed] company companies/infralink upserted');

  // 2. Technicians (root collection - matches src/modules/technicians.js)
  const techRef = collection(db, 'technicians');
  const existing = await getDocs(query(techRef, where('active', '==', true)));
  const existingNames = new Set(
    existing.docs.map((d) => String(d.data().name || '').toLowerCase()),
  );

  let added = 0;
  for (const name of TECHNICIANS) {
    if (existingNames.has(name.toLowerCase())) {
      console.log(`[seed] technician "${name}" already exists - skipped`);
      continue;
    }
    await addDoc(techRef, {
      name,
      companyId: DEFAULT_COMPANY.id,
      active: true,
      role: 'technician',
      createdAt: serverTimestamp(),
    });
    added += 1;
    console.log(`[seed] technician "${name}" created`);
  }
  console.log(`[seed] technicians: ${added} created, ${TECHNICIANS.length - added} skipped`);

  // 3. Project (subcollection under company)
  const projRef = collection(db, 'companies', DEFAULT_COMPANY.id, 'projects');
  const projSnap = await getDocs(projRef);
  const projExists = projSnap.docs.some(
    (d) => String(d.data().code || '') === DEFAULT_PROJECT.code,
  );
  if (projExists) {
    console.log(`[seed] project "${DEFAULT_PROJECT.code}" already exists - skipped`);
  } else {
    await addDoc(projRef, {
      ...DEFAULT_PROJECT,
      companyId: DEFAULT_COMPANY.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    console.log(`[seed] project "${DEFAULT_PROJECT.code}" created`);
  }

  console.log('[seed] done.');
}

main().catch((error) => {
  console.error('[seed] FAILED:', error.message ?? error);
  if (error.code) console.error('[seed] code:', error.code);
  process.exitCode = 1;
});