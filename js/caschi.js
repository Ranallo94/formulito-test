/**
 * FORMULITO — caschi.js
 * Il casco personalizzabile di ogni partecipante: disegno (SVG), casco casuale di
 * partenza, validazione e editor.
 *
 * Un casco è { base, accento, visiera, trama }:
 *   • base / accento / visiera: colori esadecimali "#rrggbb"
 *   • trama: una delle chiavi di TRAME
 *
 * Dove vive: collezione Firestore `caschi/{uid}` (lettura per tutti gli approvati,
 * scrittura solo del proprietario — vedi firestore.rules). Chi non ne ha ancora
 * scelto uno riceve un casco CASUALE ma STABILE, derivato dal suo uid (nessuna
 * scrittura: è sempre lo stesso su ogni dispositivo finché non lo personalizza).
 *
 * I dati arrivano da altri utenti: prima di disegnare passano SEMPRE da
 * cascoSicuro(), che ammette solo colori #rrggbb e trame note (niente HTML/SVG
 * iniettabile dai valori salvati).
 */

import { getCaschi, saveCasco } from './db.js';

// ── DISEGNO ───────────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
const SHELL = 'M10 64 C8 32 32 8 60 9 C84 10 96 30 95 52 L95 66 C95 75 89 81 80 81 L28 81 C17 81 10 74 10 64 Z';
const VISOR = 'M56 33 C72 29 91 35 95 49 L95 58 C82 54 66 55 52 61 C50 50 52 40 56 33 Z';

/** Colore `hex` mescolato con `to` (k = 0..1). */
function mix(hex, to, k) {
  const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex), b = p(to);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

function stella(cx, cy, r) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const R = i % 2 ? r * 0.45 : r, ang = -Math.PI / 2 + i * Math.PI / 5;
    d += (i ? 'L' : 'M') + (cx + R * Math.cos(ang)).toFixed(1) + ' ' + (cy + R * Math.sin(ang)).toFixed(1);
  }
  return d + 'Z';
}

export const TRAME = {
  nessuna:   { nome: 'Liscio',    f: () => '' },
  strisce:   { nome: 'Strisce',   f: a => `<path d="M30 6 L45 6 L35 84 L20 84Z" fill="${a}"/><path d="M52 6 L60 6 L51 84 L43 84Z" fill="${a}"/>` },
  scacchi:   { nome: 'Scacchi',   f: a => { const d = mix(a, '#000000', 0.65); let s = ''; for (let r = 0; r < 2; r++) for (let c = 0; c < 11; c++) s += `<rect x="${c * 10 - 5}" y="${58 + r * 10}" width="10" height="10" fill="${(r + c) % 2 ? a : d}"/>`; return s; } },
  fiamme:    { nome: 'Fiamme',    f: a => `<path d="M0 84 L0 58 C8 62 10 48 16 40 C18 52 26 56 28 44 C32 56 40 60 42 50 C46 62 54 62 56 52 C60 64 70 66 72 58 C76 70 84 70 86 64 L100 84Z" fill="${a}"/><path d="M0 84 L0 70 C8 70 12 62 18 58 C20 66 28 68 30 60 C34 68 42 70 44 64 C48 72 56 72 58 66 C62 74 72 76 74 70 L100 84Z" fill="${mix(a, '#ffffff', 0.55)}"/>` },
  onde:      { nome: 'Onde',      f: a => [28, 46, 64].map(y => `<path d="M-10 ${y} Q5 ${y - 12} 20 ${y} T50 ${y} T80 ${y} T110 ${y}" fill="none" stroke="${a}" stroke-width="7"/>`).join('') },
  stelle:    { nome: 'Stelle',    f: a => [[24, 30, 8], [48, 20, 7], [70, 40, 9], [36, 56, 8], [60, 66, 7], [20, 70, 6], [84, 22, 6]].map(([x, y, r]) => `<path d="${stella(x, y, r)}" fill="${a}"/>`).join('') },
  pois:      { nome: 'Pois',      f: a => { let s = ''; for (let y = 18; y < 90; y += 17) for (let x = (y / 17 | 0) % 2 ? 22 : 12; x < 100; x += 20) s += `<circle cx="${x}" cy="${y}" r="5.5" fill="${a}"/>`; return s; } },
  diagonali: { nome: 'Diagonali', f: a => `<g transform="rotate(-38 50 50)">${[-10, 12, 34, 56, 78].map(y => `<rect x="-40" y="${y}" width="180" height="9" fill="${a}"/>`).join('')}</g>` },
  meta:      { nome: 'Bicolore',  f: a => `<path d="M0 100 L0 40 L100 66 L100 100Z" fill="${a}"/>` },
  mimetica:  { nome: 'Mimetica',  f: a => { const d = mix(a, '#000000', 0.5), l = mix(a, '#ffffff', 0.35); return `<ellipse cx="28" cy="34" rx="20" ry="11" fill="${a}"/><ellipse cx="60" cy="24" rx="17" ry="9" fill="${d}"/><ellipse cx="72" cy="52" rx="20" ry="12" fill="${a}"/><ellipse cx="38" cy="62" rx="17" ry="10" fill="${l}"/><ellipse cx="16" cy="56" rx="9" ry="8" fill="${d}"/><ellipse cx="52" cy="46" rx="11" ry="7" fill="${d}"/>`; } },
};
export const TRAMA_KEYS = Object.keys(TRAME);

export const BASI = ['#E10600', '#F5B400', '#1d4ed8', '#0ea5a0', '#7c3aed', '#16a34a', '#f97316', '#ec4899', '#e5e7eb', '#111827', '#00D7B6', '#92400e'];
export const ACCENTI = ['#ffffff', '#111111', '#F5B400', '#E10600', '#00D7B6', '#1d4ed8', '#ec4899', '#16a34a'];
export const VISIERE = ['#111111', '#1e293b', '#b45309', '#0e7490', '#7f1d1d', '#a3a3a3', '#facc15'];

/** Definizioni condivise (sagoma, riflessi): un solo <svg> nascosto nel documento. */
function assicuraDefs() {
  if (document.getElementById('fh-defs')) return;
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('id', 'fh-defs'); s.setAttribute('width', '0'); s.setAttribute('height', '0');
  s.setAttribute('aria-hidden', 'true'); s.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  s.innerHTML = `<defs>
    <clipPath id="fh-shell"><path d="${SHELL}"/></clipPath>
    <linearGradient id="fh-visor" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>
    <linearGradient id="fh-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".30"/></linearGradient>
  </defs>`;
  document.body.appendChild(s);
}

/** Interno del casco, viewBox 0 0 100 100, rivolto a destra. `c` DEVE essere già sicuro. */
export function interno(c) {
  assicuraDefs();
  return `
  <g clip-path="url(#fh-shell)">
    <rect width="100" height="100" fill="${c.base}"/>
    ${(TRAME[c.trama] || TRAME.nessuna).f(c.accento)}
    <rect width="100" height="100" fill="url(#fh-shade)"/>
  </g>
  <path d="${SHELL}" fill="none" stroke="#0a0a0a" stroke-width="3" stroke-linejoin="round"/>
  <path d="${VISOR}" fill="${c.visiera}" stroke="#0a0a0a" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="${VISOR}" fill="url(#fh-visor)"/>
  <path d="M60 70 L90 70" stroke="#0a0a0a" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>
  <path d="M18 76 Q14 66 14 60" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="3" stroke-linecap="round"/>`;
}

/** <svg> autonomo del casco (liste, profilo, editor). */
export function svgCasco(casco, classe = '') {
  return `<svg class="${classe}" viewBox="0 0 100 100" xmlns="${NS}" aria-hidden="true">${interno(cascoSicuro(casco))}</svg>`;
}

// ── VALIDAZIONE E CASCO CASUALE ───────────────────────
const HEX = /^#[0-9a-f]{6}$/i;

/** Ammette solo colori #rrggbb e trame note; il resto torna al casco casuale/predefinito. */
export function cascoSicuro(raw, uidPerDefault = 'x') {
  const d = cascoDefault(uidPerDefault);
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    base: HEX.test(r.base) ? r.base : d.base,
    accento: HEX.test(r.accento) ? r.accento : d.accento,
    visiera: HEX.test(r.visiera) ? r.visiera : d.visiera,
    trama: Object.prototype.hasOwnProperty.call(TRAME, r.trama) ? r.trama : d.trama,
  };
}

function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Casco casuale ma stabile: lo stesso `seme` dà sempre lo stesso casco. */
export function cascoDefault(seme) {
  let h = hash(seme + '#');
  const n = () => (h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0);
  const base = BASI[n() % BASI.length];
  let accento = ACCENTI[n() % ACCENTI.length];
  if (accento.toLowerCase() === base.toLowerCase()) accento = base.toLowerCase() === '#ffffff' ? '#111111' : '#ffffff';
  return { base, accento, visiera: VISIERE[n() % VISIERE.length], trama: TRAMA_KEYS[n() % TRAMA_KEYS.length] };
}

// ── DATI (cache di sessione) ──────────────────────────
let _mappa = {};           // uid → casco scelto
let _caricata = null;      // Promise

/** Carica (una volta per sessione, o a richiesta) i caschi scelti da tutti. */
export function caricaCaschi(forza = false) {
  if (!_caricata || forza) {
    _caricata = getCaschi().then(m => { _mappa = m || {}; return _mappa; }).catch(() => _mappa);
  }
  return _caricata;
}
/** Casco da mostrare per `uid`: quello scelto (validato) o quello casuale. */
export function cascoDi(uid) { return cascoSicuro(_mappa[uid], uid); }
export function haCascoScelto(uid) { return !!_mappa[uid]; }

// ── EDITOR ────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Apre l'editor del proprio casco (finestra a schermo intero su telefono).
 * @param {{uid:string, nome?:string, onSalvato?:(casco:Object)=>void}} opz
 */
export function apriEditorCasco({ uid, nome = '', onSalvato }) {
  assicuraDefs();
  document.getElementById('fh-editor')?.remove();
  let draft = { ...cascoDi(uid) };

  const dlg = document.createElement('dialog');
  dlg.id = 'fh-editor'; dlg.className = 'fh-editor';
  dlg.innerHTML = `
    <div class="fhe">
      <div class="fhe-head"><h2>🎨 Il tuo casco</h2><button type="button" class="fhe-x" data-x aria-label="Chiudi">✕</button></div>
      ${nome ? `<p class="fhe-sub">${esc(nome)}</p>` : ''}
      <div class="fhe-prev" id="fhe-prev"></div>
      <label>Colore base</label><div class="fhe-sw" data-k="base"></div>
      <label>Colore trama</label><div class="fhe-sw" data-k="accento"></div>
      <label>Visiera</label><div class="fhe-sw" data-k="visiera"></div>
      <label>Trama</label><div class="fhe-tramas" id="fhe-tramas"></div>
      <p class="fhe-msg" id="fhe-msg"></p>
      <div class="fhe-foot">
        <button type="button" class="btn" data-rnd>🎲 Casuale</button>
        <button type="button" class="btn btn-primary" data-save>💾 Salva</button>
      </div>
    </div>`;
  document.body.appendChild(dlg);

  const tinte = { base: BASI, accento: ACCENTI, visiera: VISIERE };
  dlg.querySelectorAll('.fhe-sw').forEach(box => {
    const k = box.dataset.k;
    tinte[k].forEach(c => { const b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.dataset.c = c; b.setAttribute('aria-label', c); b.addEventListener('click', () => { draft[k] = c; ridisegna(); }); box.appendChild(b); });
    const inp = document.createElement('input'); inp.type = 'color'; inp.title = 'Colore personalizzato';
    inp.addEventListener('input', () => { draft[k] = inp.value; ridisegna(); }); box.appendChild(inp);
  });

  function ridisegna() {
    dlg.querySelector('#fhe-prev').innerHTML = svgCasco(draft);
    dlg.querySelectorAll('.fhe-sw').forEach(box => {
      const k = box.dataset.k;
      box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c.toLowerCase() === draft[k].toLowerCase()));
      const inp = box.querySelector('input'); if (HEX.test(draft[k])) inp.value = draft[k];
    });
    const t = dlg.querySelector('#fhe-tramas');
    t.innerHTML = TRAMA_KEYS.map(k => `<button type="button" class="fhe-trama${draft.trama === k ? ' on' : ''}" data-k="${k}">${svgCasco({ ...draft, trama: k })}<span>${TRAME[k].nome}</span></button>`).join('');
    t.querySelectorAll('.fhe-trama').forEach(b => b.addEventListener('click', () => { draft.trama = b.dataset.k; ridisegna(); }));
  }

  const chiudi = () => { if (dlg.open) dlg.close(); dlg.remove(); };            // chiude e toglie la finestra dal documento
  dlg.querySelector('[data-x]').addEventListener('click', chiudi);
  dlg.querySelector('[data-rnd]').addEventListener('click', () => { draft = cascoDefault(String(Math.random()) + uid); ridisegna(); });
  dlg.querySelector('[data-save]').addEventListener('click', async (e) => {
    const btn = e.currentTarget, msg = dlg.querySelector('#fhe-msg');
    btn.disabled = true; btn.textContent = '⏳ Salvataggio…'; msg.textContent = '';
    try {
      const c = cascoSicuro(draft, uid);
      await saveCasco(uid, c);
      _mappa[uid] = c;
      if (onSalvato) onSalvato(c);
      chiudi();
    } catch (err) {
      msg.textContent = 'Non riesco a salvare: ' + (err.message || 'errore'); msg.className = 'fhe-msg err';
      btn.disabled = false; btn.textContent = '💾 Salva';
    }
  });
  dlg.addEventListener('close', () => dlg.remove());                                 // Esc o chiusura del browser
  dlg.addEventListener('click', (e) => { if (e.target === dlg) chiudi(); });         // tocco fuori = chiudi

  ridisegna();
  dlg.showModal();
}
