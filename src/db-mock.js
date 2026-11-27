// Finto database in memoria (salvato in localStorage) per provare l'interfaccia senza Firebase.
const KEY = 'mockdb';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { trips: {} }; } catch { return { trips: {} }; } };
let data = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(data));
const subs = new Set();
const emit = () => subs.forEach((f) => f());

export const db = {
  async init() { return { uid: 'mock' }; },
  onSync(cb) { cb(0); },
  async createTrip(id, t) { data.trips[id] = { ...t, _c: {} }; save(); emit(); },
  async getTrip(id) { const t = data.trips[id]; if (!t) return null; const { _c, ...r } = t; return r; },
  watchTrip(id, cb) {
    const f = () => { const t = data.trips[id]; if (t) { const { _c, ...r } = t; cb(r); } };
    subs.add(f); f(); return () => subs.delete(f);
  },
  updateTrip(id, patch) { Object.assign(data.trips[id], patch); save(); emit(); },
  watchColl(tripId, name, cb) {
    const f = () => {
      const c = (data.trips[tripId]?._c || {})[name] || {};
      cb(Object.entries(c).map(([id, v]) => ({ ...v, id, _pending: false })), { fromCache: false });
    };
    subs.add(f); f(); return () => subs.delete(f);
  },
  saveItem(tripId, name, item) {
    const { id, _pending, ...d } = item;
    const c = data.trips[tripId]._c;
    (c[name] = c[name] || {})[id] = d; save(); emit();
  },
  mergeItem(tripId, name, id, d) {
    const c = data.trips[tripId]._c;
    (c[name] = c[name] || {})[id] = { ...((c[name] || {})[id] || {}), ...d }; save(); emit();
  },
  deleteItem(tripId, name, id) { delete data.trips[tripId]._c[name][id]; save(); emit(); },
};
