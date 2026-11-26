// Accesso a Firebase. L'interfaccia è la stessa del finto db usato per i test (db-mock.js).
import { initializeApp } from 'firebase/app';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, setDoc, getDoc, getDocFromCache, deleteDoc, onSnapshot,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyA8O1yktVgans0148h63o7kmRlFwkexBeI',
  authDomain: 'viaggi-in-moto-be45b.firebaseapp.com',
  projectId: 'viaggi-in-moto-be45b',
  storageBucket: 'viaggi-in-moto-be45b.firebasestorage.app',
  messagingSenderId: '1017066358983',
  appId: '1:1017066358983:web:1e7e590a31776ba71d16e2',
};

const app = initializeApp(firebaseConfig);
// Cache locale persistente: i dati restano sul telefono e funzionano senza rete.
const fs = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// Contatore delle scritture non ancora arrivate al server.
const pending = new Map();
let syncCb = () => {};
const reportSync = () => {
  let n = 0;
  pending.forEach((v) => { n += v; });
  syncCb(n);
};

export const db = {
  // Nessun login: l'accesso è protetto dal codice lungo e casuale del viaggio.
  // Così l'app parte subito anche senza rete.
  async init() { return { uid: 'local' }; },

  onSync(cb) { syncCb = cb; },

  async createTrip(id, data) {
    // Non aspettiamo il server: con rete scarsa la promessa arriva solo a sync avvenuta.
    setDoc(doc(fs, 'trips', id), data).catch((e) => console.error(e));
  },

  async getTrip(id) {
    try {
      const s = await getDoc(doc(fs, 'trips', id));
      return s.exists() ? s.data() : null;
    } catch (e) {
      try {
        const s = await getDocFromCache(doc(fs, 'trips', id));
        return s.exists() ? s.data() : null;
      } catch { throw e; }
    }
  },

  watchTrip(id, cb) {
    return onSnapshot(doc(fs, 'trips', id), { includeMetadataChanges: true }, (s) => {
      pending.set(`trip:${id}`, s.metadata.hasPendingWrites ? 1 : 0);
      reportSync();
      if (s.exists()) cb(s.data());
    }, (e) => console.error(e));
  },

  updateTrip(id, data) {
    setDoc(doc(fs, 'trips', id), data, { merge: true }).catch((e) => console.error(e));
  },

  watchColl(tripId, name, cb) {
    return onSnapshot(collection(fs, 'trips', tripId, name), { includeMetadataChanges: true }, (s) => {
      let n = 0;
      const items = s.docs.map((d) => {
        if (d.metadata.hasPendingWrites) n++;
        return { ...d.data(), id: d.id, _pending: d.metadata.hasPendingWrites };
      });
      pending.set(`${tripId}:${name}`, n);
      reportSync();
      cb(items);
    }, (e) => console.error(e));
  },

  saveItem(tripId, name, item) {
    const { id, _pending, ...data } = item;
    setDoc(doc(fs, 'trips', tripId, name, id), data).catch((e) => console.error(e));
  },

  deleteItem(tripId, name, id) {
    deleteDoc(doc(fs, 'trips', tripId, name, id)).catch((e) => console.error(e));
  },
};
