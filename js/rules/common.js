// Utilidades compartidas por los modos de juego

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Posiciones de un triángulo de 15 (filas 1..5) con el vértice en el punto de pie
export function trianglePositions(table, rows = 5) {
  const R = table.R;
  const gap = 1.0025;
  const dx = Math.sqrt(3) * R * gap;
  const pos = [];
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k <= i; k++) {
      pos.push([table.footX + i * dx, table.W / 2 + (k - i / 2) * 2 * R * gap]);
    }
  }
  return pos;
}

export function diamondPositions(table) {
  const R = table.R;
  const gap = 1.0025;
  const dx = Math.sqrt(3) * R * gap;
  const rows = [1, 2, 3, 2, 1];
  const pos = [];
  rows.forEach((n, i) => {
    for (let k = 0; k < n; k++) {
      pos.push([table.footX + i * dx, table.W / 2 + (k - (n - 1) / 2) * 2 * R * gap]);
    }
  });
  return pos;
}

const jitter = (v) => v + (Math.random() - 0.5) * 0.03;

// Rack de bola 8: la 8 en el centro, una lisa y una rayada en las esquinas traseras
export function rack8(world) {
  const pos = trianglePositions(world.table);
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7]);
  const stripes = shuffle([9, 10, 11, 12, 13, 14, 15]);
  const order = new Array(15).fill(0);
  order[4] = 8;
  const backA = 10, backB = 14;
  if (Math.random() < 0.5) { order[backA] = solids.pop(); order[backB] = stripes.pop(); }
  else { order[backA] = stripes.pop(); order[backB] = solids.pop(); }
  const rest = shuffle([...solids, ...stripes]);
  for (let i = 0; i < 15; i++) if (!order[i]) order[i] = rest.pop();
  placeRack(world, pos, order);
}

export function rack9(world) {
  const pos = diamondPositions(world.table);
  const order = new Array(9).fill(0);
  order[0] = 1; order[4] = 9;
  const rest = shuffle([2, 3, 4, 5, 6, 7, 8]);
  for (let i = 0; i < 9; i++) if (!order[i]) order[i] = rest.pop();
  placeRack(world, pos, order);
}

function placeRack(world, pos, order) {
  world.balls = [];
  const t = world.table;
  world.addBall(0, t.headX - 6, t.W / 2 + (Math.random() - 0.5) * 20);
  order.forEach((id, i) => world.addBall(id, jitter(pos[i][0]), jitter(pos[i][1])));
}

export function placeCue(world, zone = 'kitchen') {
  const t = world.table;
  const cue = world.ball(0) || world.addBall(0, t.headX - 6, t.W / 2);
  cue.on = true;
  const [x, y] = world.findFree(0, zone === 'kitchen' ? t.headX - 6 : t.headX, t.W / 2, zone);
  cue.x = x; cue.y = y; cue.vx = 0; cue.vy = 0;
}

// Recoloca una bola en el punto de pie (o detrás, sobre el eje largo)
export function respot(world, id) {
  const t = world.table;
  const b = world.ball(id);
  if (!b) return;
  b.on = true; b.vx = 0; b.vy = 0;
  let x = t.footX;
  while (x < t.L - t.R && !world.canPlace(id, x, t.W / 2, 'anywhere')) x += 0.5;
  if (x >= t.L - t.R) {
    x = t.footX;
    while (x > t.R && !world.canPlace(id, x, t.W / 2, 'anywhere')) x -= 0.5;
  }
  b.x = x; b.y = t.W / 2;
}

export const onTable = (world, id) => {
  const b = world.ball(id);
  return !!(b && b.on);
};

export const objectBallsOn = (world) => world.balls.filter((b) => b.on && b.id !== 0).map((b) => b.id);

// Bolas que había en la mesa antes del tiro = las que siguen + las metidas ahora
export function preShotOn(world, ev) {
  const set = new Set(world.balls.filter((b) => b.on).map((b) => b.id));
  for (const p of ev.pocketed) set.add(p.id);
  return set;
}

export const isSolid = (id) => id >= 1 && id <= 7;
export const isStripe = (id) => id >= 9 && id <= 15;

export function nextAlive(state, from) {
  const n = state.seats.length;
  for (let i = 1; i <= n; i++) {
    const k = (from + i) % n;
    if (state.seats[k].alive !== false) return k;
  }
  return from;
}

export function baseState(mode, seats, settings) {
  return {
    mode,
    settings,
    seats: seats.map((s) => ({ id: s.id, name: s.name, alive: true })),
    turn: 0,
    ballInHand: 'kitchen',
    cueId: 0,
    isBreak: true,
    shotNo: 0,
    over: null,
    log: '',
  };
}
