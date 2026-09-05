/**
 * FORMULITO — admin.js
 * Pannello admin per il GP d'Italia 2026 (Monza, weekend di test). Funzioni:
 *  - Approvazioni: accetta/rifiuta le richieste di iscrizione
 *  - Risultati: inserisci/correggi la griglia di qualifica reale, l'arrivo
 *    di gara reale e i 6 bonus di gara
 *  - Partecipanti: stato schede, abilita/disabilita, gestione admin
 *  - Montepremi: quote, pagamenti, ripartizione premi (invariato da Medusino)
 *  - Sistema: un unico interruttore apri/chiudi pronostici (Qualifiche e Gara
 *    si bloccano insieme, all'inizio delle qualifiche — vedi nota in pronostici.js),
 *    ricalcola la classifica
 *
 * Il ricalcolo classifica è interamente client-side: carica pronostici +
 * risultati, applica punteggi.js, scrive classifica/snapshot.
 */

import { STATE } from './app.js';
import {
  getPartecipanti, updatePartecipante, setPagamento,
  getRisultati, setRisultati,
  getTuttiPronostici, saveClassifica, getClassifica,
  getSistema, updateSistema, onSistemaSnapshot, getClassificaUpdatedAt,
} from './db.js';
import { caricaEvento, nomePilota, elencoPiloti } from './evento.js';
import { teamBadge } from './pilota.js';
import { normalizzaOrdine, setInPosizione, ordineCompilate } from './griglia.js';
import { calcolaPunteggio } from './punteggi.js';
import { showToast, openModal, closeModal, formatDate } from './ui.js';

let _db = null;
let _ris = null;            // copia di lavoro dei risultati ufficiali
let _parts = [];            // partecipanti
let _pronostici_aperti = true;
let _built = false;
let _montepremiCfg = { quota: 0, percentuali: [60, 30, 10] };

const METODI_PAGAMENTO = ['Contanti', 'Bonifico', 'Satispay', 'PayPal', 'Revolut'];

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

  _buildShell();
  _built = true;

  _renderSessioneRisultati('qualifica');
  _renderSessioneRisultati('gara');
  _renderBonusRisultati();

  try { await _caricaConfigMontepremi(); } catch (e) { console.error('[admin] config montepremi', e); }
  try { await _caricaPartecipanti(); }     catch (e) { console.error('[admin] partecipanti', e); }
  try { await _renderSistema(); }          catch (e) { console.error('[admin] sistema', e); }
  try { await _renderMontepremi(); }       catch (e) { console.error('[admin] montepremi', e); }

  onSistemaSnapshot((cfg) => {
    _pronostici_aperti = cfg?.pronostici_aperti !== false;
    _aggiornaStatoSessioni();
  });
}

// ── SHELL ─────────────────────────────────────────────
function _buildShell() {
  const page = document.getElementById('page-admin');

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
      <button type="button" class="tab" data-tab="tab-admin-montepremi">💰 Montepremi</button>
      <button type="button" class="tab" data-tab="tab-admin-sistema">Sistema</button>
    </div>

    <div id="tab-admin-approvazioni" class="tab-content active">
      <div id="admin-approvazioni-container"></div>
    </div>

    <div id="tab-admin-risultati" class="tab-content">
      <div class="info-banner info-banner--yellow">
        <span>📝</span>
        <span>Inserisci i risultati REALI del weekend: ordine di arrivo (gara), più i 6 bonus. Dopo il salvataggio la classifica viene ricalcolata.</span>
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

    <div id="tab-admin-montepremi" class="tab-content">
      <div class="info-banner info-banner--yellow">
        <span>💰</span>
        <span>Segna chi ha pagato, a chi e con quale metodo. Il montepremi e la ripartizione si aggiornano in automatico.</span>
      </div>
      <div id="admin-montepremi-container"></div>
    </div>

    <div id="tab-admin-sistema" class="tab-content">
      <div class="admin-sistema-grid">
        <div class="sistema-card">
          <h4>📋 Pronostici (Qualifiche + Gara)</h4>
          <p id="sistema-pronostici-status">—</p>
          <button type="button" id="btn-toggle-pronostici" class="btn btn-secondary">Apri / Chiudi</button>
          <p class="reg-desc" style="margin-top:6px">Un unico interruttore: si chiudono insieme, all'inizio delle qualifiche (sabato 16:00). Non esiste un secondo blocco per la gara — vedi Regolamento.</p>
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

  const tabMp = page.querySelector('[data-tab="tab-admin-montepremi"]');
  if (tabMp) tabMp.addEventListener('click', () => setTimeout(async () => {
    await _caricaClassificaCache();
    await _renderMontepremi();
  }, 0));
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

// ── RISULTATI (griglia/arrivo reali) ──────────────────
function _renderSessioneRisultati(sessione) {
  const box = document.getElementById('adm-risround-' + sessione);
  if (!box) return;
  const campo = sessione === 'qualifica' ? _ris.qualifica.griglia : _ris.gara.arrivo;
  const ids = elencoPiloti(_db);

  const optsHtml = (selPid, posizione) => {
    let out = '<option value="">— non assegnato —</option>';
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
    html += `<div class="grid-row${i === 0 ? ' grid-row--top' : ''}" data-pos="${i}">
      <span class="grid-row-pos" title="${sessione === 'qualifica' ? (i === 0 ? 'Pole position' : '') : (i === 0 ? 'Vincitore' : '')}">P${i + 1}</span>
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
      const c = s === 'qualifica' ? _ris.qualifica.griglia : _ris.gara.arrivo;
      const nuovo = setInPosizione(c, pos, sel.value || null);
      if (s === 'qualifica') _ris.qualifica.griglia = nuovo; else _ris.gara.arrivo = nuovo;
      _renderSessioneRisultati(s);
    });
  });

  const prog = document.getElementById('adm-risprog-' + sessione);
  if (prog) prog.textContent = `${ordineCompilate(campo)}/${campo.length}`;
}

function _renderBonusRisultati() {
  const box = document.getElementById('admin-bonus-box');
  if (!box) return;
  const ids = elencoPiloti(_db);
  const optsHtml = (sel) => '<option value="">— non assegnato —</option>' +
    ids.map(pid => `<option value="${pid}"${sel === pid ? ' selected' : ''}>${nomePilota(_db, pid)} — ${_db.piloti[pid].team}</option>`).join('');

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
  if (p) p.textContent = _pronostici_aperti ? '🟢 Aperti — i partecipanti possono modificare Qualifiche e Gara' : '🔴 Chiusi — schede bloccate';
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

// ── MONTEPREMI / PAGAMENTI ────────────────────────────
let _classificaCache = [];

async function _caricaConfigMontepremi() {
  try {
    const cfg = await getSistema();
    const mp = cfg?.montepremi || {};
    _montepremiCfg = {
      quota: Number(mp.quota) || 0,
      percentuali: Array.isArray(mp.percentuali) && mp.percentuali.length === 3
        ? mp.percentuali.map(n => Number(n) || 0)
        : [60, 30, 10],
    };
  } catch (_) {
    _montepremiCfg = { quota: 0, percentuali: [60, 30, 10] };
  }
  await _caricaClassificaCache();
}

async function _caricaClassificaCache() {
  try { _classificaCache = (await getClassifica()) || []; }
  catch (_) { _classificaCache = []; }
}

function _incassatori() {
  return _parts
    .filter(p => p.isAdmin === true && p.disabilitato !== true)
    .sort((a, b) => _displayName(a).localeCompare(_displayName(b), 'it'));
}

function _importoPagamento(p) {
  const pag = p.pagamento;
  if (!pag || pag.pagato !== true) return 0;
  const imp = Number(pag.importo);
  return Number.isFinite(imp) && imp > 0 ? imp : _montepremiCfg.quota;
}

function _fmtEuro(n) {
  return '€ ' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('it-IT',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _classificaOrdinata() {
  const arr = [..._classificaCache];
  arr.sort((a, b) => {
    if ((b.totale || 0) !== (a.totale || 0)) return (b.totale || 0) - (a.totale || 0);
    const sa = a.spareggio || [], sb = b.spareggio || [];
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      const d = (Number(sb[i]) || 0) - (Number(sa[i]) || 0);
      if (d) return d;
    }
    return (a.nome || '').localeCompare(b.nome || '', 'it');
  });
  return arr;
}

async function _renderMontepremi() {
  const box = document.getElementById('admin-montepremi-container');
  if (!box) return;

  const approvati = _parts.filter(p => p.approvato === true && p.disabilitato !== true);
  const paganti = approvati.filter(p => p.pagamento?.pagato === true);
  const montepremi = paganti.reduce((s, p) => s + _importoPagamento(p), 0);
  const atteso = _montepremiCfg.quota * approvati.length;
  const daIncassare = Math.max(0, atteso - montepremi);

  const [p1, p2, p3] = _montepremiCfg.percentuali;
  const sommaPerc = p1 + p2 + p3;
  const ord = _classificaOrdinata();
  const posti = [
    { etichetta: '🥇 1º', perc: p1, vinc: ord[0] },
    { etichetta: '🥈 2º', perc: p2, vinc: ord[1] },
    { etichetta: '🥉 3º', perc: p3, vinc: ord[2] },
  ];

  const incassatori = _incassatori();
  const incOpts = (sel) => '<option value="">— a chi —</option>' +
    incassatori.map(a => `<option value="${a.id}"${sel === a.id ? ' selected' : ''}>${_displayName(a)}</option>`).join('');
  const metOpts = (sel) => '<option value="">— metodo —</option>' +
    METODI_PAGAMENTO.map(m => `<option value="${m}"${sel === m ? ' selected' : ''}>${m}</option>`).join('');

  const cfgCard = `
    <div class="sistema-card mp-config">
      <h4>⚙️ Impostazioni montepremi</h4>
      <div class="mp-config-row">
        <label for="mp-quota">Quota a testa</label>
        <div class="mp-input-euro"><span>€</span>
          <input type="number" id="mp-quota" min="0" step="0.5" value="${_montepremiCfg.quota || ''}" placeholder="0">
        </div>
      </div>
      <div class="mp-config-row">
        <label>Ripartizione premi</label>
        <div class="mp-perc-inputs">
          <span class="mp-perc-pos">1º</span><input type="number" class="mp-perc" id="mp-p1" min="0" max="100" value="${p1}">%
          <span class="mp-perc-pos">2º</span><input type="number" class="mp-perc" id="mp-p2" min="0" max="100" value="${p2}">%
          <span class="mp-perc-pos">3º</span><input type="number" class="mp-perc" id="mp-p3" min="0" max="100" value="${p3}">%
          <span class="mp-perc-sum${sommaPerc === 100 ? ' ok' : ' warn'}" id="mp-perc-sum">tot ${sommaPerc}%</span>
        </div>
      </div>
      <button type="button" class="btn btn-primary" id="mp-save-cfg">💾 Salva impostazioni</button>
    </div>`;

  const summaryCard = `
    <div class="mp-summary">
      <div class="mp-stat"><span class="mp-stat-val">${paganti.length}/${approvati.length}</span><span class="mp-stat-lbl">Paganti</span></div>
      <div class="mp-stat mp-stat--accent"><span class="mp-stat-val">${_fmtEuro(montepremi)}</span><span class="mp-stat-lbl">Montepremi</span></div>
      <div class="mp-stat"><span class="mp-stat-val">${_fmtEuro(daIncassare)}</span><span class="mp-stat-lbl">Ancora da incassare</span></div>
    </div>
    <div class="sistema-card mp-distrib">
      <h4>🏆 Distribuzione premi</h4>
      ${sommaPerc !== 100 ? '<p class="mp-warn-line">⚠️ Le percentuali non fanno 100%: gli importi sono comunque calcolati sul totale indicato.</p>' : ''}
      <div class="mp-distrib-list">
        ${posti.map(p => `
          <div class="mp-distrib-row">
            <span class="mp-distrib-pos">${p.etichetta}</span>
            <span class="mp-distrib-perc">${p.perc}%</span>
            <span class="mp-distrib-amt">${_fmtEuro(montepremi * p.perc / 100)}</span>
            <span class="mp-distrib-name">${p.vinc ? p.vinc.nome : '<em class="text-muted">da definire</em>'}</span>
          </div>`).join('')}
      </div>
      ${_classificaCache.length ? '' : '<p class="text-muted mp-distrib-note">La classifica non è ancora stata calcolata: i nomi dei vincitori compaiono dopo il primo ricalcolo.</p>'}
    </div>`;

  let rows;
  if (!approvati.length) {
    rows = `<div class="empty-state"><div class="empty-icon">👥</div><p>Nessun partecipante approvato.</p></div>`;
  } else {
    const sorted = [...approvati].sort((a, b) => _displayName(a).localeCompare(_displayName(b), 'it'));
    rows = `<div class="mp-pay-list">` + sorted.map(p => {
      const pag = p.pagamento || {};
      const pagato = pag.pagato === true;
      const imp = pagato ? (pag.importo ?? _montepremiCfg.quota) : '';
      return `
      <div class="mp-pay-row${pagato ? ' mp-pay-row--ok' : ''}" data-uid="${p.id}">
        <label class="mp-pay-check">
          <input type="checkbox" data-mp-pagato="${p.id}" ${pagato ? 'checked' : ''}>
          <span class="mp-pay-name">${_displayName(p)}</span>
        </label>
        <div class="mp-input-euro mp-pay-importo">
          <span>€</span>
          <input type="number" min="0" step="0.5" data-mp-importo="${p.id}" value="${imp}" ${pagato ? '' : 'disabled'} placeholder="${_montepremiCfg.quota || 0}">
        </div>
        <select class="mp-pay-select" data-mp-incassato="${p.id}" ${pagato ? '' : 'disabled'}>${incOpts(pag.incassatoDa || '')}</select>
        <select class="mp-pay-select" data-mp-metodo="${p.id}" ${pagato ? '' : 'disabled'}>${metOpts(pag.metodo || '')}</select>
      </div>`;
    }).join('') + `</div>`;
  }

  box.innerHTML = `
    ${cfgCard}
    ${summaryCard}
    <div class="mp-pay">
      <div class="round-head"><h4 class="section-title">Pagamenti</h4>
        <span class="round-progress">${paganti.length}/${approvati.length} pagati</span></div>
      ${rows}
    </div>`;

  box.querySelector('#mp-save-cfg')?.addEventListener('click', (e) => _salvaConfigMontepremi(e.target));
  ['mp-p1', 'mp-p2', 'mp-p3'].forEach(id => {
    box.querySelector('#' + id)?.addEventListener('input', () => {
      const s = (Number(box.querySelector('#mp-p1').value) || 0)
        + (Number(box.querySelector('#mp-p2').value) || 0)
        + (Number(box.querySelector('#mp-p3').value) || 0);
      const el = box.querySelector('#mp-perc-sum');
      if (el) { el.textContent = 'tot ' + s + '%'; el.className = 'mp-perc-sum ' + (s === 100 ? 'ok' : 'warn'); }
    });
  });

  box.querySelectorAll('[data-mp-pagato]').forEach(c =>
    c.addEventListener('change', () => _setPagato(c.dataset.mpPagato, c.checked)));
  box.querySelectorAll('[data-mp-importo]').forEach(i =>
    i.addEventListener('change', () => _setPagamentoCampo(i.dataset.mpImporto, 'importo', Number(i.value) || 0)));
  box.querySelectorAll('[data-mp-incassato]').forEach(s =>
    s.addEventListener('change', () => _setPagamentoCampo(s.dataset.mpIncassato, 'incassatoDa', s.value || '')));
  box.querySelectorAll('[data-mp-metodo]').forEach(s =>
    s.addEventListener('change', () => _setPagamentoCampo(s.dataset.mpMetodo, 'metodo', s.value || '')));
}

async function _salvaConfigMontepremi(btn) {
  const quota = Number(document.getElementById('mp-quota')?.value) || 0;
  const p1 = Number(document.getElementById('mp-p1')?.value) || 0;
  const p2 = Number(document.getElementById('mp-p2')?.value) || 0;
  const p3 = Number(document.getElementById('mp-p3')?.value) || 0;
  if (quota < 0) { showToast('La quota non può essere negativa.', 'error'); return; }
  const old = btn.textContent; btn.disabled = true; btn.textContent = '⏳ Salvataggio…';
  try {
    _montepremiCfg = { quota, percentuali: [p1, p2, p3] };
    await updateSistema({ montepremi: _montepremiCfg });
    showToast('Impostazioni montepremi salvate.', 'success');
    await _renderMontepremi();
  } catch (err) {
    showToast('Errore: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

async function _setPagato(uid, pagato) {
  const p = _parts.find(x => x.id === uid); if (!p) return;
  const prev = p.pagamento || {};
  const pagamento = pagato
    ? { pagato: true,
        importo: (prev.importo ?? _montepremiCfg.quota),
        incassatoDa: prev.incassatoDa || '',
        metodo: prev.metodo || '',
        data: prev.data || new Date().toISOString() }
    : { ...prev, pagato: false };
  try {
    await setPagamento(uid, pagamento);
    p.pagamento = pagamento;
    showToast(pagato ? 'Pagamento registrato.' : 'Pagamento annullato.', pagato ? 'success' : 'info');
    await _renderMontepremi();
  } catch (err) { showToast('Errore: ' + err.message, 'error'); }
}

async function _setPagamentoCampo(uid, campo, valore) {
  const p = _parts.find(x => x.id === uid); if (!p) return;
  const pagamento = { ...(p.pagamento || { pagato: true }), [campo]: valore };
  if (pagamento.pagato !== true) pagamento.pagato = true;
  if (!pagamento.data) pagamento.data = new Date().toISOString();
  try {
    await setPagamento(uid, pagamento);
    p.pagamento = pagamento;
    if (campo === 'importo') await _renderMontepremi();
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
    _classificaCache = out;
    if (document.getElementById('admin-montepremi-container')) await _renderMontepremi();
    showToast(`Classifica ricalcolata (${out.length} partecipanti).`, 'success');
    const el = document.getElementById('sistema-classifica-status');
    if (el) el.textContent = `Ultimo aggiornamento: ${formatDate(new Date().toISOString(), true)}`;
  } catch (err) {
    showToast('Errore nel ricalcolo: ' + err.message, 'error');
  } finally {
    if (manuale && btn) { btn.disabled = false; btn.textContent = 'Ricalcola classifica'; }
  }
}
