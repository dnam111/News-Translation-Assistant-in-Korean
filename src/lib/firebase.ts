import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth();

async function testConnection() {
  try {
    await getDocFromServer(doc(db, '_connection_test', 'test'));
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('offline') ||
      error.message.includes('unavailable') ||
      error.message.includes('Could not reach')
    )) {
      console.warn("Firestore client is operating in offline mode or backend is temporarily unreachable.");
    } else {
      console.warn("Firebase connection test notice:", error);
    }
  }
}

testConnection();
