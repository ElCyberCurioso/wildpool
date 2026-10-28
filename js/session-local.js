// Sesión en este dispositivo: contra la CPU, dos jugadores o práctica.
// Habla el mismo "idioma" de mensajes que una sala online.
import { Emitter } from './emitter.js';
import { Match } from './match.js';
import { chooseShot } from './ai.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class LocalSession extends Emitter {
  constructor({ mode, players, opts, guide }) {
    super();
    this.mode = mode;
    this.players = players; // [{ name, avatar, cue, ai: 'easy'|'medium'|'hard'|null }]
    this.opts = opts;
    this.guide = guide;
    this.thinking = false;
    this.token = 0;
  }

  get kind() { return this.players.some((p) => p.ai) ? 'cpu' : 'local'; }

  start() {
    this.token++;
    this.thinking = false;
    const seats = this.players.map((p, i) => ({ id: 'p' + i, name: p.name }));
    this.match = new Match(this.mode, seats, { ...this.opts });
    this.emit('msg', {
      t: 'game',
      sync: {
        ...this.match.sync(),
        seats: this.players.map((p, i) => ({ id: 'p' + i, name: p.name, avatar: p.avatar, cue: p.cue })),
        guide: this.guide,
        clock: 0,
      },
    });
  }

  rematch() {
    this.players = [...this.players.slice(1), this.players[0]];
    this.start();
  }

  controls(seat) {
    const p = this.players[seat];
    return !!p && !p.ai;
  }

  statusFor(seat) {
    const p = this.players[seat];
    return p?.ai && this.thinking ? `${p.name} está pensando…` : null;
  }

  shoot(shot) {
    const m = this.match;
    const seat = m.state.turn;
    const err = m.validate(seat, shot);
    if (err) { this.emit('msg', { t: 'reject', msg: err }); return; }
    const { packet, result } = m.play(seat, shot);
    this.emit('msg', { t: 'shot', packet });
    this.emit('msg', { t: 'result', result });
  }

  concede() {
    const res = this.match.forfeit(this.match.state.turn, 'abandona la partida');
    if (res) this.emit('msg', { t: 'result', result: res });
  }

  // La vista avisa cuando ha terminado de animar: si toca a la CPU, piensa y tira
  async idle() {
    const m = this.match;
    if (!m || m.state.over || this.thinking) return;
    const seat = m.state.turn;
    const p = this.players[seat];
    if (!p?.ai) return;
    const token = this.token;
    this.thinking = true;
    this.emit('status');
    await sleep(450);
    const shot = await chooseShot(m.rules, m.state, m.world, p.ai);
    if (token !== this.token) return;
    this.thinking = false;
    this.emit('status');
    // anima el apuntado de la CPU antes de tirar
    const cue = m.world.ball(m.state.cueId);
    let a0 = this.lastAim ?? Math.atan2(m.world.table.W / 2 - cue.y, m.world.table.footX - cue.x);
    let d = shot.a - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      if (token !== this.token) return;
      const q = i / steps;
      const e = 1 - (1 - q) ** 3;
      const aim = { t: 'aim', seat, a: a0 + d * e, pw: 0, sx: shot.sx, sy: shot.sy, call: shot.call >= 0 ? shot.call : undefined };
      if (shot.cx != null) { aim.cx = shot.cx; aim.cy = shot.cy; }
      this.emit('msg', aim);
      await sleep(40);
    }
    for (let i = 1; i <= 8; i++) {
      if (token !== this.token) return;
      const aim = { t: 'aim', seat, a: shot.a, pw: shot.p * (i / 8), sx: shot.sx, sy: shot.sy, call: shot.call >= 0 ? shot.call : undefined };
      if (shot.cx != null) { aim.cx = shot.cx; aim.cy = shot.cy; }
      this.emit('msg', aim);
      await sleep(45);
    }
    await sleep(120);
    if (token !== this.token) return;
    this.lastAim = shot.a;
    this.shoot(shot);
  }

  close() {
    this.token++;
    this.clear();
  }
}
