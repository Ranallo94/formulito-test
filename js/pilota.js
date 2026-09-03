/**
 * FORMULITO — pilota.js
 * Badge team e scheda pilota (modal). I dati anagrafici sono quelli statici
 * del DB evento (f1_db.json) — niente sync per i pronostici, come da scelta
 * progettuale (inserimento manuale admin). La scheda però mostra anche la
 * FORMA RECENTE (ultime 5 gare 2026) presa in tempo reale dalla Jolpica F1 API
 * (https://api.jolpi.ca/ergast/f1/ — successore gratuito e open source di
 * Ergast, CORS aperto, nessuna chiave richiesta): non è un dato che l'admin
 * può inserire a mano in modo sensato, e a differenza del bracket tennis
 * qui esiste una stagione 2026 reale già in corso da cui prendere lo storico.
 * Ogni pilota nel DB evento ha un campo "jolpicaId" (slug driverId dell'API).
 *
 * Esporta:
 *   teamBadge(db, pid)        → stringa HTML del badge team accanto al nome
 *   infoBtn(pid)              → stringa HTML del bottone "ⓘ" che apre la scheda
 *   openSchedaPilota(db, pid) → apre il modal (dati statici subito, forma recente a caricamento avvenuto)
 */

import { openModal } from './ui.js';
import { nomePilota } from './evento.js';

const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1';
const STAGIONE = 2026;
let _formaCache = {}; // jolpicaId -> Promise<Array|null>, evita rifetch se si riapre la stessa scheda

/**
 * Ultime 5 gare 2026 di un pilota (fino a quella più recente disputata).
 * Ritorna null se il fetch fallisce o il pilota non ha ancora corso.
 */
function _fetchForma(jolpicaId) {
  if (!jolpicaId) return Promise.resolve(null);
  if (_formaCache[jolpicaId]) return _formaCache[jolpicaId];

  const p = fetch(`${JOLPICA_BASE}/${STAGIONE}/drivers/${jolpicaId}/results.json?limit=100`)
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(json => {
      const gare = json?.MRData?.RaceTable?.Races || [];
      return gare.slice(-5).map(g => {
        const res = g.Results?.[0] || {};
        return {
          gp: g.raceName?.replace(/ Grand Prix$/, '') || '?',
          round: g.round,
          posizione: res.positionText || res.position || '?',
          ritirato: (res.status && res.status !== 'Finished' && !/^\+/.test(res.status) && !/^Lap/.test(res.status)),
          punti: res.points ?? '0',
        };
      });
    })
    .catch(() => null);

  _formaCache[jolpicaId] = p;
  return p;
}

/** Classe colore chip in base a posizione/esito. */
function _classeForma(r) {
  if (r.ritirato) return 'forma-chip--dnf';
  const pos = parseInt(r.posizione, 10);
  if (pos === 1) return 'forma-chip--vittoria';
  if (pos <= 3) return 'forma-chip--podio';
  if (pos <= 10) return 'forma-chip--punti';
  return 'forma-chip--fuori';
}

function _renderForma(righe) {
  if (righe === null) {
    return '<p class="text-muted">Dati forma non disponibili al momento (servizio esterno irraggiungibile).</p>';
  }
  if (!righe.length) {
    return '<p class="text-muted">Nessuna gara disputata finora in questa stagione.</p>';
  }
  return `<div class="forma-strip">${righe.map(r => `
    <div class="forma-chip ${_classeForma(r)}" title="${r.gp} — ${r.ritirato ? 'Ritirato' : 'P' + r.posizione}">
      <span class="forma-chip-pos">${r.ritirato ? 'DNF' : 'P' + r.posizione}</span>
      <span class="forma-chip-gp">${r.gp}</span>
    </div>`).join('')}</div>`;
}

// ── BADGE & TRIGGER (usati nel rendering delle griglie) ───
/** Badge col nome del team, colorato con il colore ufficiale. */
export function teamBadge(db, pid) {
  const p = db?.piloti?.[pid];
  if (!p) return '';
  return `<span class="team-badge" style="--team-color:${p.colore || '#888'}" title="${p.team || ''}">${p.team || ''}</span>`;
}

/** Bottone informazioni che apre la scheda pilota. */
export function infoBtn(pid) {
  return `<button type="button" class="player-info-btn" data-info="${pid}"
            title="Scheda pilota" aria-label="Apri scheda pilota">ⓘ</button>`;
}

// ── SCHEDA (modal) ────────────────────────────────────
export function openSchedaPilota(db, pid) {
  const p = db?.piloti?.[pid] || {};
  const titolo = nomePilota(db, pid);

  openModal({
    title: titolo,
    body: `
      <div class="pc">
        <div class="pc-head" style="--team-color:${p.colore || '#888'}">
          <div class="pc-avatar pc-avatar--ph">🏎️</div>
          <div class="pc-headmain">
            <div class="pc-name">${titolo}</div>
            <div class="pc-meta"><span class="pc-team" style="color:${p.colore || 'inherit'}">${p.team || '—'}</span></div>
          </div>
        </div>
        <div class="pc-section">
          <div class="pc-section-title">Scuderia</div>
          <dl class="pc-dl">
            <div class="pc-dl-row"><dt>Team</dt><dd>${p.team || '—'}</dd></div>
            <div class="pc-dl-row"><dt>Nome</dt><dd>${p.nome || ''} ${p.cognome || ''}</dd></div>
          </dl>
        </div>
        <div class="pc-section">
          <div class="pc-section-title">📈 Forma — ultime 5 gare 2026</div>
          <div id="pc-forma-box" data-pid="${pid}"><p class="text-muted">Caricamento…</p></div>
        </div>
      </div>`,
    buttons: [{ label: 'Chiudi', cls: 'btn btn-secondary', onClick: () => {
      const ov = document.getElementById('modal-overlay'); if (ov) ov.style.display = 'none';
    } }],
  });

  _fetchForma(p.jolpicaId).then(righe => {
    // Il modal è un singleton riusato: se nel frattempo è stata aperta la
    // scheda di un altro pilota, il box ora ha un data-pid diverso — non
    // sovrascrivere la scheda sbagliata con questa risposta arrivata in ritardo.
    const box = document.getElementById('pc-forma-box');
    if (box && box.dataset.pid === pid) box.innerHTML = _renderForma(righe);
  });
}
