import {
  toCents, fmt, fmtSigned, expenseEffect, balances, settle, stageKm, duration, toEur,
} from './calc.js';

// ---------- utilità ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = (n = 12) => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, (x) => a[x % a.length]).join('');
};
const today = () => new Date().toISOString().slice(0, 10);
const dayLabel = (d) => {
  if (!d) return '';
  const dt = new Date(`${d}T12:00:00`);
  return dt.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
};
const centsToInput = (c) => (c ? (c / 100).toFixed(2).replace('.', ',') : '');

const CATEGORIES = [
  ['spesa', '🛒', 'Spesa'], ['carburante', '⛽', 'Carburante'], ['pernotto', '⛺', 'Pernotto'],
  ['ristorante', '🍽️', 'Ristorante/bar'], ['trasporti', '⛴️', 'Traghetti/pedaggi'],
  ['moto', '🔧', 'Moto/ricambi'], ['altro', '📦', 'Altro'],
];
const catOf = (k) => CATEGORIES.find((c) => c[0] === k) || CATEGORIES[CATEGORIES.length - 1];
const SLEEP = [['', '—'], ['tenda', '⛺ Tenda'], ['campeggio', '🏕️ Campeggio'], ['struttura', '🏨 Struttura'], ['deserto', '🐪 Deserto'], ['altro', 'Altro']];

// Conto alla rovescia: giorni di calendario che mancano alla partenza.
function countdown(startDate, startTime) {
  if (!startDate) return null;
  const start = new Date(`${startDate}T12:00:00`);
  const now = new Date();
  const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const days = Math.round((start - todayNoon) / 86400000);
  const label = start.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  const at = startTime ? `, ore ${startTime.replace(/^0/, '')}` : '';
  if (days > 1) return { big: `${days.toLocaleString('it-IT')}`, unit: 'giorni alla partenza', sub: `Partenza ${label}${at}` };
  if (days === 1) return { big: '1', unit: 'giorno alla partenza: è domani!', sub: `Partenza ${label}${at}` };
  if (days === 0) return { big: '🏍️', unit: 'Si parte oggi!', sub: startTime ? `Partenza ore ${startTime}` : 'Buon viaggio' };
  return { big: `${-days + 1}°`, unit: 'giorno di viaggio', sub: `Partiti ${label}` };
}
const countdownHtml = (t) => {
  const c = countdown(t?.startDate, t?.startTime);
  return c ? `<div class="countdown"><div class="cd-big">${c.big}</div><div><div class="cd-unit">${c.unit}</div><div class="small">${esc(c.sub)}</div></div></div>` : '';
};

// ---------- stato locale (sul telefono) ----------
const LS = 'viaggi-moto';
const local = (() => { try { return JSON.parse(localStorage.getItem(LS)) || { trips: [] }; } catch { return { trips: [] }; } })();
const saveLocal = () => localStorage.setItem(LS, JSON.stringify(local));

const S = {
  db: null, view: 'home', tab: 'spese',
  tripId: null, trip: null, expenses: [], stages: [], posts: [], gpx: [], presence: [], presenceDone: false, unsub: [], postDraft: '',
  pending: 0, online: navigator.onLine, modal: null, form: null, joinCode: '', joinTrip: null, msg: '',
};

const me = () => local.trips.find((t) => t.id === S.tripId)?.me;
const members = () => S.trip?.members || [];
const nameOf = (id) => members().find((m) => m.id === id)?.name || '?';
const myName = () => nameOf(me());
const rate = () => Number(S.trip?.rate) || 10.8;
// Il creatore del viaggio (per i viaggi vecchi: il primo partecipante).
const ownerId = () => S.trip?.ownerId || members()[0]?.id;
const isOwner = () => !!me() && me() === ownerId();

// ---------- avvio ----------
export async function start(db) {
  S.db = db;
  db.onSync((n) => { S.pending = n; renderSync(); });
  window.addEventListener('online', () => { S.online = true; renderSync(); });
  window.addEventListener('offline', () => { S.online = false; renderSync(); });
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  // Quando si torna all'app dopo averla lasciata in sottofondo, aggiorna "visto alle…".
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { S.presenceDone = false; markPresence(); } });

  $('#app').innerHTML = '<div class="center muted">Caricamento…</div>';
  try {
    await db.init();
  } catch (e) {
    $('#app').innerHTML = `<div class="center"><p><b>Serve internet al primo avvio.</b></p><p class="muted">Collegati e riapri l'app. Dopo funzionerà anche senza rete.</p><button class="btn" data-a="reload">Riprova</button></div>`;
    return;
  }
  const t = new URLSearchParams(location.search).get('t');
  if (t && !local.trips.find((x) => x.id === t)) {
    S.view = 'join'; S.joinCode = t; history.replaceState(null, '', location.pathname);
    lookupTrip();
  } else if (local.current && local.trips.find((x) => x.id === local.current)) {
    openTrip(local.current);
  }
  render();
}

function openTrip(id) {
  S.unsub.forEach((f) => f());
  S.tripId = id; S.view = 'trip'; S.trip = null; S.expenses = []; S.stages = []; S.posts = []; S.gpx = []; S.presence = []; S.presenceDone = false;
  local.current = id; saveLocal();
  S.unsub = [
    S.db.watchTrip(id, (t) => {
      S.trip = t;
      const lt = local.trips.find((x) => x.id === id);
      if (lt && (lt.name !== t.name || lt.startDate !== t.startDate)) { lt.name = t.name; lt.startDate = t.startDate || ''; saveLocal(); }
      render();
    }),
    S.db.watchColl(id, 'expenses', (items) => { S.expenses = items; render(); }),
    S.db.watchColl(id, 'stages', (items) => { S.stages = items; render(); }),
    S.db.watchColl(id, 'posts', (items) => { S.posts = items; render(); }),
    S.db.watchColl(id, 'gpx', (items) => { S.gpx = items; render(); }),
    S.db.watchColl(id, 'presence', (items) => { S.presence = items; markPresence(); render(); }),
  ];
}

// Segna che questo partecipante ha aperto l'app (una volta per apertura).
const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
function markPresence() {
  const m = me();
  if (S.presenceDone || !m || !S.tripId) return;
  S.presenceDone = true;
  const mine = S.presence.find((x) => x.id === m) || {};
  S.db.mergeItem(S.tripId, 'presence', m, {
    joinedAt: mine.joinedAt || Date.now(), lastSeen: Date.now(),
    installed: !!(mine.installed || isInstalled()), version: window.APP_VERSION || '',
  });
}
function seenLabel(ms) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  const hm = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `oggi alle ${hm}`;
  if (diff === 1) return `ieri alle ${hm}`;
  return `${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} alle ${hm}`;
}
function presenceLine(memberId) {
  const p = S.presence.find((x) => x.id === memberId);
  if (!p || !p.joinedAt) return '<div class="small muted pres">⏳ non ancora entrato</div>';
  const joined = new Date(p.joinedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const old = p.version && window.APP_VERSION && p.version < window.APP_VERSION ? ' · ⚠️ versione vecchia' : '';
  return `<div class="small muted pres">✅ entrato il ${joined}${p.installed ? ' · 📱 app installata' : ''} · visto ${seenLabel(p.lastSeen)}${old}</div>`;
}

// ---------- rendering ----------
function render() {
  const app = $('#app');
  if (S.view === 'home') app.innerHTML = viewHome();
  else if (S.view === 'create') app.innerHTML = viewCreate();
  else if (S.view === 'join') app.innerHTML = viewJoin();
  else if (S.view === 'trip') app.innerHTML = S.trip ? viewTrip() : '<div class="center muted">Apro il viaggio…</div>';
  // Se un modulo è aperto non lo ridisegniamo: chi sta scrivendo non perde il cursore.
  if (!S.modal || !$('#modal')) renderModal();
  renderSync();
}

function renderSync() {
  const el = $('#sync');
  if (!el) return;
  if (!S.online) el.innerHTML = `<span class="dot off"></span>Offline${S.pending ? ` · ${S.pending} da inviare` : ''}`;
  else if (S.pending) el.innerHTML = `<span class="dot wait"></span>Invio ${S.pending}…`;
  else el.innerHTML = '<span class="dot ok"></span>Sincronizzato';
}

function viewHome() {
  const list = local.trips.map((t) => `
    <button class="card row" data-a="open" data-id="${t.id}">
      <div><div class="title">${esc(t.name)}</div><div class="muted small">Tu sei: ${esc(t.meName || '')}${(() => { const c = countdown(t.startDate); return c && /giorn/.test(c.unit) && !/viaggio/.test(c.unit) ? ` · 🏁 tra ${c.big} ${c.big === '1' ? 'giorno' : 'giorni'}` : ''; })()}</div></div>
      <span class="chev">›</span>
    </button>`).join('');
  return `
    <header class="top"><h1>Viaggi in Moto</h1></header>
    <main class="pad">
      ${list ? `<h2>I tuoi viaggi</h2>${list}` : '<p class="muted">Nessun viaggio ancora. Creane uno o entra con il codice che ti hanno mandato.</p>'}
      <div class="stack">
        <button class="btn" data-a="go-create">＋ Crea un viaggio</button>
        <button class="btn ghost" data-a="go-join">Entra con un codice</button>
        <label class="btn ghost">♻️ Ripristina da un backup<input type="file" id="restoreFile" hidden></label>
      </div>
      ${S.msg ? `<p class="err">${esc(S.msg)}</p>` : ''}
    </main>`;
}

function viewCreate() {
  const f = S.form || (S.form = { name: '', people: ['', '', ''], meIdx: 0, rate: '10,8' });
  return `
    <header class="top"><button class="back" data-a="home">‹</button><h1>Nuovo viaggio</h1></header>
    <main class="pad">
      <label>Nome del viaggio<input data-f="name" value="${esc(f.name)}" placeholder="Marocco 2027"></label>
      <h2>Partecipanti</h2>
      ${f.people.map((p, i) => `
        <div class="row gap">
          <input data-f="people.${i}" value="${esc(p)}" placeholder="Nome ${i + 1}">
          <button class="pill ${f.meIdx === i ? 'on' : ''}" data-a="create-me" data-i="${i}">${f.meIdx === i ? '✓ Sono io' : 'Sono io'}</button>
        </div>`).join('')}
      <button class="link" data-a="create-add">＋ aggiungi partecipante</button>
      <label>Cambio: dirham per 1 euro<input data-f="rate" inputmode="decimal" value="${esc(f.rate)}"></label>
      <p class="muted small">Puoi cambiare tutto anche dopo, dalla scheda Viaggio.</p>
      ${S.msg ? `<p class="err">${esc(S.msg)}</p>` : ''}
      <button class="btn" data-a="create-save">Crea viaggio</button>
    </main>`;
}

function viewJoin() {
  const t = S.joinTrip;
  return `
    <header class="top"><button class="back" data-a="home">‹</button><h1>Entra in un viaggio</h1></header>
    <main class="pad">
      ${t ? `
        <h2>${esc(t.name)}</h2>
        <p>Chi sei?</p>
        <div class="stack">${(t.members || []).map((m) => `<button class="btn ghost" data-a="join-as" data-id="${m.id}">${esc(m.name)}</button>`).join('')}</div>
      ` : `
        <label>Codice del viaggio<input data-f="joinCode" value="${esc(S.joinCode)}" placeholder="incolla il codice o il link"></label>
        ${S.msg ? `<p class="err">${esc(S.msg)}</p>` : ''}
        <button class="btn" data-a="join-find">Cerca viaggio</button>
      `}
    </main>`;
}

function viewTrip() {
  if (S.trip.deleted) {
    return `<header class="top"><button class="back" data-a="home">‹</button><h1>${esc(S.trip.name)}</h1></header>
      <main class="pad center"><p><b>Questo viaggio è stato eliminato.</b></p>
      <p class="muted">Chi l'ha creato può ripristinarlo da un backup.</p>
      <button class="btn" data-a="forget">Togli dalla mia lista</button></main>`;
  }
  const tabs = [['spese', '💶', 'Spese'], ['saldi', '⚖️', 'Saldi'], ['tappe', '🏍️', 'Tappe'], ['bacheca', '📌', 'Bacheca'], ['viaggio', '⚙️', 'Viaggio']];
  const body = { spese: tabSpese, saldi: tabSaldi, tappe: tabTappe, bacheca: tabBacheca, viaggio: tabViaggio }[S.tab]();
  return `
    <header class="top">
      <button class="back" data-a="home" aria-label="Tutti i viaggi">‹</button>
      <div class="grow"><h1>${esc(S.trip.name)}</h1><div id="sync" class="sync"></div></div>
    </header>
    <main class="pad with-nav">${body}</main>
    <nav class="nav">${tabs.map(([k, i, l]) => `<button class="${S.tab === k ? 'on' : ''}" data-a="tab" data-tab="${k}"><span>${i}</span>${l}</button>`).join('')}</nav>`;
}

// ---------- scheda Spese ----------
const sortExp = (a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0);

function effectChips(eff) {
  return Object.entries(eff.net).filter(([, v]) => v)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => `<span class="chip ${v > 0 ? 'pos' : 'neg'}">${esc(nameOf(id))} ${fmtSigned(v)}</span>`).join('');
}

function tabSpese() {
  const exps = [...S.expenses].sort(sortExp);
  const tot = exps.filter((e) => e.kind !== 'rimborso').reduce((s, e) => s + toEur(e.total, e.currency, rate()), 0);
  let lastDay = null;
  const list = exps.map((e) => {
    const eff = expenseEffect(e, rate());
    const head = e.date !== lastDay ? `<div class="day">${dayLabel(e.date)}</div>` : '';
    lastDay = e.date;
    if (e.kind === 'rimborso') {
      return `${head}<button class="card" data-a="edit-exp" data-id="${e.id}">
        <div class="row"><div class="title">↔️ Rimborso</div><div class="amt">${fmt(e.total, e.currency)}</div></div>
        <div class="muted small">${esc(nameOf(e.payer))} ha dato a ${esc(nameOf(e.lines?.[0]?.users?.[0]))}${e._pending ? ' · ⏳' : ''}</div>
      </button>`;
    }
    const [, icon] = catOf(e.category);
    const personal = Object.keys(eff.net).every((k) => !eff.net[k]);
    return `${head}<button class="card" data-a="edit-exp" data-id="${e.id}">
      <div class="row"><div class="title">${icon} ${esc(e.description || catOf(e.category)[2])}</div>
        <div class="amt">${fmt(e.total, e.currency)}${e.currency === 'MAD' ? `<div class="muted small">${fmt(eff.totalEur)}</div>` : ''}</div></div>
      <div class="muted small">Pagato da ${esc(nameOf(e.payer))}${personal ? ' · spesa personale' : ''}${(e.lines || []).length > 1 ? ` · ${e.lines.length} righe` : ''}${e._pending ? ' · ⏳ da inviare' : ''}</div>
      ${personal ? '' : `<div class="chips">${effectChips(eff)}</div>`}
    </button>`;
  }).join('');
  return `
    ${countdownHtml(S.trip)}
    <div class="summary"><div><div class="muted small">Speso in totale</div><div class="big">${fmt(tot)}</div></div>
      <div class="right"><div class="muted small">Tu sei</div><div class="title">${esc(myName())}</div></div></div>
    <div class="row gap"><button class="btn" data-a="new-exp">＋ Spesa</button><button class="btn ghost" data-a="new-transfer">↔️ Rimborso</button></div>
    ${list || '<p class="muted center">Nessuna spesa ancora.</p>'}`;
}

// ---------- scheda Saldi ----------
function tabSaldi() {
  const bal = balances(S.expenses, members(), rate());
  const moves = settle(bal);
  const cards = members().map((m) => {
    const b = bal[m.id] || { paid: 0, used: 0, net: 0 };
    const cls = b.net > 0 ? 'pos' : b.net < 0 ? 'neg' : '';
    const label = b.net > 0 ? 'deve ricevere' : b.net < 0 ? 'deve dare' : 'in pari';
    return `<div class="card">
      <div class="row"><div class="title">${esc(m.name)}${m.id === me() ? ' (tu)' : ''}</div><div class="amt ${cls}">${b.net ? fmt(Math.abs(b.net)) : '—'}<div class="small">${label}</div></div></div>
      <div class="muted small">Ha pagato ${fmt(b.paid)} · Ha consumato ${fmt(b.used)}</div>
    </div>`;
  }).join('');
  const mv = moves.map((x, i) => `<div class="card row">
      <div><b>${esc(nameOf(x.from))}</b> dà <b>${fmt(x.amount)}</b> a <b>${esc(nameOf(x.to))}</b></div>
      <button class="pill" data-a="settle" data-i="${i}">Fatto</button></div>`).join('');
  const byCat = {};
  S.expenses.filter((e) => e.kind !== 'rimborso').forEach((e) => { byCat[e.category || 'altro'] = (byCat[e.category || 'altro'] || 0) + toEur(e.total, e.currency, rate()); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="row line"><span>${catOf(k)[1]} ${catOf(k)[2]}</span><span>${fmt(v)}</span></div>`).join('');
  return `
    <h2>Situazione di ognuno</h2>${cards}
    <h2>Per pareggiare</h2>
    ${mv || '<p class="muted">Siete in pari 👍</p>'}
    ${mv ? '<p class="muted small">Quando qualcuno paga davvero, tocca "Fatto": viene registrato come rimborso.</p>' : ''}
    ${cats ? `<h2>Per categoria</h2><div class="card">${cats}</div>` : ''}`;
}

// ---------- scheda Tappe ----------
function tabTappe() {
  const st = [...S.stages].sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.depTime || '').localeCompare(b.depTime || ''));
  const done = st.filter((s) => s.status !== 'prevista');
  const km = done.reduce((s, x) => s + stageKm(x), 0);
  const days = new Set(done.map((s) => s.date).filter(Boolean)).size;
  const kmPlan = st.filter((s) => s.status === 'prevista').reduce((s, x) => s + stageKm(x), 0);
  const list = st.map((s) => {
    const k = stageKm(s);
    const dur = duration(s.depTime, s.arrTime);
    const sleep = SLEEP.find((x) => x[0] === s.sleep);
    return `<div class="card ${s.status === 'prevista' ? 'planned' : ''}">
      <button class="plain" data-a="edit-stage" data-id="${s.id}">
        <div class="row"><div class="title">${esc(s.from || '?')} → ${esc(s.to || '?')}</div><div class="amt">${k ? `${k} km` : ''}</div></div>
        <div class="muted small">${s.status === 'prevista' ? '📝 Prevista · ' : ''}${dayLabel(s.date)}${s.depTime ? ` · ${s.depTime}` : ''}${s.arrTime ? `–${s.arrTime}` : ''}${dur ? ` (${dur})` : ''}${s.sleep ? ` · ${sleep ? sleep[1] : ''}` : ''}${s._pending ? ' · ⏳' : ''}</div>
        ${s.notes ? `<div class="small">${esc(s.notes)}</div>` : ''}
      </button>
      ${s.from && s.to ? `<button class="pill maps" data-a="maps" data-id="${s.id}">🗺️ Apri in Google Maps</button>` : ''}
    </div>`;
  }).join('');
  return `
    <div class="summary three">
      <div><div class="muted small">Km fatti</div><div class="big">${km.toLocaleString('it-IT')}</div></div>
      <div><div class="muted small">Giorni</div><div class="big">${days}</div></div>
      <div><div class="muted small">Media/giorno</div><div class="big">${days ? Math.round(km / days) : 0}</div></div>
    </div>
    ${kmPlan ? `<p class="muted small">Tappe previste ancora da fare: ${kmPlan.toLocaleString('it-IT')} km</p>` : ''}
    <div class="row gap"><button class="btn" data-a="new-stage">＋ Tappa</button><button class="btn ghost" data-a="new-stage" data-plan="1">📝 Tappa prevista</button></div>
    ${list || '<p class="muted center">Nessuna tappa ancora.</p>'}
    ${gpxSection()}`;
}

// ---------- file GPX ----------
function gpxSection() {
  const items = [...S.gpx].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return `
    <h2>File GPX</h2>
    <label class="btn ghost">📁 Carica un file GPX<input type="file" id="gpxFile" hidden></label>
    ${S.msg && S.tab === 'tappe' ? `<p class="err">${esc(S.msg)}</p>` : ''}
    ${items.map((g) => `<div class="card">
      <div class="row"><div class="title">🗺️ ${esc(g.name)}</div><div class="amt">${g.km ? `${g.km} km` : ''}</div></div>
      <div class="muted small">${g.points || 0} punti${g.wpts ? ` · ${g.wpts} ${g.wpts === 1 ? 'sosta' : 'soste'}` : ''}${g.simplified ? ' · alleggerito' : ''} · caricato da ${esc(g.uploadedBy || '?')}${g._pending ? ' · ⏳' : ''}</div>
      <div class="row gap"><button class="pill" data-a="gpx-dl" data-id="${g.id}">⬇️ Scarica / apri</button><button class="pill" data-a="gpx-del" data-id="${g.id}">Elimina</button></div>
    </div>`).join('')}
    ${items.length ? '<p class="muted small">"Scarica / apri" ti fa scegliere l\'app: OsmAnd, un navigatore da moto o Salva sul telefono.</p>' : '<p class="muted small">Carica le tracce delle tappe: tutti le avranno sul telefono, anche senza rete.</p>'}`;
}

const hav = (a, b) => {
  const R = 6371, r = (x) => (x * Math.PI) / 180;
  const dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

async function uploadGpx(file) {
  S.msg = '';
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (!/<gpx[\s>]/i.test(text) || doc.querySelector('parsererror')) { S.msg = 'Questo file non sembra un GPX.'; render(); return; }
  const pts = [...doc.querySelectorAll('trkpt, rtept')].map((n) => [parseFloat(n.getAttribute('lat')), parseFloat(n.getAttribute('lon'))]).filter((p) => p.every(Number.isFinite));
  const wpts = doc.querySelectorAll('wpt').length;
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += hav(pts[i - 1], pts[i]);
  let out = text, simplified = false;
  const LIMIT = 900000; // un documento Firestore regge circa 1 MB
  if (text.length > LIMIT) {
    simplified = true;
    const wptXml = [...doc.querySelectorAll('wpt')].map((n) => new XMLSerializer().serializeToString(n)).join('\n');
    let step = 1, body = '';
    do {
      step += 1;
      const keep = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
      body = keep.map((p) => `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"/>`).join('');
      out = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Viaggi in Moto" xmlns="http://www.topografix.com/GPX/1/1">${wptXml}<trk><name>${esc(file.name)}</name><trkseg>${body}</trkseg></trk></gpx>`;
    } while (out.length > LIMIT && step < 200);
    if (out.length > LIMIT) { S.msg = 'File troppo grande anche alleggerito: dividilo in più tappe.'; render(); return; }
  }
  S.db.saveItem(S.tripId, 'gpx', {
    id: rid(16), name: file.name.replace(/\.gpx$/i, ''), text: out, km: Math.round(km), points: pts.length, wpts, simplified,
    uploadedBy: myName(), createdAt: Date.now(),
  });
  render();
}

// ---------- scheda Bacheca ----------
const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
const when = (ms) => new Date(ms).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function tabBacheca() {
  const posts = [...S.posts].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return `
    <div class="card">
      <textarea data-p="1" rows="3" placeholder="Scrivi un aggiornamento: traghetto prenotato, campeggio confermato, link utili…">${esc(S.postDraft)}</textarea>
      <button class="btn" data-a="post-send">Pubblica</button>
    </div>
    ${posts.map((p) => `<div class="card">
      <div class="row"><b>${esc(p.author)}</b><span class="muted small">${when(p.createdAt)}${p._pending ? ' · ⏳' : ''}</span></div>
      <div class="post">${linkify(p.text)}</div>
      ${p.author === myName() ? `<button class="link small" data-a="post-del" data-id="${p.id}">Elimina</button>` : ''}
    </div>`).join('') || '<p class="muted center">Ancora nessun aggiornamento.</p>'}`;
}

// ---------- scheda Viaggio ----------
function tabViaggio() {
  const link = `${location.origin}${location.pathname}?t=${S.tripId}`;
  return `
    <h2>Invita gli altri</h2>
    <div class="card">
      <p class="small">Manda questo link a chi viaggia con te. Si apre l'app, sceglie il suo nome ed è dentro.</p>
      <div class="code">${esc(link)}</div>
      <div class="row gap"><button class="btn" data-a="share">📤 Condividi link</button><button class="btn ghost" data-a="copy">Copia</button></div>
    </div>
    <h2>Impostazioni</h2>
    <div class="card">
      <label>Nome del viaggio<input data-t="name" value="${esc(S.trip.name)}"></label>
      <label>Cambio: dirham per 1 euro<input data-t="rate" inputmode="decimal" value="${esc(String(S.trip.rate).replace('.', ','))}"></label>
      <div class="row gap">
        <label class="grow">Data di partenza<input type="date" data-t="startDate" value="${esc(S.trip.startDate || '')}"></label>
        <label class="grow">Ora<input type="time" data-t="startTime" value="${esc(S.trip.startTime || '')}"></label>
      </div>
      <p class="small muted">Con la data di partenza compare il conto alla rovescia.</p>
    </div>
    <h2>Partecipanti</h2>
    <div class="card">
      ${members().map((m) => `<div class="line"><div class="row gap"><input data-member="${m.id}" value="${esc(m.name)}">
        ${m.id === me() ? '<span class="pill on">Tu</span>' : `<button class="pill" data-a="i-am" data-id="${m.id}">Sono io</button>`}</div>
        ${presenceLine(m.id)}</div>`).join('')}
      <button class="link" data-a="add-member">＋ aggiungi partecipante</button>
    </div>
    <h2>Dati</h2>
    <div class="card stack">
      <button class="btn ghost" data-a="export-json">💾 Esporta backup completo</button>
      <button class="btn ghost" data-a="export-csv">📊 Esporta spese (per Excel)</button>
    </div>
    <h2>Lista viaggi</h2>
    <div class="card stack">
      <p class="small muted">Nasconde il viaggio solo da questo telefono. Per gli altri resta com'è e puoi rientrare con il link.</p>
      <button class="btn ghost" data-a="forget">Togli dalla mia lista</button>
      ${isOwner() ? '<button class="btn danger" data-a="ask-del-trip">🗑️ Elimina viaggio per tutti</button><p class="small muted">Questo pulsante lo vedi solo tu, che hai creato il viaggio.</p>' : ''}
    </div>
    <p class="muted small center">Versione ${window.APP_VERSION || ''}</p>`;
}

// ---------- modali (form) ----------
function renderModal() {
  let el = $('#modal');
  if (!S.modal) { if (el) el.remove(); document.body.classList.remove('lock'); return; }
  if (!el) { el = document.createElement('div'); el.id = 'modal'; document.body.appendChild(el); }
  document.body.classList.add('lock');
  el.innerHTML = { expense: modalExpense, transfer: modalTransfer, stage: modalStage, saved: modalSaved, deltrip: modalDelTrip }[S.modal]();
  if (S.modal === 'expense') updatePreview();
}

function memberPicker(selected, action, extra = '') {
  return `<div class="chips">${members().map((m) => `<button class="pill ${selected.includes(m.id) ? 'on' : ''}" data-a="${action}" data-id="${m.id}" ${extra}>${esc(m.name)}</button>`).join('')}</div>`;
}

function newExpenseForm() {
  return {
    id: null, kind: 'spesa', description: '', date: today(), category: 'spesa', currency: S.trip.lastCurrency || 'EUR',
    total: '', payer: me(), lines: [{ amount: 0, users: members().map((m) => m.id) }],
  };
}

function modalExpense() {
  const f = S.form;
  const extra = f.lines.slice(1);
  return `<div class="sheet">
    <header class="top"><button class="back" data-a="close">✕</button><h1>${f.id ? 'Modifica spesa' : 'Nuova spesa'}</h1>
      <button class="save" data-a="save-exp">Salva</button></header>
    <main class="pad">
      <div class="row gap">
        <label class="grow">Totale scontrino<input data-e="total" inputmode="decimal" value="${esc(f.total)}" placeholder="0,00"></label>
        <div class="seg">${['EUR', 'MAD'].map((c) => `<button class="${f.currency === c ? 'on' : ''}" data-a="cur" data-c="${c}">${c === 'EUR' ? '€' : 'DH'}</button>`).join('')}</div>
      </div>
      <label>Descrizione<input data-e="description" value="${esc(f.description)}" placeholder="es. Supermercato"></label>
      <div class="row gap">
        <label class="grow">Data<input type="date" data-e="date" value="${esc(f.date)}"></label>
        <label class="grow">Categoria<select data-e="category">${CATEGORIES.map(([k, i, l]) => `<option value="${k}" ${f.category === k ? 'selected' : ''}>${i} ${l}</option>`).join('')}</select></label>
      </div>
      <div class="lbl">Pagato da</div>
      ${memberPicker([f.payer], 'payer')}

      <div class="lbl">Divisione</div>
      <div class="card line-card">
        <div class="row"><b>${extra.length ? 'Il resto' : 'Tutto lo scontrino'}</b><span id="resto" class="amt"></span></div>
        <div class="muted small">Chi ne usufruisce:</div>
        ${memberPicker(f.lines[0].users, 'line-user', 'data-l="0"')}
      </div>
      ${extra.map((l, k) => `<div class="card line-card">
        <div class="row gap"><label class="grow">Importo a parte<input data-line="${k + 1}" inputmode="decimal" value="${esc(l.amountStr ?? centsToInput(l.amount))}" placeholder="es. 20,00 di birre"></label>
          <button class="pill" data-a="line-del" data-l="${k + 1}">Togli</button></div>
        <div class="muted small">Solo per:</div>
        ${memberPicker(l.users, 'line-user', `data-l="${k + 1}"`)}
      </div>`).join('')}
      <button class="link" data-a="line-add">＋ Aggiungi una parte da dividere diversamente (es. birre)</button>
      <div id="preview" class="card preview"></div>
      <p id="experr" class="err"></p>
      ${f.id ? '<button class="btn danger" data-a="del-exp">Elimina spesa</button>' : ''}
      ${f.createdBy ? `<p class="muted small center">Inserita da ${esc(f.createdBy)}${f.updatedBy && f.updatedBy !== f.createdBy ? ` · modificata da ${esc(f.updatedBy)}` : ''}</p>` : ''}
    </main></div>`;
}

// Calcola le righe definitive (la prima riga prende il resto).
function resolveLines(f) {
  const total = toCents(f.total);
  const extra = f.lines.slice(1).map((l) => ({ amount: toCents(l.amountStr ?? centsToInput(l.amount)), users: l.users }));
  const rest = total - extra.reduce((s, l) => s + l.amount, 0);
  return { total, rest, lines: [{ amount: rest, users: f.lines[0].users }, ...extra] };
}

function validateExpense(f) {
  const { total, rest, lines } = resolveLines(f);
  if (!total) return 'Scrivi il totale.';
  if (!f.payer) return 'Scegli chi ha pagato.';
  if (rest < 0) return 'Le parti a parte superano il totale.';
  if (lines.some((l) => l.amount > 0 && !l.users.length)) return 'Ogni parte deve avere almeno una persona.';
  if (lines.slice(1).some((l) => !l.amount)) return 'Scrivi l\'importo di ogni parte (o toglila).';
  return '';
}

function updatePreview() {
  const f = S.form;
  if (!f || S.modal !== 'expense') return;
  const { rest, lines, total } = resolveLines(f);
  const r = $('#resto'); if (r) r.textContent = fmt(rest, f.currency);
  const p = $('#preview'); if (!p) return;
  if (!total) { p.innerHTML = '<span class="muted small">Scrivi il totale per vedere la divisione.</span>'; return; }
  const eff = expenseEffect({ total, currency: f.currency, payer: f.payer, lines }, rate());
  const rows = members().map((m) => {
    const u = eff.used[m.id] || 0, n = eff.net[m.id] || 0;
    return `<div class="row line"><span>${esc(m.name)}</span><span class="muted small">consuma ${fmt(u)}</span><span class="${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}">${n ? fmtSigned(n) : '—'}</span></div>`;
  }).join('');
  p.innerHTML = `<div class="small muted">Con questa spesa${f.currency === 'MAD' ? ` (${fmt(eff.totalEur)})` : ''}:</div>${rows}`;
  const err = $('#experr'); if (err) err.textContent = rest < 0 ? 'Le parti a parte superano il totale.' : '';
}

function modalTransfer() {
  const f = S.form;
  return `<div class="sheet">
    <header class="top"><button class="back" data-a="close">✕</button><h1>Rimborso</h1><button class="save" data-a="save-transfer">Salva</button></header>
    <main class="pad">
      <p class="muted small">Quando qualcuno restituisce soldi a un altro.</p>
      <div class="lbl">Chi dà i soldi</div>${memberPicker([f.payer], 'payer')}
      <div class="lbl">A chi</div>${memberPicker([f.to], 'to')}
      <div class="row gap">
        <label class="grow">Importo<input data-e="total" inputmode="decimal" value="${esc(f.total)}" placeholder="0,00"></label>
        <div class="seg">${['EUR', 'MAD'].map((c) => `<button class="${f.currency === c ? 'on' : ''}" data-a="cur" data-c="${c}">${c === 'EUR' ? '€' : 'DH'}</button>`).join('')}</div>
      </div>
      <label>Data<input type="date" data-e="date" value="${esc(f.date)}"></label>
      <p id="experr" class="err"></p>
      ${f.id ? '<button class="btn danger" data-a="del-exp">Elimina rimborso</button>' : ''}
    </main></div>`;
}

function modalStage() {
  const f = S.form;
  const inp = (k, label, attrs = '') => `<label class="grow">${label}<input data-s="${k}" value="${esc(f[k] ?? '')}" ${attrs}></label>`;
  return `<div class="sheet">
    <header class="top"><button class="back" data-a="close">✕</button><h1>${f.id ? 'Modifica tappa' : 'Nuova tappa'}</h1><button class="save" data-a="save-stage">Salva</button></header>
    <main class="pad">
      <div class="seg wide">${[['fatta', '✅ Fatta'], ['prevista', '📝 Prevista']].map(([k, l]) => `<button class="${f.status === k ? 'on' : ''}" data-a="stage-status" data-v="${k}">${l}</button>`).join('')}</div>
      ${inp('date', 'Data', 'type="date"')}
      <div class="row gap">${inp('from', 'Partenza', 'placeholder="es. Fès"')}${inp('to', 'Arrivo', 'placeholder="es. Merzouga"')}</div>
      ${inp('via', 'Passando da (facoltativo)', 'placeholder="es. Midelt; Er-Rich"')}
      <div class="row gap">${inp('depTime', 'Ora partenza', 'type="time"')}${inp('arrTime', 'Ora arrivo', 'type="time"')}</div>
      <div class="row gap">${inp('odoStart', 'Contakm inizio', 'inputmode="numeric"')}${inp('odoEnd', 'Contakm fine', 'inputmode="numeric"')}</div>
      ${inp('km', 'Oppure km fatti', 'inputmode="numeric"')}
      <label>Dove si dorme<select data-s="sleep">${SLEEP.map(([k, l]) => `<option value="${k}" ${f.sleep === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Note<textarea data-s="notes" rows="3">${esc(f.notes || '')}</textarea></label>
      ${f.id ? '<button class="btn danger" data-a="del-stage">Elimina tappa</button>' : ''}
    </main></div>`;
}

function modalDelTrip() {
  return `<div class="sheet small-sheet"><main class="pad">
    <h2>🗑️ Eliminare "${esc(S.trip.name)}"?</h2>
    <p>Spariscono <b>per tutti e tre</b> spese, tappe, bacheca e file GPX. Si può recuperare solo da un backup.</p>
    <button class="btn ghost" data-a="export-json">💾 Prima salva il backup</button>
    <label>Per confermare scrivi il nome del viaggio<input data-e="confirm" placeholder="${esc(S.trip.name)}" autocomplete="off"></label>
    <p id="experr" class="err"></p>
    <button class="btn danger" data-a="del-trip">Elimina definitivamente</button>
    <button class="btn ghost" data-a="close">Annulla</button>
  </main></div>`;
}

function modalSaved() {
  const { exp } = S.form;
  const eff = expenseEffect(exp, rate());
  const bal = balances(S.expenses.filter((e) => e.id !== exp.id).concat(exp), members(), rate());
  const rows = members().map((m) => {
    const n = eff.net[m.id] || 0, b = bal[m.id]?.net || 0;
    return `<div class="row line"><span>${esc(m.name)}</span>
      <span class="${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}">${n ? fmtSigned(n) : '—'}</span>
      <span class="${b > 0 ? 'pos' : b < 0 ? 'neg' : ''}"><b>${b ? fmtSigned(b) : '0'}</b></span></div>`;
  }).join('');
  return `<div class="sheet small-sheet">
    <main class="pad">
      <h2>✅ ${exp.kind === 'rimborso' ? 'Rimborso salvato' : 'Spesa salvata'}</h2>
      <div class="card">
        <div class="row line muted small"><span></span><span>Questa spesa</span><span>Saldo del viaggio</span></div>
        ${rows}
      </div>
      <p class="muted small">+ deve ricevere · − deve dare</p>
      <button class="btn" data-a="close">OK</button>
    </main></div>`;
}

// ---------- eventi ----------
function onInput(ev) {
  const t = ev.target;
  if (t.type === 'file') {
    if (ev.type !== 'change' || !t.files?.[0]) return;
    const file = t.files[0]; t.value = '';
    if (t.id === 'restoreFile') restoreBackup(file);
    if (t.id === 'gpxFile') uploadGpx(file);
    return;
  }
  if (t.dataset.p !== undefined) { S.postDraft = t.value; return; }
  if (t.dataset.f !== undefined) {
    const k = t.dataset.f;
    if (k === 'joinCode') { S.joinCode = t.value; return; }
    if (k.startsWith('people.')) S.form.people[+k.split('.')[1]] = t.value;
    else S.form[k] = t.value;
  } else if (t.dataset.e !== undefined) {
    S.form[t.dataset.e] = t.value; updatePreview();
  } else if (t.dataset.line !== undefined) {
    S.form.lines[+t.dataset.line].amountStr = t.value; updatePreview();
  } else if (t.dataset.s !== undefined) {
    S.form[t.dataset.s] = t.value;
  } else if (t.dataset.t !== undefined && ev.type === 'change') {
    const k = t.dataset.t;
    if (k === 'startDate' || k === 'startTime') { S.db.updateTrip(S.tripId, { [k]: t.value }); return; }
    const v = k === 'rate' ? parseFloat(t.value.replace(',', '.')) || rate() : t.value.trim();
    if (v) S.db.updateTrip(S.tripId, { [k]: v });
  } else if (t.dataset.member !== undefined && ev.type === 'change') {
    const ms = members().map((m) => (m.id === t.dataset.member ? { ...m, name: t.value.trim() || m.name } : m));
    S.db.updateTrip(S.tripId, { members: ms });
  }
}

async function onClick(ev) {
  const b = ev.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a, id = b.dataset.id;
  const f = S.form;
  switch (a) {
    case 'reload': location.reload(); break;
    case 'home': S.view = 'home'; S.form = null; S.msg = ''; S.unsub.forEach((x) => x()); S.unsub = []; local.current = null; saveLocal(); render(); break;
    case 'open': openTrip(id); render(); break;
    case 'go-create': S.view = 'create'; S.form = null; S.msg = ''; render(); break;
    case 'go-join': S.view = 'join'; S.joinTrip = null; S.joinCode = ''; S.msg = ''; render(); break;
    case 'create-me': f.meIdx = +b.dataset.i; render(); break;
    case 'create-add': f.people.push(''); render(); break;
    case 'create-save': {
      const people = f.people.map((p) => p.trim());
      if (!f.name.trim()) { S.msg = 'Dai un nome al viaggio.'; render(); return; }
      if (!people[f.meIdx]) { S.msg = 'Scrivi il tuo nome (la riga con "Sono io").'; render(); return; }
      const ms = []; let meId = null;
      people.forEach((p, i) => { if (p) { const m = { id: rid(6), name: p }; ms.push(m); if (i === f.meIdx) meId = m.id; } });
      const tid = rid(20);
      await S.db.createTrip(tid, { name: f.name.trim(), members: ms, ownerId: meId, rate: parseFloat(String(f.rate).replace(',', '.')) || 10.8, createdAt: Date.now() });
      local.trips.push({ id: tid, name: f.name.trim(), me: meId, meName: people[f.meIdx] }); saveLocal();
      S.form = null; S.tab = 'viaggio'; openTrip(tid); render(); break;
    }
    case 'join-find': lookupTrip(); break;
    case 'join-as': {
      const t = S.joinTrip;
      const m = t.members.find((x) => x.id === id);
      local.trips = local.trips.filter((x) => x.id !== S.joinCode);
      local.trips.push({ id: S.joinCode, name: t.name, me: id, meName: m.name }); saveLocal();
      S.joinTrip = null; S.tab = 'spese'; openTrip(S.joinCode); render(); break;
    }
    case 'tab': S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); break;
    case 'close': S.modal = null; S.form = null; renderModal(); break;

    // spese
    case 'new-exp': S.form = newExpenseForm(); S.modal = 'expense'; renderModal(); break;
    case 'new-transfer': {
      const mv = settle(balances(S.expenses, members(), rate())).find((x) => x.from === me());
      S.form = { kind: 'rimborso', date: today(), currency: 'EUR', payer: me(), to: mv?.to || null, total: mv ? centsToInput(mv.amount) : '' };
      S.modal = 'transfer'; renderModal(); break;
    }
    case 'edit-exp': {
      const e = S.expenses.find((x) => x.id === id);
      if (e.kind === 'rimborso') {
        S.form = { ...e, to: e.lines?.[0]?.users?.[0], total: centsToInput(e.total) }; S.modal = 'transfer';
      } else {
        S.form = { ...e, total: centsToInput(e.total), lines: e.lines.map((l) => ({ ...l, users: [...l.users] })) }; S.modal = 'expense';
      }
      renderModal(); break;
    }
    case 'cur': f.currency = b.dataset.c; renderModal(); break;
    case 'payer': f.payer = id; renderModal(); break;
    case 'to': f.to = id; renderModal(); break;
    case 'line-user': {
      const l = f.lines[+b.dataset.l];
      l.users = l.users.includes(id) ? l.users.filter((x) => x !== id) : [...l.users, id];
      renderModal(); break;
    }
    case 'line-add': f.lines.push({ amount: 0, amountStr: '', users: [] }); renderModal(); break;
    case 'line-del': f.lines.splice(+b.dataset.l, 1); renderModal(); break;
    case 'save-exp': {
      const err = validateExpense(f);
      if (err) { $('#experr').textContent = err; return; }
      const { total, lines } = resolveLines(f);
      const exp = {
        id: f.id || rid(16), kind: 'spesa', description: f.description.trim(), date: f.date, category: f.category,
        currency: f.currency, total, payer: f.payer, lines: lines.filter((l) => l.amount > 0).map((l) => ({ amount: l.amount, users: l.users })),
        createdAt: f.createdAt || Date.now(), createdBy: f.createdBy || myName(), updatedBy: myName(), updatedAt: Date.now(),
      };
      S.db.saveItem(S.tripId, 'expenses', exp);
      if (S.trip.lastCurrency !== f.currency) S.db.updateTrip(S.tripId, { lastCurrency: f.currency });
      S.form = { exp }; S.modal = 'saved'; renderModal(); break;
    }
    case 'save-transfer': {
      const total = toCents(f.total);
      const err = !f.payer || !f.to ? 'Scegli chi dà e chi riceve.' : f.payer === f.to ? 'Devono essere due persone diverse.' : !total ? 'Scrivi l\'importo.' : '';
      if (err) { $('#experr').textContent = err; return; }
      const exp = {
        id: f.id || rid(16), kind: 'rimborso', date: f.date, currency: f.currency, total, payer: f.payer,
        lines: [{ amount: total, users: [f.to] }], createdAt: f.createdAt || Date.now(), createdBy: f.createdBy || myName(), updatedBy: myName(), updatedAt: Date.now(),
      };
      S.db.saveItem(S.tripId, 'expenses', exp);
      S.form = { exp }; S.modal = 'saved'; renderModal(); break;
    }
    case 'del-exp':
      if (confirm('Eliminare definitivamente?')) { S.db.deleteItem(S.tripId, 'expenses', f.id); S.modal = null; S.form = null; renderModal(); }
      break;
    case 'settle': {
      const mv = settle(balances(S.expenses, members(), rate()))[+b.dataset.i];
      S.form = { kind: 'rimborso', date: today(), currency: 'EUR', payer: mv.from, to: mv.to, total: centsToInput(mv.amount) };
      S.modal = 'transfer'; renderModal(); break;
    }

    // tappe
    case 'new-stage': S.form = { status: b.dataset.plan ? 'prevista' : 'fatta', date: today(), sleep: '' }; S.modal = 'stage'; renderModal(); break;
    case 'edit-stage': S.form = { ...S.stages.find((x) => x.id === id) }; S.modal = 'stage'; renderModal(); break;
    case 'stage-status': f.status = b.dataset.v; renderModal(); break;
    case 'save-stage': {
      const s = { ...f, id: f.id || rid(16), updatedBy: myName(), updatedAt: Date.now(), createdBy: f.createdBy || myName() };
      ['km', 'odoStart', 'odoEnd'].forEach((k) => { s[k] = s[k] ? Number(String(s[k]).replace(/\D/g, '')) || '' : ''; });
      S.db.saveItem(S.tripId, 'stages', s); S.modal = null; S.form = null; renderModal(); break;
    }
    case 'del-stage':
      if (confirm('Eliminare la tappa?')) { S.db.deleteItem(S.tripId, 'stages', f.id); S.modal = null; S.form = null; renderModal(); }
      break;
    case 'maps': {
      const s = S.stages.find((x) => x.id === id);
      const u = new URL('https://www.google.com/maps/dir/');
      u.searchParams.set('api', '1'); u.searchParams.set('origin', s.from); u.searchParams.set('destination', s.to);
      const via = (s.via || '').split(/[;|]/).map((x) => x.trim()).filter(Boolean);
      if (via.length) u.searchParams.set('waypoints', via.join('|'));
      u.searchParams.set('travelmode', 'driving');
      window.open(u.toString(), '_blank'); break;
    }

    // viaggio
    case 'share': {
      const link = `${location.origin}${location.pathname}?t=${S.tripId}`;
      if (navigator.share) navigator.share({ title: S.trip.name, text: `Entra nel viaggio "${S.trip.name}":`, url: link }).catch(() => {});
      else { navigator.clipboard?.writeText(link); alert('Link copiato'); }
      break;
    }
    case 'copy': navigator.clipboard?.writeText(`${location.origin}${location.pathname}?t=${S.tripId}`).then(() => alert('Link copiato')); break;
    case 'i-am': {
      const lt = local.trips.find((x) => x.id === S.tripId);
      lt.me = id; lt.meName = nameOf(id); saveLocal(); S.presenceDone = false; markPresence(); render(); break;
    }
    case 'add-member': {
      const n = prompt('Nome del nuovo partecipante');
      if (n && n.trim()) S.db.updateTrip(S.tripId, { members: [...members(), { id: rid(6), name: n.trim() }] });
      break;
    }
    case 'export-json': exportBackup(); break;
    case 'forget':
      local.trips = local.trips.filter((x) => x.id !== S.tripId);
      S.unsub.forEach((x) => x()); S.unsub = []; local.current = null; saveLocal();
      S.view = 'home'; S.modal = null; S.form = null; render(); break;
    case 'ask-del-trip': S.form = { confirm: '' }; S.modal = 'deltrip'; renderModal(); break;
    case 'del-trip': {
      if ((f.confirm || '').trim().toLowerCase() !== S.trip.name.trim().toLowerCase()) { $('#experr').textContent = 'Il nome non corrisponde.'; return; }
      const id = S.tripId;
      [['expenses', S.expenses], ['stages', S.stages], ['posts', S.posts], ['gpx', S.gpx], ['presence', S.presence]].forEach(([c, items]) => items.forEach((x) => S.db.deleteItem(id, c, x.id)));
      S.db.updateTrip(id, { deleted: true, deletedAt: Date.now() });
      local.trips = local.trips.filter((x) => x.id !== id);
      S.unsub.forEach((x) => x()); S.unsub = []; local.current = null; saveLocal();
      S.view = 'home'; S.modal = null; S.form = null; render(); break;
    }
    case 'post-send': {
      const text = S.postDraft.trim();
      if (!text) return;
      S.db.saveItem(S.tripId, 'posts', { id: rid(16), text, author: myName(), createdAt: Date.now() });
      S.postDraft = ''; render(); break;
    }
    case 'post-del': if (confirm('Eliminare il messaggio?')) S.db.deleteItem(S.tripId, 'posts', id); break;
    case 'gpx-dl': { const g = S.gpx.find((x) => x.id === id); download(`${g.name}.gpx`, g.text, 'application/gpx+xml'); break; }
    case 'gpx-del': if (confirm('Eliminare il file GPX per tutti?')) S.db.deleteItem(S.tripId, 'gpx', id); break;
    case 'export-csv': download(`${S.trip.name}-spese.csv`, expensesCsv(), 'text/csv'); break;
    default: break;
  }
}

async function lookupTrip() {
  let code = (S.joinCode || '').trim();
  const m = code.match(/[?&]t=([A-Za-z0-9]+)/);
  if (m) code = m[1];
  S.joinCode = code; S.msg = '';
  if (code.length < 16) { S.msg = 'Codice non valido.'; render(); return; }
  try {
    const t = await S.db.getTrip(code);
    if (!t) S.msg = 'Viaggio non trovato. Controlla il codice.';
    else S.joinTrip = t;
  } catch (e) {
    S.msg = 'Non riesco a collegarmi. Serve internet per entrare la prima volta.';
  }
  render();
}

function exportBackup() {
  const data = {
    app: 'viaggi-moto', version: 1, savedAt: new Date().toISOString(), tripId: S.tripId,
    trip: S.trip, expenses: S.expenses, stages: S.stages, posts: S.posts, gpx: S.gpx,
  };
  const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === '_pending' ? undefined : v)));
  download(`${S.trip.name}-backup.json`, JSON.stringify(clean(data), null, 1), 'application/json');
}

async function restoreBackup(file) {
  S.msg = '';
  let data;
  try { data = JSON.parse(await file.text()); } catch { data = null; }
  if (!data || !data.trip || !Array.isArray(data.expenses)) { S.msg = 'Questo file non è un backup dell\'app.'; render(); return; }
  // Se il viaggio originale esiste ancora (e non è eliminato), ne facciamo una copia con un codice nuovo.
  let id = data.tripId, name = data.trip.name;
  let existing = null;
  if (id) { try { existing = await S.db.getTrip(id); } catch { existing = { unknown: true }; } }
  if (!id || (existing && !existing.deleted)) { id = rid(20); if (existing) name = `${name} (copia)`; }
  const { deleted, deletedAt, ...trip } = data.trip;
  await S.db.createTrip(id, { ...trip, name, deleted: false, restoredAt: Date.now() });
  ['expenses', 'stages', 'posts', 'gpx'].forEach((c) => (data[c] || []).forEach((x) => S.db.saveItem(id, c, x)));
  S.joinCode = id; S.joinTrip = { ...trip, name }; S.view = 'join'; render();
}

function expensesCsv() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Data', 'Tipo', 'Descrizione', 'Categoria', 'Valuta', 'Totale', 'Totale €', 'Pagato da', ...members().map((m) => `Saldo ${m.name} €`)];
  const rows = [...S.expenses].sort(sortExp).reverse().map((e) => {
    const eff = expenseEffect(e, rate());
    return [e.date, e.kind, e.description || '', catOf(e.category)[2], e.currency, (e.total / 100).toFixed(2).replace('.', ','),
      (eff.totalEur / 100).toFixed(2).replace('.', ','), nameOf(e.payer), ...members().map((m) => ((eff.net[m.id] || 0) / 100).toFixed(2).replace('.', ','))].map(q).join(';');
  });
  return `﻿${[head.map(q).join(';'), ...rows].join('\n')}`;
}

async function download(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
