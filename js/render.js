// WildPool — render en canvas 2D: mesa cacheada, bolas sombreadas por píxel que
// ruedan de verdad (orientación 3D por bola), tacos procedurales y guías de tiro.
import { CLOTHS, WOODS, ACCENTS, BALL_SETS, CUES, byId } from './cosmetics.js';

export const RAIL = 16;   // cm desde la nariz de la banda hasta el borde exterior
export const CUSHION = 4; // ancho visible de la goma

// ---------------------------------------------------------------- utilidades
export function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

// ---------------------------------------------------------------- aspecto de las bolas
export function ballLook(id, tableKind, setId) {
  const set = byId(BALL_SETS, setId);
  const base = { ink: hexToRgb(set.ink), gloss: set.gloss || 1, marble: !!set.marble };
  if (tableKind === 'carom') {
    if (id === 0) return { ...base, base: hexToRgb(set.cue), dots: 2, marble: false };
    if (id === 1) return { ...base, base: hexToRgb('#F2C21B'), dots: 2, marble: false };
    return { ...base, base: hexToRgb('#C8102E') };
  }
  if (id === 0) return { ...base, base: hexToRgb(set.cue), dots: 6, marble: false };
  if (id === 8) return { ...base, base: hexToRgb(set.eight), number: 8 };
  if (id <= 7) return { ...base, base: hexToRgb(set.colors[id - 1]), number: id };
  return { ...base, base: hexToRgb(set.colors[id - 9]), stripe: true, number: id };
}

const IVORY = [246, 241, 228];
const DOT_DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

class BallPainter {
  constructor() {
    this.r = 0;
    this.glyphs = new Map();
  }

  glyph(n) {
    if (this.glyphs.has(n)) return this.glyphs.get(n);
    const S = 64;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${n >= 10 ? 38 : 46}px "Barlow Semi Condensed", Arial, sans-serif`;
    g.fillText(String(n), S / 2, S / 2 + 3);
    const d = g.getImageData(0, 0, S, S).data;
    const a = new Uint8Array(S * S);
    for (let i = 0; i < S * S; i++) a[i] = d[i * 4 + 3];
    this.glyphs.set(n, a);
    return a;
  }

  setRadius(rpx) {
    if (Math.abs(rpx - this.r) < 0.01) return;
    this.r = rpx;
    const N = Math.ceil(rpx * 2 + 2);
    this.N = N;
    const c = N / 2;
    let L = [-0.42, -0.62, -0.66];
    const ll = Math.hypot(...L); L = L.map((v) => v / ll);
    let H = [L[0], L[1], L[2] - 1];
    const hl = Math.hypot(...H); H = H.map((v) => v / hl);
    const idx = [], nx = [], ny = [], nz = [], dif = [], spec = [], rim = [], alpha = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let u = (x + 0.5 - c) / rpx, v = (y + 0.5 - c) / rpx;
        const dist = Math.sqrt(u * u + v * v) * rpx;
        const a = Math.max(0, Math.min(1, rpx - dist + 0.5));
        if (a <= 0) continue;
        let d2 = u * u + v * v;
        if (d2 > 0.999) { const s = Math.sqrt(0.999 / d2); u *= s; v *= s; d2 = 0.999; }
        const z = -Math.sqrt(1 - d2);
        idx.push(y * N + x); nx.push(u); ny.push(v); nz.push(z);
        const nd = u * L[0] + v * L[1] + z * L[2];
        dif.push(Math.max(0, nd));
        const nh = Math.max(0, u * H[0] + v * H[1] + z * H[2]);
        spec.push(Math.pow(nh, 70) + 0.25 * Math.pow(nh, 12));
        rim.push(Math.pow(1 + z, 2.2));
        alpha.push(a);
      }
    }
    this.px = { idx, nx, ny, nz, dif, spec, rim, alpha, n: idx.length };
    this.img = new ImageData(N, N);
  }

  paint(canvas, M, look) {
    const N = this.N;
    if (canvas.width !== N) { canvas.width = N; canvas.height = N; }
    const out = this.img.data;
    out.fill(0);
    const P = this.px;
    const glyph = look.number ? this.glyph(look.number) : null;
    const [br, bg, bb] = look.base;
    const [ir, ig, ib] = look.ink;
    const gloss = look.gloss;
    const dots = look.dots ? DOT_DIRS.slice(0, look.dots) : null;
    const m0 = M[0], m1 = M[1], m2 = M[2], m3 = M[3], m4 = M[4], m5 = M[5], m6 = M[6], m7 = M[7], m8 = M[8];
    for (let k = 0; k < P.n; k++) {
      const nx = P.nx[k], ny = P.ny[k], nz = P.nz[k];
      const lx = m0 * nx + m3 * ny + m6 * nz;
      const ly = m1 * nx + m4 * ny + m7 * nz;
      const lz = m2 * nx + m5 * ny + m8 * nz;
      let r = br, g = bg, b = bb;
      if (look.marble) {
        const vein = Math.sin(lx * 9 + Math.sin(ly * 6 + lz * 4) * 2.2 + lz * 3);
        const f = vein > 0.7 ? 1.45 : vein < -0.85 ? 0.7 : 1 + vein * 0.12;
        r = Math.min(255, r * f); g = Math.min(255, g * f); b = Math.min(255, b * f);
      }
      if (look.stripe && (ly > 0.5 || ly < -0.5)) { r = IVORY[0]; g = IVORY[1]; b = IVORY[2]; }
      if (glyph) {
        let disk = 0, gu = 0;
        if (-lz > 0.8) { disk = 1; gu = lx; } else if (lz > 0.8) { disk = 1; gu = -lx; }
        if (disk) {
          r = IVORY[0]; g = IVORY[1]; b = IVORY[2];
          const tx = ((gu / 0.6 + 1) * 0.5 * 63) | 0;
          const ty = ((ly / 0.6 + 1) * 0.5 * 63) | 0;
          if (tx >= 0 && tx < 64 && ty >= 0 && ty < 64) {
            const ga = glyph[ty * 64 + tx];
            if (ga > 100) { r = ir; g = ig; b = ib; }
          }
        }
      }
      if (dots) {
        for (let q = 0; q < dots.length; q++) {
          const d = dots[q];
          if (lx * d[0] + ly * d[1] + lz * d[2] > 0.985) { r = 200; g = 24; b = 44; break; }
        }
      }
      const light = 0.3 + 0.82 * P.dif[k];
      const rimF = 1 - 0.42 * P.rim[k];
      const sp = P.spec[k] * 255 * 0.9 * gloss;
      const o = P.idx[k] * 4;
      out[o] = Math.min(255, r * light * rimF + sp);
      out[o + 1] = Math.min(255, g * light * rimF + sp);
      out[o + 2] = Math.min(255, b * light * rimF + sp);
      out[o + 3] = P.alpha[k] * 255;
    }
    canvas.getContext('2d').putImageData(this.img, 0, 0);
  }
}

// Rota la orientación M (local→mundo, fila mayor) al rodar dx, dy sobre la mesa
export function rollMatrix(M, dx, dy, R) {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  const ax = dy / d, ay = -dx / d; // eje (dy, -dx, 0)
  const th = d / R;
  const c = Math.cos(th), s = Math.sin(th), t = 1 - c;
  const r00 = t * ax * ax + c, r01 = t * ax * ay, r02 = s * ay;
  const r10 = t * ax * ay, r11 = t * ay * ay + c, r12 = -s * ax;
  const r20 = -s * ay, r21 = s * ax, r22 = c;
  const m = M.slice();
  for (let j = 0; j < 3; j++) {
    M[j] = r00 * m[j] + r01 * m[3 + j] + r02 * m[6 + j];
    M[3 + j] = r10 * m[j] + r11 * m[3 + j] + r12 * m[6 + j];
    M[6 + j] = r20 * m[j] + r21 * m[3 + j] + r22 * m[6 + j];
  }
}

function orthonormalize(M) {
  let ax = M[0], ay = M[3], az = M[6];
  let l = Math.hypot(ax, ay, az); ax /= l; ay /= l; az /= l;
  let bx = M[1], by = M[4], bz = M[7];
  const dt = ax * bx + ay * by + az * bz;
  bx -= dt * ax; by -= dt * ay; bz -= dt * az;
  l = Math.hypot(bx, by, bz); bx /= l; by /= l; bz /= l;
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  M[0] = ax; M[3] = ay; M[6] = az; M[1] = bx; M[4] = by; M[7] = bz; M[2] = cx; M[5] = cy; M[8] = cz;
}

function randomOrientation() {
  const M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const a = Math.random() * Math.PI * 2;
  const c = Math.cos(a), s = Math.sin(a);
  M[0] = c; M[1] = -s; M[3] = s; M[4] = c;
  rollMatrix(M, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, 2.86);
  return M;
}

// ---------------------------------------------------------------- tacos
const CUE_LEN = 147.5;
function cueRadius(x) {
  if (x < 72) return 0.62 + 0.08 * (x / 72);
  if (x < 74.5) return 0.93;
  return 0.95 + 0.5 * ((x - 74.5) / 73);
}

const cueCache = new Map();
export function cueStrip(styleId, ppc = 12) {
  const key = styleId + '@' + ppc;
  if (cueCache.has(key)) return cueCache.get(key);
  const st = byId(CUES, styleId);
  const rnd = seeded(hashStr(st.id));
  const Hc = 3.0;
  const c = document.createElement('canvas');
  c.width = Math.ceil(CUE_LEN * ppc);
  c.height = Math.ceil(Hc * ppc) + 2;
  const g = c.getContext('2d');
  g.scale(ppc, ppc);
  const cy = (c.height / ppc) / 2;
  // silueta
  g.beginPath();
  g.moveTo(0, cy - cueRadius(0) * 0.9);
  for (let x = 0; x <= CUE_LEN; x += 0.5) g.lineTo(x, cy - cueRadius(x));
  for (let x = CUE_LEN; x >= 0; x -= 0.5) g.lineTo(x, cy + cueRadius(x));
  g.closePath();
  g.save();
  g.clip();
  const band = (x0, x1, col) => { g.fillStyle = col; g.fillRect(x0, 0, x1 - x0, Hc + 1); };
  band(0, 0.9, '#3F6FAE');
  band(0.9, 3.0, '#F2EEE4');
  band(3.0, 72, st.shaft);
  if (st.id !== 'carbono') {
    g.globalAlpha = 0.12;
    for (let i = 0; i < 9; i++) {
      g.strokeStyle = rnd() < 0.5 ? '#6b4a26' : '#ffffff';
      g.lineWidth = 0.04;
      g.beginPath();
      const y = cy + (rnd() - 0.5) * 1.2;
      g.moveTo(3, y); g.bezierCurveTo(25, y + (rnd() - 0.5) * 0.4, 50, y + (rnd() - 0.5) * 0.4, 72, y);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  band(72, 74.5, st.ring);
  band(74.5, 112, st.forearm);
  drawCuePattern(g, st, 74.5, 112, cy, Hc, rnd);
  band(112, 113.2, st.ring);
  band(113.2, 133, st.wrap);
  g.globalAlpha = 0.18;
  g.strokeStyle = '#000';
  g.lineWidth = 0.08;
  for (let x = 113.2; x < 134; x += 0.35) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x - 1.2, Hc + 1); g.stroke(); }
  g.globalAlpha = 1;
  band(133, 134, st.ring);
  band(134, 146.6, st.sleeve);
  if (['zebra', 'tiger', 'leopard', 'camo', 'weave', 'crystal'].includes(st.pattern)) {
    drawCuePattern(g, { ...st, forearm: st.sleeve }, 134, 146.6, cy, Hc, rnd);
  }
  band(146.6, CUE_LEN, '#111111');
  // sombreado cilíndrico
  const sh = g.createLinearGradient(0, cy - 1.5, 0, cy + 1.5);
  sh.addColorStop(0, 'rgba(0,0,0,0.5)');
  sh.addColorStop(0.28, 'rgba(255,255,255,0.32)');
  sh.addColorStop(0.42, 'rgba(255,255,255,0.06)');
  sh.addColorStop(0.75, 'rgba(0,0,0,0.18)');
  sh.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = sh;
  g.fillRect(0, 0, CUE_LEN, Hc + 1);
  g.restore();
  cueCache.set(key, c);
  return c;
}

function drawCuePattern(g, st, x0, x1, cy, Hc, rnd) {
  g.save();
  g.beginPath();
  g.rect(x0, 0, x1 - x0, Hc + 1);
  g.clip();
  const col = st.inlay;
  const top = cy - 1.5, bot = cy + 1.5;
  switch (st.pattern) {
    case 'points': {
      for (const [yb, h] of [[cy, 0.8], [top, 0.9], [bot, 0.9]]) {
        g.fillStyle = '#E9E2D0';
        g.beginPath(); g.moveTo(x1, yb - h - 0.12); g.lineTo(x0 + 7, yb); g.lineTo(x1, yb + h + 0.12); g.fill();
        g.fillStyle = col;
        g.beginPath(); g.moveTo(x1, yb - h); g.lineTo(x0 + 8, yb); g.lineTo(x1, yb + h); g.fill();
      }
      g.fillStyle = st.ring;
      for (const [yb] of [[cy]]) { g.beginPath(); g.ellipse(x0 + 20, yb, 0.5, 0.25, 0, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case 'weave': {
      const s = 0.55;
      for (let x = x0; x < x1; x += s) {
        for (let y = top; y < bot; y += s) {
          const k = (Math.round((x - x0) / s) + Math.round((y - top) / s)) % 2;
          g.fillStyle = k ? col : st.forearm;
          g.fillRect(x, y, s, s);
          g.fillStyle = 'rgba(255,255,255,0.05)';
          g.fillRect(x, y, s, s * 0.3);
        }
      }
      g.fillStyle = st.ring;
      g.fillRect(x0 + 2, 0, 0.35, Hc + 1);
      break;
    }
    case 'zebra':
    case 'tiger': {
      g.fillStyle = col;
      let x = x0 + 0.5;
      while (x < x1) {
        const w = st.pattern === 'zebra' ? 0.6 + rnd() * 0.9 : 0.4 + rnd() * 0.6;
        const lean = (rnd() - 0.5) * 2;
        g.beginPath();
        g.moveTo(x, top);
        if (st.pattern === 'tiger') {
          g.quadraticCurveTo(x + lean + w, cy, x + w * 0.2, bot);
          g.lineTo(x + w * 0.9, bot);
          g.quadraticCurveTo(x + lean + w * 0.2, cy, x + w * 1.5, top);
        } else {
          g.bezierCurveTo(x + lean, cy - 0.6, x - lean, cy + 0.6, x + lean * 0.5, bot);
          g.lineTo(x + lean * 0.5 + w, bot);
          g.bezierCurveTo(x - lean + w, cy + 0.6, x + lean + w, cy - 0.6, x + w, top);
        }
        g.closePath();
        g.fill();
        x += w + (st.pattern === 'zebra' ? 0.7 + rnd() * 1.1 : 1.0 + rnd() * 1.4);
      }
      break;
    }
    case 'leopard': {
      for (let i = 0; i < (x1 - x0) * 1.6; i++) {
        const x = x0 + rnd() * (x1 - x0), y = top + rnd() * 3;
        const r = 0.28 + rnd() * 0.25;
        g.fillStyle = '#B9873F';
        g.beginPath(); g.ellipse(x, y, r, r * 0.8, rnd() * 3, 0, Math.PI * 2); g.fill();
        g.strokeStyle = col; g.lineWidth = 0.14;
        g.setLineDash([0.3, 0.12]);
        g.beginPath(); g.ellipse(x, y, r + 0.08, r * 0.8 + 0.08, rnd() * 3, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
      }
      break;
    }
    case 'camo': {
      const cols = [col, '#7A8B4C', '#2A2418', st.forearm];
      for (let i = 0; i < (x1 - x0) * 2.2; i++) {
        g.fillStyle = cols[i % cols.length];
        const x = x0 + rnd() * (x1 - x0), y = top + rnd() * 3;
        g.beginPath();
        g.ellipse(x, y, 0.5 + rnd() * 1.2, 0.3 + rnd() * 0.6, rnd() * 3, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    case 'flames': {
      for (let i = 0; i < 9; i++) {
        const y = top + 0.2 + (i / 8) * 2.6;
        const len = 14 + rnd() * 18;
        const grd = g.createLinearGradient(x1, 0, x1 - len, 0);
        grd.addColorStop(0, '#FFD000');
        grd.addColorStop(0.5, col);
        grd.addColorStop(1, 'rgba(160,20,10,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(x1, y - 0.35);
        g.bezierCurveTo(x1 - len * 0.4, y - 0.6, x1 - len * 0.6, y + 0.4, x1 - len, y + (rnd() - 0.5) * 0.4);
        g.bezierCurveTo(x1 - len * 0.55, y + 0.15, x1 - len * 0.35, y + 0.7, x1, y + 0.35);
        g.fill();
      }
      break;
    }
    case 'fade': {
      const grd = g.createLinearGradient(x0, 0, x1, 0);
      grd.addColorStop(0, st.forearm);
      grd.addColorStop(1, col);
      g.fillStyle = grd;
      g.fillRect(x0, 0, x1 - x0, Hc + 1);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect(x0, cy - 0.06, x1 - x0, 0.12);
      break;
    }
    case 'crystal': {
      for (let i = 0; i < 40; i++) {
        const x = x0 + rnd() * (x1 - x0), y = top + rnd() * 3;
        g.fillStyle = rnd() < 0.5 ? col : 'rgba(255,255,255,0.8)';
        g.globalAlpha = 0.4 + rnd() * 0.5;
        g.beginPath();
        g.moveTo(x, y); g.lineTo(x + 0.6 + rnd() * 1.6, y + (rnd() - 0.5) * 0.9); g.lineTo(x + rnd() * 0.8, y + 0.4 + rnd() * 0.6);
        g.fill();
      }
      g.globalAlpha = 1;
      break;
    }
    case 'filigree': {
      g.strokeStyle = col;
      g.lineWidth = 0.09;
      for (const off of [-0.7, 0, 0.7]) {
        g.beginPath();
        for (let x = x0; x <= x1; x += 0.2) {
          const y = cy + off + Math.sin((x - x0) * 1.1 + off * 3) * 0.32;
          if (x === x0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.fillStyle = col;
      for (let x = x0 + 4; x < x1 - 2; x += 6) {
        g.beginPath(); g.moveTo(x, cy - 0.45); g.lineTo(x + 0.6, cy); g.lineTo(x, cy + 0.45); g.lineTo(x - 0.6, cy); g.fill();
      }
      break;
    }
    default: break;
  }
  g.restore();
}

// ---------------------------------------------------------------- renderer principal
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.painter = new BallPainter();
    this.sprites = new Map();
    this.cache = document.createElement('canvas');
    this.table = null;
    this.prefs = null;
    this.rotated = false;
    this.k = 1;
    this.allowRotate = true;
    this.cssW = 0;
    this.cssH = 0;
    this.falling = [];
  }

  setTable(table) {
    if (this.table && this.table.kind === table.kind && this.table.L === table.L) { this.table = table; return; }
    this.table = table;
    this.sprites.clear();
    this.layout();
  }

  setPrefs(prefs) {
    this.prefs = prefs;
    for (const s of this.sprites.values()) s.dirty = true;
    this.lookKey = null;
    this.buildCache();
  }

  resize(cssW, cssH) {
    this.cssW = cssW; this.cssH = cssH;
    this.layout();
  }

  layout() {
    if (!this.table || !this.cssW) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    const W = Math.round(this.cssW * dpr), H = Math.round(this.cssH * dpr);
    this.canvas.width = W; this.canvas.height = H;
    this.cache.width = W; this.cache.height = H;
    const t = this.table;
    const tw = t.L + 2 * RAIL, th = t.W + 2 * RAIL;
    const pad = 6 * dpr;
    this.rotated = this.allowRotate && this.cssH > this.cssW * 1.12;
    const aw = W - 2 * pad, ah = H - 2 * pad;
    const k = this.rotated ? Math.min(aw / th, ah / tw) : Math.min(aw / tw, ah / th);
    this.k = k;
    if (this.rotated) {
      const ox = (W - t.W * k) / 2, oy = (H - t.L * k) / 2;
      this.m = [0, -k, k, 0, ox, oy + t.L * k];
    } else {
      const ox = (W - t.L * k) / 2, oy = (H - t.W * k) / 2;
      this.m = [k, 0, 0, k, ox, oy];
    }
    this.painter.setRadius(t.R * k);
    for (const s of this.sprites.values()) s.dirty = true;
    this.buildCache();
  }

  applyT(ctx) {
    const m = this.m;
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  }

  // Coordenadas de pantalla (clientX/Y) → coordenadas de mesa (cm)
  toTable(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const X = (clientX - r.left) * this.dpr, Y = (clientY - r.top) * this.dpr;
    const [a, b, c, d, e, f] = this.m;
    const det = a * d - b * c;
    const x = (d * (X - e) - c * (Y - f)) / det;
    const y = (-b * (X - e) + a * (Y - f)) / det;
    return { x, y };
  }

  // Coordenadas de mesa → píxeles CSS relativos al canvas
  toScreen(x, y) {
    const [a, b, c, d, e, f] = this.m;
    return { x: (a * x + c * y + e) / this.dpr, y: (b * x + d * y + f) / this.dpr };
  }

  // ------------------------------------------------------------ mesa
  buildCache() {
    if (!this.table || !this.prefs || !this.m) return;
    const g = this.cache.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.cache.width, this.cache.height);
    this.applyT(g);
    drawTable(g, this.table, this.prefs, this.k);
  }

  sprite(id) {
    let s = this.sprites.get(id);
    if (!s) {
      s = { canvas: document.createElement('canvas'), M: randomOrientation(), dirty: true };
      this.sprites.set(id, s);
    }
    return s;
  }

  roll(id, dx, dy) {
    const s = this.sprite(id);
    rollMatrix(s.M, dx, dy, this.table.R);
    s.rolls = (s.rolls || 0) + 1;
    if (s.rolls % 60 === 0) orthonormalize(s.M);
    s.dirty = true;
  }

  addFalling(id, x, y, px, py) {
    this.falling.push({ id, x, y, px, py, t: 0 });
  }

  // ------------------------------------------------------------ frame
  draw(f, dt = 0) {
    const ctx = this.ctx;
    const t = this.table;
    if (!t || !this.prefs || !this.m) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.cache, 0, 0);
    this.applyT(ctx);
    const R = t.R;
    const accent = byId(ACCENTS, this.prefs.accent).color;

    if (f.kitchen) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(0, 0, t.headX, t.W);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.25;
      ctx.setLineDash([1.5, 1.2]);
      ctx.beginPath(); ctx.moveTo(t.headX, 0); ctx.lineTo(t.headX, t.W); ctx.stroke();
      ctx.setLineDash([]);
    }

    if (f.callPocket) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      t.pockets.forEach((p, i) => {
        const sel = f.call === i;
        ctx.strokeStyle = sel ? '#F4B400' : `rgba(244,180,0,${0.25 + 0.35 * pulse})`;
        ctx.lineWidth = sel ? 1.1 : 0.6;
        ctx.beginPath(); ctx.arc(p.ax + (p.ax < 1 ? -2 : p.ax > t.L - 1 ? 2 : 0), p.ay + (p.ay < 1 ? -2 : p.ay > t.W - 1 ? 2 : 0), 7.5, 0, Math.PI * 2); ctx.stroke();
      });
    }

    // anillos bajo las bolas legales del tirador
    if (f.targets && f.targets.length && f.showTargets) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 0.35;
      for (const id of f.targets) {
        const b = f.world.ball(id);
        if (!b || !b.on) continue;
        ctx.beginPath(); ctx.arc(b.x, b.y, R + 0.9, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // sombras
    for (const b of f.world.balls) {
      if (!b.on) continue;
      const gr = ctx.createRadialGradient(b.x + 0.9, b.y + 1.3, R * 0.2, b.x + 0.9, b.y + 1.3, R * 1.25);
      gr.addColorStop(0, 'rgba(0,0,0,0.45)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(b.x + 0.9, b.y + 1.3, R * 1.25, 0, Math.PI * 2); ctx.fill();
    }

    // bolas
    const kp = this.k;
    const N = this.painter.N;
    const half = N / 2 / kp;
    const lookKey = this.prefs.balls + t.kind;
    if (this.lookKey !== lookKey) { this.lookKey = lookKey; for (const s of this.sprites.values()) s.dirty = true; }
    for (const b of f.world.balls) {
      if (!b.on) continue;
      if (f.hideBall === b.id) continue;
      const s = this.sprite(b.id);
      if (s.dirty || s.canvas.width !== N) {
        this.painter.paint(s.canvas, s.M, ballLook(b.id, t.kind, this.prefs.balls));
        s.dirty = false;
      }
      ctx.globalAlpha = f.ghostBall === b.id ? 0.55 : 1;
      ctx.drawImage(s.canvas, b.x - half, b.y - half, N / kp, N / kp);
    }
    ctx.globalAlpha = 1;

    // bolas cayendo en tronera
    if (this.falling.length) {
      this.falling = this.falling.filter((fb) => fb.t < 1);
      for (const fb of this.falling) {
        fb.t += dt / 0.28;
        const q = Math.min(1, fb.t);
        const x = fb.x + (fb.px - fb.x) * q, y = fb.y + (fb.py - fb.y) * q;
        const s = this.sprite(fb.id);
        if (s.dirty || s.canvas.width !== N) { this.painter.paint(s.canvas, s.M, ballLook(fb.id, t.kind, this.prefs.balls)); s.dirty = false; }
        const sc = 1 - 0.45 * q;
        ctx.globalAlpha = 1 - q * 0.9;
        ctx.drawImage(s.canvas, x - half * sc, y - half * sc, (N / kp) * sc, (N / kp) * sc);
      }
      ctx.globalAlpha = 1;
    }

    if (f.placing) {
      const c = f.world.ball(f.placing.id);
      if (c) {
        ctx.strokeStyle = f.placing.valid ? 'rgba(255,255,255,0.8)' : '#E4572E';
        ctx.lineWidth = 0.5;
        ctx.setLineDash(f.placing.valid ? [1, 0.8] : []);
        ctx.beginPath(); ctx.arc(c.x, c.y, R + 1.4, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (f.aim) this.drawAim(ctx, f, accent);
  }

  drawAim(ctx, f, accent) {
    const t = this.table;
    const R = t.R;
    const a = f.aim;
    const cue = f.world.ball(a.cueId);
    if (!cue || !cue.on) return;
    const dx = Math.cos(a.angle), dy = Math.sin(a.angle);
    const alpha = a.remote ? 0.55 : 0.9;

    if (a.guide !== 'off' && !a.hideGuide) {
      const hit = castRay(f.world, a.cueId, cue.x, cue.y, dx, dy);
      const gx = cue.x + dx * hit.t, gy = cue.y + dy * hit.t;
      ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.8})`;
      ctx.lineWidth = 0.32;
      ctx.setLineDash([1.6, 1.1]);
      ctx.beginPath(); ctx.moveTo(cue.x + dx * R, cue.y + dy * R); ctx.lineTo(gx, gy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.arc(gx, gy, R, 0, Math.PI * 2); ctx.stroke();
      const long = a.guide === 'long';
      if (hit.ball != null) {
        const ob = f.world.ball(hit.ball);
        let nx = ob.x - gx, ny = ob.y - gy;
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const cos = dx * nx + dy * ny;
        const len = long ? 34 + 30 * cos : 10 + 8 * cos;
        ctx.strokeStyle = rgba('#F4B400', alpha);
        ctx.lineWidth = 0.45;
        ctx.beginPath(); ctx.moveTo(ob.x, ob.y); ctx.lineTo(ob.x + nx * len, ob.y + ny * len); ctx.stroke();
        if (long || a.guide === 'short') {
          // desvío de la blanca (tangente + efecto vertical)
          let tx = dx - cos * nx, ty = dy - cos * ny;
          const f2 = a.sy > 0 ? a.sy * 0.3 : a.sy * 0.55;
          tx += dx * cos * f2; ty += dy * cos * f2;
          const tl = Math.hypot(tx, ty);
          if (tl > 0.02) {
            const L2 = (long ? 26 : 9) * Math.min(1, tl * 1.4);
            ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.55})`;
            ctx.lineWidth = 0.3;
            ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + (tx / tl) * L2, gy + (ty / tl) * L2); ctx.stroke();
          }
        }
      } else if (hit.rail && long) {
        // previsualiza un rebote en banda
        let rx = dx, ry = dy;
        if (hit.rail === 'x') rx = -rx; else ry = -ry;
        const h2 = castRay(f.world, a.cueId, gx, gy, rx, ry, 90);
        ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.45})`;
        ctx.setLineDash([1.2, 1.2]);
        ctx.lineWidth = 0.28;
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + rx * h2.t, gy + ry * h2.t); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // taco
    const strip = cueStrip(a.style || 'clasico');
    const ppc = strip.width / CUE_LEN;
    const gap = R + 0.7 + (a.pull || 0) * 24 + (a.strike || 0);
    ctx.save();
    ctx.translate(cue.x, cue.y);
    ctx.rotate(a.angle + Math.PI);
    ctx.globalAlpha = 0.28 * alpha;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(gap + 1.2, 1.6); ctx.lineTo(gap + CUE_LEN + 1.2, 1.6 - 1.2); ctx.lineTo(gap + CUE_LEN + 1.2, 1.6 + 1.6); ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = a.remote ? 0.85 : 1;
    ctx.drawImage(strip, gap, -strip.height / ppc / 2, CUE_LEN, strip.height / ppc);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// Rayo desde la blanca: primera bola o banda
export function castRay(world, cueId, x0, y0, dx, dy, maxLen = 600) {
  const t = world.table, R = t.R;
  let best = maxLen, ball = null, rail = null;
  for (const b of world.balls) {
    if (!b.on || b.id === cueId) continue;
    const px = b.x - x0, py = b.y - y0;
    const proj = px * dx + py * dy;
    if (proj <= 0) continue;
    const perp2 = px * px + py * py - proj * proj;
    if (perp2 >= 4 * R * R) continue;
    const tt = proj - Math.sqrt(4 * R * R - perp2);
    if (tt > 0 && tt < best) { best = tt; ball = b.id; }
  }
  const lims = [];
  if (dx > 0) lims.push([(t.L - R - x0) / dx, 'x']);
  if (dx < 0) lims.push([(R - x0) / dx, 'x']);
  if (dy > 0) lims.push([(t.W - R - y0) / dy, 'y']);
  if (dy < 0) lims.push([(R - y0) / dy, 'y']);
  for (const [tt, ax] of lims) {
    if (tt >= 0 && tt < best) { best = tt; ball = null; rail = ax; }
  }
  return { t: Math.max(0, best), ball, rail };
}

// ---------------------------------------------------------------- dibujo de la mesa
const feltCache = new Map();
function feltPattern(g, color) {
  let c = feltCache.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 160;
    const x = c.getContext('2d');
    x.fillStyle = color;
    x.fillRect(0, 0, 160, 160);
    const rnd = seeded(hashStr(color));
    const img = x.getImageData(0, 0, 160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 16;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    x.putImageData(img, 0, 0);
    feltCache.set(color, c);
  }
  return g.createPattern(c, 'repeat');
}

function cushionPolys(t) {
  const L = t.L, W = t.W, c = 8.2, s = 6.6, D = CUSHION;
  const polys = [];
  if (t.kind === 'carom') {
    polys.push([[0, 0], [L, 0], [L + D, -D], [-D, -D]]);
    polys.push([[L, 0], [L, W], [L + D, W + D], [L + D, -D]]);
    polys.push([[L, W], [0, W], [-D, W + D], [L + D, W + D]]);
    polys.push([[0, W], [0, 0], [-D, -D], [-D, W + D]]);
    return polys;
  }
  const cj = 4.7 * (D / 3.7);  // desplazamiento x de la mandíbula de esquina a profundidad D
  const sj = 1.2 * (D / 4.5);
  const longRail = (y, sgn) => {
    polys.push([[c, y], [L / 2 - s, y], [L / 2 - s + sj, y - sgn * D], [c - cj, y - sgn * D]]);
    polys.push([[L / 2 + s, y], [L - c, y], [L - c + cj, y - sgn * D], [L / 2 + s - sj, y - sgn * D]]);
  };
  longRail(0, 1);
  longRail(W, -1);
  const shortRail = (x, sgn) => {
    polys.push([[x, c], [x, W - c], [x - sgn * D, W - c + cj], [x - sgn * D, c - cj]]);
  };
  shortRail(0, 1);
  shortRail(L, -1);
  return polys;
}

export function pocketHoles(t) {
  if (t.kind === 'carom') return [];
  const L = t.L, W = t.W;
  return [
    { x: -2.6, y: -2.6, r: 5.5 }, { x: L / 2, y: -4.7, r: 5.1 }, { x: L + 2.6, y: -2.6, r: 5.5 },
    { x: -2.6, y: W + 2.6, r: 5.5 }, { x: L / 2, y: W + 4.7, r: 5.1 }, { x: L + 2.6, y: W + 2.6, r: 5.5 },
  ];
}

export function drawTable(g, t, prefs, k) {
  const L = t.L, W = t.W;
  const cloth = byId(CLOTHS, prefs.cloth).color;
  const wood = byId(WOODS, prefs.wood);
  const acc = byId(ACCENTS, prefs.accent);
  const rnd = seeded(hashStr(wood.id + t.kind));

  // sombra general y marco de madera
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 40 * k / 4;
  g.shadowOffsetY = 10 * k / 4;
  roundRect(g, -RAIL, -RAIL, L + 2 * RAIL, W + 2 * RAIL, 5);
  g.fillStyle = wood.base;
  g.fill();
  g.restore();

  g.save();
  roundRect(g, -RAIL, -RAIL, L + 2 * RAIL, W + 2 * RAIL, 5);
  g.clip();
  const wg = g.createLinearGradient(0, -RAIL, 0, W + RAIL);
  wg.addColorStop(0, wood.light);
  wg.addColorStop(0.5, wood.base);
  wg.addColorStop(1, wood.dark);
  g.fillStyle = wg;
  g.fillRect(-RAIL, -RAIL, L + 2 * RAIL, W + 2 * RAIL);
  // vetas
  g.lineWidth = 0.12;
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = rnd() < 0.5 ? rgba('#000000', 0.08 + rnd() * 0.08) : rgba('#ffffff', 0.04 + rnd() * 0.05);
    const y = -RAIL + rnd() * (W + 2 * RAIL);
    g.beginPath();
    g.moveTo(-RAIL, y);
    for (let x = -RAIL; x <= L + RAIL; x += 12) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 0.8 + (rnd() - 0.5) * 0.3);
    g.stroke();
  }
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = rnd() < 0.5 ? rgba('#000000', 0.08 + rnd() * 0.08) : rgba('#ffffff', 0.04 + rnd() * 0.05);
    const x = -RAIL + rnd() * (L + 2 * RAIL);
    g.beginPath();
    g.moveTo(x, -RAIL);
    for (let y = -RAIL; y <= W + RAIL; y += 12) g.lineTo(x + Math.sin(y * 0.04 + i) * 0.8, y);
    g.stroke();
  }
  g.restore();
  // bisel exterior
  g.lineWidth = 0.6;
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  roundRect(g, -RAIL + 0.4, -RAIL + 0.4, L + 2 * RAIL - 0.8, W + 2 * RAIL - 0.8, 4.6);
  g.stroke();
  // borde interior de la madera
  g.lineWidth = 0.8;
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.strokeRect(-CUSHION - 0.3, -CUSHION - 0.3, L + 2 * CUSHION + 0.6, W + 2 * CUSHION + 0.6);

  // tapete
  g.save();
  const pat = feltPattern(g, cloth);
  if (pat.setTransform) pat.setTransform(new DOMMatrix().scale(1 / k));
  g.fillStyle = pat;
  g.fillRect(-CUSHION, -CUSHION, L + 2 * CUSHION, W + 2 * CUSHION);
  const lamp = g.createRadialGradient(L / 2, W / 2, 10, L / 2, W / 2, L * 0.62);
  lamp.addColorStop(0, 'rgba(255,236,200,0.16)');
  lamp.addColorStop(0.55, 'rgba(255,236,200,0.03)');
  lamp.addColorStop(1, 'rgba(0,0,0,0.32)');
  g.fillStyle = lamp;
  g.fillRect(-CUSHION, -CUSHION, L + 2 * CUSHION, W + 2 * CUSHION);
  g.restore();

  // logo de agua
  if (prefs.logo) {
    g.save();
    g.translate(L / 2, W / 2);
    g.font = '19px Shrikhand, "Barlow Semi Condensed", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillText('WildPool', 0, 1);
    g.restore();
  }

  // línea de cabeza y puntos
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.lineWidth = 0.18;
  g.beginPath(); g.moveTo(t.headX, 0); g.lineTo(t.headX, W); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (const x of [t.headX, t.footX]) { g.beginPath(); g.arc(x, W / 2, 0.45, 0, Math.PI * 2); g.fill(); }

  // gomas
  for (const p of cushionPolys(t)) {
    g.beginPath();
    p.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fillStyle = shade(cloth, -0.22);
    g.fill();
    g.strokeStyle = shade(cloth, 0.18);
    g.lineWidth = 0.25;
    g.beginPath(); g.moveTo(p[0][0], p[0][1]); g.lineTo(p[1][0], p[1][1]); g.stroke();
  }

  // troneras
  for (const h of pocketHoles(t)) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.arc(h.x + 0.3, h.y + 0.4, h.r + 1.0, 0, Math.PI * 2); g.fill();
    const rg = g.createLinearGradient(h.x - h.r, h.y - h.r, h.x + h.r, h.y + h.r);
    rg.addColorStop(0, acc.color); rg.addColorStop(1, acc.dark);
    g.fillStyle = rg;
    g.beginPath(); g.arc(h.x, h.y, h.r + 0.75, 0, Math.PI * 2); g.fill();
    const hg = g.createRadialGradient(h.x + 0.8, h.y + 0.8, 0.5, h.x, h.y, h.r);
    hg.addColorStop(0, '#050403');
    hg.addColorStop(0.75, '#0C0907');
    hg.addColorStop(1, '#1D1611');
    g.fillStyle = hg;
    g.beginPath(); g.arc(h.x, h.y, h.r, 0, Math.PI * 2); g.fill();
  }

  // diamantes
  g.fillStyle = acc.color;
  const dia = (x, y, rot) => {
    g.save(); g.translate(x, y); if (rot) g.rotate(Math.PI / 2);
    g.beginPath(); g.moveTo(-1.0, 0); g.lineTo(0, -0.55); g.lineTo(1.0, 0); g.lineTo(0, 0.55); g.closePath(); g.fill();
    g.restore();
  };
  const mid = CUSHION + (RAIL - CUSHION) / 2;
  for (let i = 1; i < 8; i++) {
    if (i === 4 && t.kind !== 'carom') continue;
    dia((L * i) / 8, -mid, false); dia((L * i) / 8, W + mid, false);
  }
  for (let i = 1; i < 4; i++) { dia(-mid, (W * i) / 4, true); dia(L + mid, (W * i) / 4, true); }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Icono de una bola (para la interfaz)
export function ballIcon(id, setId, px = 40, kind = 'pool') {
  const p = new BallPainter();
  p.setRadius(px / 2 - 1);
  const c = document.createElement('canvas');
  const M = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  rollMatrix(M, 0.35, -0.5, 2.86);
  p.paint(c, M, ballLook(id, kind, setId));
  return c;
}
