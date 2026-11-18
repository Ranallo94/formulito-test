/**
 * FORMULITO — griglia-grafica.js
 * Modalità GRAFICA (beta) per inserire un ordinamento di piloti, alternativa ai 22 menu a tendina.
 *
 *   • a sinistra le posizioni (P1…Pn), a destra tutti i piloti raggruppati per scuderia, con il colore del team;
 *   • TOCCA un pilota → va nella prossima posizione libera (bastano 22 tocchi, in ordine);
 *   • tocca una posizione vuota per scegliere dove metterlo; tocca un pilota già messo per "sollevarlo",
 *     poi tocca un'altra posizione: i due si scambiano (o il pilota si sposta, se la posizione è libera);
 *   • tocca un pilota a destra mentre ne hai uno sollevato: prende il suo posto;
 *   • ✕ toglie il pilota dalla posizione; sul computer funziona anche il trascinamento.
 *
 * Il modulo non conosce Firebase né il resto della pagina: lavora sull'array di pid che gli passa
 * pronostici.js (`leggi`/`scrivi`) con le stesse regole di scambio delle liste (scambiaInPosizione).
 */

import { pilotiPerScuderia } from './evento.js';
import { scambiaInPosizione, ordineCompilate } from './griglia.js';

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * @param {HTMLElement} box
 * @param {Object}   opz
 * @param {Object}   opz.db                DB evento (piloti)
 * @param {()=>Array} opz.leggi            ordinamento attuale (array di pid / null)
 * @param {(arr:Array)=>void} opz.scrivi   salva il nuovo ordinamento
 * @param {()=>boolean} [opz.bloccato]     true = sola lettura (pronostici chiusi)
 * @param {(i:number)=>string} [opz.etichetta]  testo della posizione i (default "P1")
 * @param {string}   [opz.suggerimento]
 * @returns {{ridisegna:()=>void}}
 */
export function montaGrigliaGrafica(box, opz) {
  const { db, leggi, scrivi } = opz;
  const bloccato = opz.bloccato || (() => false);
  const etichetta = opz.etichetta || ((i) => 'P' + (i + 1));
  // un solo set di ascoltatori per contenitore: se il modulo viene montato di nuovo sullo stesso box, i vecchi si tolgono
  if (box._ggAbort) box._ggAbort.abort();
  const ac = new AbortController(); box._ggAbort = ac;
  const L = { signal: ac.signal };
  let cursore = null;       // posizione dove andrà il prossimo pilota toccato (null = prima libera)
  let sel = null;           // posizione del pilota "sollevato" da spostare
  let messaggio = '';

  const primoVuoto = (campo, da = 0) => {
    for (let k = 0; k < campo.length; k++) { const i = (da + k) % campo.length; if (!campo[i]) return i; }
    return null;
  };
  const colore = (pid) => { const c = db.piloti?.[pid]?.colore; return HEX.test(c) ? c : '#888888'; };
  const cognome = (pid) => db.piloti?.[pid]?.cognome || pid;
  const team = (pid) => db.piloti?.[pid]?.team || '';

  function chip(pid, { pool = false, posto = null } = {}) {
    const placed = pool && posto != null;
    return `<button type="button" class="gg-chip${placed ? ' placed' : ''}" data-pid="${esc(pid)}"${pool ? ' data-pool="1"' : ''} draggable="true" style="--tc:${colore(pid)}">
      <span class="gg-nm">${esc(cognome(pid))}</span><small class="gg-tm">${esc(team(pid))}</small>${placed ? `<em class="gg-pos">P${posto + 1}</em>` : ''}</button>`;
  }

  function disegna() {
    const campo = leggi();
    const n = campo.length, fatti = ordineCompilate(campo);
    const dove = new Map(); campo.forEach((pid, i) => { if (pid) dove.set(pid, i); });
    const dest = sel == null ? (cursore ?? primoVuoto(campo)) : null;

    const slots = campo.map((pid, i) => {
      const cls = ['gg-slot', pid ? 'pieno' : 'vuoto', i === 0 ? 'top' : '', i === sel ? 'sel' : '', i === dest && !pid ? 'cursore' : '', i === dest && pid ? 'cursore' : ''].filter(Boolean).join(' ');
      return `<li class="${cls}" data-i="${i}"><span class="gg-n">${esc(etichetta(i))}</span>${pid ? chip(pid) + '<button type="button" class="gg-x" aria-label="Togli">✕</button>' : '<span class="gg-ph">scegli un pilota →</span>'}</li>`;
    }).join('');

    const pool = pilotiPerScuderia(db).map(g =>
      `<div class="gg-team">${g.pids.map(pid => chip(pid, { pool: true, posto: dove.has(pid) ? dove.get(pid) : null })).join('')}</div>`).join('');

    const guida = messaggio
      || (sel != null ? `Hai sollevato <b>${esc(cognome(campo[sel]))}</b>: tocca un'altra posizione per scambiarli, o un pilota a destra per sostituirlo.`
        : fatti >= n ? 'Scheda completa. Tocca una posizione e poi un pilota per cambiarla.'
          : (opz.suggerimento || 'Tocca i piloti a destra, uno dopo l\'altro: vanno nella prossima posizione libera.'));

    box.classList.toggle('gg-bloccato', bloccato());
    box.innerHTML = `<div class="gg">
      <div class="gg-bar"><span class="gg-count"><b>${fatti}</b>/${n}</span><span class="gg-hint">${guida}</span>
        <button type="button" class="gg-clear"${fatti ? '' : ' disabled'}>🗑 Svuota</button></div>
      <div class="gg-cols"><ol class="gg-slots">${slots}</ol><div class="gg-pool">${pool}</div></div></div>`;
    messaggio = '';
  }

  /** Applica un nuovo ordinamento e ridisegna. */
  function applica(nuovo, nuovoCursore = null, porta = true) {
    scrivi(nuovo); sel = null; cursore = nuovoCursore; disegna();
    if (porta) { const c = box.querySelector('.gg-slot.cursore'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }

  box.addEventListener('click', (e) => {
    if (bloccato() || !box.contains(e.target)) return;
    const campo = leggi();
    const x = e.target.closest('.gg-x');
    if (x) { const i = +x.closest('.gg-slot').dataset.i; const n = campo.slice(); n[i] = null; applica(n, i, false); return; }
    if (e.target.closest('.gg-clear')) {
      if (ordineCompilate(campo) && !confirm('Svuotare tutta la scheda di questa sessione?')) return;
      applica(campo.map(() => null), 0, false); return;
    }
    const pool = e.target.closest('.gg-chip[data-pool]');
    if (pool) {
      const pid = pool.dataset.pid;
      let d = sel != null ? sel : (cursore ?? primoVuoto(campo));
      if (d == null) { messaggio = 'Scheda piena: tocca prima la posizione da cambiare.'; disegna(); return; }
      const nuovo = scambiaInPosizione(campo, d, pid);
      applica(nuovo, sel != null ? null : primoVuoto(nuovo, d + 1));
      return;
    }
    const slot = e.target.closest('.gg-slot');
    if (slot) {
      const i = +slot.dataset.i;
      if (sel != null) {
        if (sel === i) { sel = null; disegna(); return; }
        applica(scambiaInPosizione(campo, i, campo[sel]), null);
        return;
      }
      if (campo[i]) { sel = i; cursore = null; disegna(); } else { cursore = i; disegna(); }
    }
  }, L);

  // trascinamento (computer): da pilota a posizione, tra posizioni, o fuori dalla griglia per toglierlo
  box.addEventListener('dragstart', (e) => {
    const c = e.target.closest && e.target.closest('.gg-chip');
    if (!c || bloccato()) { e.preventDefault(); return; }
    const slot = c.closest('.gg-slot');
    e.dataTransfer.setData('text/plain', JSON.stringify({ pid: c.dataset.pid, da: slot ? +slot.dataset.i : -1 }));
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('dragging');
  }, L);
  box.addEventListener('dragend', () => box.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging')), L);
  box.addEventListener('dragover', (e) => { if (!bloccato() && e.target.closest && (e.target.closest('.gg-slot') || e.target.closest('.gg-pool'))) e.preventDefault(); }, L);
  box.addEventListener('drop', (e) => {
    if (bloccato()) return;
    let dato; try { dato = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (_) { return; }
    if (!dato || !dato.pid) return;
    e.preventDefault();
    const campo = leggi(), slot = e.target.closest('.gg-slot');
    if (slot) { applica(scambiaInPosizione(campo, +slot.dataset.i, dato.pid), null, false); return; }
    if (e.target.closest('.gg-pool') && dato.da >= 0) { const n = campo.slice(); n[dato.da] = null; applica(n, dato.da, false); }
  }, L);

  disegna();
  return { ridisegna: disegna, distruggi: () => { ac.abort(); box.innerHTML = ''; } };
}
