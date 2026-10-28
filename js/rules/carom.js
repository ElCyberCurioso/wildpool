import { baseState } from './common.js';

// Bolas: 0 blanca (jugador 1), 1 amarilla (jugador 2), 2 roja
export default {
  id: 'carom',
  name: 'Carambola',
  blurb: 'Mesa sin troneras. Tu bola debe tocar las otras dos.',
  table: 'carom',
  min: 2,
  max: 2,
  options: [
    { key: 'variant', label: 'Variante', type: 'select', def: 'libre', choices: [['libre', 'Libre'], ['tres', 'Tres bandas']] },
    { key: 'target', label: 'Puntos para ganar', type: 'select', def: 10, choices: [[5, '5'], [10, '10'], [15, '15'], [25, '25']] },
  ],

  initialState(seats, settings) {
    const s = baseState('carom', seats, settings);
    s.scores = [0, 0];
    s.ballInHand = null;
    s.isBreak = false;
    s.cueId = 0;
    s.run = 0;
    return s;
  },

  setup(world) {
    const t = world.table;
    world.balls = [];
    world.addBall(0, t.headX, t.W / 2 + 15.24);
    world.addBall(1, t.headX, t.W / 2);
    world.addBall(2, t.footX, t.W / 2);
  },

  info(state) {
    return { targets: [0, 1, 2].filter((id) => id !== state.cueId), callPocket: false };
  },

  resolve(state, ev) {
    const s = structuredClone(state);
    s.shotNo++;
    const p = s.turn;
    const me = s.seats[p].name;
    const tres = s.settings.variant === 'tres';
    const both = ev.cueHits.length >= 2;
    const point = both && (!tres || ev.cueCushionsAt2nd >= 3);
    const target = Number(s.settings.target) || 10;
    let msg;
    if (point) {
      s.scores[p]++;
      s.run++;
      if (s.scores[p] >= target) {
        s.over = { winner: p, text: `${me} llega a ${target} puntos y gana` };
        s.log = s.over.text;
        return { state: s, foul: null, msg: s.log };
      }
      msg = `¡Carambola de ${me}! ${s.run > 1 ? `Serie de ${s.run}. ` : ''}Sigue tirando.`;
    } else {
      s.turn = 1 - p;
      s.cueId = s.turn === 0 ? 0 : 1;
      s.run = 0;
      const why = !ev.cueHits.length ? 'no tocó ninguna bola'
        : !both ? 'solo tocó una bola'
          : `solo hizo ${ev.cueCushionsAt2nd} banda${ev.cueCushionsAt2nd === 1 ? '' : 's'} antes de la segunda bola`;
      msg = `${me} ${why}. Turno de ${s.seats[s.turn].name}.`;
    }
    s.log = msg;
    return { state: s, foul: null, msg };
  },

  timeout(state) {
    const s = structuredClone(state);
    const p = s.turn;
    s.turn = 1 - p;
    s.cueId = s.turn === 0 ? 0 : 1;
    s.run = 0;
    s.log = `${s.seats[p].name} agotó el tiempo. Turno de ${s.seats[s.turn].name}.`;
    return { state: s, foul: 'tiempo', msg: s.log };
  },

  hud(state) {
    const target = Number(state.settings.target) || 10;
    return state.seats.map((seat, i) => ({
      sub: `${i === 0 ? 'Blanca' : 'Amarilla'} · ${state.scores[i]}/${target}`,
      score: state.scores[i],
      balls: [i === 0 ? 0 : 1],
    }));
  },
};
