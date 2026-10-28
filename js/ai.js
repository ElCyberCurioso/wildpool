// IA de WildPool: genera tiros candidatos (bola fantasma hacia cada tronera),
// los simula con el mismo motor físico y elige el de mejor puntuación.
import { powerToSpeed } from './physics.js';
import { applyPacket } from './match.js';

export const LEVELS = {
  easy: { label: 'Fácil', sims: 28, noise: 1.5, pnoise: 0.16, spins: [0] },
  medium: { label: 'Media', sims: 70, noise: 0.55, pnoise: 0.07, spins: [0, 0.5, -0.5] },
  hard: { label: 'Difícil', sims: 150, noise: 0.14, pnoise: 0.03, spins: [0, 0.6, -0.6, 0.25] },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export function speedToPower(v) {
  return clamp(Math.pow(Math.max(0, (v - 12) / 720), 1 / 1.55), 0.03, 1);
}

function pathClear(world, ax, ay, bx, by, ignore) {
  const R = world.table.R;
  const ex = bx - ax, ey = by - ay;
  const len2 = ex * ex + ey * ey || 1;
  for (const b of world.balls) {
    if (!b.on || ignore.includes(b.id)) continue;
    let u = ((b.x - ax) * ex + (b.y - ay) * ey) / len2;
    u = clamp(u, 0, 1);
    const dx = b.x - (ax + ex * u), dy = b.y - (ay + ey * u);
    if (dx * dx + dy * dy < 4 * R * R * 0.96) return false;
  }
  return true;
}

// Cuántos tiros "fáciles" tendría quien juegue con este estado
function easeOf(rules, state, world) {
  if (state.over) return 0;
  const info = rules.info(state, world);
  const cue = world.ball(state.cueId);
  if (!cue || !cue.on || state.ballInHand) return 3;
  const R = world.table.R;
  let count = 0, best = 0;
  for (const id of info.targets) {
    const o = world.ball(id);
    if (!o || !o.on) continue;
    for (const p of world.table.pockets) {
      let ux = p.ax - o.x, uy = p.ay - o.y;
      const d = Math.hypot(ux, uy); ux /= d; uy /= d;
      const gx = o.x - ux * 2 * R, gy = o.y - uy * 2 * R;
      let cx = gx - cue.x, cy = gy - cue.y;
      const dc = Math.hypot(cx, cy); if (dc < 1) continue;
      cx /= dc; cy /= dc;
      const cos = cx * ux + cy * uy;
      if (cos < 0.45) continue;
      if (!pathClear(world, o.x, o.y, p.ax, p.ay, [id, state.cueId])) continue;
      if (!pathClear(world, cue.x, cue.y, gx, gy, [id, state.cueId])) continue;
      count++;
      best = Math.max(best, cos - (d + dc) / 600);
    }
  }
  return Math.min(count, 4) + best;
}

function score(rules, state, res, simWorld, seat) {
  const ns = res.state;
  if (ns.over) return ns.over.winner === seat ? 5000 : -5000;
  let sc = 0;
  if (res.foul) sc -= 500;
  if (state.lives) {
    const lost = ns.lives[seat] < state.lives[seat];
    sc += lost ? -350 : 350;
    if (ns.lives[seat] > state.lives[seat]) sc += 120;
    // dejar la mesa difícil al siguiente
    sc -= easeOf(rules, ns, simWorld) * 20;
    return sc;
  }
  if (ns.turn === seat) {
    sc += 320 + easeOf(rules, ns, simWorld) * 45;
  } else {
    sc -= 90 + easeOf(rules, ns, simWorld) * 40;
  }
  // en bola 8, que el rival meta bolas propias no nos ayuda: premia reducir nuestro grupo
  if (state.groups && ns.groups[seat]) {
    const g = ns.groups[seat];
    const mine = simWorld.balls.filter((b) => b.on && (g === 'solids' ? b.id >= 1 && b.id <= 7 : b.id >= 9 && b.id <= 15)).length;
    sc -= mine * 6;
  }
  return sc;
}

function simulate(rules, state, world, shot) {
  const w = world.clone();
  const v = powerToSpeed(shot.p);
  const packet = {
    cueId: state.cueId, pre: w.snapshot(),
    vx: Math.cos(shot.a) * v, vy: Math.sin(shot.a) * v,
    roll: shot.sy, side: shot.sx,
  };
  if (shot.cx != null) { packet.cx = shot.cx; packet.cy = shot.cy; }
  applyPacket(w, packet);
  const res = rules.resolve(state, w.ev, w, { call: shot.call ?? -1 });
  return { res, w };
}

function cuePositions(world, state, info) {
  const t = world.table, R = t.R;
  const zone = state.ballInHand;
  const out = [];
  for (const id of info.targets) {
    const o = world.ball(id);
    if (!o || !o.on) continue;
    for (const p of t.pockets) {
      let ux = p.ax - o.x, uy = p.ay - o.y;
      const d = Math.hypot(ux, uy); ux /= d; uy /= d;
      for (const dist of [16, 30, 55]) {
        for (const rot of [0, 0.22, -0.22]) {
          const c = Math.cos(rot), s = Math.sin(rot);
          const rx = ux * c - uy * s, ry = ux * s + uy * c;
          const x = o.x - ux * 2 * R - rx * dist, y = o.y - uy * 2 * R - ry * dist;
          if (world.canPlace(state.cueId, x, y, zone)) out.push([x, y]);
        }
      }
    }
  }
  for (let i = 0; i < 12; i++) {
    const x = R + Math.random() * ((zone === 'kitchen' ? t.headX : t.L) - 2 * R);
    const y = R + Math.random() * (t.W - 2 * R);
    if (world.canPlace(state.cueId, x, y, zone)) out.push([x, y]);
  }
  return shuffleInPlace(out).slice(0, 26);
}

function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function chooseShot(rules, state, world, levelId = 'medium') {
  const L = LEVELS[levelId] || LEVELS.medium;
  const seat = state.turn;
  const t = world.table, R = t.R;
  const info = rules.info(state, world);

  if (state.isBreak) {
    const cx = t.headX - 4 - Math.random() * 10;
    const cy = t.W / 2 + (Math.random() - 0.5) * 40;
    const apex = world.balls.filter((b) => b.on && b.id !== 0).sort((a, b) => a.x - b.x)[0];
    const a = Math.atan2(apex.y - cy, apex.x - cx) + gauss() * 0.004;
    return { a, p: 0.9 + Math.random() * 0.1, sx: 0, sy: 0.15, cx, cy, call: -1 };
  }

  const positions = state.ballInHand
    ? cuePositions(world, state, info)
    : [[world.ball(state.cueId).x, world.ball(state.cueId).y]];

  const cands = [];
  for (const [cx, cy] of positions) {
    for (const id of info.targets) {
      const o = world.ball(id);
      if (!o || !o.on) continue;
      t.pockets.forEach((p, pi) => {
        let ux = p.ax - o.x, uy = p.ay - o.y;
        const dObj = Math.hypot(ux, uy); ux /= dObj; uy /= dObj;
        const gx = o.x - ux * 2 * R, gy = o.y - uy * 2 * R;
        let dx = gx - cx, dy = gy - cy;
        const dCue = Math.hypot(dx, dy);
        if (dCue < 0.5) return;
        dx /= dCue; dy /= dCue;
        const cos = dx * ux + dy * uy;
        if (cos < 0.18) return;
        const clearObj = pathClear(world, o.x, o.y, p.ax, p.ay, [id, state.cueId]);
        const clearCue = pathClear(world, cx, cy, gx, gy, [id, state.cueId]);
        const prio = cos * 2 - (dObj + dCue) / 250 + (clearObj ? 1 : -2) + (clearCue ? 1 : -2);
        const vo = Math.sqrt(2 * 75 * (dObj + 10)) + 25;
        const v = vo / (cos * 0.975) + Math.sqrt(2 * 45 * dCue);
        const a = Math.atan2(dy, dx);
        for (const mult of [1.05, 1.45, 1.9]) {
          for (const sy of L.spins) {
            cands.push({
              shot: { a, p: speedToPower(Math.min(720, v * mult)), sx: 0, sy, cx: state.ballInHand ? cx : null, cy: state.ballInHand ? cy : null, call: pi },
              prio: prio - (mult - 1) * 0.2 - Math.abs(sy) * 0.1 + Math.random() * 0.3,
            });
          }
        }
      });
    }
  }
  cands.sort((a, b) => b.prio - a.prio);
  let pool = cands.slice(0, L.sims);

  // Tiros de seguridad: buscar la bola legal con distintas fuerzas y grosores
  const [scx, scy] = positions[0];
  for (let i = 0; i < Math.max(10, Math.floor(L.sims / 4)); i++) {
    const id = info.targets[Math.floor(Math.random() * info.targets.length)];
    const o = world.ball(id);
    if (!o) continue;
    const off = (Math.random() - 0.5) * 3.6 * R;
    const ang = Math.atan2(o.y - scy, o.x - scx);
    const a = ang + Math.atan2(off, Math.hypot(o.x - scx, o.y - scy));
    pool.push({ shot: { a, p: 0.12 + Math.random() * 0.45, sx: 0, sy: (Math.random() - 0.5) * 0.6, cx: state.ballInHand ? scx : null, cy: state.ballInHand ? scy : null, call: -1 } });
  }

  let best = null, bestScore = -Infinity;
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i];
    if (info.callPocket && c.shot.call < 0) c.shot.call = 0;
    const { res, w } = simulate(rules, state, world, c.shot);
    const sc = score(rules, state, res, w, seat);
    if (sc > bestScore) { bestScore = sc; best = c.shot; }
    if (i % 6 === 5) await tick();
  }

  const shot = { ...best };
  shot.a += gauss() * (L.noise * Math.PI) / 180;
  shot.p = clamp(shot.p * (1 + gauss() * L.pnoise), 0.03, 1);
  if (shot.cx == null) { delete shot.cx; delete shot.cy; }
  if (!info.callPocket) shot.call = -1;
  return shot;
}
