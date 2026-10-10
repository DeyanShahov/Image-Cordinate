/**
 * Verify seeded Firestore data (read-only).
 * Run: node scripts/verify-firestore.mjs
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyC8CEyf1Rn67q-Rrf-F61gceCN3pleFktE',
  authDomain: 'infralinkdb.firebaseapp.com',
  projectId: 'infralinkdb',
  storageBucket: 'infralinkdb.firebasestorage.app',
  messagingSenderId: '1095931592929',
  appId: '1:1095931592929:web:2c740de1ec4891552137a0',
  measurementId: 'G-ZEE06CK37M',
};

async function main() {
  const app = initializeApp(firebaseConfig, 'verify');
  const db = getFirestore(app);

  // 1. Company
  const companySnap = await getDoc(doc(db, 'companies', 'infralink'));
  console.log('\n== companies/infralink ==');
  console.log(companySnap.exists() ? JSON.stringify(companySnap.data(), null, 2) : 'MISSING');

  // 2. Technicians
  const techSnap = await getDocs(collection(db, 'technicians'));
  console.log(`\n== technicians (${techSnap.size}) ==`);
  techSnap.forEach((d) => console.log(` ${d.id}: ${JSON.stringify(d.data())}`));

  // 3. Projects
  const projSnap = await getDocs(collection(db, 'companies', 'infralink', 'projects'));
  console.log(`\n== companies/infralink/projects (${projSnap.size}) ==`);
  projSnap.forEach((d) => console.log(` ${d.id}: ${JSON.stringify(d.data())}`));
  console.log('');
}

main().catch((error) => {
  console.error('[verify] FAILED:', error.message ?? error);
  process.exitCode = 1;
});