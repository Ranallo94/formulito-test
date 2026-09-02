/**
 * FORMULITO — live.js
 * Pagina "Risultati": risultati UFFICIALI del GP d'Italia 2026, in sola lettura.
 *
 * I risultati sono in Firestore (risultati/ufficiali), inseriti a mano
 * dall'admin (niente sync automatico per la F1). Stessa forma dei
 * pronostici: { qualifica:{griglia}, gara:{arrivo,bonus} }.
 *
 * Struttura della pagina:
 *   • tab Qualifiche: griglia di partenza reale
 *   • tab Gara: ordine di arrivo reale + esiti bonus
 */

import { onRisultatiSnapshot } from './db.js';
import { caricaEvento, nomePilota } from './evento.js';
import { normalizzaOrdine } from './griglia.js';
import { teamBadge, infoBtn, openSchedaPilota } from './pilota.js';
import { formatDate } from './ui.js';

const BONUS_CAMPI = [
  { id: 'giroVeloce',      label: '🏁 Giro più veloce' },
  { id: 'pitStopVeloce',   label: '🔧 Pit stop più veloce' },
  { id: 'gommaLunga',      label: '🛞 Più giri con la stessa gomma' },
  { id: 'primoRitirato',   label: '🚩 Primo ritirato (DNF)' },
  { id: 'maggiorGuadagno', label: '📈 Maggior guadagno posizioni in gara' },
  { id: 'safetyCar',       label: '🚨 Numero di ingressi Safety Car', numero: true },
];

let _db = null;
let _ris = null;
let _built = false;
let _activeTab = 'qualifica';
let _unsubRis = null;

export async function initLive() {
  const page = document.getElementById('page-live');
  if (!page) return;

  try {
    _db = await caricaEvento();
  } catch (err) {
    page.innerHTML =
      `<div class="empty-state"><div class="empty-icon">⚠️</div>` +
      `<p>Impossibile caricare la griglia piloti.</p></div>`;
    return;
  }

  _buildShell();
  _built = true;

  if (_unsubRis) _unsubRis();
  _unsubRis = onRisultatiSnapshot((ris) => {
    _ris = ris || {};
    if (!_ris.qualifica) _ris.qualifica = {};
    if (!_ris.gara) _ris.gara = {};
    _ris.qualifica.griglia = normalizzaOrdine(_ris.qualifica.griglia);
    _ris.gara.arrivo = normalizzaOrdine(_ris.gara.arrivo);
    if (!_ris.gara.bonus) _ris.gara.bonus = {};
    _renderAttivo();
    _renderUpdated(ris?.updatedAt);
  });
}

export function cleanupLive() {
  if (_unsubRis) { _unsubRis(); _unsubRis = null; }
  _built = false;
  _ris = null;
}

function _buildShell() {
  const page = document.getElementById('page-live');
  page.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">📊 Risultati</h2>
      <span id="ris-status" class="page-subtitle">Risultati ufficiali del weekend</span>
    </div>
    <div class="tab-bar" id="risultati-tabs">
      <button type="button" class="tab active" data-tab="ris-QUALI" data-round="qualifica">🏁 Qualifiche</button>
      <button type="button" class="tab" data-tab="ris-GARA" data-round="gara">🏆 Gara</button>
    </div>
    <div id="ris-QUALI" class="tab-content active">
      <div class="round-head"><h3 class="section-title">🏁 Griglia di partenza reale</h3>
        <span class="round-progress" id="risprog-qualifica"></span></div>
      <div id="risround-qualifica" class="grid-form"></div>
    </div>
    <div id="ris-GARA" class="tab-content">
      <div class="round-head"><h3 class="section-title">🏆 Ordine di arrivo reale</h3>
        <span class="round-progress" id="risprog-gara"></span></div>
      <div id="risround-gara" class="grid-form"></div>
      <div class="round-head" style="margin-top:24px"><h3 class="section-title">🎯 Bonus di gara</h3></div>
      <div id="ris-bonus-box"></div>
    </div>
  `;

  page.querySelectorAll('#risultati-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => { _activeTab = tab.dataset.round; _renderAttivo(); });
  });
}

function _renderAttivo() {
  if (!_built || !_ris) return;
  if (_activeTab === 'gara') { _renderSessione('gara'); _renderBonus(); }
  else _renderSessione('qualifica');
}

function _renderSessione(sessione) {
  const box = document.getElementById('risround-' + sessione);
  if (!box) return;
  const campo = sessione === 'qualifica' ? _ris.qualifica.griglia : _ris.gara.arrivo;

  let html = '';
  let compilati = 0;
  campo.forEach((pid, i) => {
    if (pid) compilati++;
    const etichetta = sessione === 'qualifica' ? (i === 0 ? 'Pole' : `P${i + 1}`) : (i === 0 ? 'Vincitore' : `P${i + 1}`);
    html += `<div class="grid-row grid-row--ro">
      <span class="grid-row-pos">${etichetta}</span>
      ${pid
        ? `<span class="grid-nome-ro">${nomePilota(_db, pid)}</span>${teamBadge(_db, pid)}${infoBtn(pid)}`
        : `<span class="grid-nome-ro grid-nome-ro--vuota">— in programma —</span>`}
    </div>`;
  });
  box.innerHTML = html;

  const prog = document.getElementById('risprog-' + sessione);
  if (prog) prog.textContent = `${compilati}/${campo.length}`;

  box.querySelectorAll('.player-info-btn[data-info]').forEach(btn => {
    btn.addEventListener('click', () => openSchedaPilota(_db, btn.dataset.info));
  });
}

function _renderBonus() {
  const box = document.getElementById('ris-bonus-box');
  if (!box) return;
  const bonus = _ris.gara.bonus || {};
  const hasAny = BONUS_CAMPI.some(c => bonus[c.id] != null && bonus[c.id] !== '');
  if (!hasAny) { box.innerHTML = '<p class="text-muted">Bonus non ancora assegnati.</p>'; return; }

  box.innerHTML = '<div class="bonus-list">' + BONUS_CAMPI.map(c => {
    const v = bonus[c.id];
    const val = v == null || v === '' ? '—' : (c.numero ? v : nomePilota(_db, v));
    return `<div class="bonus-row"><span class="bonus-label">${c.label}</span><span class="bonus-val">${val}</span></div>`;
  }).join('') + '</div>';
}

function _renderUpdated(ts) {
  const el = document.getElementById('ris-status');
  if (!el) return;
  const data = ts && typeof ts.toDate === 'function' ? ts.toDate() : null;
  el.textContent = data
    ? `Aggiornato: ${formatDate(data.toISOString(), true)}`
    : 'Risultati ufficiali del weekend';
}
