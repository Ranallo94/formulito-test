/**
 * FORMULITO — pilota.js
 * Badge team e scheda pilota (modal) con i soli dati statici del DB evento
 * (f1_db.json). A differenza di Medusino non c'è alcuna sincronizzazione
 * live da ESPN per la F1: qui è tutto statico, coerente con l'inserimento
 * manuale dei risultati da parte dell'admin.
 *
 * Esporta:
 *   teamBadge(db, pid)        → stringa HTML del badge team accanto al nome
 *   infoBtn(pid)              → stringa HTML del bottone "ⓘ" che apre la scheda
 *   openSchedaPilota(db, pid) → apre il modal con le info statiche del pilota
 */

import { openModal } from './ui.js';
import { nomePilota } from './evento.js';

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
      </div>`,
    buttons: [{ label: 'Chiudi', cls: 'btn btn-secondary', onClick: () => {
      const ov = document.getElementById('modal-overlay'); if (ov) ov.style.display = 'none';
    } }],
  });
}
