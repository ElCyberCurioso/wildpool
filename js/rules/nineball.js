import { rack9, baseState, preShotOn, placeCue, respot } from './common.js';

export default {
  id: '9ball',
  name: 'Bola 9',
  blurb: 'Toca siempre primero la bola más baja. Quien mete la 9, gana.',
  table: 'pool',
  min: 2,
  max: 2,
  options: [
    { key: 'threeFouls', label: 'Tres faltas seguidas pierden', type: 'bool', def: true },
  ],

  initialState(seats, settings) {
    const s = baseState('9ball', seats, settings);
    s.fouls = [0, 0];
    return s;
  },

  setup(world) { rack9(world); },

  info(state, world) {
    const on = world.balls.filter((b) => b.on && b.id !== 0).map((b) => b.id);
    return { targets: on.length ? [Math.min(...on)] : [], callPocket: false };
  },

  resolve(state, ev, world) {
    const s = structuredClone(state);
    s.shotNo++;
    const p = s.turn, o = 1 - p;
    const me = s.seats[p].name, opp = s.seats[o].name;
    const pre = [...preShotOn(world, ev)].filter((id) => id !== 0);
    const lowest = Math.min(...pre);
    const potted = ev.pocketed.map((e) => e.id).filter((id) => id !== 0);
    const cueIn = ev.pocketed.some((e) => e.id === 0);
    const msgs = [];

    let foul = null;
    if (cueIn) foul = 'la blanca entró en tronera';
    else if (ev.firstHit === null) foul = 'no tocó ninguna bola';
    else if (ev.firstHit !== lowest) foul = `debía tocar primero la ${lowest}`;
    else if (!s.isBreak && !potted.length && !ev.railAfterContact) foul = 'ninguna bola tocó banda tras el contacto';

    if (potted.includes(9)) {
      if (!foul) {
        s.over = { winner: p, text: `${me} mete la 9 y gana la partida` };
        s.log = s.over.text;
        return { state: s, foul, msg: s.log };
      }
      respot(world, 9);
      msgs.push('La 9 vuelve al punto de pie.');
    }

    s.fouls[p] = foul ? s.fouls[p] + 1 : 0;
    if (foul && s.settings.threeFouls && s.fouls[p] >= 3) {
      s.over = { winner: o, text: `${me} comete tres faltas seguidas. Gana ${opp}` };
      s.log = s.over.text;
      return { state: s, foul, msg: s.log };
    }

    s.isBreak = false;
    if (foul) {
      s.turn = o;
      s.ballInHand = 'anywhere';
      if (cueIn) placeCue(world, 'anywhere');
      msgs.unshift(`Falta de ${me}: ${foul}.`);
      if (s.fouls[p] === 2 && s.settings.threeFouls) msgs.push(`${me} lleva dos faltas seguidas.`);
      msgs.push(`Bola en mano para ${opp}.`);
    } else if (potted.length) {
      s.ballInHand = null;
      msgs.push(`${me} sigue tirando.`);
    } else {
      s.turn = o;
      s.ballInHand = null;
      msgs.push(`Turno de ${opp}.`);
    }
    s.log = msgs.join(' ');
    return { state: s, foul, msg: s.log };
  },

  timeout(state, world) {
    const s = structuredClone(state);
    const p = s.turn;
    s.fouls[p]++;
    s.turn = 1 - p;
    s.ballInHand = 'anywhere';
    s.isBreak = false;
    if (!world.ball(0).on) placeCue(world, 'anywhere');
    s.log = `${s.seats[p].name} agotó el tiempo. Bola en mano para ${s.seats[s.turn].name}.`;
    return { state: s, foul: 'tiempo', msg: s.log };
  },

  hud(state, world) {
    const on = world.balls.filter((b) => b.on && b.id !== 0).map((b) => b.id).sort((a, b) => a - b);
    return state.seats.map((seat, i) => ({
      sub: state.fouls[i] ? `${state.fouls[i]} falta${state.fouls[i] > 1 ? 's' : ''}` : 'Sin faltas',
      balls: i === state.turn ? on.slice(0, 1) : [],
    }));
  },
};
