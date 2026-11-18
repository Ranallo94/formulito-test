/**
 * FORMULITO — griglia-grafica.js
 * Modalità GRAFICA (beta) per inserire un ordinamento di piloti, alternativa ai 22 menu a tendina.
 *
 *   • QUALIFICHE: le posizioni sono disposte su DUE COLONNE sfalsate, come i piloti sulla griglia di partenza
 *     (pole a sinistra, P2 a destra un po' più indietro, P3 a sinistra…);
 *   • GARA e Sprint (tipo 'arrivo'): in alto il PODIO (2º a sinistra, 1º al centro più in alto, 3º a destra),
 *     poi l'elenco dal 4º posto in giù, una posizione per riga;
 *   • sotto, il "paddock": i piloti ancora da piazzare. TOCCA un pilota e va nella prossima posizione libera;
 *   • TENENDO PREMUTO un pilota (o selezionandolo e trascinando) lo si solleva e lo si porta dove si vuole,
 *     come le icone sulla home del telefono: lasciato su un altro pilota i due si scambiano, su una posizione
 *     libera si sposta, sul paddock torna fuori dalla griglia;
 *   • toccando una posizione vuota si sceglie dove andrà il prossimo pilota; toccando un pilota già messo lo si
 *     seleziona e poi si tocca un'altra posizione per scambiare; ✕ lo toglie.
 *
 * Il trascinamento usa i Pointer Events (stesso codice per dito e mouse) e un "fantasma" che segue il dito;
 * quando la pagina è troppo lunga scorre da sola avvicinando il dito al bordo dello schermo.
 *
 * Il modulo non conosce Firebase né il resto della pagina: lavora sull'array di pid che gli passa
 * pronostici.js (`leggi`/`scrivi`) con le stesse regole di scambio delle liste (scambiaInPosizione).
 */

import { pilotiPerScuderia } from './evento.js';
import { scambiaInPosizione, ordineCompilate } from './griglia.js';

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HEX = /^#[0-9a-f]{6}$/i;
const PRESSIONE_MS = 260;     // tenere premuto per sollevare un pilota (dito)
const SOGLIA_MOUSE = 5;       // pixel di spostamento prima di iniziare a trascinare (mouse)
const SOGLIA_SCORRI = 10;     // se il dito si muove prima della pressione lunga è uno scorrimento di pagina

/**
 * @param {HTMLElement} box
 * @param {Object}   opz
 * @param {Object}   opz.db                DB evento (piloti)
 * @param {()=>Array} opz.leggi            ordinamento attuale (array di pid / null)
 * @param {(arr:Array)=>void} opz.scrivi   salva il nuovo ordinamento
 * @param {()=>boolean} [opz.bloccato]     true = sola lettura (pronostici chiusi)
 * @param {(i:number)=>string} [opz.etichetta]  testo della posizione i (default "P1")
 * @param {'partenza'|'arrivo'} [opz.tipo] griglia di partenza o ordine d'arrivo (cambia solo l'aspetto)
 * @param {string}   [opz.suggerimento]
 * @returns {{ridisegna:()=>void, distruggi:()=>void}}
 */
export function montaGrigliaGrafica(box, opz) {
  const { db, leggi, scrivi } = opz;
  const bloccato = opz.bloccato || (() => false);
  const etichetta = opz.etichetta || ((i) => 'P' + (i + 1));
  const tipo = opz.tipo === 'arrivo' ? 'arrivo' : 'partenza';

  // un solo set di ascoltatori per contenitore: se il modulo viene montato di nuovo sullo stesso box, i vecchi si tolgono
  if (box._ggAbort) box._ggAbort.abort();
  const ac = new AbortController(); box._ggAbort = ac;
  const L = { signal: ac.signal };

  let cursore = null;       // posizione dove andrà il prossimo pilota toccato (null = prima libera)
  let sel = null;           // posizione del pilota selezionato (da scambiare o trascinare)
  let messaggio = '';
  let cand = null;          // pressione in corso, non ancora trasformata in trascinamento
  let drag = null;          // trascinamento in corso
  let soppresso = false;    // dopo un trascinamento il "click" che il browser genera va ignorato
  let paddockChiuso = false; // il paddock si può ripiegare per vedere tutta la griglia

  const primoVuoto = (campo, da = 0) => {
    for (let k = 0; k < campo.length; k++) { const i = (da + k) % campo.length; if (!campo[i]) return i; }
    return null;
  };
  const colore = (pid) => { const c = db.piloti?.[pid]?.colore; return HEX.test(c) ? c : '#888888'; };
  const cognome = (pid) => db.piloti?.[pid]?.cognome || pid;
  const team = (pid) => db.piloti?.[pid]?.team || '';
  const tuttiPid = () => pilotiPerScuderia(db).flatMap(g => g.pids);

  function chip(pid) {
    return `<button type="button" class="gg-chip" data-pid="${esc(pid)}" style="--tc:${colore(pid)}">
      <span class="gg-nm">${esc(cognome(pid))}</span><small class="gg-tm">${esc(team(pid))}</small></button>`;
  }

  function disegna() {
    const campo = leggi();
    const n = campo.length, fatti = ordineCompilate(campo);
    const messi = new Set(campo.filter(Boolean));
    const dest = sel == null ? (cursore ?? primoVuoto(campo)) : null;

    /** Una posizione (stessa struttura ovunque: il resto del modulo la riconosce da .gg-slot[data-i]). */
    const posto = (i, tag, extra = '') => {
      const pid = campo[i];
      const cls = ['gg-slot', extra, pid ? 'pieno' : 'vuoto', i === 0 ? 'top' : '', i === sel ? 'sel' : '', i === dest ? 'cursore' : ''].filter(Boolean).join(' ');
      return `<${tag} class="${cls}" data-i="${i}"><span class="gg-n">${esc(etichetta(i))}</span>${pid ? chip(pid) + '<button type="button" class="gg-x" aria-label="Togli dalla griglia">✕</button>' : '<span class="gg-ph"></span>'}</${tag}>`;
    };
    let posizioni;
    if (tipo === 'partenza') {
      posizioni = `<ol class="gg-slots">${campo.map((_, i) => posto(i, 'li')).join('')}</ol>`;
    } else {
      const podio = [1, 0, 2].filter(i => i < n)                   // 2º a sinistra, 1º al centro, 3º a destra
        .map(i => `<div class="gg-pod-col pod${i + 1}">${posto(i, 'div', 'gg-pod')}<div class="gg-plinto">${i + 1}</div></div>`).join('');
      const resto = campo.map((_, i) => i).filter(i => i >= 3).map(i => posto(i, 'li')).join('');
      posizioni = `<div class="gg-podio">${podio}</div>` + (n > 3 ? `<div class="gg-sub">Dal 4º posto in giù</div><ol class="gg-elenco">${resto}</ol>` : '');
    }

    const daPiazzare = tuttiPid().filter(pid => !messi.has(pid));
    const tray = daPiazzare.length
      ? daPiazzare.map(chip).join('')
      : '<span class="gg-tutti">✓ Tutti i piloti sono in griglia</span>';

    const guida = messaggio
      || (sel != null ? `<b>${esc(cognome(campo[sel]))}</b> selezionato: trascinalo, o tocca un'altra posizione per scambiarli.`
        : fatti >= n ? 'Scheda completa. Tieni premuto un pilota e trascinalo per scambiare le posizioni.'
          : (opz.suggerimento || 'Tocca un pilota qui sotto: va nella prossima posizione libera. Tieni premuto per trascinarlo dove vuoi.'));

    box.classList.toggle('gg-bloccato', bloccato());
    box.innerHTML = `<div class="gg">
      <div class="gg-bar"><span class="gg-count"><b>${fatti}</b>/${n}</span><span class="gg-hint">${guida}</span>
        <button type="button" class="gg-clear"${fatti ? '' : ' disabled'}>🗑 Svuota</button></div>
      <div class="gg-campo gg-${tipo}">
        <div class="gg-linea">${tipo === 'partenza' ? 'Linea di partenza · pole' : 'Traguardo · il podio'}</div>
        ${posizioni}
      </div>
      <div class="gg-tray${paddockChiuso ? ' chiuso' : ''}"><button type="button" class="gg-tray-h">Paddock · ${daPiazzare.length} ${daPiazzare.length === 1 ? 'pilota' : 'piloti'} da piazzare <span class="gg-chev">${paddockChiuso ? '▴' : '▾'}</span></button><div class="gg-tray-c">${tray}</div></div>
    </div>`;
    messaggio = '';
  }

  /** Applica un nuovo ordinamento e ridisegna. */
  function applica(nuovo, nuovoCursore = null, porta = true) {
    scrivi(nuovo); sel = null; cursore = nuovoCursore; disegna();
    if (porta) { const c = box.querySelector('.gg-slot.cursore'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }

  // ── tocco ──────────────────────────────────────────
  box.addEventListener('click', (e) => {
    if (soppresso) { e.preventDefault(); return; }
    if (bloccato() || !box.contains(e.target)) return;
    const campo = leggi();
    const x = e.target.closest('.gg-x');
    if (x) { const i = +x.closest('.gg-slot').dataset.i; const n = campo.slice(); n[i] = null; applica(n, i, false); return; }
    if (e.target.closest('.gg-clear')) {
      if (ordineCompilate(campo) && !confirm('Svuotare tutta la scheda di questa sessione?')) return;
      applica(campo.map(() => null), 0, false); return;
    }
    if (e.target.closest('.gg-tray-h')) { paddockChiuso = !paddockChiuso; disegna(); return; }
    const nelPaddock = e.target.closest('.gg-tray .gg-chip');
    if (nelPaddock) {
      const pid = nelPaddock.dataset.pid;
      const d = sel != null ? sel : (cursore ?? primoVuoto(campo));
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

  // ── trascinamento (dito e mouse) ───────────────────
  box.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.gg-chip')) e.preventDefault(); }, L);

  box.addEventListener('pointerdown', (e) => {
    if (bloccato() || (e.button != null && e.button > 0)) return;
    const c = e.target.closest && e.target.closest('.gg-chip');
    if (!c || !box.contains(c) || e.target.closest('.gg-x')) return;
    fine();
    const slot = c.closest('.gg-slot'), da = slot ? +slot.dataset.i : -1;
    cand = { pid: c.dataset.pid, da, el: c, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, id: e.pointerId, tipo: e.pointerType, selezionato: da >= 0 && da === sel, timer: null };
    // dito: pressione lunga per sollevare (se il pilota è già selezionato basta muoversi); mouse: basta muoversi
    if (e.pointerType !== 'mouse' && !cand.selezionato) {
      cand.timer = setTimeout(() => { if (cand && !drag) avvia(cand.x1, cand.y1); }, PRESSIONE_MS);
    }
  }, L);

  window.addEventListener('pointermove', (e) => {
    if (cand && e.pointerId === cand.id) {
      cand.x1 = e.clientX; cand.y1 = e.clientY;
      const dist = Math.hypot(e.clientX - cand.x0, e.clientY - cand.y0);
      if (cand.tipo === 'mouse') { if (dist > SOGLIA_MOUSE) avvia(e.clientX, e.clientY); }
      else if (cand.selezionato) { if (dist > 6) avvia(e.clientX, e.clientY); }
      else if (dist > SOGLIA_SCORRI) { fine(); }                 // è uno scorrimento della pagina, non un trascinamento
      return;
    }
    if (drag && e.pointerId === drag.id) muovi(e.clientX, e.clientY);
  }, L);

  window.addEventListener('pointerup', (e) => {
    if (drag && e.pointerId === drag.id) { rilascia(); return; }
    if (cand && e.pointerId === cand.id) fine();
  }, L);
  window.addEventListener('pointercancel', (e) => {
    if ((drag && e.pointerId === drag.id) || (cand && e.pointerId === cand.id)) { const eraDrag = !!drag; fine(); if (eraDrag) disegna(); }
  }, L);
  // quando un pilota è sollevato la pagina non deve scorrere sotto il dito
  document.addEventListener('touchmove', (e) => { if (drag && e.cancelable) e.preventDefault(); }, { passive: false, signal: ac.signal });

  function avvia(x, y) {
    if (!cand) return;
    clearTimeout(cand.timer);
    const r = cand.el.getBoundingClientRect();
    const ghost = cand.el.cloneNode(true);
    ghost.classList.add('gg-ghost'); ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
    document.body.appendChild(ghost);
    drag = { pid: cand.pid, da: cand.da, id: cand.id, ghost, dx: Math.min(x - r.left, r.width - 8), dy: y - r.top, x, y, ber: { slot: -1, paddock: false }, raf: 0 };
    cand.el.classList.add('dragging');
    cand = null; sel = null;
    box.classList.add('gg-trascina');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) { /* non disponibile */ } }
    muovi(x, y);
    const scorri = () => {                                       // la pagina scorre da sola vicino ai bordi dello schermo
      if (!drag) return;
      const margine = 90;
      if (drag.y < margine) window.scrollBy(0, -Math.ceil((margine - drag.y) / 6));
      else if (drag.y > innerHeight - margine) window.scrollBy(0, Math.ceil((drag.y - (innerHeight - margine)) / 6));
      aggiornaBersaglio();
      drag.raf = requestAnimationFrame(scorri);
    };
    drag.raf = requestAnimationFrame(scorri);
  }

  function muovi(x, y) {
    if (!drag) return;
    drag.x = x; drag.y = y;
    drag.ghost.style.transform = `translate(${Math.round(x - drag.dx)}px, ${Math.round(y - drag.dy)}px) scale(1.07)`;
    aggiornaBersaglio();
  }

  function aggiornaBersaglio() {
    if (!drag) return;
    const el = document.elementFromPoint(drag.x, drag.y);
    const slot = el && el.closest ? el.closest('.gg-slot') : null;
    const paddock = !slot && !!(el && el.closest && el.closest('.gg-tray'));
    drag.ber = { slot: slot ? +slot.dataset.i : -1, paddock };
    box.querySelectorAll('.gg-slot.drop').forEach(s => { if (s !== slot) s.classList.remove('drop'); });
    box.querySelector('.gg-tray')?.classList.toggle('drop', paddock && drag.da >= 0);
    if (slot) slot.classList.add('drop');
  }

  function rilascia() {
    const d = drag, campo = leggi();
    fine();
    soppresso = true; setTimeout(() => { soppresso = false; }, 80);   // il click che segue il rilascio non deve selezionare nulla
    if (d.ber.slot >= 0) { applica(scambiaInPosizione(campo, d.ber.slot, d.pid), null, false); return; }
    if (d.ber.paddock && d.da >= 0) { const n = campo.slice(); n[d.da] = null; applica(n, d.da, false); return; }
    disegna();                                                      // rilasciato fuori da tutto: torna come prima
  }

  /** Chiude pressione o trascinamento in corso (ghost, evidenziazioni, timer). */
  function fine() {
    if (cand) { clearTimeout(cand.timer); cand = null; }
    if (drag) {
      cancelAnimationFrame(drag.raf); drag.ghost.remove(); drag = null;
      box.classList.remove('gg-trascina');
      box.querySelectorAll('.dragging, .drop').forEach(el => el.classList.remove('dragging', 'drop'));
    }
  }

  disegna();
  return { ridisegna: disegna, distruggi: () => { fine(); ac.abort(); box.innerHTML = ''; } };
}
