/**
 * FORMULITO — functions/competizioni.js  (CommonJS, usato dalle Cloud Functions)
 * Porting minimo di js/competizioni.js: qui serve solo sapere, dato un
 * compId, se quella competizione prevede la Sprint (per il calcolo punteggi
 * server-side in punteggi.js). Niente localStorage/"competizione attuale":
 * le Cloud Functions ricevono sempre il compId esplicito dal trigger
 * Firestore (vedi index.js → _aggiornaClassifica(compId, ...)).
 *
 * IMPORTANTE: tenere questo elenco sincronizzato con il flag `sprint` di
 * js/competizioni.js ogni volta che si aggiunge una nuova gara con la
 * Sprint. Le due liste sono intenzionalmente duplicate (ES modules lato
 * client vs CommonJS lato Cloud Functions non possono condividere un unico
 * file sorgente in questo setup).
 */
'use strict';

const COMPETIZIONI_SPRINT = new Set([
  'singapore',
]);

/** true se la competizione `id` prevede la Sprint. */
function haSprint(id) {
  return COMPETIZIONI_SPRINT.has(id);
}

module.exports = { haSprint };