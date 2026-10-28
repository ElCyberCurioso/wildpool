// WildPool — arranque e interfaz: inicio, personalización, salas y partida.
import {
  loadPrefs, savePrefs, AVATARS, CUES, CLOTHS, WOODS, ACCENTS, BALL_SETS, byId, cleanName, avatarColor,
} from './cosmetics.js';
import { MODES, MODE_LIST, defaultOptions } from './rules/index.js';
import { GameView } from './gameview.js';
import { RoomHost, RoomClient, normalizeCode, inviteLink } from './net.js';
import { LocalSession } from './session-local.js';
import { LEVELS, chooseShot } from './ai.js';
import { sfx } from './audio.js';
import { Renderer, cueStrip, ballIcon } from './render.js';
import { World, TICK } from './physics.js';
import { Match, preparePacket } from './match.js';
import { powerToSpeed } from './physics.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.setAttribute('style', v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
};

let prefs = loadPrefs();
sfx.setEnabled(prefs.sound);
sfx.setVolume(prefs.volume);

const clientId = (() => {
  try {
    let id = sessionStorage.getItem('wildpool:cid');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
      sessionStorage.setItem('wildpool:cid', id);
    }
    return id;
  } catch { return Math.random().toString(36).slice(2); }
})();

function persist() { savePrefs(prefs); }
function profile() { return { name: prefs.name, avatar: prefs.avatar, cue: prefs.cue }; }

// ===================================================================== pantallas
const screens = {
  home: $('#screen-home'), custom: $('#screen-custom'), lobby: $('#screen-lobby'), game: $('#screen-game'),
};
let current = 'home';
function show(name) {
  current = name;
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
  if (name === 'home') hero.start(); else hero.stop();
  if (name === 'custom') preview.start(); else preview.stop();
  if (name === 'lobby') mountChat($('#lobby-chat-slot'));
  if (name === 'game') layoutGameChat();
}

// ===================================================================== avisos y modales
function snack(text) {
  const el = $('#snack');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(snack.t);
  snack.t = setTimeout(() => el.classList.remove('show'), 2200);
}

const modal = $('#modal');
const modalInner = $('#modal-inner');
function openModal({ title, body, actions = [], dismissable = true, onClose }) {
  modalInner.innerHTML = '';
  modalInner.onsubmit = (e) => e.preventDefault();
  if (title) modalInner.append(h('h3', { id: 'modal-title', text: title }));
  if (body) modalInner.append(...(Array.isArray(body) ? body : [body]));
  if (actions.length) {
    modalInner.append(h('div', { class: 'modal-actions' }, actions.map((a) => h('button', {
      class: `btn ${a.kind || ''}`, type: a.submit ? 'submit' : 'button',
      onclick: (e) => { if (!a.submit) { e.preventDefault(); a.onClick?.(); } },
    }, a.label))));
  }
  modal.dataset.dismiss = dismissable ? '1' : '';
  modal.onclose = () => onClose?.();
  if (!modal.open) modal.showModal();
  const first = modalInner.querySelector('input, select, .btn.primary');
  first?.focus();
}
function closeModal() { if (modal.open) { modal.onclose = null; modal.close(); } }
modal.addEventListener('cancel', (e) => { if (!modal.dataset.dismiss) e.preventDefault(); });
modal.addEventListener('click', (e) => { if (e.target === modal && modal.dataset.dismiss) closeModal(); });

function loading(text) {
  openModal({ body: h('div', { class: 'loading-row' }, h('div', { class: 'spinner' }), h('p', { text })), dismissable: false });
}
function info(title, text, then) {
  openModal({ title, body: h('p', { text }), actions: [{ label: 'Entendido', kind: 'primary', onClick: () => { closeModal(); then?.(); } }] });
}

// ===================================================================== inicio
const nameInput = $('#home-name');
nameInput.value = prefs.name;
nameInput.addEventListener('input', () => {
  prefs.name = cleanName(nameInput.value);
  persist();
});
const avatarBtn = $('#home-avatar');
function paintAvatar() { avatarBtn.textContent = prefs.avatar; avatarBtn.style.borderColor = avatarColor(prefs.avatar); }
paintAvatar();
avatarBtn.addEventListener('click', () => {
  const grid = h('div', { class: 'avatar-grid' }, AVATARS.map((a) => h('button', {
    type: 'button', 'aria-pressed': String(a === prefs.avatar), 'aria-label': `Avatar ${a}`,
    onclick: () => { prefs.avatar = a; persist(); paintAvatar(); closeModal(); sendCosmetic(); },
  }, a)));
  openModal({ title: 'Elige tu avatar', body: grid, actions: [{ label: 'Cerrar', onClick: closeModal }] });
});

function requireName() {
  prefs.name = cleanName(nameInput.value);
  if (prefs.name) { persist(); return true; }
  nameInput.focus();
  nameInput.classList.remove('shake');
  void nameInput.offsetWidth;
  nameInput.classList.add('shake');
  snack('Escribe tu nombre para jugar');
  return false;
}

$('#btn-create').addEventListener('click', () => { sfx.unlock(); if (requireName()) createRoom(); });
$('#join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  sfx.unlock();
  const raw = $('#join-code').value.trim();
  let code = normalizeCode(raw);
  if (!code) {
    try { code = normalizeCode(new URL(raw).searchParams.get('sala')); } catch { /* no era un enlace */ }
  }
  if (!code) { snack('El código tiene 6 caracteres, por ejemplo K7QM2X'); return; }
  if (requireName()) joinRoom(code);
});
$('#btn-cpu').addEventListener('click', () => { sfx.unlock(); setupCpu(); });
$('#btn-local').addEventListener('click', () => { sfx.unlock(); setupLocal(); });
$('#btn-practice').addEventListener('click', () => {
  sfx.unlock();
  startLocal({ mode: 'free', players: [{ name: prefs.name || 'Tú', avatar: prefs.avatar, cue: prefs.cue }], opts: {}, guide: 'long' });
});
$('#btn-custom').addEventListener('click', () => openCustom('home'));

// ---------------------------------------------------------------- mesa animada de portada
const hero = (() => {
  const canvas = $('#hero-canvas');
  const r = new Renderer(canvas);
  r.allowRotate = false;
  let match = null, world = null, running = false, raf = 0, phase = 'wait', t = 0, shot = null, acc = 0, aimA = 0, last = 0, shots = 0, thinking = false;
  const ro = new ResizeObserver(() => { const b = canvas.getBoundingClientRect(); if (b.width > 10) r.resize(b.width, b.height); });
  function rerack() {
    match = new Match('free', [{ id: 'd', name: 'demo' }], {});
    world = new World('pool');
    world.load(match.world.snapshot());
    r.sprites.clear();
    r.setTable(world.table);
    r.setPrefs(prefs);
    shots = 0;
    phase = 'wait'; t = 0.6;
    aimA = 0;
  }
  async function think() {
    thinking = true;
    const s = await chooseShot(match.rules, match.state, match.world, 'medium');
    thinking = false;
    if (!running) return;
    shot = s;
    phase = 'aim'; t = 0;
    if (s.cx != null) { const c = world.ball(0); c.x = s.cx; c.y = s.cy; c.on = true; }
  }
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    if (phase === 'wait' && t > 0.9 && !thinking) {
      if (match.state.over || shots > 9 || world.balls.filter((b) => b.on).length < 5) rerack();
      else { phase = 'think'; think(); }
    } else if (phase === 'aim') {
      let d = shot.a - aimA;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      aimA += d * Math.min(1, dt * 5);
      if (t > 1.0) { phase = 'pull'; t = 0; }
    } else if (phase === 'pull' && t > 0.55) {
      const { packet } = match.play(0, shot);
      preparePacket(world, packet);
      phase = 'roll'; acc = 0; shots++;
    } else if (phase === 'roll') {
      acc += dt;
      let n = 0;
      while (acc >= TICK && n < 40) {
        const prev = world.balls.map((b) => [b.x, b.y, b.on]);
        world.step();
        world.balls.forEach((b, i) => { if (b.on && prev[i][2]) r.roll(b.id, b.x - prev[i][0], b.y - prev[i][1]); });
        acc -= TICK; n++;
      }
      if (!world.isMoving()) { world.load(match.world.snapshot()); phase = 'wait'; t = 0; }
    }
    const f = { world };
    if (phase === 'aim' || phase === 'pull') {
      f.aim = { cueId: 0, angle: aimA, pull: phase === 'pull' ? Math.min(1, t / 0.4) * shot.p : 0, style: prefs.cue, guide: 'off' };
    }
    r.draw(f, dt);
    raf = requestAnimationFrame(frame);
  }
  return {
    start() {
      if (running) return;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        if (!match) rerack();
        ro.observe(canvas);
        requestAnimationFrame(() => r.draw({ world }, 0));
        return;
      }
      running = true;
      if (!match) rerack();
      ro.observe(canvas);
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(raf); ro.disconnect(); },
    refresh() { if (match) r.setPrefs(prefs); },
  };
})();

// ===================================================================== personalización
let customReturn = 'home';
function openCustom(from) {
  customReturn = from;
  show('custom');
  renderTab(currentTab);
}
$('#custom-back').addEventListener('click', () => show(customReturn));
let currentTab = 'cue';
for (const t of $$('.tabs [data-tab]')) {
  t.addEventListener('click', () => renderTab(t.dataset.tab));
}

function setPref(key, val) {
  prefs[key] = val;
  persist();
  preview.refresh();
  hero.refresh();
  if (room?.gv) room.gv.setPrefs(prefs);
  if (local?.gv) local.gv.setPrefs(prefs);
  if (key === 'cue' || key === 'avatar') sendCosmetic();
  if (key === 'sound') sfx.setEnabled(val);
  if (key === 'volume') sfx.setVolume(val);
}

function renderTab(tab) {
  currentTab = tab;
  for (const t of $$('.tabs [data-tab]')) t.setAttribute('aria-selected', String(t.dataset.tab === tab));
  const body = $('#custom-body');
  body.innerHTML = '';
  if (tab === 'cue') {
    const list = h('div', { class: 'cue-list' });
    for (const c of CUES) {
      const cv = h('canvas', { width: 360, height: 20 });
      const g = cv.getContext('2d');
      const strip = cueStrip(c.id);
      g.drawImage(strip, strip.width * 0.42, 0, strip.width * 0.58, strip.height, 0, 1, 360, 18);
      list.append(h('button', {
        class: 'cue-opt', type: 'button', 'aria-pressed': String(prefs.cue === c.id),
        onclick: () => { setPref('cue', c.id); renderTab('cue'); },
      }, cv, h('strong', { text: c.name })));
    }
    body.append(h('section', {}, h('h4', { text: 'Taco' }), list));
  } else if (tab === 'table') {
    body.append(
      swatchGroup('Tapete', CLOTHS, 'cloth', (x) => x.color),
      swatchGroup('Madera', WOODS, 'wood', (x) => `linear-gradient(135deg, ${x.light}, ${x.base} 50%, ${x.dark})`),
      swatchGroup('Troneras y diamantes', ACCENTS, 'accent', (x) => `linear-gradient(135deg, ${x.color}, ${x.dark})`),
      toggleRow('Logo de WildPool en el tapete', prefs.logo, (v) => setPref('logo', v)),
    );
  } else if (tab === 'balls') {
    const list = h('div', { class: 'set-list' });
    for (const s of BALL_SETS) {
      const imgs = h('span', { class: 'imgs' }, [1, 2, 3, 11, 13, 8, 0].map((id) => h('img', { src: ballIcon(id, s.id, 60).toDataURL(), alt: '' })));
      list.append(h('button', {
        class: 'set-opt', type: 'button', 'aria-pressed': String(prefs.balls === s.id),
        onclick: () => { setPref('balls', s.id); renderTab('balls'); },
      }, imgs, h('strong', { text: s.name })));
    }
    body.append(h('section', {}, h('h4', { text: 'Juego de bolas' }), list));
  } else {
    const nm = h('input', { value: prefs.name, maxlength: 18, placeholder: '¿Cómo te llamas?' });
    nm.addEventListener('input', () => { prefs.name = cleanName(nm.value); nameInput.value = prefs.name; persist(); });
    nm.addEventListener('change', () => sendCosmetic());
    const grid = h('div', { class: 'avatar-grid' }, AVATARS.map((a) => h('button', {
      type: 'button', 'aria-pressed': String(a === prefs.avatar), 'aria-label': `Avatar ${a}`,
      onclick: () => { setPref('avatar', a); paintAvatar(); renderTab('profile'); },
    }, a)));
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: prefs.volume, 'aria-label': 'Volumen' });
    vol.addEventListener('input', () => setPref('volume', Number(vol.value)));
    vol.addEventListener('change', () => { sfx.unlock(); sfx.play('ball', 0.8); });
    body.append(
      h('section', {}, h('h4', { text: 'Nombre' }), nm),
      h('section', {}, h('h4', { text: 'Avatar' }), grid),
      h('section', {}, h('h4', { text: 'Sonido' }), toggleRow('Efectos de sonido', prefs.sound, (v) => { sfx.unlock(); setPref('sound', v); }), vol),
    );
  }
}

function swatchGroup(title, list, key, bg) {
  const label = h('div', { class: 'swatch-label', text: byId(list, prefs[key]).name });
  const wrap = h('div', { class: 'swatches' }, list.map((x) => h('button', {
    class: 'swatch', type: 'button', style: `background:${bg(x)}`, 'aria-label': x.name, title: x.name,
    'aria-pressed': String(prefs[key] === x.id),
    onclick: (e) => {
      setPref(key, x.id);
      for (const b of wrap.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
      label.textContent = x.name;
    },
  })));
  return h('section', {}, h('h4', { text: title }), wrap, label);
}

function toggleRow(text, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle-row' }, h('span', { text }), h('span', { class: 'switch' }, input, h('span')));
}

const preview = (() => {
  const canvas = $('#custom-canvas');
  const r = new Renderer(canvas);
  r.allowRotate = false;
  const world = new World('pool');
  const t = world.table;
  const put = [[0, 70, 66], [1, 150, 52], [9, 166, 74], [8, 190, 60], [3, 212, 34], [12, 208, 96], [5, 120, 100], [14, 230, 70], [2, 100, 30]];
  for (const [id, x, y] of put) world.addBall(id, x, y);
  let running = false, raf = 0, last = 0;
  const ro = new ResizeObserver(() => { const b = canvas.getBoundingClientRect(); if (b.width > 10) r.resize(b.width, b.height); });
  r.setTable(t);
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // las bolas giran sobre sí mismas para lucir el juego elegido
    for (const b of world.balls) if (b.id !== 0) r.roll(b.id, dt * 6 * Math.cos(b.id), dt * 6 * Math.sin(b.id));
    const ph = (now / 1000) % 3;
    const pull = ph < 2 ? 0.35 + 0.25 * Math.sin(ph * Math.PI) : 0.35;
    r.draw({ world, aim: { cueId: 0, angle: Math.atan2(52 - 66, 150 - 70), pull, style: prefs.cue, guide: 'long', sy: 0 } }, dt);
    raf = requestAnimationFrame(frame);
  }
  return {
    start() {
      r.setPrefs(prefs);
      ro.observe(canvas);
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(raf); ro.disconnect(); },
    refresh() { r.setPrefs(prefs); },
  };
})();

// ===================================================================== chat
const chatEl = $('#chat');
const chatList = $('#chat-list');
const chatInput = $('#chat-input');
let unread = 0;
const QUICK = ['¡Buen tiro!', '¡Uf, casi!', 'Te toca', 'GG', 'Revancha?', '🔥', '😂', '👏', '🎱'];
$('#chat-quick').append(...QUICK.map((q) => h('button', { type: 'button', onclick: () => sendChat(q) }, q)));
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  sendChat(text);
  chatInput.value = '';
});
$('#chat-close').addEventListener('click', () => setChatOpen(false));
function sendChat(text) { room?.net.send({ t: 'chat', text }); }
function mountChat(slot) {
  if (chatEl.parentElement !== slot) slot.append(chatEl);
}
function resetChat() { chatList.innerHTML = ''; unread = 0; paintBadge(); }
function addChat(m) {
  let li;
  if (m.sys) {
    li = h('li', { class: 'sys', text: m.text });
  } else {
    const color = avatarColor(m.avatar);
    li = h('li', { class: m.from === room?.selfId ? 'mine' : '', style: `--c:${color}` },
      h('span', { class: 'av', text: m.avatar || '🎱' }),
      h('div', {}, h('span', { class: 'who', text: m.name }), h('span', { text: m.text })));
  }
  const atBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 60;
  chatList.append(li);
  while (chatList.children.length > 120) chatList.firstChild.remove();
  if (atBottom || m.from === room?.selfId) chatList.scrollTop = chatList.scrollHeight;
  if (!m.sys && m.from !== room?.selfId) {
    if (!chatVisible()) { unread++; paintBadge(); }
    sfx.play('chat');
  }
}
function chatVisible() {
  if (current === 'lobby') return true;
  const gm = $('.game-main');
  return current === 'game' && (gm.classList.contains('docked') || gm.classList.contains('drawer'));
}
function paintBadge() {
  const b = $('#chat-badge');
  b.hidden = !unread;
  b.textContent = unread > 9 ? '9+' : String(unread);
}
function setChatOpen(open) {
  $('.game-main').classList.toggle('drawer', open && !$('.game-main').classList.contains('docked'));
  if (open) { unread = 0; paintBadge(); setTimeout(() => chatInput.focus(), 50); chatList.scrollTop = chatList.scrollHeight; }
}
function layoutGameChat() {
  const gm = $('.game-main');
  const net = !!room;
  screens.game.classList.toggle('no-chat', !net);
  if (!net) { gm.classList.remove('docked', 'drawer'); return; }
  mountChat($('#game-chat-slot'));
  const wide = window.innerWidth >= 1280 && window.innerHeight >= 560;
  gm.classList.toggle('docked', wide);
  if (wide) { gm.classList.remove('drawer'); unread = 0; paintBadge(); }
}
window.addEventListener('resize', () => { if (current === 'game') layoutGameChat(); });
$('#btn-chat').addEventListener('click', () => setChatOpen(!$('.game-main').classList.contains('drawer')));

// ===================================================================== partidas locales
let local = null; // { session, gv }

function setupCpu() {
  let mode = '8ball', level = 'medium', rivals = 1;
  const modeList = h('div', { class: 'choice-list' });
  const paintModes = () => {
    modeList.innerHTML = '';
    for (const id of ['8ball', '9ball', 'killer']) {
      const m = MODES[id];
      modeList.append(h('button', {
        class: 'mode-opt', type: 'button', 'aria-pressed': String(mode === id),
        onclick: () => { mode = id; paintModes(); rivalsRow.hidden = mode !== 'killer'; },
      }, h('strong', { text: m.name }), h('span'), h('span', { class: 'bl', text: m.blurb })));
    }
  };
  const levelSeg = segmented(Object.entries(LEVELS).map(([k, v]) => [k, v.label]), level, (v) => { level = v; });
  const rivalsRow = h('div', { class: 'setting', hidden: true }, h('span', { text: 'Rivales CPU' }), segmented([[1, '1'], [2, '2'], [3, '3']], rivals, (v) => { rivals = v; }));
  paintModes();
  openModal({
    title: 'Contra la CPU',
    body: [modeList, h('div', { class: 'setting' }, h('span', { text: 'Dificultad' }), levelSeg), rivalsRow],
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: closeModal },
      {
        label: 'Jugar', kind: 'primary', onClick: () => {
          closeModal();
          const n = mode === 'killer' ? rivals : 1;
          const pool = AVATARS.filter((a) => a !== prefs.avatar);
          const players = [{ name: prefs.name || 'Tú', avatar: prefs.avatar, cue: prefs.cue }];
          for (let i = 0; i < n; i++) {
            players.push({
              name: n > 1 ? `CPU ${i + 1}` : `CPU ${LEVELS[level].label.toLowerCase()}`,
              avatar: pool[(i * 5 + 3) % pool.length], cue: CUES[(i * 3 + 2) % CUES.length].id, ai: level,
            });
          }
          startLocal({ mode, players, opts: defaultOptions(mode), guide: 'long' });
        },
      },
    ],
  });
}

function setupLocal() {
  let mode = '8ball';
  const names = [h('input', { value: prefs.name || 'Jugador 1', maxlength: 18, 'aria-label': 'Jugador 1' }), h('input', { value: 'Jugador 2', maxlength: 18, 'aria-label': 'Jugador 2' })];
  const modeList = h('div', { class: 'choice-list' });
  const paint = () => {
    modeList.innerHTML = '';
    for (const id of ['8ball', '9ball', 'carom', 'killer']) {
      const m = MODES[id];
      modeList.append(h('button', {
        class: 'mode-opt', type: 'button', 'aria-pressed': String(mode === id),
        onclick: () => { mode = id; paint(); },
      }, h('strong', { text: m.name }), h('span'), h('span', { class: 'bl', text: m.blurb })));
    }
  };
  paint();
  openModal({
    title: 'Dos jugadores',
    body: [modeList, h('div', { class: 'settings-grid' }, ...names.map((n, i) => h('label', { class: 'setting' }, h('span', { text: `Jugador ${i + 1}` }), n)))],
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: closeModal },
      {
        label: 'Jugar', kind: 'primary', onClick: () => {
          closeModal();
          const other = AVATARS.find((a) => a !== prefs.avatar);
          startLocal({
            mode,
            players: [
              { name: cleanName(names[0].value) || 'Jugador 1', avatar: prefs.avatar, cue: prefs.cue },
              { name: cleanName(names[1].value) || 'Jugador 2', avatar: other, cue: 'cebra' },
            ],
            opts: defaultOptions(mode),
            guide: 'long',
          });
        },
      },
    ],
  });
}

function startLocal(cfg) {
  endLocal();
  const session = new LocalSession(cfg);
  const gv = new GameView(screens.game, {
    kind: session.kind === 'cpu' ? 'cpu' : (cfg.players.length === 1 ? 'practice' : 'local'),
    controls: (seat) => session.controls(seat),
    shoot: (shot) => session.shoot(shot),
    aim: null,
    statusFor: (seat) => session.statusFor(seat),
    onIdle: () => session.idle(),
    onOver: (over, meta) => showOver(over, meta),
  }, prefs);
  if (cfg.players.length === 1 || session.kind === 'local') gv.ctrl.kind = 'local';
  session.on('msg', (m) => gv.handle(m));
  session.on('status', () => gv.renderStatus());
  local = { session, gv, cfg };
  hideOver();
  show('game');
  session.start();
}

function endLocal() {
  if (!local) return;
  local.session.close();
  local.gv.destroy();
  local = null;
}

// ===================================================================== fin de partida
function hideOver() { $('#over-card').hidden = true; }
function showOver(over, meta) {
  const card = $('#over-card');
  card.innerHTML = '';
  const w = over.winner != null ? meta[over.winner] : null;
  const iWon = w && ((room && w.id === room.selfId) || (local && local.session.controls(over.winner) && local.session.kind === 'cpu'));
  card.append(h('h3', { text: w ? (iWon ? '¡Has ganado!' : `Gana ${w.name}`) : 'Fin de la partida' }), h('p', { text: over.text }));
  const actions = h('div', { class: 'actions' });
  if (local) {
    actions.append(
      h('button', { class: 'btn primary', type: 'button', onclick: () => { hideOver(); local.session.rematch(); } }, 'Jugar otra'),
      h('button', { class: 'btn', type: 'button', onclick: () => { hideOver(); endLocal(); show('home'); } }, 'Menú principal'),
    );
  } else if (room?.kind === 'host') {
    actions.append(
      h('button', { class: 'btn primary', type: 'button', onclick: () => { hideOver(); room.net.send({ t: 'rematch' }); } }, 'Revancha'),
      h('button', { class: 'btn', type: 'button', onclick: () => { hideOver(); room.net.send({ t: 'lobby' }); } }, 'Volver a la sala'),
    );
  } else if (room) {
    actions.append(h('p', { text: 'El anfitrión decide si hay revancha.' }));
    actions.append(h('button', { class: 'btn', type: 'button', onclick: () => leaveRoom() }, 'Salir de la sala'));
  }
  card.append(actions);
  card.hidden = false;
  sfx.play(iWon || local?.session.kind === 'local' ? 'win' : 'foul');
}

// ===================================================================== menú en partida
$('#btn-menu').addEventListener('click', () => {
  const items = [];
  items.push(h('button', { class: 'btn', type: 'button', onclick: () => { setPref('sound', !prefs.sound); closeModal(); snack(prefs.sound ? 'Sonido activado' : 'Sonido desactivado'); } }, prefs.sound ? 'Silenciar sonido' : 'Activar sonido'));
  items.push(h('button', { class: 'btn', type: 'button', onclick: () => { closeModal(); openCustom('game'); } }, 'Personalizar'));
  items.push(h('button', { class: 'btn', type: 'button', onclick: () => { closeModal(); showHelp(); } }, 'Cómo se juega'));
  if (local) {
    items.push(h('button', { class: 'btn', type: 'button', onclick: () => { closeModal(); hideOver(); local.session.start(); } }, 'Reiniciar partida'));
    items.push(h('button', { class: 'btn danger', type: 'button', onclick: () => { closeModal(); hideOver(); endLocal(); show('home'); } }, 'Salir al menú'));
  } else if (room) {
    const seat = room.gv?.meta?.findIndex((m) => m.id === room.selfId) ?? -1;
    const st = room.gv?.state;
    if (seat >= 0 && st && !st.over && st.seats[seat]?.alive !== false) {
      items.push(h('button', { class: 'btn', type: 'button', onclick: () => { closeModal(); room.net.send({ t: 'concede' }); } }, 'Rendirse'));
    }
    if (room.kind === 'host') items.push(h('button', { class: 'btn', type: 'button', onclick: () => { closeModal(); hideOver(); room.net.send({ t: 'lobby' }); } }, 'Terminar y volver a la sala'));
    items.push(h('button', { class: 'btn danger', type: 'button', onclick: () => { closeModal(); confirmLeave(); } }, room.kind === 'host' ? 'Cerrar la sala' : 'Salir de la sala'));
  }
  openModal({ title: 'Menú', body: h('div', { class: 'menu-list' }, items), actions: [{ label: 'Seguir jugando', kind: 'primary', onClick: closeModal }] });
});

function showHelp() {
  const ul = h('ul', { style: 'margin:0;padding-left:20px;display:grid;gap:6px;color:var(--dim)' },
    h('li', { text: 'Ratón: mueve para apuntar; pulsa, arrastra hacia atrás y suelta para tirar.' }),
    h('li', { text: 'Táctil: toca o arrastra sobre la mesa para apuntar y usa la barra de potencia: arrastra y suelta.' }),
    h('li', { text: 'Ajuste fino: botones ‹ ›, flechas del teclado o rueda del ratón (Mayús para ir más rápido).' }),
    h('li', { text: 'Efecto: toca la bola pequeña. Arriba sigue, abajo retrocede, a los lados cambia el rebote en banda.' }),
    h('li', { text: 'Bola en mano: arrastra la blanca a su sitio antes de tirar.' }),
    h('li', { text: 'Mantén pulsada la mesa mientras ruedan las bolas para acelerar.' }),
  );
  openModal({ title: 'Cómo se juega', body: ul, actions: [{ label: 'Entendido', kind: 'primary', onClick: closeModal }] });
}

function confirmLeave() {
  openModal({
    title: room?.kind === 'host' ? '¿Cerrar la sala?' : '¿Salir de la sala?',
    body: h('p', { text: room?.kind === 'host' ? 'Todos los jugadores saldrán de la sala.' : 'Podrás volver con el mismo enlace.' }),
    actions: [{ label: 'Cancelar', kind: 'ghost', onClick: closeModal }, { label: 'Salir', kind: 'primary', onClick: () => { closeModal(); leaveRoom(); } }],
  });
}

// ===================================================================== salas online
let room = null; // { kind, net, selfId, view, gv, code }

function hasPeer() {
  if (typeof window.Peer === 'function') return true;
  info('Sin conexión', 'No se pudo cargar el módulo de red (PeerJS). Revisa tu conexión y recarga la página.');
  return false;
}

async function createRoom() {
  if (!hasPeer()) return;
  endLocal();
  loading('Creando sala privada…');
  const host = new RoomHost(profile());
  try {
    const code = await host.open();
    room = { kind: 'host', net: host, selfId: 'h', code, view: host.roomView(), gv: null };
    host.on('msg', onRoomMsg);
    resetChat();
    closeModal();
    renderLobby();
    show('lobby');
    host.sys(`Sala creada. Comparte el enlace para invitar.`);
  } catch (e) {
    host.close();
    info('No se pudo crear la sala', e.message);
  }
}

async function joinRoom(code, pass = '') {
  if (!hasPeer()) return;
  endLocal();
  loading(`Entrando en la sala ${code}…`);
  const client = new RoomClient();
  try {
    if (!pass) { try { pass = sessionStorage.getItem('wildpool:pass:' + code) || ''; } catch { /* sin almacenamiento */ } }
    const welcome = await client.join(code, { ...profile(), clientId, pass });
    try { if (pass) sessionStorage.setItem('wildpool:pass:' + code, pass); } catch { /* sin almacenamiento */ }
    room = { kind: 'client', net: client, selfId: welcome.you, code, view: welcome.room, gv: null };
    client.on('msg', onRoomMsg);
    client.on('closed', (text) => leaveRoom(text));
    const u = new URL(location.href);
    u.searchParams.set('sala', code);
    history.replaceState(null, '', u);
    resetChat();
    for (const m of welcome.chat || []) addChat(m);
    closeModal();
    renderLobby();
    if (welcome.game) startNetGame(welcome.game);
    else show('lobby');
  } catch (e) {
    if (e.reason === 'password') {
      try { sessionStorage.removeItem('wildpool:pass:' + code); } catch { /* sin almacenamiento */ }
      askPassword(code, !!pass);
      return;
    }
    info('No se pudo entrar', e.message, () => clearSalaParam());
  }
}

function askPassword(code, wrong) {
  const input = h('input', { type: 'password', maxlength: 32, autocomplete: 'off', 'aria-label': 'Contraseña' });
  openModal({
    title: 'Sala con contraseña',
    body: [h('p', { text: wrong ? 'La contraseña no es correcta. Inténtalo otra vez.' : `La sala ${code} pide contraseña.` }), input],
    actions: [
      { label: 'Cancelar', kind: 'ghost', onClick: () => { closeModal(); clearSalaParam(); } },
      { label: 'Entrar', kind: 'primary', submit: true },
    ],
  });
  modalInner.onsubmit = (e) => { e.preventDefault(); modalInner.onsubmit = null; joinRoom(code, input.value); };
}

function clearSalaParam() {
  const u = new URL(location.href);
  if (u.searchParams.has('sala')) { u.searchParams.delete('sala'); history.replaceState(null, '', u); }
}

function leaveRoom(reason) {
  if (!room) return;
  const r = room;
  room = null;
  r.gv?.destroy();
  r.net.close();
  hideOver();
  clearSalaParam();
  closeModal();
  show('home');
  if (reason) info('Fuera de la sala', reason);
}

function sendCosmetic() {
  if (room) room.net.send({ t: 'cosmetic', avatar: prefs.avatar, cue: prefs.cue, name: prefs.name });
}

function onRoomMsg(msg) {
  if (!room) return;
  switch (msg.t) {
    case 'room':
      room.view = msg.room;
      renderLobby();
      break;
    case 'chat': addChat(msg.m); break;
    case 'game': startNetGame(msg.sync); break;
    case 'lobby':
      room.gv?.destroy();
      room.gv = null;
      hideOver();
      show('lobby');
      break;
    case 'kicked': leaveRoom('El anfitrión te ha expulsado de la sala.'); break;
    case 'reject':
      if (room.gv && current === 'game') room.gv.handle(msg);
      else snack(msg.msg);
      break;
    case 'welcome': break;
    default:
      room.gv?.handle(msg);
  }
}

function startNetGame(sync) {
  hideOver();
  if (!room.gv) {
    const gv = new GameView(screens.game, {
      kind: 'net',
      controls: (seat) => gv.meta?.[seat]?.id === room?.selfId,
      shoot: (shot) => room?.net.send({ t: 'shot', shot }),
      aim: (d) => room?.net.send({ t: 'aim', ...d }),
      onOver: (over, meta) => showOver(over, meta),
    }, prefs);
    room.gv = gv;
  }
  show('game');
  room.gv.start(sync);
}

// ---------------------------------------------------------------- vista de la sala
$('#lobby-leave').addEventListener('click', () => confirmLeave());
$('#lobby-custom').addEventListener('click', () => openCustom('lobby'));
$('#lobby-copy').addEventListener('click', async () => {
  const link = inviteLink(room.code);
  try { await navigator.clipboard.writeText(link); snack('Enlace copiado'); } catch {
    openModal({ title: 'Enlace de invitación', body: h('input', { value: link, readonly: true, onfocus: (e) => e.target.select() }), actions: [{ label: 'Cerrar', onClick: closeModal }] });
  }
});
if (navigator.share) {
  $('#lobby-share').hidden = false;
  $('#lobby-share').addEventListener('click', () => {
    navigator.share({ title: 'WildPool', text: `¿Una partida de billar? Sala ${room.code}`, url: inviteLink(room.code) }).catch(() => {});
  });
}
$('#lobby-start').addEventListener('click', () => { sfx.unlock(); room?.net.send({ t: 'start' }); });
for (const b of $$('#lobby-role [data-role]')) b.addEventListener('click', () => room?.net.send({ t: 'role', role: b.dataset.role }));

function renderLobby() {
  if (!room) return;
  const v = room.view;
  const isHost = room.kind === 'host';
  $('#lobby-code').textContent = v.code || room.code;
  const me = v.members.find((m) => m.id === room.selfId);
  for (const b of $$('#lobby-role [data-role]')) {
    b.setAttribute('aria-pressed', String(me?.role === b.dataset.role));
    b.disabled = v.phase !== 'lobby';
  }
  const ul = $('#lobby-members');
  ul.innerHTML = '';
  for (const m of v.members) {
    const li = h('li', { class: 'member', style: `--c:${avatarColor(m.avatar)}` },
      h('span', { class: 'av', text: m.avatar }),
      h('span', { class: 'nm' }, m.name, m.id === room.selfId ? h('em', { text: 'tú' }) : null),
      m.isHost ? h('span', { class: 'tag host', text: 'Anfitrión' }) : null,
      !m.connected ? h('span', { class: 'tag off', text: 'Sin conexión' }) : null,
      h('span', { class: `tag ${m.role === 'player' ? 'play' : ''}`, text: m.role === 'player' ? 'Juega' : 'Mira' }),
      isHost && !m.isHost ? h('button', {
        class: 'kick', type: 'button', 'aria-label': `Expulsar a ${m.name}`, title: 'Expulsar',
        onclick: () => openModal({
          title: `¿Expulsar a ${m.name}?`, body: h('p', { text: 'Saldrá de la sala inmediatamente.' }),
          actions: [{ label: 'Cancelar', kind: 'ghost', onClick: closeModal }, { label: 'Expulsar', kind: 'primary', onClick: () => { closeModal(); room.net.send({ t: 'kick', id: m.id }); } }],
        }),
      }, '✕') : null,
    );
    ul.append(li);
  }
  renderSettings(v, isHost);
  const hostName = v.members.find((m) => m.isHost)?.name || '';
  $('#lobby-owner').textContent = isHost ? 'Tú eliges las reglas' : `Elige ${hostName}`;
  const mode = MODES[v.settings.mode];
  const players = v.members.filter((m) => m.role === 'player' && m.connected).length;
  let hint = '';
  if (players < mode.min) hint = `${mode.name} necesita ${mode.min === mode.max ? mode.min : 'al menos ' + mode.min} jugador${mode.min > 1 ? 'es' : ''} (ahora ${players}). Invita con el enlace.`;
  else if (players > mode.max) hint = `${mode.name} admite como mucho ${mode.max}: pasa a alguien a espectador.`;
  const ok = !hint;
  if (!isHost) hint = v.phase === 'game' ? 'Hay una partida en curso.' : `Esperando a que ${hostName} empiece la partida.`;
  else if (ok) hint = `Todo listo: ${players} jugador${players > 1 ? 'es' : ''}.`;
  $('#lobby-hint').textContent = hint;
  const start = $('#lobby-start');
  start.hidden = !isHost;
  start.disabled = !ok || v.phase !== 'lobby';
}

function renderSettings(v, isHost) {
  const box = $('#lobby-settings');
  const s = v.settings;
  const send = (patch) => room.net.send({ t: 'settings', settings: { ...s, ...patch } });
  box.innerHTML = '';
  const modes = h('div', { class: 'modes' }, MODE_LIST.map((m) => h('button', {
    class: 'mode-opt', type: 'button', 'aria-pressed': String(m.id === s.mode), disabled: !isHost,
    onclick: () => send({ mode: m.id, opts: defaultOptions(m.id) }),
  }, h('strong', { text: m.name }), h('span'), h('span', { class: 'cnt', text: m.min === m.max ? `${m.min} jugadores` : `${m.min}–${m.max} jugadores` }), h('span', { class: 'bl', text: m.blurb }))));
  const grid = h('div', { class: 'settings-grid' });
  for (const o of MODES[s.mode].options) {
    const val = s.opts[o.key];
    if (o.type === 'bool') {
      grid.append(h('div', { class: 'setting' }, h('span', { text: o.label }), segmented([[true, 'Sí'], [false, 'No']], val, (x) => send({ opts: { ...s.opts, [o.key]: x } }), !isHost)));
    } else {
      grid.append(h('div', { class: 'setting' }, h('span', { text: o.label }), segmented(o.choices, val, (x) => send({ opts: { ...s.opts, [o.key]: x } }), !isHost)));
    }
  }
  grid.append(
    h('div', { class: 'setting' }, h('span', { text: 'Tiempo por tiro' }), segmented([[0, 'Sin límite'], [30, '30 s'], [45, '45 s'], [60, '60 s']], s.clock, (x) => send({ clock: x }), !isHost)),
    h('div', { class: 'setting' }, h('span', { text: 'Línea de guía' }), segmented([['long', 'Larga'], ['short', 'Corta'], ['off', 'Sin guía']], s.guide, (x) => send({ guide: x }), !isHost)),
  );
  if (isHost) {
    const pin = h('input', { type: 'password', maxlength: 32, placeholder: v.hasPassword ? 'Contraseña activa' : 'Sin contraseña', autocomplete: 'new-password', 'aria-label': 'Contraseña de la sala' });
    const save = h('button', { class: 'btn', type: 'button', onclick: () => { room.net.send({ t: 'password', value: pin.value }); snack(pin.value ? 'Contraseña guardada' : 'Contraseña quitada'); pin.value = ''; } }, 'Guardar');
    grid.append(h('div', { class: 'setting' }, h('span', { text: 'Contraseña (opcional)' }), h('div', { class: 'pass-row' }, pin, save)));
  } else if (v.hasPassword) {
    grid.append(h('div', { class: 'setting' }, h('span', { text: 'Acceso' }), h('strong', { text: 'Con contraseña' })));
  }
  box.append(modes, grid);
}

function segmented(choices, value, onChange, disabled = false) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  for (const [k, label] of choices) {
    wrap.append(h('button', {
      type: 'button', 'aria-pressed': String(k === value), disabled,
      onclick: () => {
        for (const b of wrap.children) b.setAttribute('aria-pressed', 'false');
        wrap.children[choices.findIndex(([x]) => x === k)].setAttribute('aria-pressed', 'true');
        onChange(k);
      },
    }, label));
  }
  return wrap;
}

window.addEventListener('beforeunload', () => { room?.net.close(); });

// ===================================================================== arranque
(async function boot() {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('700 40px "Barlow Semi Condensed"'),
        document.fonts.load('40px Shrikhand'),
      ]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch { /* fuentes de reserva */ }
  show('home');
  // Enlace de invitación: ?sala=CODIGO entra directamente
  const code = normalizeCode(new URLSearchParams(location.search).get('sala'));
  if (code) {
    const waitPeer = () => new Promise((res) => {
      if (window.Peer) return res();
      window.addEventListener('load', () => res(), { once: true });
    });
    await waitPeer();
    if (prefs.name) joinRoom(code);
    else {
      const input = h('input', { maxlength: 18, placeholder: 'Tu nombre', autocomplete: 'nickname', 'aria-label': 'Tu nombre' });
      openModal({
        title: 'Te han invitado a una sala',
        body: [h('p', { text: `Escribe tu nombre para entrar en la sala ${code}.` }), input],
        actions: [{ label: 'Cancelar', kind: 'ghost', onClick: () => { closeModal(); clearSalaParam(); } }, { label: 'Entrar', kind: 'primary', submit: true }],
        dismissable: false,
      });
      modalInner.onsubmit = (e) => {
        e.preventDefault();
        const n = cleanName(input.value);
        if (!n) { input.focus(); return; }
        prefs.name = n; nameInput.value = n; persist();
        modalInner.onsubmit = null;
        joinRoom(code);
      };
    }
  }
})();

// utilidades de depuración para pruebas automáticas
window.__wildpool = { get room() { return room; }, get local() { return local; }, prefs: () => prefs, powerToSpeed };
