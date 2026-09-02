/**
 * FORMULITO — griglia.js
 * Modello di pronostico: non c'è tabellone, il pronostico è un ORDINAMENTO
 * di tutti i 22 piloti per due sessioni indipendenti (Qualifiche e Gara),
 * più i bonus di gara.
 *
 * Documento pronostici/{uid}:
 *   {
 *     qualifica: { griglia: [pid_1a, pid_2a, ..., pid_22a] },   // indice 0 = pole
 *     gara: {
 *       arrivo: [pid_1a, ..., pid_22a],                          // indice 0 = vincitore
 *       bonus: { giroVeloce, pitStopVeloce, gommaLunga, primoRitirato, safetyCar, maggiorGuadagno }
 *     }
 *   }
 *
 * Documento risultati/ufficiali: stessa struttura, con i dati REALI (compilati dall'admin).
 *
 * L'ordinamento è gestito con 22 <select> a cascata: scegliendo un pilota in una
 * posizione, se era già assegnato altrove viene liberato automaticamente lì,
 * cosicché non si possano mai avere duplicati nello stesso ordinamento.
 */

export const N_PILOTI = 22;

/** Array di 22 posizioni vuote. */
export function nuovoOrdine() {
  return new Array(N_PILOTI).fill(null);
}

/** Normalizza un ordinamento salvato: garantisce lunghezza 22. */
export function normalizzaOrdine(arr) {
  const out = Array.isArray(arr) ? arr.slice(0, N_PILOTI) : [];
  while (out.length < N_PILOTI) out.push(null);
  return out.map(v => v || null);
}

/** Indice (0-based) in cui compare `pid` nell'ordinamento, o -1. */
export function posizioneDi(ordine, pid) {
  return ordine.indexOf(pid);
}

/**
 * Imposta `pid` in posizione `index`: se `pid` era già presente in un'altra
 * posizione, quella viene liberata. Ritorna un NUOVO array (non muta l'originale).
 * Passare pid = null per svuotare la posizione.
 */
export function setInPosizione(ordine, index, pid) {
  const out = ordine.slice();
  if (pid) {
    const prev = out.indexOf(pid);
    if (prev !== -1 && prev !== index) out[prev] = null;
  }
  out[index] = pid || null;
  return out;
}

/** true se l'ordinamento è completo: 22 posizioni, tutte diverse, nessun vuoto. */
export function ordineCompleto(ordine) {
  if (!Array.isArray(ordine) || ordine.length !== N_PILOTI) return false;
  if (ordine.some(v => !v)) return false;
  return new Set(ordine).size === N_PILOTI;
}

/** Quante posizioni sono state compilate (non nulle). */
export function ordineCompilate(ordine) {
  return (ordine || []).filter(Boolean).length;
}

/** Mappa pid → posizione (0-based) per lookup rapido. */
export function mappaPosizioni(ordine) {
  const m = {};
  (ordine || []).forEach((pid, i) => { if (pid) m[pid] = i; });
  return m;
}

// ── Lettura sicura dal documento Firestore (pronostici o risultati) ─────
export function getGrigliaQuali(doc) {
  return normalizzaOrdine(doc?.qualifica?.griglia);
}
export function getArrivoGara(doc) {
  return normalizzaOrdine(doc?.gara?.arrivo);
}
export function getBonusGara(doc) {
  return doc?.gara?.bonus || {};
}

/** Prepara l'oggetto pronostici pronto per il salvataggio (senza updatedAt). */
export function serializzaPronostico(pron) {
  return {
    qualifica: { griglia: normalizzaOrdine(pron?.qualifica?.griglia) },
    gara: {
      arrivo: normalizzaOrdine(pron?.gara?.arrivo),
      bonus: { ...(pron?.gara?.bonus || {}) },
    },
  };
}

// ── Render read-only di un ordinamento (per profilo.js / live.js) ───────
/**
 * @param {HTMLElement} container
 * @param {Array} ordine   22 pid (o meno se incompleto)
 * @param {Object} db      DB evento
 * @param {Object} opts    { evidenziaCorrette: Array<pid> di posizioni esatte da segnare con ✅ }
 */
export function renderOrdineReadOnly(container, ordine, db, opts = {}) {
  if (!container) return;
  const corretti = new Set(opts.evidenziaCorrette || []);
  let html = '<ol class="grid-ordine">';
  (ordine || []).forEach((pid, i) => {
    if (!pid) {
      html += `<li class="grid-riga grid-riga--vuota"><span class="grid-pos">${i + 1}</span><span class="grid-nome">—</span></li>`;
      return;
    }
    const p = db.piloti?.[pid] || {};
    const ok = corretti.has(pid) ? ' grid-riga--ok' : '';
    html += `<li class="grid-riga${ok}" style="--team-color:${p.colore || '#888'}">
      <span class="grid-pos">${i + 1}</span>
      <span class="grid-team-dot"></span>
      <span class="grid-nome">${p.nome || ''} ${p.cognome || pid}</span>
      <span class="grid-team">${p.team || ''}</span>
      ${corretti.has(pid) ? '<span class="grid-check">✅</span>' : ''}
    </li>`;
  });
  html += '</ol>';
  container.innerHTML = html;
}
