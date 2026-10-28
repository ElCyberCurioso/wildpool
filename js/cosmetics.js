// Catálogo de personalización y preferencias guardadas

export const AVATARS = ['🐯', '🦁', '🐺', '🦊', '🐻', '🐼', '🦉', '🦅', '🐊', '🦈', '🐍', '🦍', '🦓', '🐆', '🦬', '🐗'];
export const AVATAR_COLORS = ['#F4B400', '#E8833A', '#9AA5B1', '#E4572E', '#B07D4F', '#E9E4D8', '#C9A66B', '#D9A441', '#6BA368', '#5C9EAD', '#8DB580', '#A78BCE', '#F2F2F2', '#E0B04A', '#8C6E5A', '#C57B57'];

export const CLOTHS = [
  { id: 'torneo', name: 'Verde torneo', color: '#14684F' },
  { id: 'azul', name: 'Azul eléctrico', color: '#1C5AA6' },
  { id: 'burdeos', name: 'Burdeos', color: '#7E2232' },
  { id: 'morado', name: 'Morado', color: '#4E2E80' },
  { id: 'grafito', name: 'Grafito', color: '#30373B' },
  { id: 'turquesa', name: 'Turquesa', color: '#0E8585' },
  { id: 'arena', name: 'Arena', color: '#A9824B' },
  { id: 'rosa', name: 'Rosa chicle', color: '#B4487A' },
];

export const WOODS = [
  { id: 'nogal', name: 'Nogal', base: '#5A3424', light: '#7A4A33', dark: '#3A2016' },
  { id: 'roble', name: 'Roble claro', base: '#A0703E', light: '#C08D55', dark: '#7A522A' },
  { id: 'ebano', name: 'Ébano', base: '#1E1714', light: '#3A2E28', dark: '#0E0A08' },
  { id: 'cerezo', name: 'Cerezo', base: '#7E2E1F', light: '#A3432C', dark: '#561D13' },
  { id: 'lacado', name: 'Blanco lacado', base: '#E7E2D8', light: '#FFFFFF', dark: '#BDB6A8' },
  { id: 'gris', name: 'Gris industrial', base: '#4B4F54', light: '#6A6F75', dark: '#2E3134' },
];

export const ACCENTS = [
  { id: 'laton', name: 'Latón', color: '#C9A227', dark: '#7A5F12' },
  { id: 'cromo', name: 'Cromo', color: '#D7DDE2', dark: '#7D868E' },
  { id: 'negro', name: 'Negro mate', color: '#2A2A2A', dark: '#111111' },
  { id: 'cobre', name: 'Cobre', color: '#C46B3E', dark: '#7A3B1E' },
  { id: 'nacar', name: 'Nácar', color: '#EFE7D6', dark: '#A69D8A' },
];

// Colores 1..7 (las 9..15 repiten con raya), 8 negra
const CLASSIC = ['#F2B705', '#1F4FBF', '#D2232A', '#5A2A86', '#F06A12', '#14773E', '#7C1E1E'];
export const BALL_SETS = [
  { id: 'clasico', name: 'Clásico', colors: CLASSIC, eight: '#141414', cue: '#F6F1E4', ink: '#141414' },
  { id: 'pastel', name: 'Pastel', colors: ['#F7D96B', '#7FA7E8', '#EF8A8A', '#B79BE0', '#F6B07A', '#8ED1A4', '#C9928C'], eight: '#3B3B48', cue: '#FBF8F1', ink: '#3B3B48' },
  { id: 'neon', name: 'Neón', colors: ['#FFE600', '#00B3FF', '#FF2E63', '#B14CFF', '#FF8A00', '#00E28A', '#FF4FD8'], eight: '#1A1A26', cue: '#F4FBFF', ink: '#14141C', gloss: 1.5 },
  { id: 'vintage', name: 'Vintage', colors: ['#D9A62E', '#2E4A7A', '#A8322D', '#5B3B6E', '#C66A2B', '#3D6B47', '#6E2C22'], eight: '#221B17', cue: '#EDE3CC', ink: '#221B17', gloss: 0.6 },
  { id: 'marmol', name: 'Mármol', colors: CLASSIC, eight: '#1A1A1A', cue: '#F3F0EA', ink: '#141414', marble: true },
];

export const CUES = [
  { id: 'clasico', name: 'Clásico', shaft: '#E8CFA0', forearm: '#2A1810', inlay: '#D9B68A', pattern: 'points', ring: '#D4AF37', wrap: '#1F1B18', sleeve: '#3B2214' },
  { id: 'carbono', name: 'Carbono', shaft: '#2D3034', forearm: '#1A1C1F', inlay: '#30343A', pattern: 'weave', ring: '#3A86C8', wrap: '#111214', sleeve: '#1A1C1F' },
  { id: 'cebra', name: 'Cebra', shaft: '#EADBB8', forearm: '#F3EFE6', inlay: '#151515', pattern: 'zebra', ring: '#151515', wrap: '#151515', sleeve: '#F3EFE6' },
  { id: 'tigre', name: 'Tigre', shaft: '#EAD3A2', forearm: '#E07B1A', inlay: '#1A1210', pattern: 'tiger', ring: '#1A1210', wrap: '#1A1210', sleeve: '#E07B1A' },
  { id: 'leopardo', name: 'Leopardo', shaft: '#EAD3A2', forearm: '#D9AE62', inlay: '#2A1C10', pattern: 'leopard', ring: '#2A1C10', wrap: '#3A2A1A', sleeve: '#D9AE62' },
  { id: 'selva', name: 'Selva', shaft: '#DCC796', forearm: '#4D6B3A', inlay: '#2F4526', pattern: 'camo', ring: '#C9A227', wrap: '#22301B', sleeve: '#4D6B3A' },
  { id: 'llamas', name: 'Llamas', shaft: '#E8CFA0', forearm: '#1B1010', inlay: '#FF7A1A', pattern: 'flames', ring: '#FFB000', wrap: '#2B0F0F', sleeve: '#8B0F0F' },
  { id: 'neon', name: 'Neón', shaft: '#EDE2C6', forearm: '#FF2E88', inlay: '#22D3EE', pattern: 'fade', ring: '#FFFFFF', wrap: '#14141C', sleeve: '#22D3EE' },
  { id: 'hielo', name: 'Hielo', shaft: '#F1E6CC', forearm: '#E6F3FF', inlay: '#7CC4FF', pattern: 'crystal', ring: '#C0CCD6', wrap: '#9FB6C8', sleeve: '#E6F3FF' },
  { id: 'oro', name: 'Oro negro', shaft: '#E8CFA0', forearm: '#121212', inlay: '#D4AF37', pattern: 'filigree', ring: '#D4AF37', wrap: '#C9A227', sleeve: '#121212' },
];

export const byId = (list, id) => list.find((x) => x.id === id) || list[0];

const KEY = 'wildpool:prefs';
const DEFAULTS = {
  name: '',
  avatar: '🐯',
  cue: 'clasico',
  cloth: 'torneo',
  wood: 'nogal',
  accent: 'laton',
  balls: 'clasico',
  logo: true,
  sound: true,
  volume: 0.8,
};

export function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return sanitizePrefs({ ...DEFAULTS, ...raw });
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* almacenamiento no disponible */ }
}

function sanitizePrefs(p) {
  const out = { ...p };
  out.name = cleanName(out.name);
  if (!AVATARS.includes(out.avatar)) out.avatar = DEFAULTS.avatar;
  for (const [k, list] of [['cue', CUES], ['cloth', CLOTHS], ['wood', WOODS], ['accent', ACCENTS], ['balls', BALL_SETS]]) {
    if (!list.some((x) => x.id === out[k])) out[k] = DEFAULTS[k];
  }
  out.logo = !!out.logo;
  out.sound = !!out.sound;
  return out;
}

// Nombres: sin caracteres de control, espacios colapsados, máximo 18
export function cleanName(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18);
}

export function cleanText(s, max = 200) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function avatarColor(avatar) {
  const i = AVATARS.indexOf(avatar);
  return AVATAR_COLORS[i >= 0 ? i : 0];
}
