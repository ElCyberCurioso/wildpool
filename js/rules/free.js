import { rack8, baseState, placeCue, objectBallsOn } from './common.js';

export default {
  id: 'free',
  name: 'Mesa libre',
  blurb: 'Sin faltas ni grupos. Ideal para practicar o tirar con amigos.',
  table: 'pool',
  min: 1,
  max: 8,
  options: [],

  initialState(seats, settings) {
    const s = baseState('free', seats, settings);
    s.potted = seats.map(() => 0);
    return s;
  },

  setup(world) { rack8(world); },

  info(state, world) {
    return { targets: objectBallsOn(world), callPocket: false };
  },

  resolve(state, ev, world) {
    const s = structuredClone(state);
    s.shotNo++;
    const p = s.turn;
    const me = s.seats[p].name;
    const potted = ev.pocketed.map((e) => e.id).filter((id) => id !== 0);
    const cueIn = ev.pocketed.some((e) => e.id === 0);
    s.potted[p] += potted.length;
    const msgs = [];
    if (potted.length) msgs.push(`${me} mete ${potted.length > 1 ? potted.length + ' bolas' : 'la ' + potted[0]}.`);
    s.isBreak = false;
    s.ballInHand = null;
    if (cueIn) {
      placeCue(world, 'anywhere');
      s.ballInHand = 'anywhere';
      msgs.push('La blanca entró: bola en mano.');
    }
    if (!(potted.length && !cueIn)) s.turn = (p + 1) % s.seats.length;
    if (!objectBallsOn(world).length) {
      rack8(world);
      s.ballInHand = 'kitchen';
      s.isBreak = true;
      msgs.push('Mesa vacía: nuevo triángulo.');
    }
    if (s.seats.length > 1) msgs.push(s.turn === p ? `${me} sigue tirando.` : `Turno de ${s.seats[s.turn].name}.`);
    s.log = msgs.join(' ');
    return { state: s, foul: null, msg: s.log };
  },

  timeout(state) {
    const s = structuredClone(state);
    const p = s.turn;
    s.turn = (p + 1) % s.seats.length;
    s.log = `${s.seats[p].name} agotó el tiempo. Turno de ${s.seats[s.turn].name}.`;
    return { state: s, foul: 'tiempo', msg: s.log };
  },

  hud(state) {
    return state.seats.map((seat, i) => ({
      sub: `${state.potted[i]} metida${state.potted[i] === 1 ? '' : 's'}`,
      balls: [],
    }));
  },
};
