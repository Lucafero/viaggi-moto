// Calcoli puri: nessuna dipendenza da Firebase o dal DOM.
// Tutti gli importi sono in centesimi (interi).

// Legge numeri scritti all'italiana: "1.250,50", "12,5", "12.5", "1.000".
export const parseNum = (v) => {
  if (typeof v === 'number') return v;
  let t = String(v ?? '').trim().replace(/\s|€|DH/gi, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return parseFloat(t);
};

export const toCents = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseNum(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export const fmt = (cents, cur = 'EUR') => {
  const v = (cents || 0) / 100;
  const s = v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur === 'MAD' ? `${s} DH` : `${s} €`;
};

export const fmtSigned = (cents) => (cents > 0 ? '+' : cents < 0 ? '−' : '') + fmt(Math.abs(cents));

// Divide un importo in n parti intere; i centesimi avanzati vanno ai primi.
export function splitEven(amount, n) {
  if (n <= 0) return [];
  const base = Math.trunc(amount / n);
  let rest = amount - base * n;
  return Array.from({ length: n }, () => {
    const extra = rest > 0 ? 1 : rest < 0 ? -1 : 0;
    rest -= extra;
    return base + extra;
  });
}

// Converte in euro (centesimi). rate = dirham per 1 euro.
export function toEur(cents, currency, rate) {
  if (currency !== 'MAD') return cents;
  const r = Number(rate) > 0 ? Number(rate) : 1;
  return Math.round(cents / r);
}

// Effetto di una spesa (o rimborso) sui saldi, in centesimi di euro.
// Ritorna { paid: {id: c}, used: {id: c}, net: {id: c} }.
export function expenseEffect(exp, rate) {
  const paid = {}, used = {}, net = {};
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  // Ogni spesa usa il cambio salvato nel momento in cui è stata inserita (se c'è).
  const totalEur = toEur(exp.total || 0, exp.currency, Number(exp.rate) > 0 ? Number(exp.rate) : rate);
  // Le righe vengono convertite in proporzione, così la somma resta uguale al totale in euro.
  const lines = (exp.lines || []).filter((l) => (l.users || []).length && l.amount);
  const sumLines = lines.reduce((s, l) => s + l.amount, 0);
  let assigned = 0;
  lines.forEach((l, i) => {
    const eur = i === lines.length - 1
      ? totalEur - assigned
      : Math.round((l.amount / (sumLines || 1)) * totalEur);
    assigned += eur;
    const parts = splitEven(eur, l.users.length);
    l.users.forEach((u, j) => add(used, u, parts[j]));
  });
  if (exp.payer) add(paid, exp.payer, totalEur);
  const ids = new Set([...Object.keys(paid), ...Object.keys(used)]);
  ids.forEach((id) => { net[id] = (paid[id] || 0) - (used[id] || 0); });
  return { paid, used, net, totalEur };
}

// Saldi complessivi del viaggio.
export function balances(expenses, members, rate) {
  const res = {};
  members.forEach((m) => { res[m.id] = { paid: 0, used: 0, net: 0, personal: 0 }; });
  expenses.forEach((e) => {
    const eff = expenseEffect(e, rate);
    const isTransfer = e.kind === 'rimborso';
    Object.keys(eff.net).forEach((id) => {
      if (!res[id]) res[id] = { paid: 0, used: 0, net: 0, personal: 0 };
      res[id].net += eff.net[id];
      if (!isTransfer) {
        res[id].paid += eff.paid[id] || 0;
        res[id].used += eff.used[id] || 0;
      }
    });
  });
  return res;
}

// Pareggio: il minor numero di passaggi di soldi (algoritmo greedy).
export function settle(bal) {
  const cred = [], deb = [];
  Object.entries(bal).forEach(([id, b]) => {
    if (b.net > 0) cred.push({ id, v: b.net });
    else if (b.net < 0) deb.push({ id, v: -b.net });
  });
  cred.sort((a, b) => b.v - a.v);
  deb.sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0, j = 0;
  while (i < deb.length && j < cred.length) {
    const v = Math.min(deb[i].v, cred[j].v);
    if (v > 0) out.push({ from: deb[i].id, to: cred[j].id, amount: v });
    deb[i].v -= v; cred[j].v -= v;
    if (deb[i].v === 0) i++;
    if (cred[j].v === 0) j++;
  }
  return out;
}

// Km di una tappa: contachilometri se presente, altrimenti il valore scritto.
export function stageKm(s) {
  const a = Number(s.odoStart), b = Number(s.odoEnd);
  if (a > 0 && b > a) return b - a;
  return Number(s.km) || 0;
}

export function duration(dep, arr) {
  if (!dep || !arr) return '';
  const [h1, m1] = dep.split(':').map(Number);
  const [h2, m2] = arr.split(':').map(Number);
  let min = h2 * 60 + m2 - (h1 * 60 + m1);
  if (min < 0) min += 24 * 60;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}
