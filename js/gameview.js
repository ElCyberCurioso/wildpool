// Pantalla de juego: anima los tiros, gestiona el apuntado y pinta el marcador.
// Recibe mensajes de una sesión (local o en red) y le entrega los tiros del jugador.
import { World, TICK } from './physics.js';
import { preparePacket } from './match.js';
import { MODES } from './rules/index.js';
import { Renderer, ballIcon, cueStrip } from './render.js';
import { sfx } from './audio.js';
import { avatarColor } from './cosmetics.js';

const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* puntero sintético o ya liberado */ } };
const iconCache = new Map();
function ballIconURL(id, set, kind) {
  const k = `${id}|${set}|${kind}`;
  if (!iconCache.has(k)) iconCache.set(k, ballIcon(id, set, 44, kind).toDataURL());
  return iconCache.get(k);
}

export class GameView {
  constructor(root, ctrl, prefs) {
    this.root = root;
    this.ctrl = ctrl;
    this.prefs = prefs;
    this.canvas = $('#table-canvas', root);
    this.wrap = $('#table-wrap', root);
    this.board = $('#scoreboard', root);
    this.statusEl = $('#game-status', root);
    this.toastEl = $('#toasts', root);
    this.powerEl = $('#power', root);
    this.spinCanvas = $('#spin-canvas', root);
    this.renderer = new Renderer(this.canvas);
    this.queue = [];
    this.anim = null;
    this.angle = 0;
    this.pull = 0;
    this.spin = { x: 0, y: 0 };
    this.call = null;
    this.placing = null;
    this.remote = null;
    this.waiting = false;
    this.clockEnd = 0;
    this.lastAimSent = 0;
    this.ff = false;
    this.disposers = [];
    this.alive = true;
    this.bindInput();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.wrap);
    this.last = performance.now();
    const loop = (now) => {
      if (!this.alive) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const d of this.disposers) d();
    clearTimeout(this.aimTimer);
    clearInterval(this.fineTimer);
  }

  on(el, ev, fn, opts) {
    el.addEventListener(ev, fn, opts);
    this.disposers.push(() => el.removeEventListener(ev, fn, opts));
  }

  setPrefs(prefs) {
    this.prefs = prefs;
    this.renderer.setPrefs(prefs);
    this.renderHud();
  }

  resize() {
    const r = this.wrap.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    this.renderer.resize(r.width, r.height);
  }

  // ------------------------------------------------------------ mensajes
  start(sync) {
    this.sync = sync;
    this.rules = MODES[sync.mode];
    this.world = new World(this.rules.table);
    this.world.load(sync.snap);
    this.state = sync.state;
    this.meta = sync.seats;
    this.queue = [];
    this.anim = null;
    this.waiting = false;
    this.remote = null;
    this.renderer.sprites.clear();
    this.renderer.falling = [];
    this.renderer.setTable(this.world.table);
    this.renderer.setPrefs(this.prefs);
    this.resize();
    this.root.dataset.mode = sync.mode;
    this.toastEl.innerHTML = '';
    this.afterState(true);
  }

  handle(msg) {
    switch (msg.t) {
      case 'game': this.start(msg.sync); break;
      case 'shot': this.queue.push({ kind: 'shot', packet: msg.packet }); this.process(); break;
      case 'result': this.queue.push({ kind: 'result', result: msg.result }); this.process(); break;
      case 'aim':
        if (this.state && msg.seat === this.state.turn && !this.ctrl.controls(msg.seat)) this.remote = msg;
        break;
      case 'meta': this.meta = msg.seats; this.renderHud(); break;
      case 'reject':
        this.waiting = false;
        this.toast(msg.msg, 'foul');
        break;
      default: break;
    }
  }

  process() {
    while (!this.anim && this.queue.length) {
      const item = this.queue.shift();
      if (item.kind === 'shot') this.startAnim(item.packet);
      else this.applyResult(item.result);
    }
  }

  startAnim(packet) {
    this.waiting = false;
    this.placing = null;
    this.remote = null;
    this.clockEnd = 0;
    const w = this.world;
    preparePacket(w, packet);
    const meta = this.meta[packet.seat] || {};
    this.anim = {
      packet, phase: 'strike', t: 0, acc: 0,
      style: meta.cue || 'clasico',
      angle: Math.atan2(packet.vy, packet.vx),
      pull: packet.p ?? 0.5,
      sx: packet.side, sy: packet.roll,
    };
    w.onImpact = (type, speed, x, y, id) => {
      if (type === 'ball') sfx.play('ball', speed / 380);
      else if (type === 'cushion') sfx.play('cushion', speed / 420);
      else if (type === 'pocket') {
        sfx.play('pocket', 1);
        const b = w.ball(id);
        if (b) this.renderer.addFalling(id, b.x, b.y, x, y);
      }
    };
    this.statusEl.textContent = '';
  }

  finishAnim() {
    this.world.onImpact = null;
    this.anim = null;
    this.process();
  }

  applyResult(res) {
    const prevTurn = this.state.turn;
    this.world.load(res.snap);
    this.state = res.state;
    if (res.msg) this.toast(res.msg, res.foul ? 'foul' : '');
    if (res.foul) sfx.play('foul');
    this.afterState(prevTurn !== this.state.turn);
  }

  afterState(turnChanged) {
    this.pull = 0;
    this.call = null;
    this.placing = null;
    this.spin = { x: 0, y: 0 };
    this.drawSpin();
    this.renderPower();
    const s = this.state;
    if (s.over) {
      this.clockEnd = 0;
      this.renderHud();
      this.ctrl.onOver?.(s.over, this.meta, s);
      return;
    }
    this.aimAtTarget();
    const clock = this.sync.clock || 0;
    this.clockEnd = clock ? performance.now() + clock * 1000 : 0;
    if (this.ctrl.controls(s.turn) && turnChanged) sfx.play('turn');
    this.renderHud();
    if (!this.queue.length) this.ctrl.onIdle?.();
  }

  aimAtTarget() {
    const cue = this.world.ball(this.state.cueId);
    if (!cue) return;
    const info = this.rules.info(this.state, this.world);
    let best = null, bd = Infinity;
    for (const id of info.targets) {
      const b = this.world.ball(id);
      if (!b || !b.on) continue;
      const d = (b.x - cue.x) ** 2 + (b.y - cue.y) ** 2;
      if (d < bd) { bd = d; best = b; }
    }
    if (best) this.angle = Math.atan2(best.y - cue.y, best.x - cue.x);
    this.info = info;
  }

  // ------------------------------------------------------------ estado derivado
  canAct() {
    return !!this.state && !this.anim && !this.queue.length && !this.state.over && !this.waiting
      && this.ctrl.controls(this.state.turn);
  }

  // ------------------------------------------------------------ bucle
  frame(dt) {
    if (!this.world) return;
    sfx.frame();
    const a = this.anim;
    if (a) {
      if (a.phase === 'strike') {
        a.t += dt;
        if (a.t >= 0.1) {
          a.phase = 'roll';
          sfx.play('cue', 0.25 + a.pull);
        }
      } else {
        a.t += dt;
        a.acc += dt * (this.ff ? 4 : 1);
        let steps = 0;
        const w = this.world;
        while (a.acc >= TICK && steps < 60) {
          const prev = w.balls.map((b) => [b.x, b.y, b.on]);
          w.step();
          w.balls.forEach((b, i) => {
            if (b.on && prev[i][2]) {
              const dx = b.x - prev[i][0], dy = b.y - prev[i][1];
              if (dx || dy) this.renderer.roll(b.id, dx, dy);
            }
          });
          a.acc -= TICK;
          steps++;
          if (!w.isMoving()) break;
        }
        if (!w.isMoving()) this.finishAnim();
      }
    }
    this.updateClock();
    this.renderer.draw(this.frameData(), dt);
  }

  frameData() {
    const s = this.state;
    const f = { world: this.world };
    const mine = this.canAct();
    if (this.anim) {
      const a = this.anim;
      if (a.phase === 'strike') {
        const q = Math.min(1, a.t / 0.1);
        f.aim = { cueId: a.packet.cueId, angle: a.angle, pull: a.pull * (1 - q), style: a.style, guide: 'off', remote: !this.ctrl.controls(a.packet.seat) };
      } else if (a.t < 0.35) {
        // el taco acompaña un instante tras el golpe
        const b = this.world.ball(a.packet.cueId);
        if (b) f.aim = null;
      }
      return f;
    }
    if (!s || s.over) return f;
    const guide = this.sync.guide || 'long';
    if (mine) {
      const callNeeded = this.info?.callPocket;
      f.aim = {
        cueId: s.cueId, angle: this.angle, pull: this.pull, style: this.meta[s.turn]?.cue,
        guide, sy: this.spin.y,
        hideGuide: !!this.placing?.drag,
      };
      f.kitchen = s.ballInHand === 'kitchen';
      f.callPocket = callNeeded;
      f.call = this.call;
      f.targets = this.info?.targets;
      f.showTargets = !s.isBreak && (f.targets?.length || 0) <= 7;
      if (s.ballInHand) {
        f.placing = { id: s.cueId, valid: this.placing ? this.placing.valid : true };
      }
    } else if (this.remote && this.remote.seat === s.turn) {
      const r = this.remote;
      if (s.ballInHand && r.cx != null && this.world.canPlace(s.cueId, r.cx, r.cy, s.ballInHand)) {
        const cue = this.world.ball(s.cueId);
        cue.x = r.cx; cue.y = r.cy; cue.on = true;
      }
      this.angle = lerpAngle(this.angle, r.a, 0.35);
      f.aim = { cueId: s.cueId, angle: this.angle, pull: r.pw || 0, style: this.meta[s.turn]?.cue, guide: guide === 'off' ? 'off' : 'short', sy: r.sy || 0, remote: true };
      f.callPocket = this.info?.callPocket && r.call != null;
      f.call = r.call;
    } else {
      f.aim = { cueId: s.cueId, angle: this.angle, pull: 0, style: this.meta[s.turn]?.cue, guide: 'off', remote: true };
    }
    return f;
  }

  // ------------------------------------------------------------ tiro
  shoot(power) {
    if (!this.canAct()) return;
    if (power < 0.02) return;
    const s = this.state;
    if (this.info?.callPocket && this.call == null) {
      this.toast('Primero toca la tronera donde vas a meter la 8.', 'hint');
      this.pull = 0;
      this.renderPower();
      return;
    }
    const shot = { a: this.angle, p: clamp(power, 0.02, 1), sx: this.spin.x, sy: this.spin.y, call: this.call ?? -1 };
    if (s.ballInHand) {
      const cue = this.world.ball(s.cueId);
      shot.cx = cue.x; shot.cy = cue.y;
    }
    this.waiting = true;
    sfx.unlock();
    this.ctrl.shoot(shot);
  }

  sendAim(force = false) {
    if (!this.canAct() || !this.ctrl.aim) return;
    const now = performance.now();
    const send = () => {
      this.lastAimSent = performance.now();
      const s = this.state;
      const cue = this.world.ball(s.cueId);
      const d = { a: this.angle, pw: this.pull, sx: this.spin.x, sy: this.spin.y };
      if (s.ballInHand && cue) { d.cx = cue.x; d.cy = cue.y; }
      if (this.call != null) d.call = this.call;
      this.ctrl.aim(d);
    };
    clearTimeout(this.aimTimer);
    if (force || now - this.lastAimSent > 70) send();
    else this.aimTimer = setTimeout(send, 70);
  }

  // ------------------------------------------------------------ entrada
  bindInput() {
    const cv = this.canvas;
    let mode = null; // 'place' | 'pull' | 'touchaim'
    let start = null;
    const tableR = () => this.world.table.R;

    const nearPocket = (p) => {
      const t = this.world.table;
      let best = -1, bd = 11 * 11;
      t.pockets.forEach((pk, i) => {
        const d = (pk.x - p.x) ** 2 + (pk.y - p.y) ** 2;
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    };

    const aimTo = (p) => {
      const cue = this.world.ball(this.state.cueId);
      const dx = p.x - cue.x, dy = p.y - cue.y;
      if (dx * dx + dy * dy < (tableR() * 2.2) ** 2) return;
      this.angle = Math.atan2(dy, dx);
      this.sendAim();
    };

    this.on(cv, 'pointerdown', (e) => {
      sfx.unlock();
      if (this.anim) { this.ff = true; return; }
      if (!this.canAct()) return;
      const p = this.renderer.toTable(e.clientX, e.clientY);
      const s = this.state;
      const cue = this.world.ball(s.cueId);
      if (this.info?.callPocket) {
        const pk = nearPocket(p);
        if (pk >= 0) {
          this.call = pk;
          sfx.play('ui');
          this.sendAim(true);
          this.renderStatus();
          return;
        }
      }
      if (s.ballInHand && cue && (p.x - cue.x) ** 2 + (p.y - cue.y) ** 2 < (tableR() * 2.8) ** 2) {
        mode = 'place';
        this.placing = { drag: true, valid: true, lastX: cue.x, lastY: cue.y, offX: cue.x - p.x, offY: cue.y - p.y };
        capture(cv, e.pointerId);
        return;
      }
      if (e.pointerType === 'mouse') {
        if (e.button !== 0) return;
        mode = 'pull';
        start = p;
        capture(cv, e.pointerId);
      } else {
        mode = 'touchaim';
        aimTo(p);
        capture(cv, e.pointerId);
      }
    });

    this.on(cv, 'pointermove', (e) => {
      if (!this.world || !this.state) return;
      if (!this.canAct()) return;
      const p = this.renderer.toTable(e.clientX, e.clientY);
      if (mode === 'place') {
        const t = this.world.table, R = t.R, s = this.state;
        const cue = this.world.ball(s.cueId);
        const maxX = s.ballInHand === 'kitchen' ? t.headX : t.L - R;
        const x = clamp(p.x + this.placing.offX, R, maxX), y = clamp(p.y + this.placing.offY, R, t.W - R);
        cue.x = x; cue.y = y; cue.on = true;
        this.placing.valid = this.world.canPlace(s.cueId, x, y, s.ballInHand);
        if (this.placing.valid) { this.placing.lastX = x; this.placing.lastY = y; }
        this.sendAim();
      } else if (mode === 'pull') {
        const dx = Math.cos(this.angle), dy = Math.sin(this.angle);
        const back = -((p.x - start.x) * dx + (p.y - start.y) * dy);
        this.pull = clamp(back / 40, 0, 1);
        this.renderPower();
        this.sendAim();
      } else if (mode === 'touchaim') {
        aimTo(p);
      } else if (e.pointerType === 'mouse' && !e.buttons) {
        aimTo(p);
      }
    });

    const end = (e, cancel) => {
      this.ff = false;
      if (!mode) return;
      const m = mode;
      mode = null;
      try { cv.releasePointerCapture(e.pointerId); } catch { /* sin captura */ }
      if (m === 'place') {
        const cue = this.world.ball(this.state.cueId);
        if (!this.placing.valid) { cue.x = this.placing.lastX; cue.y = this.placing.lastY; }
        this.placing = { drag: false, valid: true };
        this.sendAim(true);
      } else if (m === 'pull') {
        const p = this.pull;
        if (!cancel && p > 0.02) this.shoot(p);
        else { this.pull = 0; this.renderPower(); this.sendAim(true); }
      }
    };
    this.on(cv, 'pointerup', (e) => end(e, false));
    this.on(cv, 'pointercancel', (e) => end(e, true));
    this.on(cv, 'contextmenu', (e) => { e.preventDefault(); if (mode === 'pull') { mode = null; this.pull = 0; this.renderPower(); } });
    this.on(cv, 'wheel', (e) => {
      if (!this.canAct()) return;
      e.preventDefault();
      this.angle += Math.sign(e.deltaY) * (e.shiftKey ? 0.01 : 0.0015);
      this.sendAim();
    }, { passive: false });

    // barra de potencia
    const track = $('.power-track', this.powerEl);
    let pDrag = false;
    const setFromBar = (e) => {
      const r = track.getBoundingClientRect();
      const vertical = r.height > r.width;
      this.pull = vertical ? clamp((e.clientY - r.top) / r.height, 0, 1) : clamp((e.clientX - r.left) / r.width, 0, 1);
      this.renderPower();
      this.sendAim();
    };
    this.on(track, 'pointerdown', (e) => {
      sfx.unlock();
      if (!this.canAct()) return;
      pDrag = true;
      capture(track, e.pointerId);
      setFromBar(e);
    });
    this.on(track, 'pointermove', (e) => { if (pDrag) setFromBar(e); });
    this.on(track, 'pointerup', (e) => {
      if (!pDrag) return;
      pDrag = false;
      const p = this.pull;
      if (p > 0.02) this.shoot(p); else { this.pull = 0; this.renderPower(); }
    });
    this.on(track, 'pointercancel', () => { pDrag = false; this.pull = 0; this.renderPower(); });

    // efecto
    const sc = this.spinCanvas;
    let sDrag = false;
    const setSpin = (e) => {
      const r = sc.getBoundingClientRect();
      let x = ((e.clientX - r.left) / r.width) * 2 - 1;
      let y = ((e.clientY - r.top) / r.height) * 2 - 1;
      const l = Math.hypot(x, y) / 0.8;
      if (l > 1) { x /= l; y /= l; }
      this.spin = { x: x / 0.8, y: -y / 0.8 };
      if (Math.hypot(this.spin.x, this.spin.y) < 0.08) this.spin = { x: 0, y: 0 };
      this.drawSpin();
      this.sendAim();
    };
    this.on(sc, 'pointerdown', (e) => { if (!this.canAct()) return; sDrag = true; capture(sc, e.pointerId); setSpin(e); });
    this.on(sc, 'pointermove', (e) => { if (sDrag) setSpin(e); });
    this.on(sc, 'pointerup', () => { sDrag = false; });
    this.on(sc, 'dblclick', () => { this.spin = { x: 0, y: 0 }; this.drawSpin(); });

    // ajuste fino
    for (const b of this.root.querySelectorAll('[data-fine]')) {
      const dir = Number(b.dataset.fine);
      const stop = () => clearInterval(this.fineTimer);
      this.on(b, 'pointerdown', (e) => {
        e.preventDefault();
        if (!this.canAct()) return;
        let n = 0;
        const stepFn = () => { this.angle += dir * (n++ > 12 ? 0.006 : 0.0012); this.sendAim(); };
        stepFn();
        clearInterval(this.fineTimer);
        this.fineTimer = setInterval(stepFn, 45);
      });
      this.on(b, 'pointerup', stop);
      this.on(b, 'pointerleave', stop);
      this.on(b, 'pointercancel', stop);
    }

    // teclado
    this.on(window, 'keydown', (e) => {
      if (!this.root.isConnected || this.root.hidden) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!this.canAct()) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        this.angle += (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.012 : 0.0015);
        this.sendAim();
        e.preventDefault();
      } else if (k === 'ArrowUp' || k === 'ArrowDown') {
        this.pull = clamp(this.pull + (k === 'ArrowDown' ? 0.05 : -0.05), 0, 1);
        this.renderPower();
        this.sendAim();
        e.preventDefault();
      } else if (k === 'Enter' || k === ' ') {
        if (this.pull > 0.02) { this.shoot(this.pull); e.preventDefault(); }
      } else if (k === 'Escape') {
        this.pull = 0; this.renderPower();
      }
    });
    this.on(window, 'blur', () => { if (mode === 'pull') { mode = null; this.pull = 0; this.renderPower(); } });
  }

  // ------------------------------------------------------------ HUD
  renderPower() {
    const fill = $('.power-fill', this.powerEl);
    if (fill) fill.style.setProperty('--p', this.pull.toFixed(3));
    this.powerEl.classList.toggle('disabled', !this.canAct());
  }

  drawSpin() {
    const c = this.spinCanvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = c.clientWidth || 72;
    if (c.width !== Math.round(S * dpr)) { c.width = Math.round(S * dpr); c.height = Math.round(S * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    const r = S / 2 - 2;
    const gr = g.createRadialGradient(S * 0.38, S * 0.34, 2, S / 2, S / 2, r);
    gr.addColorStop(0, '#FFFFFF');
    gr.addColorStop(0.7, '#E9E2D2');
    gr.addColorStop(1, '#A79F8E');
    g.fillStyle = gr;
    g.beginPath(); g.arc(S / 2, S / 2, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(S / 2, 6); g.lineTo(S / 2, S - 6); g.moveTo(6, S / 2); g.lineTo(S - 6, S / 2); g.stroke();
    g.beginPath(); g.arc(S / 2, S / 2, r * 0.8, 0, Math.PI * 2); g.stroke();
    const px = S / 2 + this.spin.x * r * 0.8, py = S / 2 - this.spin.y * r * 0.8;
    g.fillStyle = '#C8102E';
    g.beginPath(); g.arc(px, py, Math.max(4, S * 0.075), 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 1.5;
    g.stroke();
  }

  updateClock() {
    if (!this.clockEnd || !this.state || this.anim) {
      this.board.style.setProperty('--clock', '1');
      return;
    }
    const total = (this.sync.clock || 1) * 1000;
    const left = Math.max(0, this.clockEnd - performance.now());
    this.board.style.setProperty('--clock', (left / total).toFixed(3));
    const secs = Math.ceil(left / 1000);
    if (secs !== this.lastSecs) {
      this.lastSecs = secs;
      const el = this.board.querySelector('.plate.active .clock');
      if (el) el.textContent = secs <= 10 ? String(secs) : '';
    }
  }

  renderHud() {
    if (!this.state) return;
    const s = this.state;
    const hud = this.rules.hud(s, this.world);
    const kind = this.world.table.kind;
    this.board.innerHTML = '';
    const many = s.seats.length > 2;
    this.board.classList.toggle('many', many);
    const plates = s.seats.map((seat, i) => {
      const m = this.meta[i] || {};
      const h = hud[i] || {};
      const el = document.createElement('div');
      el.className = 'plate';
      if (i === s.turn && !s.over) el.classList.add('active');
      if (h.out || seat.alive === false) el.classList.add('out');
      if (!many && i === 1) el.classList.add('right');
      const av = document.createElement('span');
      av.className = 'avatar';
      av.style.setProperty('--c', avatarColor(m.avatar));
      av.textContent = m.avatar || '🎱';
      const clock = document.createElement('span');
      clock.className = 'clock';
      av.appendChild(clock);
      const txt = document.createElement('div');
      txt.className = 'who';
      const nm = document.createElement('strong');
      nm.textContent = seat.name;
      if (this.ctrl.controls(i) && this.ctrl.kind !== 'local') {
        const you = document.createElement('em');
        you.textContent = 'tú';
        nm.appendChild(you);
      }
      if (m.offline) {
        const off = document.createElement('em');
        off.className = 'off';
        off.textContent = 'sin conexión';
        nm.appendChild(off);
      }
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = h.sub || '';
      txt.append(nm, sub);
      const balls = document.createElement('div');
      balls.className = 'balls';
      for (const id of h.balls || []) {
        const img = document.createElement('img');
        img.src = ballIconURL(id, this.prefs.balls, kind);
        img.alt = String(id);
        balls.appendChild(img);
      }
      if (h.lives != null && seat.alive !== false) {
        const lv = document.createElement('span');
        lv.className = 'lives';
        lv.textContent = '●'.repeat(Math.max(0, Math.min(8, h.lives)));
        balls.appendChild(lv);
      }
      el.append(av, txt, balls);
      return el;
    });
    if (!many && plates.length === 2) {
      const mid = document.createElement('div');
      mid.className = 'mid';
      mid.innerHTML = '<span class="mode"></span>';
      mid.querySelector('.mode').textContent = this.rules.name;
      this.board.append(plates[0], mid, plates[1]);
    } else {
      const mode = document.createElement('div');
      mode.className = 'mid';
      mode.innerHTML = '<span class="mode"></span>';
      mode.querySelector('.mode').textContent = this.rules.name;
      this.board.append(mode, ...plates);
    }
    this.renderStatus();
    this.renderPower();
  }

  renderStatus() {
    const s = this.state;
    let t = '';
    if (!s) return;
    if (s.over) t = '';
    else if (this.ctrl.controls(s.turn)) {
      const who = this.ctrl.kind === 'local' && s.seats.length > 1 ? `${s.seats[s.turn].name}: ` : '';
      const say = (x) => (who ? who + x : x[0].toUpperCase() + x.slice(1));
      if (s.ballInHand === 'kitchen') t = say('saque: coloca la blanca tras la línea y tira');
      else if (s.ballInHand) t = say('bola en mano: arrastra la blanca');
      else if (this.info?.callPocket && this.call == null) t = say('toca la tronera para la 8');
      else if (this.ctrl.kind === 'local') t = s.seats.length > 1 ? `Turno de ${s.seats[s.turn].name}` : '';
      else t = 'Tu turno';
    } else {
      t = this.ctrl.statusFor?.(s.turn) || `Turno de ${s.seats[s.turn].name}`;
    }
    this.statusEl.textContent = t;
  }

  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toastEl.appendChild(el);
    while (this.toastEl.children.length > 3) this.toastEl.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 3600);
    setTimeout(() => el.remove(), 4200);
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export { cueStrip };
