/**
 * FORMULITO — db.js
 * Astrazione Firestore: tutte le operazioni di lettura/scrittura
 * passano da qui, così il resto del codice non tocca mai Firestore direttamente.
 */

import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, deleteField,
  collection, getDocs, query, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import { competizioneAttuale } from './competizioni.js';

const db = () => window._firebase.db;

// Tutti i dati specifici di una gara (pronostici, risultati, classifica,
// sistema) vivono sotto competizioni/{id}/..., così più competizioni
// convivono nella stessa app/stesso login senza mescolare i dati.
// I partecipanti restano invece globali (vedi sezione PARTECIPANTI sotto).
const compDoc = (col, id) => doc(db(), 'competizioni', competizioneAttuale(), col, id);
const compCol = (col) => collection(db(), 'competizioni', competizioneAttuale(), col);

// ── PRONOSTICI ────────────────────────────────────────

/**
 * Carica i pronostici di un partecipante (nella competizione attuale).
 * @param {string} uid
 * @returns {Object|null}
 */
export async function getPronostici(uid) {
  const snap = await getDoc(compDoc('pronostici', uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Carica i pronostici di TUTTI i partecipanti (per il ricalcolo classifica),
 * nella competizione attuale.
 * @returns {Array} [{ id, ...dati }]
 */
export async function getTuttiPronostici() {
  const snap = await getDocs(compCol('pronostici'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Salva (sovrascrive) i pronostici di un partecipante nella competizione attuale.
 * @param {string} uid
 * @param {Object} dati
 */
export async function savePronostici(uid, dati) {
  await setDoc(compDoc('pronostici', uid), {
    ...dati,
    updatedAt: serverTimestamp(),
  });
}

// ── RISULTATI ─────────────────────────────────────────

/**
 * Carica i risultati ufficiali (documento singleton) della competizione attuale.
 * @returns {Object}
 */
export async function getRisultati() {
  const snap = await getDoc(compDoc('risultati', 'ufficiali'));
  return snap.exists() ? snap.data() : {};
}

/**
 * Ascolta i risultati in real-time (competizione attuale).
 * @param {Function} callback  fn(risultati)
 * @returns unsubscribe function
 */
export function onRisultatiSnapshot(callback) {
  return onSnapshot(compDoc('risultati', 'ufficiali'), (snap) => {
    callback(snap.exists() ? snap.data() : {});
  });
}

/**
 * Aggiorna parzialmente i risultati (solo admin), competizione attuale.
 * @param {Object} patch  Oggetto con i campi da aggiornare (dot-notation Firestore)
 */
export async function patchRisultati(patch) {
  await updateDoc(compDoc('risultati', 'ufficiali'), patch);
}

/**
 * Scrive i risultati ufficiali in modalità merge (crea il documento se non esiste).
 * Più sicuro di patchRisultati quando il documento potrebbe non esistere ancora.
 * @param {Object} dati
 */
export async function setRisultati(dati) {
  await setDoc(compDoc('risultati', 'ufficiali'), {
    ...dati,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/**
 * Rimuove un singolo match dal bracket dei risultati ufficiali.
 * Necessario perché il merge NON cancella i campi: per togliere un override
 * (e farlo tornare gestibile dall'API) serve una delete esplicita del path.
 * @param {string} roundId  es. 'R128'
 * @param {string} mid      es. 'R128_32'
 */
export async function deleteRisultatoMatch(roundId, mid) {
  await updateDoc(compDoc('risultati', 'ufficiali'), {
    [`bracket.${roundId}.${mid}`]: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

// ── CLASSIFICA ────────────────────────────────────────

/**
 * Carica la classifica pre-calcolata (documento singleton, aggiornato dalla
 * Cloud Function) della competizione attuale.
 * @returns {Array} Array di { uid, nome, totale, breakdown, spareggio }
 */
export async function getClassifica() {
  const snap = await getDoc(compDoc('classifica', 'snapshot'));
  return snap.exists() ? (snap.data().partecipanti || []) : [];
}

/**
 * Ascolta la classifica in real-time (competizione attuale).
 * @param {Function} callback  fn(array)
 * @returns unsubscribe function
 */
export function onClassificaSnapshot(callback) {
  return onSnapshot(compDoc('classifica', 'snapshot'), (snap) => {
    callback(snap.exists() ? (snap.data().partecipanti || []) : []);
  });
}

/**
 * Salva (sovrascrive) la classifica pre-calcolata. Usato dal ricalcolo manuale admin.
 * @param {Array} partecipanti  [{ id, nome, totale, breakdown, spareggio }]
 */
export async function saveClassifica(partecipanti) {
  await setDoc(compDoc('classifica', 'snapshot'), {
    partecipanti,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Salva il timestamp dell'ultimo aggiornamento classifica (scritto dalla Cloud Function).
 */
export async function getClassificaUpdatedAt() {
  const snap = await getDoc(compDoc('classifica', 'snapshot'));
  if (!snap.exists()) return null;
  const ts = snap.data().updatedAt;
  return ts ? ts.toDate() : null;
}

// ── PARTECIPANTI ──────────────────────────────────────

/**
 * Carica tutti i partecipanti.
 * @returns {Array} [{ id, nome, isAdmin }]
 */
export async function getPartecipanti() {
  const snap = await getDocs(collection(db(), 'partecipanti'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Aggiorna i dati di un partecipante (solo admin).
 */
export async function updatePartecipante(uid, patch) {
  await updateDoc(doc(db(), 'partecipanti', uid), patch);
}

/**
 * Salva lo stato di pagamento di un partecipante (solo admin).
 * Scrive l'intero oggetto `pagamento` nel documento del partecipante.
 * @param {string} uid
 * @param {Object|null} pagamento  { pagato, importo, incassatoDa, metodo, data }
 */
export async function setPagamento(uid, pagamento) {
  await updateDoc(doc(db(), 'partecipanti', uid), { pagamento: pagamento || null });
}

// ── SISTEMA ───────────────────────────────────────────
// (pronostici aperti/chiusi, montepremi: tutto per-competizione)

/**
 * Legge la configurazione di sistema (es. pronostici aperti/chiusi, montepremi)
 * della competizione attuale.
 */
export async function getSistema() {
  const snap = await getDoc(compDoc('sistema', 'config'));
  return snap.exists() ? snap.data() : {};
}

/**
 * Aggiorna la configurazione di sistema (solo admin), competizione attuale.
 */
export async function updateSistema(patch) {
  await setDoc(compDoc('sistema', 'config'), patch, { merge: true });
}

/**
 * Ascolta la configurazione di sistema in real-time (competizione attuale).
 */
export function onSistemaSnapshot(callback) {
  return onSnapshot(compDoc('sistema', 'config'), (snap) => {
    callback(snap.exists() ? snap.data() : {});
  });
}

