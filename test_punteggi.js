/**
 * FORMULITO — test_punteggi.js
 * Script standalone (Node, nessuna dipendenza) che verifica la formula di
 * punteggio di functions/punteggi.js con un pronostico e un risultato
 * fittizi di 22 piloti, calcolando a mano il punteggio atteso e
 * confrontandolo con quello prodotto dalla funzione.
 *
 * Uso: node test_punteggi.js   (dalla cartella FORMULITO)
 */
'use strict';

const path = require('path');
const { calcolaPunteggio } = require(path.join(__dirname, 'functions', 'punteggi.js'));

const P = Array.from({ length: 22 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
// P[0]=p01 ... P[21]=p22

// ── QUALIFICHE ──────────────────────────────────────────
// Pronostico: ordine identico p01..p22.
const grigliaPron = [...P];
// Reale: swap p01/p02 (scarto 1 su entrambi), swap p05/p07 (scarto 2 -> 0pt),
// tutto il resto identico (posizione esatta, non pole -> 3pt ciascuno).
const grigliaReale = [...P];
[grigliaReale[0], grigliaReale[1]] = [grigliaReale[1], grigliaReale[0]]; // p02,p01,...
[grigliaReale[4], grigliaReale[6]] = [grigliaReale[6], grigliaReale[4]]; // scambia posizioni 4 e 6

// ── GARA ────────────────────────────────────────────────
// Pronostico: ordine identico p01..p22 (p01 vincitore).
const arrivoPron = [...P];
// Reale: swap p01/p03 (posizioni 0/2), swap p10/p11 (posizioni 9/10), resto identico.
const arrivoReale = [...P];
[arrivoReale[0], arrivoReale[2]] = [arrivoReale[2], arrivoReale[0]]; // p03,p02,p01,...
[arrivoReale[9], arrivoReale[10]] = [arrivoReale[10], arrivoReale[9]]; // scambia P10/P11

const bonusPron = {
  giroVeloce: 'p05', pitStopVeloce: 'p06', gommaLunga: 'p07',
  primoRitirato: 'p20', maggiorGuadagno: 'p10', safetyCar: 2,
};
const bonusReale = {
  giroVeloce: 'p05',       // esatto        -> +8
  pitStopVeloce: 'p09',    // sbagliato      -> 0
  gommaLunga: 'p07',       // esatto        -> +8
  primoRitirato: 'p20',    // esatto        -> +8
  maggiorGuadagno: 'p12',  // sbagliato      -> 0
  safetyCar: 3,            // scarto di 1    -> +4
};

const pron = { qualifica: { griglia: grigliaPron }, gara: { arrivo: arrivoPron, bonus: bonusPron } };
const risultati = { qualifica: { griglia: grigliaReale }, gara: { arrivo: arrivoReale, bonus: bonusReale } };

// ── CALCOLO ATTESO A MANO ────────────────────────────────
// Qualifiche: p01 scarto1=1, p02 scarto1=1, p03 esatto=3, p04 esatto=3,
// p05 scarto2=0, p06 esatto=3, p07 scarto2=0, p08..p22 (15 piloti) esatti=3 l'uno.
const qualiAtteso = 1 + 1 + 3 + 3 + 0 + 3 + 0 + 15 * 3; // = 56

// Gara (per pilota: [posizione esatta pt] + [podio +3] + [punti +1]):
//   p01: pred0 real2 -> 0 + podio(0<3,2<3)+3 + punti(+1)          =  4
//   p02: pred1 real1 -> P2=18 + podio+3 + punti+1                 = 22
//   p03: pred2 real0 -> 0 + podio+3 + punti+1                     =  4
//   p04: pred3 real3 -> P4=12 + (no podio) + punti+1              = 13
//   p05: pred4 real4 -> P5=10 + punti+1                           = 11
//   p06: pred5 real5 -> P6=8  + punti+1                           =  9
//   p07: pred6 real6 -> P7=6  + punti+1                           =  7
//   p08: pred7 real7 -> P8=4  + punti+1                           =  5
//   p09: pred8 real8 -> P9=2  + punti+1                           =  3
//   p10: pred9 real10 -> 0 (posizione errata, punti solo se ENTRAMBE <10) = 0
//   p11: pred10 real9 -> 0 (pred non <10)                         =  0
//   p12..p22: posizione esatta ma oltre P10 -> 0 punti F1, niente bonus = 0
const garaAtteso = 4 + 22 + 4 + 13 + 11 + 9 + 7 + 5 + 3 + 0 + 0; // = 78

// Bonus: giroVeloce+8, pitStopVeloce+0, gommaLunga+8, primoRitirato+8,
// maggiorGuadagno+0, safetyCar scarto1 +4 -> totale 28, indovinati=4
const bonusAtteso = 8 + 0 + 8 + 8 + 0 + 4; // = 28
const indovinatiAttesi = 4;

const totaleAtteso = qualiAtteso + garaAtteso + bonusAtteso; // = 162
const poleOkAtteso = false;      // pron pole = p01, reale pole = p02
const vincitoreOkAtteso = false; // pron vincitore = p01, reale vincitore = p03
const spareggioAtteso = [vincitoreOkAtteso ? 1 : 0, poleOkAtteso ? 1 : 0, indovinatiAttesi];

// ── ESECUZIONE ────────────────────────────────────────────
const risultato = calcolaPunteggio(pron, risultati);

console.log('── FORMULITO — test_punteggi.js ──');
console.log('Atteso  : totale=%d  breakdown=%j  spareggio=%j',
  totaleAtteso, { qualifica: qualiAtteso, gara: garaAtteso, bonus: bonusAtteso }, spareggioAtteso);
console.log('Ottenuto: totale=%d  breakdown=%j  spareggio=%j',
  risultato.totale, risultato.breakdown, risultato.spareggio);

let ok = true;
function check(label, atteso, reale) {
  const pass = JSON.stringify(atteso) === JSON.stringify(reale);
  if (!pass) ok = false;
  console.log(`  [${pass ? 'OK' : 'FAIL'}] ${label}: atteso=${JSON.stringify(atteso)} ottenuto=${JSON.stringify(reale)}`);
}

check('totale', totaleAtteso, risultato.totale);
check('breakdown.qualifica', qualiAtteso, risultato.breakdown.qualifica);
check('breakdown.gara', garaAtteso, risultato.breakdown.gara);
check('breakdown.bonus', bonusAtteso, risultato.breakdown.bonus);
check('spareggio', spareggioAtteso, risultato.spareggio);

console.log(ok ? '\n✅ TUTTI I CONTROLLI SUPERATI' : '\n❌ ALCUNI CONTROLLI FALLITI');
process.exit(ok ? 0 : 1);
