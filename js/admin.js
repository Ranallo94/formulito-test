/**
 * FORMULITO — admin.js
 * Pannello admin. Funzioni:
 *  - Approvazioni: accetta/rifiuta le richieste di iscrizione
 *  - Risultati: inserisci/correggi la griglia di qualifica reale, i primi 8
 *    Sprint reali (SOLO nei weekend che la prevedono), l'arrivo di gara reale
 *    e i 6 bonus di gara
 *  - Partecipanti: stato schede, abilita/disabilita, gestione admin
 *  - Sistema: un unico interruttore apri/chiudi pronostici (tutte le schede
 *    si bloccano insieme, all'inizio della prima sessione del weekend — vedi
 *    nota in pronostici.js), ricalcola la classifica
 *
 * Il ricalcolo classifica è interamente client-side: carica pronostici +
 * risultati, applica punteggi.js (che include da solo lo Sprint se previsto
 * dalla competizione attiva — vedi haSprint() in competizioni.js), scrive
 * classifica/snapshot.
 */

import { STATE } from './app.js';
import {
  getPartecipanti, updatePartecipante,
  getRisultati, setRisultati,
  getTuttiPronostici, saveClassifica,
  getSistema, updateSistema, onSistemaSnapshot, getClassificaUpdatedAt,
} from './db.js';
import { caricaEvento, nomePilota, opzioniPilotiHtml } from './evento.js';
import { haSprint } from './competizioni.js';
import { teamBadge } from './pilota.js';
import { normalizzaOrdine, scambiaInPosizione, ordineCompilate, N_SPRINT } from './griglia.js';
import { calcolaPunteggio } from './punteggi.js';
import { showToast, openModal, closeModal, formatDate } from './ui.js';

let _db = null;
let _ris = null;            // copia di lavoro dei risultati ufficiali
let _parts = [];            // partecipanti
let _pronostici_aperti = true;
let _built = false;
let _unsubSistema = null;

const BONUS_CAMPI = [
  { id: 'giroVeloce',      label: '🏁 Giro più veloce',                    tipo: 'pilota' },
  { id: 'pitStopVeloce',   label: '🔧 Pit stop più veloce',                tipo: 'pilota' },
  { id: 'gommaLunga',      label: '🛞 Più giri con la stessa gomma',       tipo: 'pilota' },
  { id: 'primoRitirato',   label: '🚩 Primo ritirato (DNF)',               tipo: 'pilota' },
  { id: 'maggiorGuadagno', label: '📈 Maggior guadagno posizioni in gara', tipo: 'pilota' },
  { id: 'safetyCar',       label: '🚨 Numero di ingressi Safety Car',      tipo: 'numero' },
];

// ── INIT ──────────────────────────────────────────────
export async function initAdmin() {
  const page = document.getElementById('page-admin');
  if (!page) return;

  _db = await caricaEvento();
  _ris = (await getRisultati()) || {};
  if (!_ris.qualifica) _ris.qualifica = {};
  if (!_ris.gara) _ris.gara = {};
  _ris.qualifica.griglia = normalizzaOrdine(_ris.qualifica.griglia);
  _ris.gara.arrivo = normalizzaOrdine(_ris.gara.arrivo);
  if (!_ris.gara.bonus) _ris.gara.bonus = {};
  if (haSprint()) {
    if (!_ris.sprint) _ris.sprint = {};
    _ris.sprint.top8 = normalizzaOrdine(_ris.sprint.top8, N_SPRINT);
  } else {
    delete _ris.sprint;
  }

  _buildShell();
  _built = true;

  _renderSessioneRisultati('qualifica');
  if (haSprint()) _renderSessioneRisultati('sprint');
  _renderSessioneRisultati('gara');
  _renderBonusRisultati();

  try { await _caricaPartecipanti(); }     catch (e) { console.error('[admin] partecipanti', e); }
  try { await _renderSistema(); }          catch (e) { console.error('[admin] sistema', e); }

  if (_unsubSistema) _unsubSistema();
  _unsubSistema = onSistemaSnapshot((cfg) => {
    _pronostici_aperti = cfg?.pronostici_aperti !== false;
    _aggiornaStatoSessioni();
  });
}

/** Ferma gli ascolti real-time (usato quando si cambia competizione). */
export function cleanupAdmin() {
  if (_unsubSistema) { _unsubSistema(); _unsubSistema = null; }
  _built = false;
  _db = null;
  _ris = null;
}

// ── SHELL ─────────────────────────────────────────────
function _buildShell() {
  const page = document.getElementById('page-admin');
  const sprint = haSprint();

  page.innerHTML = `
    <div class="page-header">
      <h2 class="page-title">⚙️ Pannello Admin</h2>
      <span class="page-subtitle">Approvazioni, risultati, sistema</span>
    </div>

    <div class="tab-bar admin-tabs">
      <button type="button" class="tab active" data-tab="tab-admin-approvazioni">
        Approvazioni <span id="approv-badge" class="nav-badge" style="display:none;position:relative;top:-1px;right:auto;margin-left:4px"></span>
      </button>
      <button type="button" class="tab" data-tab="tab-admin-risultati">Risultati</button>
      <button type="button" class="tab" data-tab="tab-admin-partecipanti">Partecipanti</button>
      <button type="button" class="tab" data-tab="tab-admin-sistema">Sistema</button>
    </div>

    <div id="tab-admin-approvazioni" class="tab-content active">
      <div id="admin-approvazioni-container"></div>
    </div>

    <div id="tab-admin-risultati" class="tab-content">
      <div class="info-banner info-banner--yellow">
        <span>📝</span>
        <span>Inserisci i risultati REALI del weekend: ordine di arrivo (gara)${sprint ? ', i primi 8 della Sprint,' : ','} più i 6 bonus. Dopo il salvataggio la classifica viene ricalcolata.</span>
      </div>
      <div class="info-banner info-banner--yellow" style="margin-top:8px">
        <span>⚠️</span>
        <span>Nel campo Qualifiche inserisci l'<strong>ordine effettivo del sabato</strong> (chi ha fatto il tempo migliore in Q1/Q2/Q3), NON la griglia di partenza dopo eventuali penalità per cambio motore/cambio pezzi. I punti si assegnano sull'ordine reale in pista.</span>
      </div>

      <div class="round-head"><h4 class="section-title">🏁 Qualifiche — ordine effettivo (non la griglia post-penalità)</h4>
        <span class="round-progress" id="adm-risprog-qualifica"></span></div>
      <div id="adm-risround-qualifica" class="grid-form"></div>
      <div class="elim-save-row">
        <button type="button" class="btn btn-primary" data-savris="qualifica">💾 Salva griglia Qualifiche</button>
        <span class="elim-save-msg" id="rismsg-qualifica"></span>
      </div>

      ${sprint ? `
      <div class="round-head" style="margin-top:24px"><h4 class="section-title">⚡ Sprint — primi 8 all'arrivo reali</h4>
        <span class="round-progress" id="adm-risprog-sprint"></span></div>
      <div id="adm-risround-sprint" class="grid-form"></div>
      <div class="elim-save-row">
        <button type="button" class="btn btn-primary" data-savris="sprint">💾 Salva Sprint</button>
        <span class="elim-save-msg" id="rismsg-sprint"></span>
      </div>` : ''}

      <div class="round-head" style="margin-top:24px"><h4 class="section-title">🏆 Gara — ordine di arrivo reale</h4>
        <span class="round-progress" id="adm-risprog-gara"></span></div>
      <div id="adm-risround-gara" class="grid-form"></div>

      <div class="round-head" style="margin-top:24px"><h4 class="section-title">🎯 Bonus di gara — esiti reali</h4></div>
      <div id="admin-bonus-box" class="bonus-form"></div>

      <div class="elim-save-row">
        <button type="button" class="btn btn-primary" data-savris="gara">💾 Salva Gara e Bonus</button>
        <span class="elim-save-msg" id="rismsg-gara"></span>
      </div>
    </div>

    <div id="tab-admin-partecipanti" class="tab-content">
      <div id="admin-partecipanti-container"></div>
    </div>

    <div id="tab-admin-sistema" class="tab-content">
      <div class="admin-sistema-grid">
        <div class="sistema-card">
          <h4>📋 Pronostici (${sprint ? 'Qualifiche + Sprint + Gara' : 'Qualifiche + Gara'})</h4>
          <p id="sistema-pronostici-status">—</p>
          <button type="button" id="btn-toggle-pronostici" class="btn btn-secondary">Apri / Chiudi</button>
          <p class="reg-desc" style="margin-top:6px">Un unico interruttore: tutte le schede si chiudono insieme, all'inizio della prima sessione del weekend (${sprint ? 'la Sprint, che precede le Qualifiche' : 'le qualifiche'}). Non esistono blocchi separati per le altre sessioni — vedi Regolamento.</p>
        </div>
        <div class="sistema-card">
          <h4>🏅 Classifica</h4>
          <p id="sistema-classifica-status">—</p>
          <button type="button" id="btn-ricalcola-classifica" class="btn btn-primary">Ricalcola classifica</button>
        </div>
      </div>
    </div>
  `;

  page.querySelectorAll('[data-savris]').forEach(btn => {
    btn.addEventListener('click', () => _salvaRisultatiSessione(btn.dataset.savris, btn));
  });

  page.querySelector('#btn-toggle-pronostici').addEventListener('click', () => _toggleSessione());
  page.querySelector('#btn-ricalcola-classifica').addEventListener('click', () => _ricalcola(true));
}

// ── APPROVAZIONI ──────────────────────────────────────
async function _caricaPartecipanti() {
  _parts = await getPartecipanti();
  _renderApprovazioni();
  _renderPartecipanti();
}

function _displayName(p) {
  return p.nickname || `${p.nome || ''} ${p.cognome || ''}`.trim() || p.id;
}

function _waLink(tel) {
  if (!tel) return null;
  let n = String(tel).replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (n.startsWith('3')) n = '39' + n;
  else if (n.startsWith('0')) n = '39' + n.replace(/^0+/, '');
  if (n.length < 8) return null;
  return 'https://wa.me/' + n;
}

function _waBtn(p) {
  const link = _waLink(p.telefono);
  const msg = encodeURIComponent(`Ciao ${_displayName(p)}! 🏎️ Ti scrivo da Formulito.`);
  if (!link) {
    return `<button type="button" class="btn btn-secondary btn-sm" disabled title="Numero non disponibile">💬 WhatsApp</button>`;
  }
  return `<a href="${link}?text=${msg}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" title="Scrivi su WhatsApp">💬 WhatsApp</a>`;
}

function _renderApprovazioni() {
  const box = document.getElementById('admin-approvazioni-container');
  if (!box) return;
  const pending = _parts.filter(p => p.approvato !== true && p.disabilitato !== true);

  const badge = document.getElementById('approv-badge');
  if (badge) {
    if (pending.length) { badge.style.display = ''; badge.textContent = pending.length; }
    else badge.style.display = 'none';
  }

  if (!pending.length) {
    box.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><p>Nessuna richiesta in attesa.</p></div>`;
    return;
  }

  box.innerHTML = pending.map(p => `
    <div class="admin-row" data-uid="${p.id}">
      <div class="admin-row-info">
        <span class="admin-row-nome">${_displayName(p)}</span>
        <span class="admin-row-sub">${p.nome || ''} ${p.cognome || ''} · ${p.telefono || '—'} · ${p.email || '—'}</span>
      </div>
      <div class="admin-row-actions">
        ${_waBtn(p)}
        <button type="button" class="btn btn-primary btn-sm" data-approva="${p.id}">✅ Approva</button>
        <button type="button" class="btn btn-secondary btn-sm" data-rifiuta="${p.id}">✖ Rifiuta</button>
      </div>
    </div>`).join('');

  box.querySelectorAll('[data-approva]').forEach(b =>
    b.addEventListener('click', () => _approva(b.dataset.approva)));
  box.querySelectorAll('[data-rifiuta]').forEach(b =>
    b.addEventListener('click', () => _rifiuta(b.dataset.rifiuta)));
}

async function _approva(uid) {
  try {
    await updatePartecipante(uid, { approvato: true, disabilitato: false });
    const p = _parts.find(x => x.id === uid); if (p) { p.approvato = true; p.disabilitato = false; }
    showToast('Utente approvato.', 'success');
    _renderApprovazioni(); _renderPartecipanti();
  } catch (err) { showToast('Errore: ' + err.message, 'error'); }
}

function _rifiuta(uid) {
  const p = _parts.find(x => x.id === uid);
  openModal({
    title: 'Rifiuta richiesta',
    body: `<p>Rifiutare la richiesta di <strong>${p ? _displayName(p) : uid}</strong>? L'account verrà disabilitato e non potrà accedere.</p>`,
    buttons: [
      { label: 'Annulla', cls: 'btn btn-secondary', onClick: closeModal },
      { label: 'Rifiuta', cls: 'btn btn-danger', onClick: async () => {
          closeModal();
          try {
            await updatePartecipante(uid, { approvato: false, disabilitato: true });
            const pp = _parts.find(x => x.id === uid); if (pp) { pp.approvato = false; pp.disabilitato = true; }
            showToast('Richiesta rifiutata.', 'info');
            _renderApprovazioni(); _renderPartecipanti();
          } catch (err) { showToast('Errore: ' + err.message, 'error'); }
        } },
    ],
  });
}

// ── PARTECIPANTI ──────────────────────────────────────
async function _renderPartecipanti() {
  const box = document.getElementById('admin-partecipanti-container');
  if (!box) return;

  let compilati = {};
  try {
    const prons = await getTuttiPronostici();
    prons.forEach(d => {
      const n = ordineCompilate(normalizzaOrdine(d.qualifica?.griglia)) + ordineCompilate(normalizzaOrdine(d.gara?.arrivo));
      compilati[d.id] = n;
    });
  } catch (_) {}

  const lista = _parts.filter(p => p.approvato === true);
  if (!lista.length) { box.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>Nessun partecipante approvato.</p></div>`; return; }

  box.innerHTML = `<div class="admin-part-list">` + lista.map(p => {
    const n = compilati[p.id] || 0;
    const owner = p.isOwner === true;
    const disab = p.disabilitato === true;
    return `
    <div class="admin-row${disab ? ' admin-row--off' : ''}" data-uid="${p.id}">
      <div class="admin-row-info">
        <span class="admin-row-nome">${_displayName(p)}
          ${p.isAdmin ? '<span class="badge-admin">admin</span>' : ''}
          ${owner ? '<span class="badge-owner">owner</span>' : ''}
        </span>
        <span class="admin-row-sub">${n}/44 posizioni compilate · ${p.email || '—'}${disab ? ' · disabilitato' : ''}</span>
      </div>
      <div class="admin-row-actions">
        ${_waBtn(p)}
        <button type="button" class="btn btn-secondary btn-sm" data-toggleadmin="${p.id}" ${owner ? 'disabled title="Owner sempre admin"' : ''}>
          ${p.isAdmin ? '↓ Rimuovi admin' : '↑ Rendi admin'}
        </button>
        <button type="button" class="btn btn-secondary btn-sm" data-toggleoff="${p.id}" ${owner ? 'disabled title="Owner protetto"' : ''}>
          ${disab ? '✓ Riattiva' : '⛔ Disabilita'}
        </button>
      </div>
    </div>`;
  }).join('') + `</div>`;

  box.querySelectorAll('[data-toggleadmin]').forEach(b =>
    b.addEventListener('click', () => _toggleAdmin(b.dataset.toggleadmin)));
  box.querySelectorAll('[data-toggleoff]').forEach(b =>
    b.addEventListener('click', () => _toggleOff(b.dataset.toggleoff)));
}

async function _toggleAdmin(uid) {
  const p = _parts.find(x => x.id === uid); if (!p || p.isOwner) return;
  try {
    await updatePartecipante(uid, { isAdmin: !p.isAdmin });
    p.isAdmin = !p.isAdmin;
    showToast('Permessi aggiornati.', 'success');
    _renderPartecipanti();
  } catch (err) { showToast('Errore: ' + err.message, 'error'); }
}

async function _toggleOff(uid) {
  const p = _parts.find(x => x.id === uid); if (!p || p.isOwner) return;
  try {
    await updatePartecipante(uid, { disabilitato: !p.disabilitato });
    p.disabilitato = !p.disabilitato;
    showToast('Stato aggiornato.', 'success');
    _renderPartecipanti();
  } catch (err) { showToast('Errore: ' + err.message, 'error'); }
}

// Stessa logica "menu aperto = nome+scuderia, chiuso = solo nome" di pronostici.js:
// il badge scuderia accanto al select renderebbe la scuderia ripetuta due volte.
function _espandiOpzioni(sel) {
  Array.from(sel.options).forEach(o => { if (o.dataset.full) o.textContent = o.dataset.full; });
}
function _accorciaSelectChiuso(sel) {
  const opt = sel.options[sel.selectedIndex];
  if (opt && opt.dataset.short) opt.textContent = opt.dataset.short;
}

// ── RISULTATI (griglia/top8/arrivo reali) ─────────────
function _campoRis(sessione) {
  if (sessione === 'qualifica') return _ris.qualifica.griglia;
  if (sessione === 'sprint') return _ris.sprint.top8;
  return _ris.gara.arrivo;
}
function _setCampoRis(sessione, arr) {
  if (sessione === 'qualifica') _ris.qualifica.griglia = arr;
  else if (sessione === 'sprint') _ris.sprint.top8 = arr;
  else _ris.gara.arrivo = arr;
}

function _renderSessioneRisultati(sessione) {
  const box = document.getElementById('adm-risround-' + sessione);
  if (!box) return;
  const campo = _campoRis(sessione);

  // Come nella scheda utente: menu per scuderia e scambio rapido tra due posizioni
  const optsHtml = (selPid, posizione) => opzioniPilotiHtml(_db, {
    selPid,
    vuoto: '— non assegnato —',
    nota: (pid) => {
      const dove = campo.indexOf(pid);
      return dove !== -1 && dove !== posizione ? `P${dove + 1} ↔ scambia` : null;
    },
  });

  let html = '';
  for (let i = 0; i < campo.length; i++) {
    const pid = campo[i];
    html += `<div class="grid-row${i === 0 ? ' grid-row--top' : ''}" data-pos="${i}">
      <span class="grid-row-pos" title="${i === 0 ? (sessione === 'qualifica' ? 'Pole position' : 'Vincitore') : ''}">P${i + 1}</span>
      <select class="grid-select" data-sessione="${sessione}" data-pos="${i}">${optsHtml(pid, i)}</select>
      ${pid ? teamBadge(_db, pid) : ''}
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
      const nuovo = scambiaInPosizione(_campoRis(s), pos, sel.value || null);
      _setCampoRis(s, nuovo);
      _renderSessioneRisultati(s);
    });
  });

  const prog = document.getElementById('adm-risprog-' + sessione);
  if (prog) prog.textContent = `${ordineCompilate(campo)}/${campo.length}`;
}

function _renderBonusRisultati() {
  const box = document.getElementById('admin-bonus-box');
  if (!box) return;
  const optsHtml = (sel) => opzioniPilotiHtml(_db, { selPid: sel, vuoto: '— non assegnato —' });

  box.innerHTML = BONUS_CAMPI.map(c => {
    const val = _ris.gara.bonus[c.id];
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

  box.querySelectorAll('.bonus-select').forEach(s =>
    s.addEventListener('change', () => { _ris.gara.bonus[s.dataset.bonus] = s.value || null; }));
  box.querySelectorAll('.bonus-num').forEach(inp =>
    inp.addEventListener('input', () => {
      const raw = inp.value.trim();
      _ris.gara.bonus[inp.dataset.bonus] = raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0);
    }));
}

async function _salvaRisultatiSessione(sessione, btn) {
  const msg = document.getElementById('rismsg-' + sessione);
  btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ Salvataggio…';
  try {
    if (sessione === 'qualifica') {
      await setRisultati({ qualifica: { griglia: _ris.qualifica.griglia } });
    } else if (sessione === 'sprint') {
      await setRisultati({ sprint: { top8: _ris.sprint.top8 } });
    } else {
      await setRisultati({ gara: { arrivo: _ris.gara.arrivo, bonus: _ris.gara.bonus } });
    }
    if (msg) { msg.textContent = '✅ Salvato'; msg.className = 'elim-save-msg ok'; }
    showToast('Risultati salvati. Ricalcolo classifica…', 'success');
    await _ricalcola(false);
  } catch (err) {
    if (msg) { msg.textContent = '❌ Errore'; msg.className = 'elim-save-msg err'; }
    showToast('Errore: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = old;
    setTimeout(() => { if (msg) msg.textContent = ''; }, 4000);
  }
}

// ── SISTEMA ───────────────────────────────────────────
async function _renderSistema() {
  try {
    const cfg = await getSistema();
    _pronostici_aperti = cfg?.pronostici_aperti !== false;
  } catch (_) {}
  _aggiornaStatoSessioni();
  try {
    const ts = await getClassificaUpdatedAt();
    const el = document.getElementById('sistema-classifica-status');
    if (el) el.textContent = ts ? `Ultimo aggiornamento: ${formatDate(ts.toISOString(), true)}` : 'Mai ricalcolata';
  } catch (_) {}
}

function _aggiornaStatoSessioni() {
  const p = document.getElementById('sistema-pronostici-status');
  const label = haSprint() ? 'Qualifiche, Sprint e Gara' : 'Qualifiche e Gara';
  if (p) p.textContent = _pronostici_aperti ? `🟢 Aperti — i partecipanti possono modificare ${label}` : '🔴 Chiusi — schede bloccate';
}

async function _toggleSessione() {
  const nuovo = !_pronostici_aperti;
  try {
    await updateSistema({ pronostici_aperti: nuovo });
    _pronostici_aperti = nuovo;
    _aggiornaStatoSessioni();
    showToast(nuovo ? 'Pronostici aperti.' : 'Pronostici chiusi.', 'success');
  } catch (err) { showToast('Errore: ' + err.message, 'error'); }
}

// ── RICALCOLO CLASSIFICA (client-side) ────────────────
async function _ricalcola(manuale) {
  const btn = document.getElementById('btn-ricalcola-classifica');
  if (manuale && btn) { btn.disabled = true; btn.textContent = '⏳ Ricalcolo…'; }
  try {
    const [parts, prons, ris] = await Promise.all([
      getPartecipanti(), getTuttiPronostici(), getRisultati(),
    ]);
    const nomi = {};
    parts.forEach(p => {
      if (p.approvato === true && p.disabilitato !== true) {
        nomi[p.id] = p.nickname || `${p.nome || ''} ${p.cognome || ''}`.trim() || p.id;
      }
    });

    const out = [];
    const visti = new Set();
    prons.forEach(d => {
      if (!nomi[d.id]) return;
      const { totale, breakdown, spareggio } = calcolaPunteggio(d, ris);
      out.push({ id: d.id, nome: nomi[d.id], totale, breakdown, spareggio });
      visti.add(d.id);
    });
    Object.keys(nomi).forEach(uid => {
      if (visti.has(uid)) return;
      out.push({ id: uid, nome: nomi[uid], totale: 0,
        breakdown: { qualifica: 0, gara: 0, bonus: 0 },
        spareggio: [0, 0, 0] });
    });

    await saveClassifica(out);
    showToast(`Classifica ricalcolata (${out.length} partecipanti).`, 'success');
    const el = document.getElementById('sistema-classifica-status');
    if (el) el.textContent = `Ultimo aggiornamento: ${formatDate(new Date().toISOString(), true)}`;
  } catch (err) {
    showToast('Errore nel ricalcolo: ' + err.message, 'error');
  } finally {
    if (manuale && btn) { btn.disabled = false; btn.textContent = 'Ricalcola classifica'; }
  }
}