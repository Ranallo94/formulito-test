/**
 * FORMULITO — stagione.js
 * Statistiche di stagione di un partecipante, calcolate su TUTTI i GP già
 * disputati (competizioni.js). Sola lettura: nessuna scrittura su Firestore.
 *
 * Per ogni competizione legge classifica/snapshot, risultati/ufficiali e il
 * pronostico dell'utente (db.js → getDatiCompetizione) e ne ricava:
 *   • posizione finale nel GP (medaglie 🥇🥈🥉) e punti;
 *   • percentuali di indovinamento (pole, vincitore, podio, posizioni
 *     esatte in qualifica/gara/sprint, top 10, bonus per categoria);
 *   • errore medio di posizione in gara.
 *
 * Un GP conta solo se ha un arrivo di gara reale (≥ 10 piloti): i weekend
 * senza risultati inseriti (in corso o futuri) sono ignorati. Le percentuali
 * sono calcolate solo sui GP in cui il partecipante ha un pronostico.
 */

import { getCompetizioni } from './competizioni.js';
import { getDatiCompetizione } from './db.js';
import { normalizzaOrdine, N_SPRINT } from './griglia.js';

const MIN_ARRIVO_REALE = 10;

const BONUS_CAMPI = [
  { id: 'giroVeloce',      label: '🏁 Giro più veloce' },
  { id: 'pitStopVeloce',   label: '🔧 Pit stop più veloce' },
  { id: 'gommaLunga',      label: '🛞 Gomma più duratura' },
  { id: 'primoRitirato',   label: '🚩 Primo ritirato' },
  { id: 'maggiorGuadagno', label: '📈 Maggior guadagno' },
  { id: 'safetyCar',       label: '🚨 N. Safety Car', numero: true },
];

// ── POSIZIONE IN CLASSIFICA ───────────────────────────
// Stesso ordinamento della classifica: totale, poi spareggio, poi nome.
// A pari totale e spareggio la posizione è condivisa.
export function posizioneInClassifica(classifica, uid) {
  return uid ? (posizioniClassifica(classifica).get(uid) ?? null) : null;
}

/** Mappa uid → posizione per tutta la classifica (ordine: totale, spareggio, nome). */
export function posizioniClassifica(classifica) {
  const out = new Map();
  if (!classifica?.length) return out;
  const sorted = [...classifica].sort((a, b) => {
    if (b.totale !== a.totale) return (b.totale || 0) - (a.totale || 0);
    const sa = a.spareggio || [], sb = b.spareggio || [];
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      if ((sb[i] || 0) !== (sa[i] || 0)) return (sb[i] || 0) - (sa[i] || 0);
    }
    return (a.nome || '').localeCompare(b.nome || '', 'it');
  });
  let pos = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = sorted[i - 1], cur = sorted[i];
      const same = prev.totale === cur.totale &&
        JSON.stringify(prev.spareggio) === JSON.stringify(cur.spareggio);
      if (!same) pos = i + 1;
    }
    out.set(sorted[i].id, pos);
  }
  return out;
}

// ── STATISTICHE DI UN SINGOLO GP ──────────────────────
const _pieno = (v) => v != null && v !== '';

function _esatte(pron, reale) {
  let ok = 0, tot = 0;
  pron.forEach((pid, i) => {
    if (!pid) return;
    tot++;
    if (reale[i] === pid) ok++;
  });
  return { ok, tot };
}

function _statsGp(pron, ris) {
  const quali = normalizzaOrdine(pron?.qualifica?.griglia);
  const gara = normalizzaOrdine(pron?.gara?.arrivo);
  const qualiR = normalizzaOrdine(ris?.qualifica?.griglia);
  const garaR = normalizzaOrdine(ris?.gara?.arrivo);

  const s = {};
  s.pole = qualiR[0] ? { ok: quali[0] === qualiR[0] ? 1 : 0, tot: quali[0] ? 1 : 0 } : { ok: 0, tot: 0 };
  s.vincitore = { ok: gara[0] && gara[0] === garaR[0] ? 1 : 0, tot: gara[0] ? 1 : 0 };

  const podioR = garaR.slice(0, 3);
  const podioP = gara.slice(0, 3);
  const podioCompleto = podioP.every(Boolean);
  s.podioEsatto = { ok: podioCompleto && podioP.every((p, i) => p === podioR[i]) ? 1 : 0, tot: podioCompleto ? 1 : 0 };
  s.podioPiloti = { ok: podioCompleto && podioP.every(p => podioR.includes(p)) ? 1 : 0, tot: podioCompleto ? 1 : 0 };

  s.qualiEsatte = _esatte(quali, qualiR);
  s.garaEsatte = _esatte(gara, garaR);

  const top10R = garaR.slice(0, 10);
  const top10P = gara.slice(0, 10).filter(Boolean);
  s.top10 = { ok: top10P.filter(p => top10R.includes(p)).length, tot: top10P.length };

  // errore medio: di quante posizioni sbaglio in gara, sui piloti presenti in entrambi
  const posR = {};
  garaR.forEach((p, i) => { if (p) posR[p] = i; });
  let somma = 0, n = 0;
  gara.forEach((p, i) => {
    if (p && Object.prototype.hasOwnProperty.call(posR, p)) { somma += Math.abs(i - posR[p]); n++; }
  });
  s.errore = { somma, n };

  const sprintR = ris?.sprint?.top8 ? normalizzaOrdine(ris.sprint.top8, N_SPRINT) : null;
  if (sprintR && sprintR.some(Boolean)) {
    const sprintP = normalizzaOrdine(pron?.sprint?.top8, N_SPRINT);
    s.sprintEsatte = _esatte(sprintP, sprintR);
    s.sprintVincitore = { ok: sprintP[0] && sprintP[0] === sprintR[0] ? 1 : 0, tot: sprintP[0] ? 1 : 0 };
  }

  s.bonus = {};
  BONUS_CAMPI.forEach(c => {
    const pick = pron?.gara?.bonus?.[c.id];
    const real = ris?.gara?.bonus?.[c.id];
    if (_pieno(pick) && _pieno(real)) {
      const ok = c.numero ? Number(pick) === Number(real) : pick === real;
      s.bonus[c.id] = { ok: ok ? 1 : 0, tot: 1 };
    }
  });
  return s;
}

function _somma(a, b) {
  return { ok: (a?.ok || 0) + (b?.ok || 0), tot: (a?.tot || 0) + (b?.tot || 0) };
}

// ── CARICAMENTO + AGGREGAZIONE ────────────────────────
/**
 * @param {string} uid  partecipante di cui calcolare le statistiche
 * @param {Function} [lettore]  (compId, uid) → {classifica, risultati, pronostico};
 *                              iniettabile per i test, di default legge da Firestore
 * @returns {Promise<{gp:Array, medaglie:{oro:number,argento:number,bronzo:number},
 *   totali:Object, bonus:Object, errore:(number|null), partecipati:number}>}
 */
export async function caricaStagione(uid, lettore = getDatiCompetizione) {
  const comps = getCompetizioni();
  const dati = await Promise.all(comps.map(async (c) => {
    try { return { comp: c, ...(await lettore(c.id, uid)) }; }
    catch (_) { return null; }   // una competizione illeggibile non blocca le altre
  }));

  const gp = [];
  const totali = {};
  const bonus = {};
  let erroreSomma = 0, erroreN = 0, partecipati = 0;
  const medaglie = { oro: 0, argento: 0, bronzo: 0 };
  const albo = [];                 // un elemento per GP: podio di TUTTI i partecipanti
  const vittorie = new Map();      // uid → { nome, oro, argento, bronzo } su tutti i GP

  dati.filter(Boolean).forEach(({ comp, classifica, risultati, pronostico }) => {
    const arrivo = normalizzaOrdine(risultati?.gara?.arrivo).filter(Boolean);
    if (arrivo.length < MIN_ARRIVO_REALE) return;               // GP non ancora concluso

    const posizioni = posizioniClassifica(classifica);
    const me = classifica.find(p => p.id === uid) || null;
    const pos = me ? posizioni.get(uid) : null;
    const haPron = !!pronostico && normalizzaOrdine(pronostico?.gara?.arrivo).some(Boolean);

    if (pos === 1) medaglie.oro++;
    else if (pos === 2) medaglie.argento++;
    else if (pos === 3) medaglie.bronzo++;

    // Albo d'oro: i primi tre di questo GP (pari merito inclusi) e il conteggio per persona
    const podio = classifica
      .filter(p => posizioni.get(p.id) <= 3 && (p.totale || 0) > 0)
      .map(p => ({ id: p.id, nome: p.nome || 'Partecipante', pos: posizioni.get(p.id), punti: p.totale || 0 }))
      .sort((a, b) => a.pos - b.pos || b.punti - a.punti);
    if (podio.length) {
      albo.push({ id: comp.id, nome: comp.nome, ordine: comp.ordine, podio });
      podio.forEach(p => {
        const v = vittorie.get(p.id) || { id: p.id, nome: p.nome, oro: 0, argento: 0, bronzo: 0 };
        v[['', 'oro', 'argento', 'bronzo'][p.pos]]++;
        vittorie.set(p.id, v);
      });
    }

    const s = haPron ? _statsGp(pronostico, risultati) : null;
    gp.push({
      id: comp.id, nome: comp.nome, ordine: comp.ordine,
      pos, punti: me?.totale ?? null, partecipanti: classifica.length, haPron, stats: s,
    });
    if (!haPron) return;
    partecipati++;

    ['pole', 'vincitore', 'podioEsatto', 'podioPiloti', 'qualiEsatte', 'garaEsatte', 'top10',
      'sprintEsatte', 'sprintVincitore'].forEach(k => {
      if (s[k]) totali[k] = _somma(totali[k], s[k]);
    });
    Object.entries(s.bonus).forEach(([id, v]) => { bonus[id] = _somma(bonus[id], v); });
    erroreSomma += s.errore.somma; erroreN += s.errore.n;
  });

  gp.sort((a, b) => a.ordine - b.ordine);
  albo.sort((a, b) => a.ordine - b.ordine);
  const classificaVittorie = [...vittorie.values()]
    .sort((a, b) => b.oro - a.oro || b.argento - a.argento || b.bronzo - a.bronzo
      || a.nome.localeCompare(b.nome, 'it'));

  const st = {
    gp, medaglie, totali, bonus, partecipati, albo, classificaVittorie,
    errore: erroreN ? erroreSomma / erroreN : null,
  };
  st.badge = calcolaBadge(st);
  return st;
}

// ── BADGE ─────────────────────────────────────────────
// Ogni badge ha un valore misurato e una soglia: sotto soglia resta "da sbloccare"
// con l'avanzamento. Le soglie sono tarate su un gruppo piccolo: ritoccale qui.

/** Serie più lunga di GP consecutivi in cui `cond(g)` è vera (un GP senza posizione spezza la serie). */
function _serie(gp, cond) {
  let max = 0, cur = 0;
  gp.forEach(g => { if (g.pos && cond(g)) { cur++; max = Math.max(max, cur); } else cur = 0; });
  return max;
}

function _migliorRimonta(gp) {
  let best = 0, prec = null;
  gp.forEach(g => {
    if (!g.pos) return;
    if (prec) best = Math.max(best, prec.pos - g.pos);
    prec = g;
  });
  return best;
}

export function calcolaBadge(st) {
  const { totali: t, bonus: b, medaglie: m, gp } = st;
  const ok = (v) => v?.ok || 0;
  const piuBonusInUnGp = Math.max(0, ...gp.map(g =>
    g.stats ? Object.values(g.stats.bonus).reduce((a, v) => a + v.ok, 0) : 0));
  const top10Massimo = Math.max(0, ...gp.map(g => g.stats?.top10.ok || 0));

  const def = [
    { id: 'campione',   icon: '👑', nome: 'Campione di GP',      desc: 'Vinci un Gran Premio',                       val: m.oro,                          soglia: 1 },
    { id: 'podi',       icon: '🏅', nome: 'Habitué del podio',   desc: 'Sali sul podio in 3 GP',                     val: m.oro + m.argento + m.bronzo,   soglia: 3 },
    { id: 'serie',      icon: '🔥', nome: 'Serie aperta',        desc: 'Podio in 2 GP consecutivi',                  val: _serie(gp, g => g.pos <= 3),    soglia: 2 },
    { id: 'costante',   icon: '🧱', nome: 'Il Costante',         desc: 'Top 5 in 3 GP consecutivi',                  val: _serie(gp, g => g.pos <= 5),    soglia: 3 },
    { id: 'cecchino',   icon: '🎯', nome: 'Cecchino',            desc: 'Indovina la pole in 2 GP',                   val: ok(t.pole),                     soglia: 2 },
    { id: 'profeta',    icon: '🔮', nome: 'Profeta',             desc: 'Indovina il vincitore in 2 GP',              val: ok(t.vincitore),                soglia: 2 },
    { id: 'podioEsatto',icon: '🍾', nome: 'Mago del podio',      desc: 'Podio esatto (3 su 3, in ordine) una volta', val: ok(t.podioEsatto),              soglia: 1 },
    { id: 'top10',      icon: '🔟', nome: 'Top 10 perfetta',     desc: 'Tutti e 10 i piloti a punti giusti in un GP',val: top10Massimo,                   soglia: 10 },
    { id: 'safety',     icon: '🚨', nome: 'Uomo Safety Car',     desc: 'Indovina il numero di Safety Car',           val: ok(b.safetyCar),                soglia: 1 },
    { id: 'bonus',      icon: '🎰', nome: 'Re dei bonus',        desc: '3 bonus indovinati nello stesso GP',         val: piuBonusInUnGp,                 soglia: 3 },
    { id: 'sprint',     icon: '⚡', nome: 'Sprinter',            desc: 'Indovina il vincitore di una Sprint',        val: ok(t.sprintVincitore),          soglia: 1 },
    { id: 'rimonta',    icon: '🚀', nome: 'Rimonta',             desc: 'Guadagna 3 posizioni rispetto al GP prima',  val: _migliorRimonta(gp),            soglia: 3 },
    { id: 'presenza',   icon: '🏁', nome: 'Sempre al via',       desc: 'Pronostico in tutti i GP (almeno 3)',        val: st.partecipati,                 soglia: Math.max(3, gp.length) },
  ];
  return def.map(d => ({ ...d, ottenuto: d.val >= d.soglia }));
}

// ── RENDER ────────────────────────────────────────────
const _pct = (v) => (v && v.tot ? Math.round((v.ok / v.tot) * 100) : null);

function _bar(label, v, nota) {
  const p = _pct(v);
  if (p == null) return '';
  return `
    <div class="st-bar-row">
      <div class="st-bar-head">
        <span class="st-bar-label">${label}</span>
        <span class="st-bar-val">${v.ok}/${v.tot} <b>${p}%</b></span>
      </div>
      <div class="st-bar"><span style="width:${p}%"></span></div>
      ${nota ? `<div class="st-bar-note">${nota}</div>` : ''}
    </div>`;
}

const _medaglia = (pos) => ({ 1: '🥇', 2: '🥈', 3: '🥉' }[pos] || (pos ? `${pos}°` : '—'));

function _medaglieHtml(m) {
  return `
    <span class="st-medal"><span>🥇</span><b>${m.oro}</b></span>
    <span class="st-medal"><span>🥈</span><b>${m.argento}</b></span>
    <span class="st-medal"><span>🥉</span><b>${m.bronzo}</b></span>`;
}

/**
 * Riquadro "bacheca": medaglie, badge sbloccati e pulsante verso la vista Stagione.
 * Il pulsante porta `data-vista-goto="stagione"`: il collegamento lo fa profilo.js.
 * `st` null = ancora in caricamento.
 */
export function renderBacheca(container, st) {
  if (!container) return;
  if (!st) {
    container.innerHTML = `<div class="st-bacheca"><div class="loading-state"><div class="spinner"></div><p>Caricamento bacheca…</p></div></div>`;
    return;
  }
  const guadagnati = (st.badge || []).filter(x => x.ottenuto);
  const conclusi = st.gp.length;
  const saltati = conclusi - st.partecipati;
  const corpo = conclusi ? `
      <div class="st-presenze${saltati ? '' : ' st-presenze--full'}">
        <div class="st-presenze-num"><b>${st.partecipati}</b><span>/ ${conclusi}</span></div>
        <div class="st-presenze-txt">
          <div class="st-presenze-top">GP disputati</div>
          <div class="st-presenze-sub">${saltati
            ? `${saltati} ${saltati === 1 ? 'GP concluso non giocato' : 'GP conclusi non giocati'}`
            : 'presente a tutti i GP conclusi'}</div>
        </div>
      </div>
      <div class="st-bacheca-row">
        <div class="st-medals">${_medaglieHtml(st.medaglie)}<span class="st-medals-note">in ${st.partecipati} ${st.partecipati === 1 ? 'GP giocato' : 'GP giocati'}</span></div>
      </div>
      <div class="st-bacheca-badges">
        ${guadagnati.length
          ? guadagnati.map(x => `<span class="st-chip" title="${x.desc}"><span>${x.icon}</span>${x.nome}</span>`).join('')
          : '<span class="st-muted">Nessun badge ancora: i primi arrivano coi primi GP.</span>'}
      </div>`
    : `<p class="st-muted" style="margin:0">Medaglie e badge compaiono dopo il primo Gran Premio concluso.</p>`;

  container.innerHTML = `
    <div class="st-bacheca">
      <div class="st-bacheca-head">
        <h3 class="prof-card-title" style="margin:0">🏆 Bacheca</h3>
        <span class="st-muted">${guadagnati.length}/${(st.badge || []).length} badge</span>
      </div>
      ${corpo}
      <button type="button" class="btn btn-primary st-bacheca-btn" data-vista-goto="stagione">📅 Statistiche di stagione →</button>
    </div>`;
}

function _badgeHtml(badge) {
  const n = badge.filter(b => b.ottenuto).length;
  return `
    <div class="prof-card">
      <h3 class="prof-card-title">🏆 Badge <span class="st-muted">${n}/${badge.length} sbloccati</span></h3>
      <div class="st-badges">
        ${badge.map(b => `
          <div class="st-badge${b.ottenuto ? ' st-badge--on' : ''}" title="${b.desc}">
            <div class="st-badge-ic">${b.icon}</div>
            <div class="st-badge-nome">${b.nome}</div>
            <div class="st-badge-desc">${b.ottenuto ? b.desc : `${Math.min(b.val, b.soglia)}/${b.soglia} · ${b.desc}`}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

function _escape(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function _alboHtml(st, uid) {
  if (!st.albo.length) return '';
  const righe = st.albo.map(g => {
    const per = (pos) => g.podio.filter(p => p.pos === pos)
      .map(p => `<span class="${p.id === uid ? 'st-me' : ''}">${_escape(p.nome)}</span> <span class="st-muted">${p.punti}</span>`).join(', ');
    return `<tr class="prof-bd-row">
      <td class="prof-bd-turno">${g.nome}</td>
      <td>🥇 ${per(1) || '—'}<div class="st-albo-sub">${[2, 3].map(p => per(p) ? `${_medaglia(p)} ${per(p)}` : '').filter(Boolean).join(' &nbsp; ')}</div></td>
    </tr>`;
  }).join('');

  const classifica = st.classificaVittorie.map(v => `
    <tr class="prof-bd-row${v.id === uid ? ' st-row-me' : ''}">
      <td class="prof-bd-turno">${_escape(v.nome)}</td>
      <td class="prof-bd-num">${v.oro}</td><td class="prof-bd-num">${v.argento}</td><td class="prof-bd-num">${v.bronzo}</td>
    </tr>`).join('');

  return `
    <div class="prof-card">
      <h3 class="prof-card-title">📜 Albo d'oro</h3>
      <table class="prof-bd-table st-albo">
        <thead><tr><th>Gran Premio</th><th>Podio</th></tr></thead>
        <tbody>${righe}</tbody>
      </table>
      <h4 class="prof-bonus-title" style="margin-top:18px">Chi ha vinto di più</h4>
      <table class="prof-bd-table">
        <thead><tr><th>Partecipante</th><th>🥇</th><th>🥈</th><th>🥉</th></tr></thead>
        <tbody>${classifica}</tbody>
      </table>
    </div>`;
}

/** Scheda "Stagione" completa. */
export function renderStagione(container, st, uid) {
  if (!container) return;
  if (!st || !st.gp.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🏁</div>
      <p>Nessun Gran Premio concluso per ora.</p>
      <p class="text-muted">Le statistiche compaiono appena l'admin inserisce l'arrivo di gara.</p></div>`;
    return;
  }

  const righe = st.gp.map((g, i) => {
    let trend = '';
    const prec = [...st.gp.slice(0, i)].reverse().find(x => x.pos);
    if (g.pos && prec) {
      trend = g.pos < prec.pos ? '<span class="st-up">▲</span>'
        : g.pos > prec.pos ? '<span class="st-down">▼</span>' : '<span class="st-eq">=</span>';
    }
    return `<tr class="prof-bd-row">
      <td class="prof-bd-turno">${g.nome}</td>
      <td class="prof-bd-num">${g.haPron || g.pos ? _medaglia(g.pos) : '—'} ${trend}</td>
      <td class="prof-bd-num">${g.punti ?? '—'}</td>
      <td class="prof-bd-num st-muted">${g.pos ? `/${g.partecipanti}` : ''}</td>
    </tr>`;
  }).join('');

  const punti = st.gp.filter(g => g.punti != null);
  const media = punti.length ? Math.round(punti.reduce((a, g) => a + g.punti, 0) / punti.length) : null;
  const migliore = punti.length ? punti.reduce((a, g) => (g.punti > a.punti ? g : a)) : null;

  const t = st.totali;
  const bonusRighe = BONUS_CAMPI.map(c => _bar(c.label, st.bonus[c.id])).join('');

  container.innerHTML = `
    <div class="prof-card">
      <h3 class="prof-card-title">🏅 Risultati GP per GP</h3>
      <table class="prof-bd-table">
        <thead><tr><th>Gran Premio</th><th>Posizione</th><th>Punti</th><th></th></tr></thead>
        <tbody>${righe}</tbody>
        ${media != null ? `<tfoot><tr class="prof-bd-totrow"><td>Media punti</td><td></td><td class="prof-bd-num">${media}</td><td></td></tr></tfoot>` : ''}
      </table>
      ${migliore ? `<p class="prof-note">Miglior weekend: <b>${migliore.nome}</b> con ${migliore.punti} punti.</p>` : ''}
    </div>

    ${_alboHtml(st, uid)}
    ${_badgeHtml(st.badge)}

    <div class="prof-card">
      <h3 class="prof-card-title">🎯 Percentuali di indovinamento</h3>
      ${st.partecipati ? `
        ${_bar('🏁 Pole position', t.pole)}
        ${_bar('🏆 Vincitore gara', t.vincitore)}
        ${_bar('🥇 Podio esatto (3 su 3 in ordine)', t.podioEsatto)}
        ${_bar('🥈 Piloti giusti sul podio', t.podioPiloti, 'i tre piloti sul podio, anche in ordine diverso')}
        ${_bar('📍 Posizioni esatte in qualifica', t.qualiEsatte)}
        ${_bar('📍 Posizioni esatte in gara', t.garaEsatte)}
        ${_bar('🔟 Piloti giusti nei primi 10', t.top10)}
        ${t.sprintEsatte ? _bar('⚡ Posizioni esatte in Sprint', t.sprintEsatte) : ''}
        ${t.sprintVincitore ? _bar('⚡ Vincitore Sprint', t.sprintVincitore) : ''}
        <p class="prof-note">Calcolate su ${st.partecipati} GP a cui hai partecipato.${st.errore != null
          ? ` Errore medio in gara: <b>${st.errore.toFixed(1)}</b> posizioni a pilota.` : ''}</p>`
        : '<p class="text-muted">Nessun pronostico trovato nei GP conclusi.</p>'}
    </div>

    ${bonusRighe ? `<div class="prof-card">
      <h3 class="prof-card-title">🎰 Bonus di gara</h3>
      ${bonusRighe}
    </div>` : ''}`;
}
