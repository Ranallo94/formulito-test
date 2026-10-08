/**
 * FORMULITO — pronostici.js
 * Scheda pronostici.
 *
 * Tre sessioni possibili per weekend:
 *   • Qualifiche — ordinamento di tutti i 22 piloti (griglia di partenza prevista)
 *   • Sprint     — SOLO per i weekend che la prevedono (vedi competizioni.js →
 *                  sprint:true): ordinamento dei primi 8 all'arrivo, gli unici
 *                  che prendono punti ufficiali in Sprint
 *   • Gara       — ordinamento di tutti i 22 piloti (ordine di arrivo previsto)
 *                  + 6 campi bonus
 *
 * Salvataggio per-sessione (un bottone per scheda, ognuno risalva l'intero
 * documento _pron — vedi serializzaPronostico), ma il LOCK è UNICO per
 * tutte: nei weekend normali Qualifiche e Gara si chiudono insieme, all'inizio
 * delle Qualifiche; nei weekend Sprint si chiudono tutte e tre insieme,
 * all'inizio della Sprint (che precede le Qualifiche) — vedi Regolamento.
 * Stesso pattern onSistemaSnapshot usato da Wimbledino/Medusino.
 *
 * Documento salvato: pronostici/{uid} = {
 *   qualifica: { griglia: [22 pid] },
 *   sprint: { top8: [8 pid] },     // SOLO se la competizione prevede la Sprint
 *   gara: { arrivo: [22 pid], bonus: { giroVeloce, pitStopVeloce, gommaLunga,
 *           primoRitirato, safetyCar, maggiorGuadagno } },
 *   updatedAt
 * }
 */

import { STATE } from './app.js';
import { getPronostici, savePronostici, onSistemaSnapshot } from './db.js';
import { caricaEvento, nomePilota, elencoPiloti } from './evento.js';
import { haSprint } from './competizioni.js';
import {
  normalizzaOrdine, setInPosizione, ordineCompilate, serializzaPronostico, N_SPRINT,
} from './griglia.js';
import { showToast } from './ui.js';
import { teamBadge, infoBtn, openSchedaPilota } from './pilota.js';

const BONUS_CAMPI = [
  { id: 'giroVeloce',      label: '🏁 Giro più veloce',                    tipo: 'pilota' },
  { id: 'pitStopVeloce',   label: '🔧 Pit stop più veloce',                tipo: 'pilota' },
  { id: 'gommaLunga',      label: '🛞 Più giri con la stessa gomma',       tipo: 'pilota' },
  { id: 'primoRitirato',   label: '🚩 Primo ritirato (DNF)',               tipo: 'pilota' },
  { id: 'maggiorGuadagno', label: '📈 Maggior guadagno posizioni in gara', tipo: 'pilota' },
  { id: 'safetyCar',       label: '🚨 Numero di ingressi Safety Car',      tipo: 'numero' },
];

let _db = null;
let _pron = null;
let _pronostici_aperti = true;
let _unsubSistema = null;
let _built = false;

// ── INIT / CLEANUP ────────────────────────────────────
export async function initPronostici() {
  const page = document.getElementById('page-pronostici');
  if (!page) return;

  try {
    _db = await caricaEvento();
  } catch (err) {
    page.innerHTML = _errBox('Impossibile caricare la griglia piloti.', err.message);
    return;
  }

  _pron = (await getPronostici(STATE.utente.id)) || {};
  if (!_pron.qualifica) _pron.qualifica = {};
  if (!_pron.gara) _pron.gara = {};
  _pron.qualifica.griglia = normalizzaOrdine(_pron.qualifica.griglia);
  _pron.gara.arrivo = normalizzaOrdine(_pron.gara.arrivo);
  if (!_pron.gara.bonus) _pron.gara.bonus = {};
  if (haSprint()) {
    if (!_pron.sprint) _pron.sprint = {};
    _pron.sprint.top8 = normalizzaOrdine(_pron.sprint.top8, N_SPRINT);
  } else {
    delete _pron.sprint;
  }

  _buildShell();
  _built = true;

  if (_unsubSistema) _unsubSistema();
  _unsubSistema = onSistemaSnapshot((cfg) => {
    _pronostici_aperti = cfg?.pronostici_aperti !== false;
    STATE.pronosticiAperti = _pronostici_aperti;
    _applyLockState();
  });

  _renderSessione('qualifica');
  if (haSprint()) _renderSessione('sprint');
  _renderSessione('gara');
  _renderBonus();
}

export function cleanupPronostici() {
  if (_unsubSistema) { _unsubSistema(); _unsubSistema = null; }
  _built = false;
  _pron = null;
}

// ── SHELL (header + tab + contenitori) ────────────────
function _buildShell() {
  const page = document.getElementById('page-pronostici');
  const sprint = haSprint();

  page.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">📋 La mia scheda pronostici</h2>
      <span id="pronostici-status" class="page-subtitle"></span>
    </div>
    <div id="pronostici-banner" class="info-banner" style="display:none"></div>

    <div class="tab-bar" id="pronostici-tabs">
      <button type="button" class="tab active" data-tab="pron-QUALI" data-round="qualifica">🏁 Qualifiche</button>
      ${sprint ? `<button type="button" class="tab" data-tab="pron-SPRINT" data-round="sprint">⚡ Sprint</button>` : ''}
      <button type="button" class="tab" data-tab="pron-GARA" data-round="gara">🏆 Gara</button>
    </div>

    <div id="pron-QUALI" class="tab-content active">
      <div class="round-head"><h3 class="section-title">🏁 Qualifiche · griglia di partenza prevista</h3>
        <span class="round-progress" id="prog-qualifica"></span></div>
      <p class="text-muted">Indica, posizione per posizione, chi pensi partirà in pole (1ª) e via via tutti gli altri piloti.</p>
      <div class="info-banner info-banner--yellow" style="margin-bottom:12px">
        <span>📌</span>
        <span><strong>NB:</strong> i piloti che sconteranno penalità per cambi al motore partecipano regolarmente alle qualifiche. L'assegnazione dei punti in qualifica avverrà in base all'<strong>ordine effettivo del sabato</strong> (Q1/Q2/Q3), non alla griglia di partenza dopo le penalità. Esempio: se pronostichi Antonelli in pole e lui fa davvero il tempo più veloce in Q3, prendi comunque i punti della pole — anche se poi in griglia partirà più indietro per una penalità.</span>
      </div>
      <div id="round-qualifica" class="grid-form"></div>
      <div class="elim-save-row">
        <button type="button" class="btn-salva-fase" data-save="qualifica">💾 Salva Qualifiche</button>
        <span class="elim-save-msg" id="msg-qualifica"></span>
      </div>
    </div>

    ${sprint ? `
    <div id="pron-SPRINT" class="tab-content">
      <div class="round-head"><h3 class="section-title">⚡ Sprint · primi 8 all'arrivo previsti</h3>
        <span class="round-progress" id="prog-sprint"></span></div>
      <p class="text-muted">Qui si pronosticano SOLO i primi 8 all'arrivo: sono gli unici che prendono punti nella Sprint ufficiale.</p>
      <div id="round-sprint" class="grid-form"></div>
      <div class="elim-save-row">
        <button type="button" class="btn-salva-fase" data-save="sprint">💾 Salva Sprint</button>
        <span class="elim-save-msg" id="msg-sprint"></span>
      </div>
    </div>` : ''}

    <div id="pron-GARA" class="tab-content">
      <div class="round-head"><h3 class="section-title">🏆 Gara · ordine di arrivo previsto</h3>
        <span class="round-progress" id="prog-gara"></span></div>
      <p class="text-muted">Indica, posizione per posizione, chi pensi vincerà (1º) e via via tutti gli altri piloti all'arrivo.</p>
      <div id="round-gara" class="grid-form"></div>

      <div class="round-head" style="margin-top:24px"><h3 class="section-title">🎯 Bonus di gara</h3></div>
      <div id="bonus-box" class="bonus-form"></div>

      <div class="elim-save-row">
        <button type="button" class="btn-salva-fase" data-save="gara">💾 Salva Gara e Bonus</button>
        <span class="elim-save-msg" id="msg-gara"></span>
      </div>
    </div>
  `;

  page.querySelectorAll('[data-save]').forEach(btn => {
    btn.addEventListener('click', () => _salvaSessione(btn.dataset.save, btn));
  });
}

// ── HELPERS: campo-array per sessione (qualifica / sprint / gara) ─────
function _campoDi(sessione) {
  if (sessione === 'qualifica') return _pron.qualifica.griglia;
  if (sessione === 'sprint') return _pron.sprint.top8;
  return _pron.gara.arrivo;
}
function _setCampoDi(sessione, arr) {
  if (sessione === 'qualifica') _pron.qualifica.griglia = arr;
  else if (sessione === 'sprint') _pron.sprint.top8 = arr;
  else _pron.gara.arrivo = arr;
}

// ── RENDER DI UNA SESSIONE (select a cascata) ─────────
function _renderSessione(sessione) {
  const box = document.getElementById('round-' + sessione);
  if (!box) return;
  const campo = _campoDi(sessione);
  const ids = elencoPiloti(_db);

  // Nel menu aperto mostriamo "Nome — Scuderia" (data-full); una volta scelto,
  // il badge scuderia accanto al select rende ridondante ripeterla nella
  // casella chiusa, quindi lì mostriamo solo il nome (data-short) — vedi
  // _accorciaSelectChiuso più sotto.
  const optsHtml = (selPid, posizione) => {
    let out = '<option value="">— scegli —</option>';
    ids.forEach(pid => {
      const usatoAltrove = campo.includes(pid) && campo[posizione] !== pid;
      const nome = nomePilota(_db, pid);
      out += `<option value="${pid}"${selPid === pid ? ' selected' : ''}${usatoAltrove ? ' disabled' : ''} data-full="${nome} — ${_db.piloti[pid].team}" data-short="${nome}">${nome} — ${_db.piloti[pid].team}</option>`;
    });
    return out;
  };

  let html = '';
  for (let i = 0; i < campo.length; i++) {
    const pid = campo[i];
    // Etichetta sempre "P1..Pn" (compatta e allineata); la riga 0 (pole/vincitore)
    // si distingue con uno stile a parte (.grid-row--top) invece di una parola lunga.
    const titoloPos = sessione === 'qualifica'
      ? (i === 0 ? 'Pole position' : `Posizione ${i + 1}`)
      : sessione === 'sprint'
        ? (i === 0 ? 'Vincitore Sprint' : `Posizione ${i + 1}`)
        : (i === 0 ? 'Vincitore' : `Posizione ${i + 1}`);
    html += `<div class="grid-row${i === 0 ? ' grid-row--top' : ''}" data-pos="${i}">
      <span class="grid-row-pos" title="${titoloPos}">P${i + 1}</span>
      <select class="grid-select" data-sessione="${sessione}" data-pos="${i}">${optsHtml(pid, i)}</select>
      ${pid ? teamBadge(_db, pid) : ''}
      ${pid ? infoBtn(pid) : ''}
    </div>`;
  }
  box.innerHTML = html;

  box.querySelectorAll('.grid-select').forEach(sel => {
    _accorciaSelectChiuso(sel);
    sel.addEventListener('mousedown', () => _espandiOpzioni(sel));
    sel.addEventListener('focus', () => _espandiOpzioni(sel));
    sel.addEventListener('blur', () => _accorciaSelectChiuso(sel));
    sel.addEventListener('change', () => {
      const s = sel.dataset.sessione, pos = +sel.dataset.pos;
      _setPosizione(s, pos, sel.value || null);
      _renderSessione(s);
    });
  });
  box.querySelectorAll('.player-info-btn[data-info]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openSchedaPilota(_db, btn.dataset.info); });
  });

  const prog = document.getElementById('prog-' + sessione);
  if (prog) prog.textContent = `${ordineCompilate(campo)}/${campo.length}`;

  _applyLockState();
}

// Mostra "Nome — Scuderia" in tutte le opzioni (usato appena il menu sta per
// aprirsi, così l'elenco a tendina resta completo).
function _espandiOpzioni(sel) {
  Array.from(sel.options).forEach(o => { if (o.dataset.full) o.textContent = o.dataset.full; });
}

// Una volta chiuso il select, l'opzione selezionata mostra solo il nome
// (la scuderia è già nel badge accanto), evitando la ripetizione.
function _accorciaSelectChiuso(sel) {
  const opt = sel.options[sel.selectedIndex];
  if (opt && opt.dataset.short) opt.textContent = opt.dataset.short;
}

function _setPosizione(sessione, pos, pid) {
  const campo = _campoDi(sessione);
  const nuovo = setInPosizione(campo, pos, pid);
  _setCampoDi(sessione, nuovo);
}

// ── RENDER BONUS (solo Gara) ───────────────────────────
function _renderBonus() {
  const box = document.getElementById('bonus-box');
  if (!box) return;
  const ids = elencoPiloti(_db);
  const optsHtml = (sel) => '<option value="">— scegli —</option>' +
    ids.map(pid => `<option value="${pid}"${sel === pid ? ' selected' : ''}>${nomePilota(_db, pid)} — ${_db.piloti[pid].team}</option>`).join('');

  box.innerHTML = BONUS_CAMPI.map(c => {
    const val = _pron.gara.bonus[c.id];
    if (c.tipo === 'numero') {
      return `<div class="bonus-field">
        <label class="bonus-field-label">${c.label}</label>
        <input type="number" class="bonus-num" min="0" step="1" data-bonus="${c.id}" value="${val ?? ''}" placeholder="es. 1">
      </div>`;
    }
    return `<div class="bonus-field">
      <label class="bonus-field-label">${c.label}</label>
      <select class="bonus-select" data-bonus="${c.id}">${optsHtml(val || '')}</select>
    </div>`;
  }).join('');

  box.querySelectorAll('.bonus-select').forEach(s => {
    s.addEventListener('change', () => { _pron.gara.bonus[s.dataset.bonus] = s.value || null; });
  });
  box.querySelectorAll('.bonus-num').forEach(inp => {
    inp.addEventListener('input', () => {
      const raw = inp.value.trim();
      _pron.gara.bonus[inp.dataset.bonus] = raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0);
    });
  });

  _applyLockState();
}

// ── SALVATAGGIO ───────────────────────────────────────
async function _salvaSessione(sessione, btn) {
  if (!_pronostici_aperti) { showToast('Pronostici chiusi: non puoi modificare.', 'warning'); return; }
  const msg = document.getElementById('msg-' + sessione);
  btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ Salvataggio…';
  try {
    await savePronostici(STATE.utente.id, serializzaPronostico(_pron));
    if (msg) { msg.textContent = '✅ Salvato'; msg.className = 'elim-save-msg ok'; }
    showToast('Pronostici salvati.', 'success');
  } catch (err) {
    if (msg) { msg.textContent = '❌ Errore'; msg.className = 'elim-save-msg err'; }
    showToast('Errore nel salvataggio: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = old;
    setTimeout(() => { if (msg) msg.textContent = ''; }, 4000);
  }
}

// ── LOCK STATE (sessioni chiuse) ───────────────────────
function _applyLockState() {
  if (!_built) return;
  const banner = document.getElementById('pronostici-banner');
  const status = document.getElementById('pronostici-status');
  const page = document.getElementById('page-pronostici');
  if (!page) return;

  const sessioniLabel = haSprint() ? 'Qualifiche, Sprint e Gara' : 'Qualifiche e Gara';

  if (_pronostici_aperti) {
    if (banner) banner.style.display = 'none';
    if (status) status.textContent = `Pronostici aperti — ${sessioniLabel}`;
  } else {
    if (banner) {
      banner.style.display = '';
      banner.className = 'info-banner info-banner--yellow';
      banner.innerHTML = `<span>🔒</span><span>Pronostici chiusi: la prima sessione del weekend è iniziata, la scheda (${sessioniLabel}) è in sola lettura.</span>`;
    }
    if (status) status.textContent = 'Pronostici chiusi';
  }

  const quali  = document.getElementById('pron-QUALI');
  const sprint = document.getElementById('pron-SPRINT');
  const gara   = document.getElementById('pron-GARA');
  [quali, sprint, gara].forEach((box) => {
    if (!box) return;
    box.querySelectorAll('.grid-select, .bonus-select, .bonus-num').forEach(el => {
      if (_pronostici_aperti) el.removeAttribute('disabled'); else el.setAttribute('disabled', 'disabled');
    });
    box.querySelectorAll('[data-save]').forEach(b => { b.style.display = _pronostici_aperti ? '' : 'none'; });
  });
}

// ── HELPERS ───────────────────────────────────────────
function _errBox(titolo, dettaglio) {
  return `<div class="page-header"><h2 class="page-title">📋 Pronostici</h2></div>
    <div class="empty-state"><div class="empty-icon">⚠️</div>
    <p>${titolo}</p><p class="text-muted">${dettaglio || ''}</p></div>`;
}