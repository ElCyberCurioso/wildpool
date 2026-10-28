// Salas privadas P2P con PeerJS. El anfitrión es la autoridad: valida cada mensaje,
// simula los tiros y reparte el resultado. Los invitados solo envían intenciones.
/* global Peer */
import { Emitter } from './emitter.js';
import { NET, PROTOCOL } from './config.js';
import { Match } from './match.js';
import { MODES, sanitizeOptions, defaultOptions } from './rules/index.js';
import { AVATARS, CUES, cleanName, cleanText } from './cosmetics.js';
import { shuffle } from './rules/common.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export function makeCode() {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return [...a].map((n) => ALPHABET[n % ALPHABET.length]).join('');
}

export function normalizeCode(s) {
  const c = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE_RE.test(c) ? c : null;
}

export function inviteLink(code) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('sala', code);
  return u.toString();
}

function peerOptions() {
  const opts = { debug: 1, ...NET.peer };
  // Solo en desarrollo local: ?peer=localhost:9000 apunta a un servidor PeerJS propio
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const q = new URLSearchParams(location.search).get('peer');
  if (local && q && /^(localhost|127\.0\.0\.1)(:\d{2,5})?$/.test(q)) {
    const [host, port] = q.split(':');
    Object.assign(opts, { host, port: Number(port || 9000), path: '/', secure: false });
  }
  if (NET.iceServers) opts.config = { iceServers: NET.iceServers };
  return opts;
}

function peerErrorText(err) {
  switch (err?.type) {
    case 'peer-unavailable': return 'La sala no existe o ya se cerró.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'No se pudo contactar con el servidor de emparejamiento. Revisa tu conexión.';
    case 'browser-incompatible': return 'Tu navegador no admite WebRTC.';
    case 'webrtc': return 'No se pudo abrir la conexión directa con la sala.';
    default: return `Error de conexión (${err?.type || 'desconocido'}).`;
  }
}

const isObj = (m) => m && typeof m === 'object' && !Array.isArray(m) && typeof m.t === 'string' && m.t.length < 16;
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const CUE_IDS = new Set(CUES.map((c) => c.id));

// ===================================================================== anfitrión
export class RoomHost extends Emitter {
  constructor(profile) {
    super();
    this.profile = profile;
    this.code = null;
    this.peer = null;
    this.members = new Map();
    this.seq = 0;
    this.phase = 'lobby';
    this.match = null;
    this.seatIds = [];
    this.chatLog = [];
    this.password = '';
    this.settings = { mode: '8ball', opts: defaultOptions('8ball'), clock: 0, guide: 'long' };
    this.closed = false;
    this.members.set('h', {
      id: 'h', clientId: 'host', name: profile.name, avatar: profile.avatar, cue: profile.cue,
      role: 'player', connected: true, isHost: true, conn: null, auto: true,
    });
  }

  get selfId() { return 'h'; }

  open() {
    return new Promise((resolve, reject) => {
      let tries = 0;
      const attempt = () => {
        tries++;
        const code = makeCode();
        const peer = new Peer(NET.idPrefix + code, peerOptions());
        let opened = false;
        peer.on('open', () => {
          opened = true;
          this.code = code;
          this.peer = peer;
          peer.on('connection', (c) => this.onConn(c));
          peer.on('disconnected', () => {
            if (!this.closed) setTimeout(() => { if (!this.closed && peer.disconnected) peer.reconnect(); }, 1500);
          });
          this.heart = setInterval(() => this.heartbeat(), 4000);
          resolve(code);
        });
        peer.on('error', (err) => {
          if (!opened) {
            peer.destroy();
            if (err.type === 'unavailable-id' && tries < 5) attempt();
            else reject(new Error(peerErrorText(err)));
          } else if (err.type !== 'peer-unavailable') {
            console.warn('PeerJS', err.type, err);
          }
        });
      };
      attempt();
    });
  }

  close() {
    this.closed = true;
    clearInterval(this.heart);
    clearTimeout(this.clockTimer);
    for (const m of this.members.values()) {
      clearTimeout(m.grace);
      try { m.conn?.close(); } catch { /* ya cerrada */ }
    }
    try { this.peer?.destroy(); } catch { /* ya destruido */ }
    this.clear();
  }

  // ---------------------------------------------------------------- transporte
  sendTo(id, msg) {
    if (id === 'h') { this.emit('msg', msg); return; }
    const m = this.members.get(id);
    if (m?.conn?.open) {
      try { m.conn.send(msg); } catch (e) { console.warn(e); }
    }
  }

  broadcast(msg, except = null) {
    for (const id of this.members.keys()) if (id !== except) this.sendTo(id, msg);
  }

  // El anfitrión habla consigo mismo por la misma vía que los invitados
  send(msg) { this.handle('h', msg); }

  // ---------------------------------------------------------------- conexiones
  onConn(conn) {
    conn.on('open', () => {
      conn._hello = setTimeout(() => { if (!conn._member) conn.close(); }, 8000);
      conn._rate = { t: performance.now(), n: 0 };
    });
    conn.on('data', (d) => this.onData(conn, d));
    conn.on('close', () => this.onClose(conn));
    conn.on('error', () => this.onClose(conn));
  }

  onData(conn, msg) {
    const r = conn._rate || (conn._rate = { t: performance.now(), n: 0 });
    const now = performance.now();
    if (now - r.t > 2000) { r.t = now; r.n = 0; }
    if (++r.n > 120) { conn.close(); return; }
    if (!isObj(msg)) return;
    if (!conn._member) {
      if (msg.t === 'hello') this.admit(conn, msg);
      return;
    }
    const m = this.members.get(conn._member);
    if (!m || m.conn !== conn) return;
    m.lastSeen = now;
    this.handle(m.id, msg);
  }

  admit(conn, msg) {
    clearTimeout(conn._hello);
    const deny = (reason) => {
      try { conn.send({ t: 'denied', reason }); } catch { /* nada */ }
      setTimeout(() => conn.close(), 300);
    };
    if (msg.v !== PROTOCOL) return deny('version');
    if (this.password && String(msg.pass || '') !== this.password) return deny('password');
    const name = cleanName(msg.name) || 'Jugador';
    const avatar = AVATARS.includes(msg.avatar) ? msg.avatar : AVATARS[0];
    const cue = CUE_IDS.has(msg.cue) ? msg.cue : 'clasico';
    const clientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 40) : '';

    let m = clientId ? [...this.members.values()].find((x) => x.clientId === clientId && !x.isHost) : null;
    if (m) {
      if (m.conn && m.conn !== conn) { try { m.conn.close(); } catch { /* nada */ } }
      clearTimeout(m.grace);
      const back = !m.connected;
      Object.assign(m, { conn, connected: true, name, avatar, cue, lastSeen: performance.now() });
      conn._member = m.id;
      if (back) this.sys(`${m.name} ha vuelto.`);
    } else {
      if (this.members.size >= NET.maxMembers) return deny('full');
      const players = [...this.members.values()].filter((x) => x.role === 'player').length;
      const role = this.phase === 'lobby' && players < MODES[this.settings.mode].max ? 'player' : 'spectator';
      m = {
        id: 'm' + ++this.seq, clientId, name: this.uniqueName(name), avatar, cue, role, auto: this.phase === 'lobby',
        connected: true, isHost: false, conn, lastSeen: performance.now(), chat: [],
      };
      this.members.set(m.id, m);
      conn._member = m.id;
      this.sys(`${m.name} se ha unido${role === 'spectator' ? ' como espectador' : ''}.`);
    }
    this.sendTo(m.id, {
      t: 'welcome', you: m.id, room: this.roomView(), chat: this.chatLog.slice(-40),
      game: this.phase === 'game' && this.match ? this.gameSync() : null,
    });
    this.pushRoom();
    if (this.phase === 'game') this.broadcast({ t: 'meta', seats: this.seatMeta() });
  }

  uniqueName(name) {
    const taken = new Set([...this.members.values()].map((m) => m.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; i < 99; i++) {
      const n = `${name.slice(0, 15)} ${i}`;
      if (!taken.has(n.toLowerCase())) return n;
    }
    return name;
  }

  onClose(conn) {
    clearTimeout(conn._hello);
    const id = conn._member;
    if (!id) return;
    const m = this.members.get(id);
    if (!m || m.conn !== conn) return;
    m.conn = null;
    m.connected = false;
    const seat = this.seatIds.indexOf(id);
    const live = this.phase === 'game' && this.match && !this.match.state.over && seat >= 0
      && this.match.state.seats[seat].alive !== false;
    if (live) {
      this.sys(`${m.name} se ha desconectado. Tiene 60 s para volver.`);
      m.grace = setTimeout(() => {
        if (m.connected) return;
        this.members.delete(id);
        this.forfeit(seat, 'no volvió a tiempo');
        this.pushRoom();
      }, 60000);
      this.broadcast({ t: 'meta', seats: this.seatMeta() });
    } else {
      if (this.phase === 'game' && seat >= 0) {
        // estaba en la partida terminada o eliminado: se conserva el nombre en el marcador
      }
      this.members.delete(id);
      this.sys(`${m.name} ha salido.`);
    }
    this.pushRoom();
  }

  heartbeat() {
    const now = performance.now();
    for (const m of this.members.values()) {
      if (m.isHost || !m.conn) continue;
      if (now - (m.lastSeen || now) > 15000) { try { m.conn.close(); } catch { /* nada */ } this.onClose(m.conn || { _member: m.id }); continue; }
      this.sendTo(m.id, { t: 'ping' });
    }
  }

  // ---------------------------------------------------------------- vistas
  roomView() {
    return {
      code: this.code,
      phase: this.phase,
      settings: this.settings,
      hasPassword: !!this.password,
      members: [...this.members.values()].map((m) => ({
        id: m.id, name: m.name, avatar: m.avatar, cue: m.cue, role: m.role, connected: m.connected, isHost: m.isHost,
      })),
    };
  }

  pushRoom() { this.broadcast({ t: 'room', room: this.roomView() }); }

  seatMeta() {
    return this.seatIds.map((id, i) => {
      const m = this.members.get(id);
      const st = this.match?.state.seats[i];
      return { id, name: m?.name || st?.name || '—', avatar: m?.avatar || '🎱', cue: m?.cue || 'clasico', offline: !m || !m.connected };
    });
  }

  gameSync() {
    return { ...this.match.sync(), seats: this.seatMeta(), guide: this.settings.guide, clock: this.settings.clock };
  }

  sys(text) {
    const m = { id: 'c' + ++this.seq, sys: true, text, ts: Date.now() };
    this.chatLog.push(m);
    if (this.chatLog.length > 80) this.chatLog.shift();
    this.broadcast({ t: 'chat', m });
  }

  // ---------------------------------------------------------------- lógica
  handle(mid, msg) {
    const m = this.members.get(mid);
    if (!m || !isObj(msg)) return;
    const isHost = mid === 'h';
    switch (msg.t) {
      case 'chat': {
        const text = cleanText(msg.text, 200);
        if (!text) return;
        const now = Date.now();
        m.chat = (m.chat || []).filter((t) => now - t < 6000);
        if (m.chat.length >= 5) {
          this.sendTo(mid, { t: 'chat', m: { id: 'c' + ++this.seq, sys: true, text: 'Vas demasiado rápido: espera un momento.', ts: now } });
          return;
        }
        m.chat.push(now);
        const cm = { id: 'c' + ++this.seq, from: mid, name: m.name, avatar: m.avatar, text, ts: now };
        this.chatLog.push(cm);
        if (this.chatLog.length > 80) this.chatLog.shift();
        this.broadcast({ t: 'chat', m: cm });
        break;
      }
      case 'role':
        if (this.phase !== 'lobby' || !['player', 'spectator'].includes(msg.role)) return;
        m.role = msg.role;
        m.auto = false;
        this.pushRoom();
        break;
      case 'cosmetic':
        if (AVATARS.includes(msg.avatar)) m.avatar = msg.avatar;
        if (CUE_IDS.has(msg.cue)) m.cue = msg.cue;
        if (typeof msg.name === 'string' && this.phase === 'lobby') {
          const n = cleanName(msg.name);
          if (n && n !== m.name) m.name = this.uniqueName(n);
        }
        this.pushRoom();
        if (this.phase === 'game') this.broadcast({ t: 'meta', seats: this.seatMeta() });
        break;
      case 'aim': {
        if (this.phase !== 'game' || !this.match) return;
        const seat = this.seatIds.indexOf(mid);
        if (seat < 0 || seat !== this.match.state.turn) return;
        const out = { t: 'aim', seat };
        if (num(msg.a, -1e3, 1e3)) out.a = msg.a; else return;
        out.pw = num(msg.pw, 0, 1) ? msg.pw : 0;
        out.sx = num(msg.sx, -1.01, 1.01) ? msg.sx : 0;
        out.sy = num(msg.sy, -1.01, 1.01) ? msg.sy : 0;
        if (num(msg.cx, -50, 400) && num(msg.cy, -50, 300)) { out.cx = msg.cx; out.cy = msg.cy; }
        if (Number.isInteger(msg.call) && msg.call >= 0 && msg.call < 6) out.call = msg.call;
        this.broadcast(out, mid);
        break;
      }
      case 'shot': {
        if (this.phase !== 'game' || !this.match) return;
        const seat = this.seatIds.indexOf(mid);
        const shot = msg.shot && typeof msg.shot === 'object' ? {
          a: msg.shot.a, p: msg.shot.p, sx: msg.shot.sx, sy: msg.shot.sy,
          cx: num(msg.shot.cx, -50, 400) ? msg.shot.cx : undefined,
          cy: num(msg.shot.cy, -50, 300) ? msg.shot.cy : undefined,
          call: Number.isInteger(msg.shot.call) ? msg.shot.call : -1,
        } : null;
        const err = seat < 0 ? 'Eres espectador' : this.match.validate(seat, shot);
        if (err) { this.sendTo(mid, { t: 'reject', msg: err }); return; }
        const { packet, result } = this.match.play(seat, shot);
        this.broadcast({ t: 'shot', packet });
        this.broadcast({ t: 'result', result });
        this.afterResult(result);
        break;
      }
      case 'concede': {
        if (this.phase !== 'game' || !this.match) return;
        const seat = this.seatIds.indexOf(mid);
        if (seat >= 0) this.forfeit(seat, 'abandona la partida');
        break;
      }
      case 'pong': break;
      // ---- solo anfitrión
      case 'settings': {
        if (!isHost || this.phase !== 'lobby') return;
        const s = msg.settings || {};
        const mode = MODES[s.mode] ? s.mode : this.settings.mode;
        this.settings = {
          mode,
          opts: sanitizeOptions(mode, s.opts),
          clock: [0, 20, 30, 45, 60].includes(s.clock) ? s.clock : 0,
          guide: ['long', 'short', 'off'].includes(s.guide) ? s.guide : 'long',
        };
        this.autoRoles();
        this.pushRoom();
        break;
      }
      case 'password':
        if (!isHost) return;
        this.password = cleanText(msg.value, 32);
        this.pushRoom();
        break;
      case 'kick': {
        if (!isHost || msg.id === 'h') return;
        const k = this.members.get(msg.id);
        if (!k) return;
        this.sendTo(k.id, { t: 'kicked' });
        const conn = k.conn;
        const seat = this.seatIds.indexOf(k.id);
        this.members.delete(k.id);
        clearTimeout(k.grace);
        setTimeout(() => { try { conn?.close(); } catch { /* nada */ } }, 200);
        this.sys(`${k.name} ha sido expulsado.`);
        if (this.phase === 'game' && seat >= 0) this.forfeit(seat, 'ha sido expulsado');
        this.pushRoom();
        break;
      }
      case 'start': if (isHost) this.startGame(false); break;
      case 'rematch': if (isHost) this.startGame(true); break;
      case 'lobby':
        if (!isHost) return;
        this.phase = 'lobby';
        this.match = null;
        this.seatIds = [];
        clearTimeout(this.clockTimer);
        this.broadcast({ t: 'lobby' });
        this.pushRoom();
        break;
      default: break;
    }
  }

  // Quien no ha elegido papel a mano juega si hay sitio en el modo elegido
  autoRoles() {
    const max = MODES[this.settings.mode].max;
    const all = [...this.members.values()];
    let players = all.filter((m) => !m.auto && m.role === 'player').length;
    for (const m of all) {
      if (!m.auto) continue;
      if (players < max) { m.role = 'player'; players++; } else m.role = 'spectator';
    }
  }

  canStart() {
    const mode = MODES[this.settings.mode];
    const n = [...this.members.values()].filter((m) => m.role === 'player' && m.connected).length;
    if (n < mode.min) return `${mode.name} necesita ${mode.min === mode.max ? mode.min : 'al menos ' + mode.min} jugador${mode.min > 1 ? 'es' : ''} (hay ${n}).`;
    if (n > mode.max) return `${mode.name} admite como mucho ${mode.max} jugador${mode.max > 1 ? 'es' : ''}: pasa a alguien a espectador.`;
    return null;
  }

  startGame(rematch) {
    let ids;
    if (rematch && this.seatIds.length && this.seatIds.every((id) => this.members.get(id)?.connected)) {
      ids = [...this.seatIds.slice(1), this.seatIds[0]];
    } else {
      const err = this.canStart();
      if (err) { this.sendTo('h', { t: 'reject', msg: err }); return; }
      ids = shuffle([...this.members.values()].filter((m) => m.role === 'player' && m.connected).map((m) => m.id));
    }
    const mode = this.settings.mode;
    if (ids.length < MODES[mode].min) { this.sendTo('h', { t: 'reject', msg: this.canStart() || 'Faltan jugadores.' }); return; }
    this.seatIds = ids;
    this.match = new Match(mode, ids.map((id) => ({ id, name: this.members.get(id).name })), { ...this.settings.opts });
    this.phase = 'game';
    this.broadcast({ t: 'game', sync: this.gameSync() });
    this.pushRoom();
    this.sys(`Empieza ${rematch ? 'la revancha' : 'la partida'}: ${MODES[mode].name}. Saca ${this.members.get(ids[0]).name}.`);
    this.armClock(0);
  }

  forfeit(seat, reason) {
    if (!this.match) return;
    const res = this.match.forfeit(seat, reason);
    if (!res) return;
    this.broadcast({ t: 'result', result: res });
    this.broadcast({ t: 'meta', seats: this.seatMeta() });
    this.afterResult(res);
  }

  afterResult(result) {
    this.armClock(result.ms);
  }

  armClock(delayMs) {
    clearTimeout(this.clockTimer);
    const secs = this.settings.clock;
    if (!secs || !this.match || this.match.state.over) return;
    const { shotNo, turn } = this.match.state;
    this.clockTimer = setTimeout(() => {
      const s = this.match?.state;
      if (!s || s.over || s.shotNo !== shotNo || s.turn !== turn) return;
      const res = this.match.timeout();
      this.broadcast({ t: 'result', result: res });
      this.afterResult(res);
    }, delayMs + secs * 1000 + 1500);
  }
}

// ===================================================================== invitado
export class RoomClient extends Emitter {
  constructor() {
    super();
    this.peer = null;
    this.conn = null;
    this.selfId = null;
    this.closed = false;
  }

  join(code, hello) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (text, reason) => {
        if (settled) return;
        settled = true;
        this.close();
        const e = new Error(text);
        e.reason = reason;
        reject(e);
      };
      const timer = setTimeout(() => fail('La sala no responde. Comprueba el código o inténtalo de nuevo.'), 20000);
      const peer = new Peer(peerOptions());
      this.peer = peer;
      peer.on('open', () => {
        const conn = peer.connect(NET.idPrefix + code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => {
          conn.send({ t: 'hello', v: PROTOCOL, ...hello });
        });
        conn.on('data', (d) => {
          if (!isObj(d)) return;
          this.lastMsg = performance.now();
          if (d.t === 'ping') { this.send({ t: 'pong' }); return; }
          if (d.t === 'denied') {
            clearTimeout(timer);
            const text = { password: 'Contraseña incorrecta.', full: 'La sala está llena.', version: 'La sala usa otra versión de WildPool. Recarga la página.' }[d.reason] || 'No te han dejado entrar.';
            fail(text, d.reason);
            return;
          }
          if (d.t === 'welcome' && !settled) {
            settled = true;
            clearTimeout(timer);
            this.selfId = d.you;
            this.watch = setInterval(() => {
              if (performance.now() - this.lastMsg > 16000) this.drop('Se perdió la conexión con la sala.');
            }, 3000);
            resolve(d);
          }
          this.emit('msg', d);
        });
        conn.on('close', () => {
          if (!settled) fail('La sala cerró la conexión.');
          else this.drop('El anfitrión cerró la sala.');
        });
        conn.on('error', () => { if (!settled) fail('No se pudo abrir la conexión con la sala.'); });
      });
      peer.on('error', (err) => {
        if (!settled) { clearTimeout(timer); fail(peerErrorText(err), err.type); } else if (err.type === 'peer-unavailable' || err.type === 'webrtc') this.drop(peerErrorText(err));
      });
    });
  }

  drop(text) {
    if (this.closed) return;
    this.close();
    this.emit('closed', text);
  }

  send(msg) {
    if (this.conn?.open) {
      try { this.conn.send(msg); } catch (e) { console.warn(e); }
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.watch);
    try { this.conn?.close(); } catch { /* nada */ }
    try { this.peer?.destroy(); } catch { /* nada */ }
  }
}
