/**
 * FORMULITO — pronostici.js
 * Scheda pronostici per il GP d'Italia 2026 (Monza, weekend di test).
 *
 * Non c'è tabellone: per ciascuna delle due sessioni indipendenti
 * (Qualifiche e Gara) l'utente ordina tutti i 22 piloti con 22 <select> a
 * cascata (scegliere un pilota già assegnato altrove lo libera lì, così non
 * si possono avere duplicati). Sotto la sessione Gara ci sono i 6 campi bonus.
 *
 * Salvataggio separato per sessione. Lock automatico quando la sessione è
 * chiusa (sistema/config.quali_aperti / gara_aperti), stesso pattern
 * onSistemaSnapshot usato da Wimbledino/Medusino.
 *
 * Documento salvato: pronostici/{uid} = {
 *   qualifica: { griglia: [22 pid] },
 *   gara: { arrivo: [22 pid], bonus: { giroVeloce, pitStopVeloce, gommaLunga,
 *           primoRitirato, safetyCar, maggiorGuadagno } },
 *   updatedAt
 * }
 */

import { STATE } from './app.js';
import { getPronostici, savePronostici, onSistemaSnapshot } from './db.js';
import { caricaEvento, nomePilota, elencoPiloti } from './evento.js';
import {
  nuovoOrdine, normalizzaOrdine, setInPosizione, ordineCompilate, serializzaPronostico,
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
let _quali_aperti = true;
let _gara_aperti = true;
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

  _buildShell();
  _built = true;

  if (_unsubSistema) _unsubSistema();
  _unsubSistema = onSistemaSnapshot((cfg) => {
    _quali_aperti = cfg?.quali_aperti !== false;
    _gara_aperti  = cfg?.gara_aperti  !== false;
    STATE.pronosticiAperti = _quali_aperti || _gara_aperti;
    _applyLockState();
  });

  _renderSessione('qualifica');
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

  page.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">📋 La mia scheda pronostici</h2>
      <span id="pronostici-status" class="page-subtitle"></span>
    </div>
    <div id="pronostici-banner" class="info-banner" style="display:none"></div>

    <div class="tab-bar" id="pronostici-tabs">
      <button type="button" class="tab active" data-tab="pron-QUALI" data-round="qualifica">🏁 Qualifiche</button>
      <button type="button" class="tab" data-tab="pron-GARA" data-round="gara">🏆 Gara</button>
    </div>

    <div id="pron-QUALI" class="tab-content active">
      <div class="round-head"><h3 class="section-title">🏁 Qualifiche · griglia di partenza prevista</h3>
        <span class="round-progress" id="prog-qualifica"></span></div>
      <p class="text-muted">Indica, posizione per posizione, chi pensi partirà in pole (1ª) e via via tutti gli altri piloti.</p>
      <div id="round-qualifica" class="grid-form"></div>
      <div class="elim-save-row">
        <button type="button" class="btn-salva-fase" data-save="qualifica">💾 Salva Qualifiche</button>
        <span class="elim-save-msg" id="msg-qualifica"></span>
      </div>
    </div>

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

// ── RENDER DI UNA SESSIONE (22 select a cascata) ──────
function _renderSessione(sessione) {
  const box = document.getElementById('round-' + sessione);
  if (!box) return;
  const campo = sessione === 'qualifica' ? _pron.qualifica.griglia : _pron.gara.arrivo;
  const ids = elencoPiloti(_db);

  const optsHtml = (selPid, posizione) => {
    let out = '<option value="">— scegli —</option>';
    ids.forEach(pid => {
      const usatoAltrove = campo.includes(pid) && campo[posizione] !== pid;
      out += `<option value="${pid}"${selPid === pid ? ' selected' : ''}${usatoAltrove ? ' disabled' : ''}>${nomePilota(_db, pid)} — ${_db.piloti[pid].team}</option>`;
    });
    return out;
  };

  let html = '';
  for (let i = 0; i < campo.length; i++) {
    const pid = campo[i];
    const etichettaPos = sessione === 'qualifica'
      ? (i === 0 ? 'Pole' : `P${i + 1}`)
      : (i === 0 ? 'Vincitore' : `P${i + 1}`);
    html += `<div class="grid-row" data-pos="${i}">
      <span class="grid-row-pos">${etichettaPos}</span>
      <select class="grid-select" data-sessione="${sessione}" data-pos="${i}">${optsHtml(pid, i)}</select>
      ${pid ? teamBadge(_db, pid) : ''}
      ${pid ? infoBtn(pid) : ''}
    </div>`;
  }
  box.innerHTML = html;

  box.querySelectorAll('.grid-select').forEach(sel => {
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

function _setPosizione(sessione, pos, pid) {
  const campo = sessione === 'qualifica' ? _pron.qualifica.griglia : _pron.gara.arrivo;
  const nuovo = setInPosizione(campo, pos, pid);
  if (sessione === 'qualifica') _pron.qualifica.griglia = nuovo;
  else _pron.gara.arrivo = nuovo;
}

// ── RENDER BONUS ───────────────────────────────────────
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
  const aperta = sessione === 'qualifica' ? _quali_aperti : _gara_aperti;
  if (!aperta) { showToast('Sessione chiusa: non puoi modificare.', 'warning'); return; }
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

  if (_quali_aperti && _gara_aperti) {
    if (banner) banner.style.display = 'none';
    if (status) status.textContent = 'Qualifiche e Gara aperte';
  } else {
    if (banner) {
      banner.style.display = '';
      banner.className = 'info-banner info-banner--yellow';
      const parti = [];
      if (!_quali_aperti) parti.push('le <strong>Qualifiche</strong>');
      if (!_gara_aperti) parti.push('la <strong>Gara</strong>');
      banner.innerHTML = `<span>🔒</span><span>Sono chius${parti.length > 1 ? 'e' : 'a'} ${parti.join(' e ')}: quella scheda è in sola lettura.</span>`;
    }
    if (status) status.textContent = `Qualifiche ${_quali_aperti ? 'aperte' : 'chiuse'} · Gara ${_gara_aperti ? 'aperta' : 'chiusa'}`;
  }

  const quali = document.getElementById('pron-QUALI');
  const gara  = document.getElementById('pron-GARA');
  [[quali, _quali_aperti], [gara, _gara_aperti]].forEach(([box, aperta]) => {
    if (!box) return;
    box.querySelectorAll('.grid-select, .bonus-select, .bonus-num').forEach(el => {
      if (aperta) el.removeAttribute('disabled'); else el.setAttribute('disabled', 'disabled');
    });
    box.querySelectorAll('[data-save]').forEach(b => { b.style.display = aperta ? '' : 'none'; });
  });
}

// ── HELPERS ───────────────────────────────────────────
function _errBox(titolo, dettaglio) {
  return `<div class="page-header"><h2 class="page-title">📋 Pronostici</h2></div>
    <div class="empty-state"><div class="empty-icon">⚠️</div>
    <p>${titolo}</p><p class="text-muted">${dettaglio || ''}</p></div>`;
}
