// WildPool — motor de física 2D determinista.
// Unidades: centímetros y segundos. Coordenadas: x a la derecha, y hacia abajo.
// El bucle de simulación solo usa + - * / y Math.sqrt (correctamente redondeadas
// en IEEE-754), así que dos navegadores con el mismo estado inicial y la misma
// velocidad de salida obtienen el mismo resultado. Nada de trigonometría aquí.

export const TICK = 1 / 120;

const FRICTION_A = 17;     // deceleración constante (cm/s²)
const FRICTION_B = 0.33;   // deceleración proporcional a la velocidad (1/s)
const BALL_E = 0.95;       // restitución bola-bola
const CUSHION_E = 0.78;    // restitución en banda
const CUSHION_T = 0.94;    // conservación tangencial en banda
const SIDE_K = 0.32;       // influencia del efecto lateral al rebotar
const FOLLOW_K = 0.30;     // seguimiento con efecto alto / rodadura natural
const DRAW_K = 0.62;       // retroceso con efecto bajo
const STOP_SPEED = 0.6;
const ROLL_RATE = 260;    // rapidez con la que el efecto se convierte en rodadura natural

export function makeTable(kind) {
  if (kind === 'carom') {
    const L = 284, W = 142, R = 3.08;
    return {
      kind, L, W, R,
      pockets: [],
      segments: [[0, 0, L, 0], [L, 0, L, W], [L, W, 0, W], [0, W, 0, 0]],
      headX: L / 4, footX: (3 * L) / 4,
    };
  }
  const L = 254, W = 127, R = 2.86;
  const c = 8.2;   // distancia del vértice de la banda a la esquina
  const s = 6.6;   // media boca de la tronera central
  const segs = [];
  // bandas largas (superior e inferior) partidas por la tronera central
  for (const y of [0, W]) {
    segs.push([c, y, L / 2 - s, y], [L / 2 + s, y, L - c, y]);
  }
  // bandas cortas
  segs.push([0, c, 0, W - c], [L, c, L, W - c]);
  // mandíbulas de las esquinas
  const jaw = (x1, y1, dx, dy) => segs.push([x1, y1, x1 + dx, y1 + dy]);
  jaw(c, 0, -4.7, -3.7); jaw(0, c, -3.7, -4.7);
  jaw(L - c, 0, 4.7, -3.7); jaw(L, c, 3.7, -4.7);
  jaw(c, W, -4.7, 3.7); jaw(0, W - c, -3.7, 4.7);
  jaw(L - c, W, 4.7, 3.7); jaw(L, W - c, 3.7, 4.7);
  // mandíbulas de las centrales
  jaw(L / 2 - s, 0, 1.2, -4.5); jaw(L / 2 + s, 0, -1.2, -4.5);
  jaw(L / 2 - s, W, 1.2, 4.5); jaw(L / 2 + s, W, -1.2, 4.5);

  // r: radio de captura; ax/ay: punto al que apuntar la bola objetivo
  const pockets = [
    { x: -1.5, y: -1.5, r: 6.0, ax: 0.6, ay: 0.6, kind: 'corner' },
    { x: L / 2, y: -3.2, r: 5.2, ax: L / 2, ay: -0.6, kind: 'side' },
    { x: L + 1.5, y: -1.5, r: 6.0, ax: L - 0.6, ay: 0.6, kind: 'corner' },
    { x: -1.5, y: W + 1.5, r: 6.0, ax: 0.6, ay: W - 0.6, kind: 'corner' },
    { x: L / 2, y: W + 3.2, r: 5.2, ax: L / 2, ay: W + 0.6, kind: 'side' },
    { x: L + 1.5, y: W + 1.5, r: 6.0, ax: L - 0.6, ay: W - 0.6, kind: 'corner' },
  ];
  return { kind: 'pool', L, W, R, pockets, segments: segs, headX: L / 4, footX: (3 * L) / 4 };
}

export class World {
  constructor(tableKind = 'pool') {
    this.table = makeTable(tableKind);
    this.balls = [];
    this.ev = null;
    this.onImpact = null; // (tipo, intensidad, x, y) — solo para sonido en la vista
  }

  addBall(id, x, y) {
    const b = { id, x, y, vx: 0, vy: 0, on: true, roll: 0, side: 0 };
    this.balls.push(b);
    return b;
  }

  ball(id) {
    for (const b of this.balls) if (b.id === id) return b;
    return null;
  }

  snapshot() {
    return this.balls.map((b) => [b.id, b.x, b.y, b.on ? 1 : 0]);
  }

  load(snap) {
    const byId = new Map(this.balls.map((b) => [b.id, b]));
    const next = [];
    for (const [id, x, y, on] of snap) {
      const b = byId.get(id) || { id, x, y, vx: 0, vy: 0, on: true, roll: 0, side: 0 };
      b.x = x; b.y = y; b.on = !!on; b.vx = 0; b.vy = 0; b.roll = 0; b.side = 0;
      next.push(b);
    }
    this.balls = next;
  }

  clone() {
    const w = new World(this.table.kind);
    w.balls = this.balls.map((b) => ({ ...b }));
    return w;
  }

  isMoving() {
    for (const b of this.balls) if (b.on && (b.vx !== 0 || b.vy !== 0)) return true;
    return false;
  }

  beginShot(cueId) {
    this.ev = {
      cueId,
      firstHit: null,
      pocketed: [],
      cushions: [],          // ids de bolas que tocaron banda
      railAfterContact: false,
      cueHits: [],           // bolas distintas tocadas por la bola jugadora, en orden
      cueCushions: 0,        // bandas de la jugadora antes de la 2.ª bola distinta
      cueCushionsAt2nd: -1,
      ticks: 0,
    };
  }

  // vx, vy ya calculados por la autoridad; roll y side en [-1, 1]
  shoot(cueId, vx, vy, roll, side) {
    this.beginShot(cueId);
    const b = this.ball(cueId);
    b.vx = vx; b.vy = vy; b.roll = roll < 0 ? roll * 1.25 : roll; b.side = side;
  }

  step() {
    const balls = this.balls;
    let maxV2 = 0;
    for (const b of balls) {
      if (!b.on) continue;
      const v2 = b.vx * b.vx + b.vy * b.vy;
      if (v2 > maxV2) maxV2 = v2;
    }
    if (maxV2 === 0) return false;
    const R = this.table.R;
    let n = Math.ceil((Math.sqrt(maxV2) * TICK) / (0.32 * R));
    if (n < 1) n = 1;
    if (n > 60) n = 60;
    const h = TICK / n;
    for (let k = 0; k < n; k++) this.substep(h);
    if (this.ev) this.ev.ticks++;
    return true;
  }

  substep(h) {
    const balls = this.balls;
    const t = this.table;
    const R = t.R;
    // 1) movimiento + fricción + evolución del efecto
    for (const b of balls) {
      if (!b.on || (b.vx === 0 && b.vy === 0)) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
      const s2 = b.vx * b.vx + b.vy * b.vy;
      const s = Math.sqrt(s2);
      const ds = s * h;
      let k = (ds * ROLL_RATE) / (s2 > 400 ? s2 : 400);
      if (k > 1) k = 1;
      b.roll += (1 - b.roll) * k;
      let ks = ds / 700;
      if (ks > 1) ks = 1;
      b.side -= b.side * ks;
      const dec = (FRICTION_A + FRICTION_B * s) * h;
      if (s <= dec || s < STOP_SPEED) {
        b.vx = 0; b.vy = 0;
      } else {
        const f = (s - dec) / s;
        b.vx *= f; b.vy *= f;
      }
    }
    // 2) colisiones bola-bola (orden fijo)
    const R2x4 = 4 * R * R;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (!a.on) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (!b.on) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R2x4 || d2 < 1e-12) continue;
        let d = Math.sqrt(d2);
        let nx = dx / d, ny = dy / d;
        let vrel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (vrel <= 0) {
          const push = (2 * R - d) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          continue;
        }
        // Retrocede hasta el instante exacto de contacto para que la normal sea precisa
        const wx = b.vx - a.vx, wy = b.vy - a.vy;
        const w2 = wx * wx + wy * wy;
        const pw = dx * wx + dy * wy;
        let tau = (pw + Math.sqrt(pw * pw - w2 * (d2 - R2x4))) / w2;
        if (!(tau > 0)) tau = 0;
        if (tau > h) tau = h;
        a.x -= a.vx * tau; a.y -= a.vy * tau;
        b.x -= b.vx * tau; b.y -= b.vy * tau;
        const ddx = b.x - a.x, ddy = b.y - a.y;
        d = Math.sqrt(ddx * ddx + ddy * ddy);
        nx = ddx / d; ny = ddy / d;
        vrel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (d < 2 * R) {
          const push = (2 * R - d) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
        if (vrel <= 0) continue;
        const ina = a.vx * nx + a.vy * ny;      // componente de a hacia b
        const inb = -(b.vx * nx + b.vy * ny);   // componente de b hacia a
        const sa = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
        const sb = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        const dax = sa > 0 ? a.vx / sa : 0, day = sa > 0 ? a.vy / sa : 0;
        const dbx = sb > 0 ? b.vx / sb : 0, dby = sb > 0 ? b.vy / sb : 0;
        const J = (vrel * (1 + BALL_E)) / 2;
        a.vx -= J * nx; a.vy -= J * ny;
        b.vx += J * nx; b.vy += J * ny;
        if (ina > 0) {
          const f = a.roll > 0 ? a.roll * FOLLOW_K : a.roll * DRAW_K;
          a.vx += dax * ina * f; a.vy += day * ina * f;
        }
        if (inb > 0) {
          const f = b.roll > 0 ? b.roll * FOLLOW_K : b.roll * DRAW_K;
          b.vx += dbx * inb * f; b.vy += dby * inb * f;
        }
        a.roll = 0; b.roll = 0;
        // avanza de nuevo el tiempo rebobinado con las velocidades nuevas
        a.x += a.vx * tau; a.y += a.vy * tau;
        b.x += b.vx * tau; b.y += b.vy * tau;
        this.recordBallHit(a.id, b.id, vrel);
      }
    }
    // 3) bandas
    const segs = t.segments;
    for (const b of balls) {
      if (!b.on) continue;
      for (let si = 0; si < segs.length; si++) {
        const sg = segs[si];
        const x1 = sg[0], y1 = sg[1];
        const ex = sg[2] - x1, ey = sg[3] - y1;
        const len2 = ex * ex + ey * ey;
        let u = ((b.x - x1) * ex + (b.y - y1) * ey) / len2;
        if (u < 0) u = 0; else if (u > 1) u = 1;
        const cx = x1 + ex * u, cy = y1 + ey * u;
        const dx = b.x - cx, dy = b.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R * R || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        b.x += nx * (R - d); b.y += ny * (R - d);
        const vn = b.vx * nx + b.vy * ny;
        if (vn >= 0) continue;
        const tx = -ny, ty = nx;
        let vt = b.vx * tx + b.vy * ty;
        vt = vt * CUSHION_T - b.side * SIDE_K * -vn;
        const vn2 = -vn * CUSHION_E;
        b.vx = nx * vn2 + tx * vt;
        b.vy = ny * vn2 + ty * vt;
        b.side *= 0.55;
        b.roll *= 0.3;
        this.recordCushion(b.id, -vn, b.x, b.y);
      }
    }
    // 4) troneras
    if (t.pockets.length) {
      for (const b of balls) {
        if (!b.on) continue;
        for (let pi = 0; pi < t.pockets.length; pi++) {
          const p = t.pockets[pi];
          const dx = b.x - p.x, dy = b.y - p.y;
          if (dx * dx + dy * dy < p.r * p.r) { this.pocket(b, pi); break; }
        }
        // salvaguarda: una bola fuera de la mesa cae en la tronera más cercana
        if (b.on && (b.x < -12 || b.y < -12 || b.x > t.L + 12 || b.y > t.W + 12)) {
          let best = 0, bd = Infinity;
          t.pockets.forEach((p, pi) => {
            const dd = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
            if (dd < bd) { bd = dd; best = pi; }
          });
          this.pocket(b, best);
        }
      }
    } else {
      for (const b of balls) {
        if (!b.on) continue;
        if (b.x < R) b.x = R; if (b.x > t.L - R) b.x = t.L - R;
        if (b.y < R) b.y = R; if (b.y > t.W - R) b.y = t.W - R;
      }
    }
  }

  pocket(b, pi) {
    const p = this.table.pockets[pi];
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    b.on = false; b.vx = 0; b.vy = 0; b.roll = 0; b.side = 0;
    if (this.ev) this.ev.pocketed.push({ id: b.id, p: pi });
    if (this.onImpact) this.onImpact('pocket', speed, p.x, p.y, b.id);
  }

  recordBallHit(a, b, speed) {
    const ev = this.ev;
    if (ev) {
      const cue = ev.cueId;
      if (a === cue || b === cue) {
        const other = a === cue ? b : a;
        if (ev.firstHit === null) ev.firstHit = other;
        if (!ev.cueHits.includes(other)) {
          ev.cueHits.push(other);
          if (ev.cueHits.length === 2) ev.cueCushionsAt2nd = ev.cueCushions;
        }
      }
    }
    if (this.onImpact) {
      const A = this.ball(a), B = this.ball(b);
      this.onImpact('ball', speed, (A.x + B.x) / 2, (A.y + B.y) / 2);
    }
  }

  recordCushion(id, speed, x, y) {
    const ev = this.ev;
    if (ev) {
      if (!ev.cushions.includes(id)) ev.cushions.push(id);
      if (ev.firstHit !== null) ev.railAfterContact = true;
      if (id === ev.cueId && ev.cueHits.length < 2) ev.cueCushions++;
    }
    if (this.onImpact && speed > 4) this.onImpact('cushion', speed, x, y);
  }

  // Simula hasta que todo se detiene (para la autoridad y la IA)
  runToRest(maxTicks = 120 * 45) {
    let ticks = 0;
    while (this.isMoving() && ticks < maxTicks) { this.step(); ticks++; }
    if (ticks >= maxTicks) for (const b of this.balls) { b.vx = 0; b.vy = 0; }
    return ticks;
  }

  // ¿Se puede colocar una bola en (x, y)? zone: 'kitchen' | 'anywhere'
  canPlace(id, x, y, zone) {
    const t = this.table, R = t.R;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x < R || x > t.L - R || y < R || y > t.W - R) return false;
    if (zone === 'kitchen' && x > t.headX) return false;
    for (const b of this.balls) {
      if (!b.on || b.id === id) continue;
      const dx = b.x - x, dy = b.y - y;
      if (dx * dx + dy * dy < 4 * R * R * 1.0004) return false;
    }
    return true;
  }

  // Busca un hueco libre cerca de (x, y), desplazándose a lo largo de la mesa
  findFree(id, x, y, zone = 'anywhere', dir = 1) {
    const R = this.table.R;
    for (let i = 0; i < 400; i++) {
      const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.5 * R;
      const cx = x + (i < 200 ? off * dir : 0);
      const cy = y + (i >= 200 ? off : 0);
      if (this.canPlace(id, cx, cy, zone)) return [cx, cy];
    }
    for (let i = 0; i < 2000; i++) {
      const cx = R + Math.random() * (this.table.L - 2 * R);
      const cy = R + Math.random() * (this.table.W - 2 * R);
      if (this.canPlace(id, cx, cy, zone)) return [cx, cy];
    }
    return [x, y];
  }
}

// Potencia del taco (0..1) → velocidad de salida en cm/s
export function powerToSpeed(p) {
  const q = Math.max(0, Math.min(1, p));
  return 12 + 720 * Math.pow(q, 1.55);
}
