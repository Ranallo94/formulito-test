/**
 * FORMULITO — evento.js
 * Caricamento (con cache) del DB locale dell'evento (f1_db.json / f1_db_madrid.json):
 * anagrafica piloti, orari delle due sessioni (Qualifiche/Gara) e categorie
 * bonus gara. Tutti i moduli che hanno bisogno dei dati di gara passano da qui.
 *
 * Ogni competizione ha il proprio file JSON (vedi js/competizioni.js): la
 * cache è quindi tenuta per id-competizione, così cambiare competizione non
 * richiede un nuovo fetch se il file era già stato caricato in precedenza.
 */

import { competizioneAttuale, getCompetizione } from './competizioni.js';

let _cache = {};    // { [compId]: dbJson }
let _inflight = {}; // { [compId]: Promise }

/**
 * Carica il DB della competizione attuale una sola volta e lo cachea.
 * @returns {Promise<Object>}
 */
export async function caricaEvento() {
  const compId = competizioneAttuale();
  if (_cache[compId]) return _cache[compId];
  if (_inflight[compId]) return _inflight[compId];

  const file = getCompetizione(compId).dbFile;
  _inflight[compId] = fetch(file, { cache: 'no-cache' })
    .then(r => {
      if (!r.ok) throw new Error(`Impossibile caricare ${file} (${r.status})`);
      return r.json();
    })
    .then(j => { _cache[compId] = j; delete _inflight[compId]; return j; })
    .catch(err => { delete _inflight[compId]; throw err; });
  return _inflight[compId];
}

/** DB già caricato per la competizione attuale (o null). Accesso sincrono dopo caricaEvento(). */
export function eventoDb() {
  return _cache[competizioneAttuale()] || null;
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

/**
 * Piloti raggruppati per scuderia: [{ team, pids:[...] }], scuderie in ordine
 * alfabetico e piloti in ordine alfabetico di cognome (così si trova a colpo
 * d'occhio sia la squadra sia il pilota).
 */
export function pilotiPerScuderia(db) {
  const gruppi = {};
  Object.keys(db?.piloti || {}).forEach(pid => {
    const team = db.piloti[pid].team || 'Altri';
    (gruppi[team] = gruppi[team] || []).push(pid);
  });
  return Object.keys(gruppi)
    .sort((a, b) => a.localeCompare(b, 'it'))
    .map(team => ({
      team,
      pids: gruppi[team].sort((a, b) =>
        (db.piloti[a].cognome || '').localeCompare(db.piloti[b].cognome || '', 'it')),
    }));
}

/**
 * HTML delle <option> di un menu pilota, raggruppate per scuderia (<optgroup>).
 *
 * @param {Object} db
 * @param {Object} [opz]
 * @param {string} [opz.selPid]      pilota selezionato
 * @param {string} [opz.vuoto]       testo della prima opzione vuota (default "— scegli —")
 * @param {(pid:string)=>(string|null)} [opz.nota]  testo da aggiungere al pilota nel menu aperto
 *        (es. "P7 ↔ scambia" per chi è già in un'altra posizione); l'opzione resta selezionabile.
 *
 * Ogni <option> porta data-full (testo nel menu aperto) e data-short (solo il
 * nome, mostrato a menu chiuso): vedi _espandiOpzioni/_accorciaSelectChiuso.
 */
export function opzioniPilotiHtml(db, { selPid = '', vuoto = '— scegli —', nota = null } = {}) {
  let out = `<option value="">${vuoto}</option>`;
  pilotiPerScuderia(db).forEach(g => {
    out += `<optgroup label="${g.team}">`;
    g.pids.forEach(pid => {
      const nome = nomePilota(db, pid);
      const n = nota ? nota(pid) : null;
      const full = n ? `${nome} · ${n}` : nome;
      out += `<option value="${pid}"${selPid === pid ? ' selected' : ''} data-full="${full}" data-short="${nome}">${full}</option>`;
    });
    out += '</optgroup>';
  });
  return out;
}

/** Elenco ordinato (per nome) di tutti gli id pilota del DB. */
export function elencoPiloti(db) {
  const ids = Object.keys(db?.piloti || {});
  ids.sort((a, b) => nomePilota(db, a).localeCompare(nomePilota(db, b), 'it'));
  return ids;
}
