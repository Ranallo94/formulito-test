/**
 * FORMULITO — profilo.js
 * Pagina "Il mio profilo" (e scheda di un altro partecipante, via STATE.profiloUid).
 *
 * Due sotto-schede:
 *   • Riepilogo — punti Qualifiche / Gara / Bonus + pole e vincitore pronosticati,
 *                 con stato rispetto ai risultati ufficiali.
 *   • Griglie   — le due griglie pronosticate (Qualifiche e Gara), con le
 *                 posizioni esatte evidenziate in verde.
 *
 * Privacy: qui non c'è un interruttore "nascondi pronostico" come in Medusino
 * (test a evento singolo, tra amici): le griglie di tutti sono sempre visibili
 * agli approvati, per restare semplice.
 */

import { STATE, navigaA } from './app.js';
import { getClassifica, getPronostici, getRisultati } from './db.js';
import { caricaEvento, nomePilota } from './evento.js';
import { normalizzaOrdine, mappaPosizioni, renderOrdineReadOnly } from './griglia.js';
import { calcolaPunteggio } from './punteggi.js';

let _tabsBound = false;

// ── INIT ──────────────────────────────────────────────
export async function initProfilo() {
  const page = document.getElementById('page-profilo');
  if (!page || !STATE.utente) return;

  const targetUid = STATE.profiloUid || STATE.utente.id;
  const isMe = targetUid === STATE.utente.id;

  _bindInnerTabs();
  _resetInnerTabs();
  _renderBanner(isMe);

  const bd = document.getElementById('profilo-breakdown');
  if (bd) bd.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Caricamento profilo…</p></div>';
  _spinner('profilo-griglie-container');

  try {
    const db = await caricaEvento();
    const [classifica, risultati] = await Promise.all([getClassifica(), getRisultati()]);

    const me = (classifica || []).find(p => p.id === targetUid) || null;
    const nome = isMe
      ? (STATE.utente.nickname || STATE.utente.nome || 'Tu')
      : (me?.nome || 'Partecipante');

    const pron = (await getPronostici(targetUid)) || {};
    if (!pron.qualifica) pron.qualifica = {};
    if (!pron.gara) pron.gara = {};
    pron.qualifica.griglia = normalizzaOrdine(pron.qualifica.griglia);
    pron.gara.arrivo = normalizzaOrdine(pron.gara.arrivo);
    if (!pron.gara.bonus) pron.gara.bonus = {};

    const risNorm = {
      qualifica: { griglia: normalizzaOrdine(risultati?.qualifica?.griglia) },
      gara: { arrivo: normalizzaOrdine(risultati?.gara?.arrivo), bonus: risultati?.gara?.bonus || {} },
    };

    const title = document.getElementById('profilo-page-title');
    if (title) title.textContent = isMe ? '📊 Il mio profilo' : `📊 ${nome}`;

    _renderScoreCard(me, nome, isMe, classifica);
    _renderBreakdown(me, pron, risNorm, db);
    _renderKeyPicks(pron, risNorm, db);
    _renderGriglie(pron, risNorm, db);
  } catch (err) {
    if (bd) bd.innerHTML =
      `<div class="empty-state"><div class="empty-icon">⚠️</div>` +
      `<p>Impossibile caricare il profilo.</p><p class="text-muted">${err.message || ''}</p></div>`;
  }
}

// ── BANNER / SOTTO-TAB ────────────────────────────────
function _renderBanner(isMe) {
  const banner = document.getElementById('profilo-header-banner');
  if (!banner) return;
  if (isMe) { banner.style.display = 'none'; banner.innerHTML = ''; return; }
  banner.style.display = '';
  banner.innerHTML =
    `<button type="button" class="prof-back-btn">← Torna alla classifica</button>` +
    `<span class="prof-back-note">Stai guardando la scheda di un altro partecipante</span>`;
  const btn = banner.querySelector('.prof-back-btn');
  if (btn) btn.addEventListener('click', () => navigaA('classifica'));
}

function _bindInnerTabs() {
  if (_tabsBound) return;
  const bar = document.getElementById('profilo-inner-tabs');
  const page = document.getElementById('page-profilo');
  if (!bar || !page) return;
  const contents = [...page.children].filter(el => el.classList.contains('tab-content'));
  bar.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab;
      bar.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      contents.forEach(c => c.classList.toggle('active', c.id === targetId));
    });
  });
  _tabsBound = true;
}

function _resetInnerTabs() {
  const bar = document.getElementById('profilo-inner-tabs');
  const page = document.getElementById('page-profilo');
  if (!bar || !page) return;
  bar.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  const contents = [...page.children].filter(el => el.classList.contains('tab-content'));
  contents.forEach((c, i) => c.classList.toggle('active', i === 0));
}

// ── SCORE CARD ────────────────────────────────────────
function _renderScoreCard(me, nome, isMe, classifica) {
  const card = document.getElementById('profilo-score-card');
  if (!card) return;
  const pos = _posizione(classifica, me?.id);
  card.innerHTML = `
    <div class="score-card-inner">
      <div class="score-card-pos">${_posLabel(pos)}</div>
      <div class="score-card-info">
        <div class="score-card-nome">${nome}${isMe ? ' <span class="badge-tu">Tu</span>' : ''}</div>
        <div class="score-card-totale">${me?.totale ?? 0} <span class="score-card-pt">pt</span></div>
      </div>
    </div>`;
}

// ── RIEPILOGO: punti Qualifiche / Gara / Bonus ────────
function _renderBreakdown(me, pron, ris, db) {
  const box = document.getElementById('profilo-breakdown');
  if (!box) return;

  let breakdown = me?.breakdown;
  if (!breakdown) breakdown = calcolaPunteggio(pron, ris).breakdown;

  const totale = (breakdown.qualifica || 0) + (breakdown.gara || 0) + (breakdown.bonus || 0);

  box.innerHTML = `
    <div class="prof-card">
      <h3 class="prof-card-title">📈 Punti per categoria</h3>
      <table class="prof-bd-table">
        <thead><tr><th>Categoria</th><th>Punti</th></tr></thead>
        <tbody>
          <tr class="prof-bd-row"><td class="prof-bd-turno">🏁 Qualifiche</td><td class="prof-bd-num">${breakdown.qualifica || 0}</td></tr>
          <tr class="prof-bd-row"><td class="prof-bd-turno">🏆 Gara</td><td class="prof-bd-num">${breakdown.gara || 0}</td></tr>
          <tr class="prof-bd-row"><td class="prof-bd-turno">🎯 Bonus</td><td class="prof-bd-num">${breakdown.bonus || 0}</td></tr>
        </tbody>
        <tfoot><tr class="prof-bd-totrow"><td>Totale</td><td class="prof-bd-num">${totale}</td></tr></tfoot>
      </table>
    </div>`;
}

// ── RIEPILOGO: pronostici chiave (pole + vincitore) ───
function _renderKeyPicks(pron, ris, db) {
  const box = document.getElementById('profilo-keypicks');
  if (!box) return;

  const posQualiReale = mappaPosizioni(ris.qualifica.griglia);
  const posGaraReale = mappaPosizioni(ris.gara.arrivo);

  const poleId = pron.qualifica.griglia[0];
  const vincId = pron.gara.arrivo[0];

  const chip = (pid, mappa) => {
    if (!pid) return '<span class="text-muted">— non pronosticato</span>';
    const reale = Object.prototype.hasOwnProperty.call(mappa, pid) ? mappa[pid] : null;
    const ok = reale === 0;
    const icon = reale == null ? '⏳' : ok ? '✅' : '❌';
    const cls = reale == null ? ' prof-chip--live' : ok ? ' prof-chip--ok' : ' prof-chip--out';
    return `<span class="prof-chip${cls}"><span class="prof-chip-ic">${icon}</span><span class="prof-chip-name">${nomePilota(db, pid)}</span></span>`;
  };

  box.innerHTML = `
    <div class="prof-card">
      <h3 class="prof-card-title">🎯 I tuoi pronostici chiave</h3>
      <div class="prof-keys">
        <div class="prof-key-group">
          <div class="prof-key-label">🏁 Pole position</div>
          <div class="prof-chips">${chip(poleId, posQualiReale)}</div>
        </div>
        <div class="prof-key-group">
          <div class="prof-key-label">🏆 Vincitore gara</div>
          <div class="prof-chips">${chip(vincId, posGaraReale)}</div>
        </div>
      </div>
      <div id="profilo-bonus-confronto"></div>
      <p class="prof-note">✅ indovinato · ❌ sbagliato · ⏳ risultato non ancora inserito.</p>
    </div>`;

  _renderBonusConfronto(document.getElementById('profilo-bonus-confronto'), pron, ris, db);
}

function _renderBonusConfronto(container, pron, ris, db) {
  if (!container) return;
  const CAMPI = [
    { id: 'giroVeloce', label: '🏁 Giro più veloce' },
    { id: 'pitStopVeloce', label: '🔧 Pit stop più veloce' },
    { id: 'gommaLunga', label: '🛞 Gomma più duratura' },
    { id: 'primoRitirato', label: '🚩 Primo ritirato' },
    { id: 'maggiorGuadagno', label: '📈 Maggior guadagno' },
    { id: 'safetyCar', label: '🚨 N. Safety Car', numero: true },
  ];
  let html = '<h4 class="prof-bonus-title">🎯 Bonus di gara</h4><div class="prof-bonus-list">';
  CAMPI.forEach(c => {
    const pick = pron?.gara?.bonus?.[c.id];
    const real = ris?.gara?.bonus?.[c.id];
    let esito = '';
    if (pick != null && pick !== '' && real != null && real !== '') {
      const ok = c.numero ? Number(pick) === Number(real) : pick === real;
      esito = ok ? '<span class="prof-pts prof-pts--ok">✓</span>' : '<span class="prof-pts prof-pts--no">✗</span>';
    }
    const val = pick == null || pick === '' ? '—' : (c.numero ? pick : nomePilota(db, pick));
    html += `<div class="prof-bonus-row"><span class="prof-bonus-label">${c.label}</span><span class="prof-bonus-val">${val} ${esito}</span></div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

// ── GRIGLIE pronosticate (con posizioni esatte in verde) ──
function _renderGriglie(pron, ris, db) {
  const box = document.getElementById('profilo-griglie-container');
  if (!box) return;

  const posQualiReale = mappaPosizioni(ris.qualifica.griglia);
  const posGaraReale = mappaPosizioni(ris.gara.arrivo);

  const correttiQuali = pron.qualifica.griglia
    .map((pid, i) => (pid && posQualiReale[pid] === i) ? pid : null)
    .filter(Boolean);
  const correttiGara = pron.gara.arrivo
    .map((pid, i) => (pid && posGaraReale[pid] === i) ? pid : null)
    .filter(Boolean);

  box.innerHTML = `
    <div class="prof-legend">
      <span class="prof-legend-item"><span class="prof-legend-sw prof-legend-sw--ok"></span> posizione esatta</span>
    </div>
    <div class="prof-griglie-grid">
      <div class="prof-card">
        <h3 class="prof-card-title">🏁 Qualifiche</h3>
        <div id="profilo-griglia-quali"></div>
      </div>
      <div class="prof-card">
        <h3 class="prof-card-title">🏆 Gara</h3>
        <div id="profilo-griglia-gara"></div>
      </div>
    </div>`;

  renderOrdineReadOnly(document.getElementById('profilo-griglia-quali'), pron.qualifica.griglia, db, { evidenziaCorrette: correttiQuali });
  renderOrdineReadOnly(document.getElementById('profilo-griglia-gara'), pron.gara.arrivo, db, { evidenziaCorrette: correttiGara });
}

// ── HELPERS ───────────────────────────────────────────
function _spinner(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Caricamento…</p></div>';
}

function _posizione(classifica, uid) {
  if (!uid || !classifica?.length) return null;
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
    if (sorted[i].id === uid) return pos;
  }
  return null;
}

function _posLabel(pos) {
  if (!pos) return '—';
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  return medals[pos] || `${pos}°`;
}
