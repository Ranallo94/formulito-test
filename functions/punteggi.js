/**
 * FORMULITO — functions/punteggi.js  (CommonJS, usato dalle Cloud Functions)
 * Porting fedele di js/punteggi.js + js/griglia.js, adattato a CommonJS perché
 * le Cloud Functions non usano i moduli ES.
 *
 * Il pronostico è un ORDINAMENTO di tutti i 22 piloti per Qualifiche e Gara,
 * più 6 bonus di gara. Vedi js/punteggi.js per la spiegazione dettagliata
 * della formula (identica qui).
 */
'use strict';

const DB = require('./f1_db.json');
const N_PILOTI = 22;

// ── GRIGLIA HELPERS (porting da js/griglia.js) ────────────────────────
function normalizzaOrdine(arr) {
  const out = Array.isArray(arr) ? arr.slice(0, N_PILOTI) : [];
  while (out.length < N_PILOTI) out.push(null);
  return out.map((v) => v || null);
}

function mappaPosizioni(ordine) {
  const m = {};
  (ordine || []).forEach((pid, i) => { if (pid) m[pid] = i; });
  return m;
}

// ── PUNTEGGI (porting da js/punteggi.js) ──────────────────────────────
const QUALI_POLE_PUNTI = 10;
const QUALI_ALTRA_PUNTI = 3;
const QUALI_VICINO_PUNTI = 1;

const POSIZIONE_PUNTI_F1 = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const GARA_BONUS_PODIO = 3;
const GARA_BONUS_PUNTI = 1;

const BONUS_PUNTI = {
  giroVeloce: 8,
  pitStopVeloce: 8,
  gommaLunga: 8,
  primoRitirato: 8,
  maggiorGuadagno: 8,
  safetyCar: { esatto: 8, vicino: 4 },
};

function puntiQualiPosizione(posPrevista, posReale) {
  if (posReale == null) return 0;
  if (posPrevista === posReale) return posPrevista === 0 ? QUALI_POLE_PUNTI : QUALI_ALTRA_PUNTI;
  if (Math.abs(posPrevista - posReale) === 1) return QUALI_VICINO_PUNTI;
  return 0;
}

function calcolaQualifica(grigliaPron, grigliaReale) {
  const posReale = mappaPosizioni(grigliaReale);
  let punti = 0;
  grigliaPron.forEach((pid, i) => {
    if (!pid) return;
    const pr = Object.prototype.hasOwnProperty.call(posReale, pid) ? posReale[pid] : null;
    punti += puntiQualiPosizione(i, pr);
  });
  return { punti };
}

function calcolaGara(arrivoPron, arrivoReale) {
  const posReale = mappaPosizioni(arrivoReale);
  let punti = 0;
  let vincitoreOk = false;

  arrivoPron.forEach((pid, i) => {
    if (!pid) return;
    const pr = Object.prototype.hasOwnProperty.call(posReale, pid) ? posReale[pid] : null;
    if (pr == null) return;

    let pt = 0;
    if (i === pr) pt += POSIZIONE_PUNTI_F1[pr] || 0;
    if (i < 3 && pr < 3) pt += GARA_BONUS_PODIO;
    if (i < 10 && pr < 10) pt += GARA_BONUS_PUNTI;

    punti += pt;
    if (i === 0 && pr === 0) vincitoreOk = true;
  });

  return { punti, vincitoreOk };
}

function calcolaBonus(bonusPron, bonusReale) {
  let punti = 0, indovinati = 0;

  ['giroVeloce', 'pitStopVeloce', 'gommaLunga', 'primoRitirato', 'maggiorGuadagno'].forEach((id) => {
    const scelto = bonusPron && bonusPron[id];
    const reale = bonusReale && bonusReale[id];
    if (scelto && reale && scelto === reale) {
      punti += BONUS_PUNTI[id];
      indovinati++;
    }
  });

  const scNum = bonusPron && bonusPron.safetyCar;
  const scReale = bonusReale && bonusReale.safetyCar;
  if (scNum != null && scReale != null && scNum !== '' && scReale !== '') {
    const scarto = Math.abs(Number(scNum) - Number(scReale));
    if (scarto === 0) { punti += BONUS_PUNTI.safetyCar.esatto; indovinati++; }
    else if (scarto === 1) { punti += BONUS_PUNTI.safetyCar.vicino; indovinati++; }
  }

  return { punti, indovinati };
}

/**
 * Calcola il punteggio completo di un pronostico.
 * @param {Object} pron       documento pronostici/{uid}
 * @param {Object} risultati  documento risultati/ufficiali
 */
function calcolaPunteggio(pron, risultati) {
  const grigliaPron  = normalizzaOrdine(pron && pron.qualifica && pron.qualifica.griglia);
  const grigliaReale = normalizzaOrdine(risultati && risultati.qualifica && risultati.qualifica.griglia);
  const arrivoPron   = normalizzaOrdine(pron && pron.gara && pron.gara.arrivo);
  const arrivoReale  = normalizzaOrdine(risultati && risultati.gara && risultati.gara.arrivo);
  const bonusPron    = (pron && pron.gara && pron.gara.bonus) || {};
  const bonusReale   = (risultati && risultati.gara && risultati.gara.bonus) || {};

  const quali = calcolaQualifica(grigliaPron, grigliaReale);
  const gara  = calcolaGara(arrivoPron, arrivoReale);
  const bonus = calcolaBonus(bonusPron, bonusReale);

  const totale = quali.punti + gara.punti + bonus.punti;
  const poleOk = grigliaPron[0] && grigliaReale[0] && grigliaPron[0] === grigliaReale[0];

  const breakdown = { qualifica: quali.punti, gara: gara.punti, bonus: bonus.punti };
  const spareggio = [gara.vincitoreOk ? 1 : 0, poleOk ? 1 : 0, bonus.indovinati];

  return { totale, breakdown, spareggio };
}

module.exports = {
  DB,
  calcolaPunteggio,
};
