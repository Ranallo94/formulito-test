/**
 * FORMULITO — circuito.js
 * "Classifica sul circuito": il tracciato REALE del Gran Premio (js/circuiti.js) con i caschi
 * dei partecipanti che avanzano man mano che fanno punti.
 *
 *   ① Griglia   — tutti dietro la linea del traguardo, a punti zero
 *   ② Qualifiche — primo step: avanza chi ha fatto più punti in qualifica (+ Sprint)
 *   ③ Gara       — step finale: avanza ancora; il primo in classifica taglia il traguardo
 *
 * Pensato prima di tutto per il TELEFONO: il tracciato viene ruotato di 90° se così occupa
 * meglio lo schermo, e tutte le misure (caschi, asfalto, scritte) sono in pixel reali, quindi
 * restano leggibili a qualsiasi larghezza. Si ridisegna da solo se la finestra cambia.
 *
 * Il modulo non conosce Firebase: riceve già pronti partecipanti, fase raggiunta e caschi.
 *
 * @example
 *   const cv = montaCircuito(el, { circuitoId:'monza', partecipanti:[{id,nome,quali,totale}], faseMax:2,
 *     meId, cascoDi: caschi.cascoDi, onScheda: uid => ..., onModifica: () => ... });
 *   cv.aggiorna({ partecipanti, faseMax });   cv.distruggi();
 */

import { CIRCUITI, CREDITI_CIRCUITI } from './circuiti.js';
import { interno } from './caschi.js';

const NS = 'http://www.w3.org/2000/svg';
const ROW = 46;                                   // altezza di una riga della classifica
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const riduci = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── GEOMETRIA ─────────────────────────────────────────
/** Anello chiuso → path SVG con curve di Bézier (spline di Catmull-Rom "chordal", senza sbavature sui rettilinei). */
export function percorso(P) {
  const n = P.length;
  const d = (i) => Math.hypot(P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]) || 0.001;
  const T = P.map((_, i) => {
    const a = P[(i - 1 + n) % n], b = P[(i + 1) % n], dd = d((i - 1 + n) % n) + d(i);
    return [(b[0] - a[0]) / dd, (b[1] - a[1]) / dd];
  });
  let s = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, k = d(i) / 3;
    s += `C${(P[i][0] + T[i][0] * k).toFixed(1)} ${(P[i][1] + T[i][1] * k).toFixed(1)} ${(P[j][0] - T[j][0] * k).toFixed(1)} ${(P[j][1] - T[j][1] * k).toFixed(1)} ${P[j][0].toFixed(1)} ${P[j][1].toFixed(1)}`;
  }
  return s + 'Z';
}

/**
 * Dispone il tracciato nello spazio disponibile: sceglie se ruotarlo di 90° per riempire meglio
 * lo schermo e restituisce i punti in pixel.
 * @returns {{pts:number[][], w:number, h:number, ruotato:boolean}}
 */
export function dispone(c, larghezza, altezzaMax, margine) {
  const prova = (r) => {
    const bw = r ? c.h : c.w, bh = r ? c.w : c.h;
    return { r, bw, bh, k: Math.min((larghezza - 2 * margine) / bw, (altezzaMax - 2 * margine) / bh) };
  };
  const a = prova(false), b = prova(true);
  const m = b.k > a.k * 1.02 ? b : a;                                     // ruota solo se serve davvero
  const pts = c.pts.map(([x, y]) => (m.r ? [margine + (c.h - y) * m.k, margine + x * m.k] : [margine + x * m.k, margine + y * m.k]));
  return { pts, w: larghezza, h: m.bh * m.k + 2 * margine, ruotato: m.r };
}

// ── VISTA ─────────────────────────────────────────────
export function montaCircuito(root, opz) {
  const circ = CIRCUITI[opz.circuitoId];
  let dati = { partecipanti: opz.partecipanti || [], faseMax: opz.faseMax || 0 };
  let ph = 0, raf = 0, token = 0, nomi = false, selez = null, ro = null, distrutto = false, primo = true;
  let geo = null, stati = [], els = new Map(), rowEls = new Map(), parts = [], cfRaf = 0;

  root.innerHTML = `
    <div class="cv">
      <div class="cv-steps" role="tablist">
        <button type="button" class="cv-step" data-ph="0">① Griglia</button>
        <button type="button" class="cv-step" data-ph="1">② Qualifiche</button>
        <button type="button" class="cv-step" data-ph="2">③ Gara</button>
      </div>
      <div class="cv-hud"><span class="cv-hud-step"></span><span class="cv-hud-lead"></span></div>
      <div class="cv-banner" hidden></div>
      <div class="cv-stage">
        <svg class="cv-svg" role="img" aria-label="Circuito ${esc(circ.nome)} con i caschi dei partecipanti"></svg>
        <canvas class="cv-conf"></canvas>
        <div class="cv-card" hidden></div>
      </div>
      <p class="cv-vuoto" hidden>Nessun partecipante in classifica per ora.</p>
      <div class="cv-ctrl">
        <button type="button" class="cv-btn cv-btn--p" data-replay>▶ Replay</button>
        <label class="cv-nomi"><input type="checkbox" data-nomi> nomi</label>
        ${opz.onModifica ? '<button type="button" class="cv-btn" data-casco>🎨 Il mio casco</button>' : ''}
      </div>
      <div class="cv-rows"></div>
      <p class="cv-credit">${esc(circ.nome)} · ${circ.km} km · ${circ.senso === 'orario' ? 'senso orario' : 'senso antiorario'}<br>${esc(CREDITI_CIRCUITI)}</p>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const svg = $('.cv-svg'), stage = $('.cv-stage'), cv = $('.cv-conf'), cx = cv.getContext('2d');

  // ── dati derivati ──
  const cascoOf = (uid) => (opz.cascoDi ? opz.cascoDi(uid) : null);

  function costruisci() {
    const w = Math.max(260, Math.round(stage.clientWidth || root.clientWidth || 320));
    const helm = w < 520 ? 30 : 38;
    const altMax = Math.max(300, Math.min(innerHeight * 0.66, 680));
    const lay = dispone(circ, w, altMax, helm * 0.9 + 6);
    const AW = Math.max(14, Math.round(helm * 0.55));                          // larghezza asfalto
    const d = percorso(lay.pts);
    svg.setAttribute('viewBox', `0 0 ${lay.w} ${Math.round(lay.h)}`);
    svg.style.height = Math.round(lay.h) + 'px';
    svg.innerHTML = `
      <defs><pattern id="cv-chk" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#fff"/><rect width="3" height="3" fill="#111"/><rect x="3" y="3" width="3" height="3" fill="#111"/></pattern></defs>
      <path class="cv-run" d="${d}" fill="none" stroke="#1f3b25" stroke-width="${AW + 26}" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="#fff" stroke-width="${AW + 6}" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="#E10600" stroke-width="${AW + 6}" stroke-linejoin="round" stroke-dasharray="9 9"/>
      <path class="cv-road" d="${d}" fill="none" stroke="#3b3b42" stroke-width="${AW}" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="#fff" stroke-opacity=".32" stroke-width="1.4" stroke-dasharray="8 10"/>
      <g class="cv-chev"></g><g class="cv-fin"></g><g class="cv-hs"></g>`;
    const road = svg.querySelector('.cv-road'), L = road.getTotalLength();

    // frecce di marcia ogni ~12% del giro
    const ch = svg.querySelector('.cv-chev');
    for (let i = 1; i < 9; i++) {
      const m = (L * i) / 9, p = road.getPointAtLength(m), q = road.getPointAtLength(m + 3);
      const a = Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
      const e = document.createElementNS(NS, 'path');
      e.setAttribute('d', 'M-4 -4 L3 0 L-4 4'); e.setAttribute('fill', 'none'); e.setAttribute('stroke', '#fff'); e.setAttribute('stroke-opacity', '.45'); e.setAttribute('stroke-width', '2');
      e.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${a.toFixed(1)})`); ch.appendChild(e);
    }
    // traguardo
    const p0 = road.getPointAtLength(0), p1 = road.getPointAtLength(2);
    const a0 = Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI;
    svg.querySelector('.cv-fin').innerHTML =
      `<g transform="translate(${p0.x.toFixed(1)} ${p0.y.toFixed(1)}) rotate(${a0.toFixed(1)})"><rect x="-3" y="${-(AW / 2 + 4)}" width="6" height="${AW + 8}" fill="url(#cv-chk)" stroke="#000" stroke-width=".5"/></g>`;

    geo = { w, helm, AW, L, road, lay };
    calcola();
    const hs = svg.querySelector('.cv-hs'); els = new Map();
    stati.forEach(s => {
      const g = document.createElementNS(NS, 'g'); g.setAttribute('class', 'cv-h'); g.dataset.id = s.p.id;
      const k = helm / 85;
      g.innerHTML = `<ellipse cx="0" cy="${(helm * 0.36).toFixed(1)}" rx="${(helm * 0.4).toFixed(1)}" ry="${(helm * 0.11).toFixed(1)}" fill="#000" opacity=".35"/>
        <circle class="ring" r="${(helm * 0.62).toFixed(1)}" cy="-3" fill="none" stroke="#F5B400" stroke-width="3" opacity="0"/>
        <g class="fl"><g transform="scale(${k.toFixed(3)}) translate(-52 -50)">${interno(s.casco)}</g></g>
        <g class="nm" opacity="0"></g>`;
      g.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') seleziona(s.p.id, true); });
      g.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') deseleziona(); });
      g.addEventListener('click', (e) => { e.stopPropagation(); seleziona(s.p.id, selez !== s.p.id); });
      hs.appendChild(g); els.set(s.p.id, g);
    });
    nomiVisibili();
    const w2 = Math.round(stage.clientWidth), h2 = Math.round(lay.h);
    cv.width = w2 * devicePixelRatio; cv.height = h2 * devicePixelRatio;
    place();
  }

  /** Posizioni-chiave (griglia, dopo qualifiche, dopo gara) e corsie per non sovrapporre i caschi. */
  function calcola() {
    const { L, helm } = geo;
    const P = dati.partecipanti;
    const minQ = Math.min(...P.map(p => p.quali)), maxQ = Math.max(...P.map(p => p.quali));
    const minT = Math.min(...P.map(p => p.totale)), T = Math.max(...P.map(p => p.totale));
    const norm = (v, a, b) => (b > a ? (v - a) / (b - a) : 1);
    const D1 = (p) => L * (0.06 + 0.32 * norm(p.quali, minQ, maxQ));
    const D2 = (p) => Math.max(D1(p) + 0.04 * L, L * (0.36 + 0.64 * norm(p.totale, minT, T)));  // il leader = L = sul traguardo
    const ordina = [...P].sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    const colonne = P.length > 16 ? 3 : 2, passo = helm * 0.95, lane = helm * 0.62;
    stati = ordina.map((p, i) => {
      const riga = Math.floor(i / colonne), col = i % colonne;
      const lane0 = colonne === 2 ? (col ? 0.55 : -0.55) : (col - 1);
      return { p, casco: cascoOf(p.id) || { base: '#888888', accento: '#ffffff', visiera: '#111111', trama: 'nessuna' },
        d: [-(riga * passo + helm * 0.8) - (col === 1 ? passo * 0.4 : 0), D1(p), D2(p)], lane: [lane0, 0, 0],
        pts: [0, p.quali, p.totale] };
    });
    corsie(1); corsie(2);
    stati.forEach(s => { s.laneSp = lane; });
  }
  /** Assegna la corsia (-2..2) a ciascun casco in modo che quelli vicini lungo il tracciato non si coprano. */
  function corsie(k) {
    const { helm } = geo, gap = helm * 0.9, ordine = [...stati].sort((a, b) => b.d[k] - a.d[k]), messi = [];
    ordine.forEach(s => {
      const pref = [0, -1, 1, -2, 2];
      let best = pref[0], minC = Infinity;
      for (const l of pref) {
        const c = messi.filter(q => Math.abs(q.d - s.d[k]) < gap && Math.abs(q.l - l) < 0.9).length;
        if (c < minC) { minC = c; best = l; if (c === 0) break; }
      }
      s.lane[k] = best; messi.push({ d: s.d[k], l: best });
    });
  }

  const at = (arr, v) => (v <= 1 ? lerp(arr[0], arr[1], v) : lerp(arr[1], arr[2], v - 1));

  function place() {
    if (!geo) return;
    const { L, road, helm } = geo, ordine = [];
    stati.forEach(s => {
      const d = at(s.d, ph), lane = at(s.lane, ph) * s.laneSp, m = ((d % L) + L) % L;
      const p = road.getPointAtLength(m), q = road.getPointAtLength((m + 3) % L), r = road.getPointAtLength((m - 3 + L) % L);
      let tx = q.x - r.x, ty = q.y - r.y; const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
      const mg = helm * 0.55;                                   // un casco in corsia esterna non esce mai dallo schermo
      const x = Math.min(Math.max(p.x - ty * lane, mg), geo.w - mg);
      const y = Math.min(Math.max(p.y + tx * lane - helm * 0.12, mg), geo.lay.h - mg);
      const g = els.get(s.p.id);
      g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      g.querySelector('.fl').setAttribute('transform', tx < -0.1 ? 'scale(-1 1)' : 'scale(1 1)');
      ordine.push([d, g]);
    });
    const hs = svg.querySelector('.cv-hs');
    ordine.sort((a, b) => a[0] - b[0]).forEach(([, g]) => hs.appendChild(g));    // chi è davanti sta sopra
    classifica();
  }

  // ── classifica a fianco ──
  function righe() {
    const box = $('.cv-rows'); box.innerHTML = ''; box.style.height = (dati.partecipanti.length * ROW) + 'px'; rowEls = new Map();
    stati.forEach(s => {
      const r = document.createElement('div'); r.className = 'cv-row' + (s.p.id === opz.meId ? ' me' : ''); r.dataset.id = s.p.id;
      r.innerHTML = `<span class="pos"></span><svg class="hm" viewBox="0 0 100 100" aria-hidden="true">${interno(s.casco)}</svg><span class="nm"></span><span class="pt"></span>`;
      r.querySelector('.nm').textContent = s.p.nome + (s.p.id === opz.meId ? '  · tu' : '');
      r.addEventListener('click', () => seleziona(s.p.id, selez !== s.p.id));
      box.appendChild(r); rowEls.set(s.p.id, r);
    });
  }
  let ordineCorrente = [];
  function classifica() {
    const cur = stati.map(s => ({ s, v: at(s.pts, ph) }));
    cur.sort((a, b) => b.v - a.v || b.s.p.totale - a.s.p.totale || a.s.p.nome.localeCompare(b.s.p.nome, 'it'));
    ordineCorrente = cur.map(c => c.s.p.id);
    const fin = ph > 1.98;
    cur.forEach(({ s, v }, i) => {
      const r = rowEls.get(s.p.id); if (!r) return;
      r.style.transform = `translateY(${i * ROW}px)`;
      const pos = r.querySelector('.pos'), med = ['🥇', '🥈', '🥉'][i];
      pos.className = 'pos' + (fin && med ? ' m' : ''); pos.textContent = ph < 0.02 ? '–' : (fin && med ? med : i + 1);
      r.querySelector('.pt').innerHTML = `${Math.round(v)}<small>pt</small>`;
    });
    const lead = cur[0];
    $('.cv-hud-step').textContent = ph < 0.02 ? 'Griglia di partenza' : ph < 1.02 ? 'Dopo le qualifiche' : ph < 1.98 ? 'Gara in corso…' : 'Classifica finale';
    $('.cv-hud-lead').textContent = !lead || ph < 0.02 ? 'tutti al via' : `🏎️ ${lead.s.p.nome} · ${Math.round(lead.v)} pt`;
    if (selez) schedaAggiorna();
  }

  // ── selezione / scheda del casco ──
  function seleziona(id, on) {
    if (!on) return deseleziona();
    deseleziona(true); selez = id;
    els.get(id)?.querySelector('.ring').setAttribute('opacity', 1);
    rowEls.get(id)?.classList.add('hl');
    schedaAggiorna();
  }
  function deseleziona(silenzioso) {
    if (selez) { els.get(selez)?.querySelector('.ring').setAttribute('opacity', 0); rowEls.get(selez)?.classList.remove('hl'); }
    selez = null; if (!silenzioso) $('.cv-card').hidden = true;
  }
  function schedaAggiorna() {
    const s = stati.find(x => x.p.id === selez); if (!s) return;
    const card = $('.cv-card'), pos = ordineCorrente.indexOf(s.p.id) + 1, tot = Math.round(at(s.pts, ph));
    const q = ph >= 1 ? s.p.quali : Math.round(at(s.pts, ph)), g = ph >= 2 ? s.p.totale - s.p.quali : (ph > 1 ? Math.round(at(s.pts, ph) - s.p.quali) : 0);
    card.hidden = false;
    card.innerHTML = `<svg class="hm" viewBox="0 0 100 100" aria-hidden="true">${interno(s.casco)}</svg>
      <div class="cv-card-t"><b></b><span>${ph < 0.02 ? 'ancora fermo in griglia' : `${pos}° · ${tot} pt`}</span>
      <small>Qualifiche ${q} · Gara e bonus ${g}</small></div>
      <button type="button" class="cv-btn" data-scheda>Scheda →</button><button type="button" class="cv-x" data-chiudi aria-label="Chiudi">✕</button>`;
    card.querySelector('b').textContent = s.p.nome;
  }
  function nomiVisibili() {
    const { helm } = geo;
    stati.forEach(s => {
      const g = els.get(s.p.id); if (!g) return;
      const nm = g.querySelector('.nm'); nm.innerHTML = '';
      const me = s.p.id === opz.meId, txt = me ? 'Tu' : (s.p.nome.length > 13 ? s.p.nome.slice(0, 12) + '…' : s.p.nome);
      const t = document.createElementNS(NS, 'text'), w = Math.max(24, txt.length * 6.4 + 12), y = helm * 0.46 + 3;
      t.setAttribute('y', y + 11); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-size', '10.5'); t.setAttribute('font-weight', '700'); t.setAttribute('font-family', 'Inter,sans-serif'); t.setAttribute('fill', me ? '#F5B400' : '#fff'); t.textContent = txt;
      const rc = document.createElementNS(NS, 'rect'); rc.setAttribute('x', -w / 2); rc.setAttribute('y', y); rc.setAttribute('width', w); rc.setAttribute('height', 15); rc.setAttribute('rx', 7.5); rc.setAttribute('fill', '#000'); rc.setAttribute('opacity', '.74');
      nm.append(rc, t);
      nm.setAttribute('opacity', nomi || me ? 1 : 0);
    });
  }

  // ── animazione ──
  function vai(target, ms) {
    const mio = ++token; cancelAnimationFrame(raf); const da = ph, t0 = performance.now(); passi(target);
    if (riduci()) ms = 1;
    return new Promise(res => {
      const tick = (now) => {
        if (mio !== token || distrutto) return res(false);
        const k = Math.min(1, (now - t0) / ms); ph = lerp(da, target, ease(k)); place();
        if (k < 1) raf = requestAnimationFrame(tick);
        else { ph = target; place(); if (target === 2 && da < 2) finale(); res(true); }
      };
      raf = requestAnimationFrame(tick);
    });
  }
  function passi(target) {
    root.querySelectorAll('.cv-step').forEach(b => {
      const p = +b.dataset.ph; b.classList.toggle('on', p === target); b.disabled = p > dati.faseMax;
      b.title = p > dati.faseMax ? 'Non ancora disponibile' : '';
    });
  }
  const dormi = (ms) => new Promise(r => setTimeout(r, ms));
  async function replay() {
    token++; cancelAnimationFrame(raf); fineFesta(); ph = 0; place(); passi(0);
    await dormi(500); if (!await vai(Math.min(1, dati.faseMax), 3800)) return;
    if (dati.faseMax >= 2) { await dormi(1100); await vai(2, 5600); }
  }

  function finale() {
    const w = [...dati.partecipanti].sort((a, b) => b.totale - a.totale)[0]; if (!w) return;
    const b = $('.cv-banner'); b.hidden = false; b.innerHTML = '<small>🏁 taglia il traguardo</small><b></b>'; b.querySelector('b').textContent = `${w.nome} · ${w.totale} pt`;
    if (riduci()) return;
    const W = cv.width, H = cv.height, dpr = devicePixelRatio;
    parts = Array.from({ length: 110 }, () => ({ x: Math.random() * W, y: -Math.random() * H * 0.4, vx: (Math.random() - 0.5) * 2.4 * dpr, vy: (1.8 + Math.random() * 3.4) * dpr,
      s: (4 + Math.random() * 6) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: ['#E10600', '#F5B400', '#fff', '#00D7B6'][(Math.random() * 4) | 0] }));
    cancelAnimationFrame(cfRaf);
    const step = () => {
      cx.clearRect(0, 0, cv.width, cv.height);
      parts.forEach(p => { p.x += p.vx; p.y += p.vy; p.r += p.vr; cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c; cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); cx.restore(); });
      parts = parts.filter(p => p.y < cv.height + 20);
      if (parts.length && !distrutto) cfRaf = requestAnimationFrame(step); else cx.clearRect(0, 0, cv.width, cv.height);
    };
    step();
  }
  function fineFesta() { $('.cv-banner').hidden = true; parts = []; cancelAnimationFrame(cfRaf); cx.clearRect(0, 0, cv.width, cv.height); }

  /** Ricostruisce tracciato, caschi e righe (es. dopo un ridimensionamento) mantenendo la selezione. */
  function ridisegna() {
    const vuoto = !dati.partecipanti.length;
    root.querySelector('.cv-vuoto').hidden = !vuoto;
    root.querySelector('.cv-stage').hidden = vuoto; root.querySelector('.cv-rows').hidden = vuoto;
    if (vuoto) return false;
    costruisci(); righe();
    if (selez && stati.some(s => s.p.id === selez)) { els.get(selez)?.querySelector('.ring').setAttribute('opacity', 1); rowEls.get(selez)?.classList.add('hl'); }
    else { selez = null; $('.cv-card').hidden = true; }
    place(); return true;
  }

  // ── eventi ──
  root.addEventListener('click', (e) => {
    const st = e.target.closest('.cv-step'); if (st && !st.disabled) { fineFesta(); vai(+st.dataset.ph, 2400); return; }
    if (e.target.closest('[data-replay]')) { replay(); return; }
    if (e.target.closest('[data-casco]')) { opz.onModifica && opz.onModifica(); return; }
    if (e.target.closest('[data-scheda]') && selez) { opz.onScheda && opz.onScheda(selez); return; }
    if (e.target.closest('[data-chiudi]')) { deseleziona(); return; }
  });
  $('[data-nomi]').addEventListener('change', (e) => { nomi = e.target.checked; nomiVisibili(); });
  stage.addEventListener('click', (e) => { if (!e.target.closest('.cv-h') && !e.target.closest('.cv-card')) deseleziona(); });
  let ultimaW = 0;
  ro = new ResizeObserver(() => {
    const w = Math.round(stage.clientWidth); if (!w || Math.abs(w - ultimaW) < 2) return; ultimaW = w;
    if (stati.length) ridisegna();
  });
  ro.observe(stage);

  // ── avvio e aggiornamenti ──
  function inizia() {
    if (!ridisegna()) return;
    ultimaW = Math.round(stage.clientWidth); passi(0);
    if (primo) { primo = false; setTimeout(() => { if (!distrutto) vai(dati.faseMax, 3600); }, 450); }
  }
  inizia();

  return {
    /** Nuovi dati (classifica in tempo reale): se la gara avanza di fase il campo si anima. */
    aggiorna(nuovi) {
      if (distrutto) return;
      const eraFase = dati.faseMax, eraVuoto = !dati.partecipanti.length;
      dati = { partecipanti: nuovi.partecipanti || [], faseMax: nuovi.faseMax || 0 };
      if (!ridisegna()) return;
      if (eraVuoto && primo) { primo = false; vai(dati.faseMax, 3600); return; }
      ph = Math.min(ph, dati.faseMax); place(); passi(ph);
      if (dati.faseMax > eraFase) vai(dati.faseMax, 3200);
    },
    /** Dopo che qualcuno ha cambiato casco: ridisegna i caschi mantenendo la posizione. */
    ridisegnaCaschi() { if (geo) ridisegna(); },
    distruggi() { distrutto = true; token++; cancelAnimationFrame(raf); cancelAnimationFrame(cfRaf); ro && ro.disconnect(); root.innerHTML = ''; },
  };
}
