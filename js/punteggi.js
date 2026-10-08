/**
 * FORMULITO — punteggi.js
 * Motore di calcolo punteggi. Il pronostico è un ORDINAMENTO di tutti i 22
 * piloti per Qualifiche e per Gara, più 6 bonus di gara, più — SOLO nei
 * weekend che la prevedono (competizioni.js → sprint:true) — un ordinamento
 * dei primi 8 all'arrivo in Sprint.
 *
 * ── QUALIFICHE ── per ogni pilota pronosticato in posizione i (0-based),
 * confrontato con la griglia di partenza reale:
 *   • posizione 1 (pole) esatta            → 10 pt
 *   • qualsiasi altra posizione esatta      → 3 pt
 *   • scarto di esattamente 1 posizione     → 1 pt
 *   • altrimenti                            → 0 pt
 * Si somma su tutti i 22 piloti.
 *
 * ── SPRINT ── (solo weekend con sprint:true) per ogni pilota pronosticato
 * tra i primi 8, confrontato con l'arrivo reale della Sprint:
 *   1) se la posizione prevista è ESATTAMENTE quella reale → punti Sprint
 *      ufficiali di quella posizione (POSIZIONE_PUNTI_SPRINT, P1=8…P8=1);
 *   2) +1 pt se il pilota era previsto a podio (pos. prevista 1-3) ED è
 *      arrivato realmente a podio (pos. reale 1-3, non necessariamente la stessa).
 * A differenza della Gara, niente scarto-di-1 e niente bonus "a punti": in
 * Sprint si pronosticano solo 8 piloti, non ha senso un secondo livello.
 * Si somma sugli 8 piloti pronosticati.
 *
 * ── GARA ── per ogni pilota pronosticato in posizione i, confrontato con
 * l'ordine di arrivo reale, si sommano (cumulabili sullo stesso pilota):
 *   1) se la posizione prevista è ESATTAMENTE quella reale → punti F1 ufficiali
 *      di quella posizione (POSIZIONE_PUNTI_F1, P1=25 … P10=1, P11+=0);
 *   2) +3 pt se il pilota era previsto a podio (pos. prevista 1-3) ED è
 *      arrivato realmente a podio (pos. reale 1-3, non necessariamente la stessa);
 *   3) +1 pt se il pilota era previsto a punti (pos. prevista 1-10) ED è
 *      arrivato realmente a punti (pos. reale 1-10).
 * Si somma su tutti i 22 piloti.
 *
 * ── BONUS GARA ── 6 voci indipendenti, punti fissi in BONUS_PUNTI:
 *   • giroVeloce, pitStopVeloce, gommaLunga, primoRitirato, maggiorGuadagno:
 *     5 pt se il pilota indicato è esatto, altrimenti 0.
 *   • safetyCar (numero di ingressi): 5 pt se il numero è esatto, altrimenti 0
 *     (nessun punteggio parziale per lo scarto di 1).
 *
 * Nota: il valore di 5 pt/bonus (ridotto da 8, senza mezzo punto sulla safety
 * car) è stato scelto dopo una simulazione Monte Carlo (3000 GP simulati, 15
 * partecipanti): con 8 pt i bonus valevano il 22,5% del punteggio totale e
 * ribaltavano il vincitore nel 24,5% dei casi; a 5 pt scendono al 14,6% del
 * totale e al 15,4% dei ribaltamenti — un peso ancora percepibile ma non più
 * dominante rispetto all'ordine di arrivo vero e proprio.
 *
 * Punteggio totale = punti qualifica + punti sprint (se presente) + punti
 * gara + bonus gara. calcolaPunteggio() legge da solo haSprint() per sapere
 * se includere lo Sprint: i chiamanti (admin.js, profilo.js) non devono
 * saperlo né passare opzioni.
 *
 * Spareggio: (1) vincitore gara indovinato, (2) pole indovinata, (3) più
 * bonus indovinati. Non include la Sprint di proposito, per non appesantire
 * i criteri su una sessione presente solo in alcuni weekend.
 */
import { normalizzaOrdine, mappaPosizioni, N_SPRINT } from './griglia.js';
import { haSprint } from './competizioni.js';

// ── QUALIFICHE ────────────────────────────────────────
export const QUALI_POLE_PUNTI  = 10;
export const QUALI_ALTRA_PUNTI = 3;
export const QUALI_VICINO_PUNTI = 1;

// ── GARA: punti F1 ufficiali per posizione esatta (P1..P10, P11+ = 0) ──
export const POSIZIONE_PUNTI_F1 = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const GARA_BONUS_PODIO  = 3; // previsto podio (1-3) e arrivato podio (1-3)
export const GARA_BONUS_PUNTI  = 1; // previsto punti (1-10) e arrivato punti (1-10)

// ── SPRINT: punti ufficiali per posizione esatta (P1..P8) ─────────────
export const POSIZIONE_PUNTI_SPRINT = [8, 7, 6, 5, 4, 3, 2, 1];
export const SPRINT_BONUS_PODIO = 1; // previsto podio sprint (1-3) e arrivato podio sprint (1-3)

// ── BONUS GARA (facilmente modificabile) ──────────────
export const BONUS_PUNTI = {
  giroVeloce:      5,
  pitStopVeloce:   5,
  gommaLunga:      5,
  primoRitirato:   5,
  maggiorGuadagno: 5,
  safetyCar:       { esatto: 5 },
};

/** Punti qualifica per un singolo pilota dato lo scarto tra posizione prevista e reale. */
function puntiQualiPosizione(posPrevista, posReale) {
  if (posReale == null) return 0;
  if (posPrevista === posReale) return posPrevista === 0 ? QUALI_POLE_PUNTI : QUALI_ALTRA_PUNTI;
  if (Math.abs(posPrevista - posReale) === 1) return QUALI_VICINO_PUNTI;
  return 0;
}

/** Calcola i punti qualifica: somma su tutti i piloti pronosticati. */
function calcolaQualifica(grigliaPron, grigliaReale) {
  const posReale = mappaPosizioni(grigliaReale);
  let punti = 0;
  const dettaglio = [];
  grigliaPron.forEach((pid, i) => {
    if (!pid) return;
    const pr = Object.prototype.hasOwnProperty.call(posReale, pid) ? posReale[pid] : null;
    const pt = puntiQualiPosizione(i, pr);
    if (pt) dettaglio.push({ pid, previsto: i, reale: pr, punti: pt });
    punti += pt;
  });
  return { punti, dettaglio };
}

/** Calcola i punti gara (posizione + podio + punti), sommati su tutti i piloti. */
function calcolaGara(arrivoPron, arrivoReale) {
  const posReale = mappaPosizioni(arrivoReale);
  let punti = 0;
  let vincitoreOk = false;
  const dettaglio = [];

  arrivoPron.forEach((pid, i) => {
    if (!pid) return;
    const pr = Object.prototype.hasOwnProperty.call(posReale, pid) ? posReale[pid] : null;
    if (pr == null) return;

    let pt = 0;
    if (i === pr) pt += POSIZIONE_PUNTI_F1[pr] || 0;
    if (i < 3 && pr < 3) pt += GARA_BONUS_PODIO;
    if (i < 10 && pr < 10) pt += GARA_BONUS_PUNTI;

    if (pt) dettaglio.push({ pid, previsto: i, reale: pr, punti: pt });
    punti += pt;
    if (i === 0 && pr === 0) vincitoreOk = true;
  });

  return { punti, dettaglio, vincitoreOk };
}

/** Calcola i punti Sprint (posizione esatta + podio), sommati sugli 8 piloti pronosticati. */
function calcolaSprint(top8Pron, top8Reale) {
  const posReale = mappaPosizioni(top8Reale);
  let punti = 0;
  let vincitoreOk = false;
  const dettaglio = [];

  top8Pron.forEach((pid, i) => {
    if (!pid) return;
    const pr = Object.prototype.hasOwnProperty.call(posReale, pid) ? posReale[pid] : null;
    if (pr == null) return;

    let pt = 0;
    if (i === pr) pt += POSIZIONE_PUNTI_SPRINT[pr] || 0;
    if (i < 3 && pr < 3) pt += SPRINT_BONUS_PODIO;

    if (pt) dettaglio.push({ pid, previsto: i, reale: pr, punti: pt });
    punti += pt;
    if (i === 0 && pr === 0) vincitoreOk = true;
  });

  return { punti, dettaglio, vincitoreOk };
}

/** Calcola i punti dei 6 bonus di gara. */
function calcolaBonus(bonusPron, bonusReale) {
  let punti = 0, indovinati = 0;
  const dettaglio = {};

  ['giroVeloce', 'pitStopVeloce', 'gommaLunga', 'primoRitirato', 'maggiorGuadagno'].forEach(id => {
    const scelto = bonusPron?.[id];
    const reale = bonusReale?.[id];
    const ok = !!(scelto && reale && scelto === reale);
    dettaglio[id] = { scelto: scelto ?? null, reale: reale ?? null, punti: ok ? BONUS_PUNTI[id] : 0 };
    if (ok) { punti += BONUS_PUNTI[id]; indovinati++; }
  });

  // Safety car: numero intero esatto, nessun punteggio parziale
  const scNum = bonusPron?.safetyCar;
  const scReale = bonusReale?.safetyCar;
  let scPunti = 0;
  if (scNum != null && scReale != null && scNum !== '' && scReale !== '') {
    if (Number(scNum) === Number(scReale)) scPunti = BONUS_PUNTI.safetyCar.esatto;
  }
  dettaglio.safetyCar = { scelto: scNum ?? null, reale: scReale ?? null, punti: scPunti };
  if (scPunti) indovinati++;
  punti += scPunti;

  return { punti, indovinati, dettaglio };
}

/**
 * Calcola il punteggio completo di un pronostico.
 * @param {Object} pron       documento pronostici/{uid}
 * @param {Object} risultati  documento risultati/ufficiali
 * @returns {{ totale:number, breakdown:Object, spareggio:Array }}
 */
export function calcolaPunteggio(pron, risultati) {
  const grigliaPron  = normalizzaOrdine(pron?.qualifica?.griglia);
  const grigliaReale = normalizzaOrdine(risultati?.qualifica?.griglia);
  const arrivoPron   = normalizzaOrdine(pron?.gara?.arrivo);
  const arrivoReale  = normalizzaOrdine(risultati?.gara?.arrivo);
  const bonusPron    = pron?.gara?.bonus || {};
  const bonusReale   = risultati?.gara?.bonus || {};

  const quali = calcolaQualifica(grigliaPron, grigliaReale);
  const gara  = calcolaGara(arrivoPron, arrivoReale);
  const bonus = calcolaBonus(bonusPron, bonusReale);

  let totale = quali.punti + gara.punti + bonus.punti;

  const breakdown = {
    qualifica: quali.punti,
    gara: gara.punti,
    bonus: bonus.punti,
    dettaglioQualifica: quali.dettaglio,
    dettaglioGara: gara.dettaglio,
    dettaglioBonus: bonus.dettaglio,
  };

  // Sprint: solo per i weekend che la prevedono. Fuori da quei weekend
  // breakdown.sprint resta undefined — i chiamanti lo trattano come 0 (|| 0).
  if (haSprint()) {
    const top8Pron  = normalizzaOrdine(pron?.sprint?.top8, N_SPRINT);
    const top8Reale = normalizzaOrdine(risultati?.sprint?.top8, N_SPRINT);
    const sprint = calcolaSprint(top8Pron, top8Reale);
    breakdown.sprint = sprint.punti;
    breakdown.dettaglioSprint = sprint.dettaglio;
    totale += sprint.punti;
  }

  const poleOk = grigliaPron[0] && grigliaReale[0] && grigliaPron[0] === grigliaReale[0];

  // Spareggio: (1) vincitore gara, (2) pole, (3) bonus indovinati
  const spareggio = [gara.vincitoreOk ? 1 : 0, poleOk ? 1 : 0, bonus.indovinati];

  return { totale, breakdown, spareggio };
}