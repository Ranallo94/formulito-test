/**
 * FORMULITO — evento.js
 * Caricamento (con cache) del DB locale dell'evento (f1_db.json):
 * anagrafica piloti (22, 11 team), orari delle due sessioni (Qualifiche/Gara)
 * e categorie bonus gara. Tutti i moduli che hanno bisogno dei dati di gara
 * passano da qui.
 */

let _cache = null;
let _inflight = null;

/**
 * Carica il DB evento una sola volta e lo cachea.
 * @returns {Promise<Object>}
 */
export async function caricaEvento() {
  if (_cache) return _cache;
  if (_inflight) return _inflight;
  _inflight = fetch('./f1_db.json', { cache: 'no-cache' })
    .then(r => {
      if (!r.ok) throw new Error('Impossibile caricare f1_db.json (' + r.status + ')');
      return r.json();
    })
    .then(j => { _cache = j; _inflight = null; return j; })
    .catch(err => { _inflight = null; throw err; });
  return _inflight;
}

/** DB già caricato (o null). Per accesso sincrono dopo caricaEvento(). */
export function eventoDb() {
  return _cache;
}

/** Nome leggibile di un pilota: "Nome Cognome" oppure l'id se non noto. */
export function nomePilota(db, pid) {
  if (!pid) return '?';
  const p = db?.piloti?.[pid];
  if (!p) return pid;
  return `${p.nome} ${p.cognome}`;
}

/** Solo il cognome (usato nelle liste compatte). */
export function cognomePilota(db, pid) {
  if (!pid) return '?';
  return db?.piloti?.[pid]?.cognome || pid;
}

/** Team di un pilota. */
export function teamPilota(db, pid) {
  return db?.piloti?.[pid]?.team || '';
}

/** Colore team (per badge/UI). */
export function colorePilota(db, pid) {
  return db?.piloti?.[pid]?.colore || '#888888';
}

/** Elenco ordinato (per nome) di tutti gli id pilota del DB. */
export function elencoPiloti(db) {
  const ids = Object.keys(db?.piloti || {});
  ids.sort((a, b) => nomePilota(db, a).localeCompare(nomePilota(db, b), 'it'));
  return ids;
}
