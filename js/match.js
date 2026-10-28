// Autoridad de una partida: valida tiros, simula el resultado y aplica las reglas.
// La usan tanto las partidas locales como el anfitrión de una sala online.
import { World, powerToSpeed, TICK } from './physics.js';
import { MODES } from './rules/index.js';

export class Match {
  constructor(modeId, seats, settings) {
    this.rules = MODES[modeId];
    if (!this.rules) throw new Error('Modo desconocido');
    this.modeId = modeId;
    this.world = new World(this.rules.table);
    this.state = this.rules.initialState(seats, settings);
    this.rules.setup(this.world, this.state);
  }

  sync() {
    return { mode: this.modeId, snap: this.world.snapshot(), state: this.state };
  }

  info() {
    return this.rules.info(this.state, this.world);
  }

  // Devuelve un texto de error o null si el tiro es válido
  validate(seat, shot) {
    const s = this.state;
    if (s.over) return 'La partida ha terminado';
    if (seat !== s.turn) return 'No es tu turno';
    if (!shot || typeof shot !== 'object') return 'Tiro inválido';
    const { a, p, sx, sy } = shot;
    if (![a, p, sx, sy].every((v) => typeof v === 'number' && Number.isFinite(v))) return 'Tiro inválido';
    if (p < 0.005 || p > 1) return 'Potencia fuera de rango';
    if (sx * sx + sy * sy > 1.0001) return 'Efecto fuera de rango';
    if (s.ballInHand) {
      if (shot.cx != null || shot.cy != null) {
        if (!this.world.canPlace(s.cueId, shot.cx, shot.cy, s.ballInHand)) return 'No puedes colocar la blanca ahí';
      }
    }
    const info = this.info();
    if (info.callPocket) {
      if (!Number.isInteger(shot.call) || shot.call < 0 || shot.call >= this.world.table.pockets.length) {
        return 'Elige la tronera para la 8';
      }
    }
    return null;
  }

  // Ejecuta un tiro ya validado. Devuelve el paquete (para animar) y el resultado.
  play(seat, shot) {
    const w = this.world;
    const s = this.state;
    const pre = w.snapshot();
    const v = powerToSpeed(shot.p);
    const packet = {
      seat,
      cueId: s.cueId,
      pre,
      vx: Math.cos(shot.a) * v,
      vy: Math.sin(shot.a) * v,
      roll: shot.sy,
      side: shot.sx,
      call: Number.isInteger(shot.call) ? shot.call : -1,
      a: shot.a,
      p: shot.p,
    };
    if (s.ballInHand && shot.cx != null) { packet.cx = shot.cx; packet.cy = shot.cy; }
    const ticks = applyPacket(w, packet);
    const ev = w.ev;
    const res = this.rules.resolve(s, ev, w, { call: packet.call });
    this.state = res.state;
    const result = {
      snap: w.snapshot(),
      state: this.state,
      msg: res.msg,
      foul: res.foul || null,
      pocketed: ev.pocketed.map((e) => e.id),
      ms: Math.round(ticks * TICK * 1000),
    };
    return { packet, result };
  }

  timeout() {
    const res = this.rules.timeout(this.state, this.world);
    this.state = res.state;
    return { snap: this.world.snapshot(), state: this.state, msg: res.msg, foul: res.foul, pocketed: [], ms: 0 };
  }

  // Abandono o expulsión de un asiento
  forfeit(seat, reason) {
    const s = structuredClone(this.state);
    if (s.over) return null;
    const name = s.seats[seat].name;
    const alive = s.seats.map((x, i) => (x.alive !== false && i !== seat ? i : -1)).filter((i) => i >= 0);
    if (s.seats.length <= 2 || alive.length <= 1) {
      const w = alive.length ? alive[0] : null;
      s.over = { winner: w, text: `${name} ${reason}.${w != null ? ` Gana ${s.seats[w].name}` : ''}` };
      s.log = s.over.text;
    } else {
      s.seats[seat].alive = false;
      if (s.lives) s.lives[seat] = 0;
      if (s.turn === seat) {
        let k = seat;
        do { k = (k + 1) % s.seats.length; } while (s.seats[k].alive === false && k !== seat);
        s.turn = k;
      }
      s.log = `${name} ${reason}. Turno de ${s.seats[s.turn].name}.`;
    }
    this.state = s;
    return { snap: this.world.snapshot(), state: s, msg: s.log, foul: null, pocketed: [], ms: 0 };
  }
}

// Aplica un paquete de tiro sobre un mundo y lo simula hasta el reposo.
// Lo usan la autoridad (instantáneo) y la IA. La vista hace lo mismo paso a paso.
export function preparePacket(world, packet) {
  world.load(packet.pre);
  if (packet.cx != null) {
    const cue = world.ball(packet.cueId);
    cue.on = true; cue.x = packet.cx; cue.y = packet.cy;
  }
  world.shoot(packet.cueId, packet.vx, packet.vy, packet.roll, packet.side);
}

export function applyPacket(world, packet) {
  preparePacket(world, packet);
  return world.runToRest();
}
