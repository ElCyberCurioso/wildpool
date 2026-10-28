import eightball from './eightball.js';
import nineball from './nineball.js';
import killer from './killer.js';
import carom from './carom.js';
import free from './free.js';

export const MODES = {
  '8ball': eightball,
  '9ball': nineball,
  killer,
  carom,
  free,
};

export const MODE_LIST = [eightball, nineball, killer, carom, free];

export function defaultOptions(modeId) {
  const out = {};
  for (const o of MODES[modeId].options) out[o.key] = o.def;
  return out;
}

// Normaliza las opciones recibidas (por ejemplo, desde la red)
export function sanitizeOptions(modeId, raw = {}) {
  const out = {};
  for (const o of MODES[modeId].options) {
    const v = raw[o.key];
    if (o.type === 'bool') out[o.key] = typeof v === 'boolean' ? v : o.def;
    else if (o.type === 'select') out[o.key] = o.choices.some(([k]) => k === v) ? v : o.def;
  }
  return out;
}
