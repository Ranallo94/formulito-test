/**
 * FORMULITO — classifica.js
 * Leaderboard real-time con calcolo spareggio.
 * La classifica pre-calcolata è in Firestore (aggiornata dalla Cloud Function).
 */

import { STATE, navigaA } from './app.js';
import { onClassificaSnapshot, getClassificaUpdatedAt, getRisultati } from './db.js';
import { showSpinner, showEmpty, formatDate } from './ui.js';
import { getCompetizione } from './competizioni.js';
import { CIRCUITI } from './circuiti.js';
import { caricaCaschi, cascoDi, svgCasco, apriEditorCasco } from './caschi.js';
import { montaCircuito } from './circuito.js';

let _unsub = null;
let _partecipanti = [];
let _query = '';
let _vista = 'lista';          // 'lista' | 'circuito'
let _cv = null;                // vista circuito montata
let _vistaBound = false;

// ── INIT ──────────────────────────────────────────────
export async function initClassifica() {
  showSpinner('classifica-container', 'Caricamento classifica…');

  // Barra di ricerca
  const search = document.getElementById('classifica-search');
  if (search) {
    search.addEventListener('input', () => {
      _query = search.value.trim().toLowerCase();
      renderClassifica(_partecipanti);
    });
  }

  // Ascolta in real-time
  _unsub = onClassificaSnapshot((partecipanti) => {
    _partecipanti = partecipanti;
    renderClassifica(partecipanti);
    if (_vista === 'circuito') _aggiornaCircuito();
  });

  // Elenco ⇄ circuito (il circuito esiste solo se il GP ha un tracciato in circuiti.js)
  _bindVista();
  _vista = 'lista'; _mostraVista();

  // Caschi di tutti: arrivano dopo e ridisegnano le icone (finché non ci sono, vale quello casuale)
  caricaCaschi().then(() => { renderClassifica(_partecipanti); if (_cv) _cv.ridisegnaCaschi(); });

  // Timestamp aggiornamento
  try {
    const ts = await getClassificaUpdatedAt();
    if (ts) {
      document.getElementById('classifica-updated').textContent =
        `Aggiornata: ${formatDate(ts.toISOString(), true)}`;
    }
  } catch (_) {}
}

/** Ferma l'ascolto real-time (usato quando si cambia competizione). */
export function cleanupClassifica() {
  if (_unsub) { _unsub(); _unsub = null; }
  if (_cv) { _cv.distruggi(); _cv = null; }
  _vista = 'lista'; _mostraVista();
  _partecipanti = [];
  _query = '';
  const search = document.getElementById('classifica-search');
  if (search) search.value = '';
}

// ── VISTA CIRCUITO ────────────────────────────────────
function _bindVista() {
  if (_vistaBound) return;
  const bar = document.getElementById('classifica-vista');
  if (!bar) return;
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cvista]');
    if (!b) return;
    _vista = b.dataset.cvista;
    _mostraVista();
    if (_vista === 'circuito') _aggiornaCircuito();
  });
  _vistaBound = true;
}

function _mostraVista() {
  const circ = document.getElementById('classifica-circuito');
  const lista = document.getElementById('classifica-container');
  const ricerca = document.getElementById('classifica-search-wrap');
  const bar = document.getElementById('classifica-vista');
  if (!circ || !lista) return;
  // senza tracciato per questo GP la scelta non ha senso: si resta sull'elenco
  const ha = !!CIRCUITI[getCompetizione(STATE.competizioneId).circuito];
  if (bar) bar.style.display = ha ? '' : 'none';
  if (!ha) _vista = 'lista';
  bar?.querySelectorAll('[data-cvista]').forEach(b => b.classList.toggle('on', b.dataset.cvista === _vista));
  circ.style.display = _vista === 'circuito' ? '' : 'none';
  lista.style.display = _vista === 'lista' ? '' : 'none';
  if (ricerca) ricerca.style.display = _vista === 'lista' ? '' : 'none';
}

/** Dati per il circuito: punti di qualifica (+Sprint) e totali, e fino a dove è arrivato il weekend. */
async function _aggiornaCircuito() {
  const el = document.getElementById('classifica-circuito');
  const id = getCompetizione(STATE.competizioneId).circuito;
  if (!el || !CIRCUITI[id]) return;
  let ris = {};
  try { ris = await getRisultati(); } catch (_) {}
  if (_vista !== 'circuito') return;                      // nel frattempo si è tornati all'elenco
  const piene = (a) => (Array.isArray(a) ? a : Object.values(a || {})).filter(Boolean).length;
  const faseMax = piene(ris?.gara?.arrivo) >= 10 ? 2 : piene(ris?.qualifica?.griglia) >= 10 ? 1 : 0;
  const partecipanti = (_partecipanti || []).map(p => ({
    id: p.id, nome: p.nome || '—',
    quali: (p.breakdown?.qualifica || 0) + (p.breakdown?.sprint || 0),
    totale: p.totale || 0,
  }));
  if (_cv) { _cv.aggiorna({ partecipanti, faseMax }); return; }
  _cv = montaCircuito(el, {
    circuitoId: id, partecipanti, faseMax, meId: STATE.utente?.id,
    cascoDi,
    onScheda: (uid) => navigaA('profilo', { uid }),
    onModifica: () => apriEditorCasco({
      uid: STATE.utente.id, nome: STATE.utente.nickname || STATE.utente.nome || '',
      onSalvato: () => { if (_cv) _cv.ridisegnaCaschi(); renderClassifica(_partecipanti); },
    }),
  });
}

// ── RENDER ────────────────────────────────────────────
export function renderClassifica(partecipanti) {
  const container = document.getElementById('classifica-container');
  if (!container) return;

  if (!partecipanti || !partecipanti.length) {
    showEmpty('classifica-container', 'Classifica non ancora disponibile.', '🏅');
    return;
  }

  // Ordina: totale DESC, poi criteri spareggio in cascata
  const sorted = [...partecipanti].sort((a, b) => {
    if (b.totale !== a.totale) return b.totale - a.totale;
    const sa = a.spareggio || [];
    const sb = b.spareggio || [];
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      if ((sb[i] || 0) !== (sa[i] || 0)) return (sb[i] || 0) - (sa[i] || 0);
    }
    return (a.nome || '').localeCompare(b.nome || '', 'it');
  });

  // Assegna posizioni effettive (gestisce ex-aequo)
  let pos = 1;
  sorted.forEach((p, i) => {
    if (i > 0) {
      const prev = sorted[i - 1];
      const samePts = prev.totale === p.totale;
      const sameSpar = JSON.stringify(prev.spareggio) === JSON.stringify(p.spareggio);
      if (!samePts || !sameSpar) pos = i + 1;
    }
    p._pos = pos;
  });

  const isMe = (uid) => uid === STATE.utente?.id;

  // Filtro ricerca (le posizioni restano quelle reali)
  const visibili = _query
    ? sorted.filter(p => (p.nome || '').toLowerCase().includes(_query))
    : sorted;

  if (!visibili.length) {
    container.innerHTML = `
      <div class="classifica-list">
        <div class="classifica-search-empty">Nessun partecipante trovato per «${_query}».</div>
      </div>`;
    _aggiornaProfilo(sorted);
    return;
  }

  const rows = visibili.map(p => {
    const posClass = p._pos === 1 ? 'pos-1'
                   : p._pos === 2 ? 'pos-2'
                   : p._pos === 3 ? 'pos-3'
                   : p._pos === sorted.length ? 'pos-last' : '';
    const meClass  = isMe(p.id) ? ' row-me' : '';
    const bdHtml   = _renderBreakdownInline(p.breakdown);

    return `
      <div class="classifica-row${meClass} ${posClass} classifica-row-link" data-uid="${p.id}" title="Vedi scheda pronostici">
        <div class="row-pos">${_posLabel(p._pos)}</div>
        <div class="row-info">
          <span class="row-nome">${svgCasco(cascoDi(p.id), 'hm-mini')}${p.nome || '—'}${isMe(p.id) ? ' <span class="badge-tu">Tu</span>' : ''}</span>
          <div class="row-breakdown">${bdHtml}</div>
        </div>
        <div class="row-totale">${p.totale ?? '—'}</div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="classifica-list">
      <div class="classifica-header">
        <span>Pos.</span>
        <span>Partecipante</span>
        <span>Punti</span>
      </div>
      ${rows}
    </div>`;

  // Clic su una riga → apri scheda pronostici
  container.querySelectorAll('.classifica-row-link').forEach(row => {
    row.addEventListener('click', () => {
      const uid = row.dataset.uid;
      if (uid) navigaA('profilo', { uid });
    });
  });

  // Aggiorna profilo se è la pagina corrente
  _aggiornaProfilo(sorted);
}

// ── PROFILO SCORE CARD ────────────────────────────────
function _aggiornaProfilo(sorted) {
  // Non toccare la score-card quando l'utente sta guardando il profilo di un altro
  // partecipante: in quel caso è profilo.js a gestirla.
  if (STATE.profiloUid) return;
  const me = sorted.find(p => p.id === STATE.utente?.id);
  const card = document.getElementById('profilo-score-card');
  if (!card || !me) return;

  card.innerHTML = `
    <div class="score-card-inner">
      <div class="score-card-pos">${_posLabel(me._pos)}</div>
      <div class="score-card-info">
        <div class="score-card-nome">${me.nome}</div>
        <div class="score-card-totale">${me.totale ?? 0} <span class="score-card-pt">pt</span></div>
      </div>
    </div>`;
}

// ── BREAKDOWN INLINE ──────────────────────────────────
function _renderBreakdownInline(bd) {
  if (!bd) return '';
  // Breakdown F1: { qualifica, sprint (solo weekend Sprint), gara, bonus }
  const voci = [
    { label: 'Qualifiche', punti: bd.qualifica || 0 },
  ];
  if (bd.sprint != null) voci.push({ label: 'Sprint', punti: bd.sprint || 0 });
  voci.push({ label: 'Gara', punti: bd.gara || 0 });
  voci.push({ label: 'Bonus', punti: bd.bonus || 0 });

  const filtered = voci.filter(v => v.punti > 0);
  if (!filtered.length) return '<span class="bd-empty">nessun punto ancora</span>';
  return filtered.map(v => `<span class="bd-chip">${v.label}: <strong>${v.punti}</strong></span>`).join('');
}

// ── HELPERS ───────────────────────────────────────────
function _posLabel(pos) {
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  return medals[pos] || `${pos}°`;
}