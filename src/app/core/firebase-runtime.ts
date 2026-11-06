import { FIREBASE_CONFIG } from './firebase-config';

export async function getFirebaseFirestore() {
  const [{ getApp, getApps, initializeApp }, { getFirestore }] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
  ]);
  const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
  return getFirestore(app);
}
