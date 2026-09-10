/**
 * FORMULITO — app.js
 * Router principale e gestione stato globale
 */

import { initAuth, registra, getCurrentUser, onAuthChange, logout } from './auth.js';
import { initClassifica, renderClassifica, cleanupClassifica } from './classifica.js';
import { initPronostici, cleanupPronostici } from './pronostici.js';
import { initLive, cleanupLive } from './live.js';
import { initAdmin, cleanupAdmin } from './admin.js';
import { initProfilo } from './profilo.js';
import { showToast } from './ui.js';
import { getCompetizioni, getCompetizione, competizioneAttuale, setCompetizioneAttuale } from './competizioni.js';

// ── STATO GLOBALE ──────────────────────────────────────
export const STATE = {
  utente: null,       // { id, nome, cognome, isAdmin, approvato }
  pagina: 'classifica',
  profiloUid: null,   // uid del profilo visualizzato (null = profilo personale)
  pronosticiAperti: true, // false quando i pronostici sono chiusi (aggiornato da pronostici.js)
  db: null,
  competizioneId: competizioneAttuale(), // competizione attiva (vedi competizioni.js)
  _appInizializzata: false,
};

// ── ENTRY POINT ────────────────────────────────────────
export async function initApp() {
  STATE.db = window._firebase.db;

  // Ascolta i cambi di autenticazione
  onAuthChange(async (utente) => {
    if (!utente) {
      cleanupPronostici();
      STATE._appInizializzata = false;
      STATE.utente = null;
      mostraLogin();
      return;
    }
    STATE.utente = utente;
    if (utente.disabilitato) {
      mostraDisabilitato(utente);
    } else if (!utente.approvato) {
      mostraAttesa(utente);
    } else {
      await mostraApp();
    }
  });

  // ── Tab login / registrazione ──
  document.getElementById('tab-accedi').addEventListener('click', () => {
    document.getElementById('tab-accedi').classList.add('active');
    document.getElementById('tab-registrati').classList.remove('active');
    document.getElementById('form-login').style.display = '';
    document.getElementById('form-registrazione').style.display = 'none';
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('reg-error').style.display = 'none';
  });

  document.getElementById('tab-registrati').addEventListener('click', () => {
    document.getElementById('tab-registrati').classList.add('active');
    document.getElementById('tab-accedi').classList.remove('active');
    document.getElementById('form-registrazione').style.display = '';
    document.getElementById('form-login').style.display = 'none';
    document.getElementById('login-error').style.display = 'none';
    document.getElementById('reg-error').style.display = 'none';
  });

  // ── Form login ──
  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    document.getElementById('login-error').style.display = 'none';
    const emailInput = document.getElementById('login-email').value.trim();
    const password   = document.getElementById('login-password').value;
    if (!emailInput) { showLoginError('Inserisci email o nome utente.'); return; }
    try {
      await initAuth(emailInput, password);
    } catch (err) {
      const msg = _traduciErroreAuth(err.code) || 'Credenziali errate. Riprova.';
      showLoginError(msg);
    }
  });

  // ── Form registrazione ──
  document.getElementById('form-registrazione').addEventListener('submit', async (e) => {
    e.preventDefault();
    document.getElementById('reg-error').style.display = 'none';

    const nome     = document.getElementById('reg-nome').value.trim();
    const cognome  = document.getElementById('reg-cognome').value.trim();
    const email    = document.getElementById('reg-email').value.trim();
    const telefono = document.getElementById('reg-telefono').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim();
    const pw1      = document.getElementById('reg-password').value;
    const pw2      = document.getElementById('reg-password2').value;

    if (!nome || !cognome || !email || !telefono || !nickname) { showRegError('Compila tutti i campi.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showRegError('Inserisci un indirizzo email valido.'); return; }
    if (nickname.length < 2) { showRegError('Il nickname deve avere almeno 2 caratteri.'); return; }
    if (pw1 !== pw2) { showRegError('Le password non coincidono.'); return; }
    if (pw1.length < 6) { showRegError('La password deve avere almeno 6 caratteri.'); return; }

    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = '⏳ Invio in corso…';

    try {
      await registra(nome, cognome, email, telefono, pw1, nickname);
      // onAuthChange gestirà il redirect alla schermata attesa
    } catch (err) {
      const msg = _traduciErroreAuth(err.code) || 'Errore nella registrazione. Riprova.';
      showRegError(msg);
      btn.disabled = false;
      btn.textContent = 'Invia richiesta di accesso';
    }
  });
}

// ── SCHERMATE ──────────────────────────────────────────
function mostraLogin() {
  _nascondiTutto();
  document.getElementById('screen-login').style.display = '';
  // Reset tab su "Accedi"
  document.getElementById('tab-accedi').classList.add('active');
  document.getElementById('tab-registrati').classList.remove('active');
  document.getElementById('form-login').style.display = '';
  document.getElementById('form-registrazione').style.display = 'none';
}

function mostraDisabilitato(utente) {
  _nascondiTutto();
  document.getElementById('screen-disabilitato').style.display = '';
  document.getElementById('disab-nome').textContent =
    `${utente.nome} ${utente.cognome || ''}`.trim();
  document.getElementById('btn-logout-disab').onclick = async () => {
    await logout();
  };
}

function mostraAttesa(utente) {
  _nascondiTutto();
  document.getElementById('screen-attesa').style.display = '';
  document.getElementById('attesa-nome').textContent =
    `${utente.nome} ${utente.cognome || ''}`.trim();
  document.getElementById('attesa-telefono').textContent = utente.telefono || '—';

  document.getElementById('btn-logout-attesa').onclick = async () => {
    await logout();
  };
}

async function mostraApp() {
  _nascondiTutto();
  document.getElementById('screen-app').style.display = '';

  // Header — mostra nickname se disponibile, altrimenti nome
  const displayName = STATE.utente.nickname || STATE.utente.nome || '';
  document.getElementById('header-username').textContent = displayName;

  // Nav admin
  if (STATE.utente.isAdmin) {
    document.getElementById('nav-admin').style.display = '';
  }

  // Selettore competizione (chi era già approvato è automaticamente valido
  // per tutte le competizioni: nessuna nuova approvazione richiesta)
  _initSelettoreCompetizione();
  _aggiornaRegolamentoEvento();

  // Logout
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await logout();
  });

  // Navigazione
  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigaA(btn.dataset.page));
  });

  // Tabs globali (per le tab interne alle pagine)
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const tabBar = tab.closest('.tab-bar');
    if (!tabBar) return;
    tabBar.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const targetId = tab.dataset.tab;
    if (!targetId) return;
    const parent = tabBar.parentElement;
    parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const target = parent.querySelector('#' + targetId) || document.getElementById(targetId);
    if (target) target.classList.add('active');
  });

  // Inizializza moduli (una volta sola)
  if (!STATE._appInizializzata) {
    STATE._appInizializzata = true;
    await initClassifica();
    await initLive();
    await initPronostici();
    await initProfilo();
    if (STATE.utente.isAdmin) await initAdmin();
  }

  navigaA('classifica');
}

function _nascondiTutto() {
  ['screen-login', 'screen-attesa', 'screen-app'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

// ── SELETTORE COMPETIZIONE ─────────────────────────────
// Stesso login, stessi partecipanti: chi è approvato lo è per tutte le
// competizioni. Ogni competizione ha però la propria scheda pronostici,
// risultati e classifica (classifiche NON cumulative tra loro).
let _selettoreCompBound = false;

function _initSelettoreCompetizione() {
  const sel = document.getElementById('header-competizione');
  if (!sel) return;

  if (!sel.options.length) {
    sel.innerHTML = getCompetizioni()
      .map(c => `<option value="${c.id}">${c.nome}</option>`)
      .join('');
  }
  sel.value = STATE.competizioneId;

  if (!_selettoreCompBound) {
    sel.addEventListener('change', () => cambiaCompetizione(sel.value));
    _selettoreCompBound = true;
  }
}

/**
 * Cambia la competizione attiva: aggiorna lo stato/localStorage, azzera e
 * ri-inizializza tutti i moduli che leggono dati Firestore per-competizione
 * (classifica, risultati, pronostici, profilo, admin), senza toccare login
 * o approvazione (che restano validi per tutte le competizioni).
 */
async function cambiaCompetizione(id) {
  if (!setCompetizioneAttuale(id)) return; // id invalido o invariato
  STATE.competizioneId = id;

  cleanupClassifica();
  cleanupLive();
  cleanupPronostici();
  if (STATE.utente?.isAdmin) cleanupAdmin();

  showToast(`Competizione: ${getCompetizione(id).nome}`, 'info');

  await initClassifica();
  await initLive();
  await initPronostici();
  await initProfilo();
  if (STATE.utente?.isAdmin) await initAdmin();
  _aggiornaRegolamentoEvento();
}

// ── REGOLAMENTO: intro dinamica in base alla competizione attiva ──────
function _aggiornaRegolamentoEvento() {
  const el = document.getElementById('reg-intro-evento');
  if (!el) return;
  const c = getCompetizione(STATE.competizioneId);
  el.innerHTML = `Formulito segue più competizioni con lo stesso login: questa scheda è per il <strong>${c.nomeEsteso}</strong>. Niente tabellone: il pronostico è un <strong>ordinamento di tutti i piloti</strong> per Qualifiche e per Gara, più 6 bonus di gara.`;
}

// ── ROUTER ─────────────────────────────────────────────
export function navigaA(pagina, params = {}) {
  STATE.pagina = pagina;

  // Gestione profiloUid: se non specificato lo azzera
  STATE.profiloUid = params.uid || null;

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === pagina);
  });
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + pagina);
  if (target) { target.classList.add('active'); window.scrollTo(0, 0); }

  // Se navighiamo al profilo, lo reinizializziamo con il nuovo uid
  if (pagina === 'profilo') {
    import('./profilo.js').then(m => m.initProfilo());
  }
}

// ── HELPERS ────────────────────────────────────────────
function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = '';
}

function showRegError(msg) {
  const el = document.getElementById('reg-error');
  el.textContent = msg;
  el.style.display = '';
}

function _traduciErroreAuth(code) {
  const map = {
    'auth/user-not-found':       'Utente non trovato.',
    'auth/wrong-password':       'Password errata.',
    'auth/invalid-email':        'Email non valida.',
    'auth/email-already-in-use': 'Esiste già un account con questo nome. Prova ad accedere.',
    'auth/weak-password':        'Password troppo corta. Minimo 6 caratteri.',
    'auth/too-many-requests':    'Troppi tentativi. Riprova tra qualche minuto.',
    'auth/network-request-failed': 'Errore di rete. Controlla la connessione.',
    'auth/invalid-credential':   'Credenziali errate. Controlla email e password.',
  };
  return map[code] || null;
}
