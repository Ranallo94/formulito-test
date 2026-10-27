/**
 * FORMULITO — competizioni.js
 * Registro delle competizioni disponibili nella stessa app (stesso login,
 * stessi partecipanti) e stato della competizione attualmente selezionata.
 *
 * Ogni competizione ha il proprio spazio dati in Firestore, sotto
 * competizioni/{id}/... (pronostici, risultati, classifica, sistema),
 * completamente separato dalle altre (classifiche NON cumulative). I
 * partecipanti restano invece globali (partecipanti/{uid}): chi è già
 * approvato per una competizione lo è automaticamente per tutte.
 *
 * Il flag `sprint: true` segnala i weekend con gara Sprint (vedi
 * pronostici.js / live.js / admin.js / profilo.js / punteggi.js): in quel
 * caso compare una terza scheda (solo primi 8 all'arrivo). Tutti i moduli
 * che hanno bisogno di saperlo leggono haSprint(), senza duplicare il check.
 *
 * Modulo volutamente senza dipendenze (nessun import), così può essere
 * importato sia da db.js/evento.js/punteggi.js sia da app.js senza rischio
 * di cicli.
 */

export const COMPETIZIONI = [
  {
    id: 'monza',
    nome: 'GP Italia',
    nomeEsteso: "GP d'Italia 2026 · Monza",
    dbFile: './f1_db.json',
    ordine: 1,
  },
  {
    id: 'madrid',
    nome: 'GP Madrid',
    nomeEsteso: 'GP di Madrid 2026 · Circuito de Madrid (IFEMA)',
    dbFile: './f1_db_madrid.json',
    ordine: 2,
  },
  {
    id: 'baku',
    nome: 'GP Azerbaigian',
    nomeEsteso: "GP dell'Azerbaigian 2026 · Baku City Circuit",
    dbFile: './f1_db_baku.json',
    ordine: 3,
  },
  {
    id: 'bahrain',
    nome: 'GP Bahrain',
    nomeEsteso: 'GP del Bahrain 2026 · Sepang International Circuit (Malesia)',
    dbFile: './f1_db_bahrain.json',
    ordine: 4,
  },
  {
    id: 'singapore',
    nome: 'GP Singapore',
    nomeEsteso: 'GP di Singapore 2026 · Marina Bay Street Circuit',
    dbFile: './f1_db_singapore.json',
    ordine: 5,
    sprint: true, // weekend con Sprint: terza scheda (solo top 8), vedi punteggi.js
  },
  {
    id: 'austin',
    nome: 'GP USA',
    nomeEsteso: 'GP degli Stati Uniti 2026 · Circuit of the Americas (Austin)',
    dbFile: './f1_db_austin.json',
    ordine: 6,
  },
  {
    id: 'messico',
    nome: 'GP Messico',
    nomeEsteso: 'GP del Messico 2026 · Autódromo Hermanos Rodríguez · Edizione speciale Kimi Antonelli',
    dbFile: './f1_db_messico.json',
    ordine: 7,
    // Edizione speciale: tema grafico (css: html[data-tema="..."]) + etichetta + banner.
    // Cambia SOLO l'aspetto: regole e punteggi restano quelli di sempre.
    tema: 'kimi',
    edizione: 'Kimi Edition',
    edizioneTitolo: 'Edizione speciale · Andrea Kimi Antonelli',
    edizioneNumero: '12',
    edizioneDesc: 'edizione speciale dedicata ad Andrea Kimi Antonelli (Mercedes, #12). Regole e punteggi sono quelli di sempre: cambiano solo i colori e il banner. In più si può sbloccare il badge «Kimi Fan» indovinando la posizione esatta di Antonelli all\'arrivo.',
  },
];

/** Dati dell'edizione speciale della competizione `id` (o null se è un GP normale). */
export function edizioneSpeciale(id) {
  const c = getCompetizione(id);
  return c.tema ? c : null;
}

const STORAGE_KEY = 'formulito_competizione';

let _attuale = null;

/** Elenco competizioni, ordinato. */
export function getCompetizioni() {
  return [...COMPETIZIONI].sort((a, b) => a.ordine - b.ordine);
}

/** Metadati di una competizione (o quella di default se l'id non esiste). */
export function getCompetizione(id) {
  return COMPETIZIONI.find(c => c.id === id) || getCompetizioni()[0];
}

/** Id della competizione attualmente selezionata (persistita in localStorage). */
export function competizioneAttuale() {
  if (_attuale) return _attuale;
  let salvata = null;
  try { salvata = localStorage.getItem(STORAGE_KEY); } catch (_) { /* privato/incognito */ }
  // Default per chi non ha ancora scelto: la competizione più recente (ordine più alto)
  const elenco = getCompetizioni();
  _attuale = COMPETIZIONI.some(c => c.id === salvata) ? salvata : elenco[elenco.length - 1].id;
  return _attuale;
}

/** Cambia la competizione attiva. Ritorna true se è cambiata davvero. */
export function setCompetizioneAttuale(id) {
  if (!COMPETIZIONI.some(c => c.id === id)) return false;
  const cambiata = id !== competizioneAttuale();
  _attuale = id;
  try { localStorage.setItem(STORAGE_KEY, id); } catch (_) { /* privato/incognito */ }
  return cambiata;
}

/** true se la competizione indicata (default: quella attuale) prevede la Sprint. */
export function haSprint(id = competizioneAttuale()) {
  return getCompetizione(id).sprint === true;
}