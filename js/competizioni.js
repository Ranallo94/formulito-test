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
 * Modulo volutamente senza dipendenze (nessun import), così può essere
 * importato sia da db.js/evento.js sia da app.js senza rischio di cicli.
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
];

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
  _attuale = COMPETIZIONI.some(c => c.id === salvata) ? salvata : getCompetizioni()[0].id;
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
