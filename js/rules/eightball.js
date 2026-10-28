import { rack8, baseState, preShotOn, isSolid, isStripe, placeCue, respot } from './common.js';

const groupOf = (id) => (isSolid(id) ? 'solids' : isStripe(id) ? 'stripes' : null);
const GROUP_NAME = { solids: 'lisas', stripes: 'rayadas' };
const other = (g) => (g === 'solids' ? 'stripes' : 'solids');

function remaining(world, g) {
  return world.balls.filter((b) => b.on && groupOf(b.id) === g).map((b) => b.id);
}

export default {
  id: '8ball',
  name: 'Bola 8',
  blurb: 'Lisas contra rayadas. Mete tu grupo y después la 8.',
  table: 'pool',
  min: 2,
  max: 2,
  options: [
    { key: 'callEight', label: 'Cantar tronera para la 8', type: 'bool', def: true },
  ],

  initialState(seats, settings) {
    const s = baseState('8ball', seats, settings);
    s.groups = [null, null];
    return s;
  },

  setup(world) { rack8(world); },

  info(state, world) {
    const g = state.groups[state.turn];
    let targets;
    if (state.isBreak || !g) targets = world.balls.filter((b) => b.on && b.id !== 0 && b.id !== 8).map((b) => b.id);
    else {
      targets = remaining(world, g);
      if (!targets.length) targets = [8];
    }
    const onEight = !!g && remaining(world, g).length === 0;
    return { targets, callPocket: !!state.settings.callEight && onEight };
  },

  resolve(state, ev, world, shot) {
    const s = structuredClone(state);
    s.shotNo++;
    const p = s.turn, o = 1 - p;
    const me = s.seats[p].name, opp = s.seats[o].name;
    const pre = preShotOn(world, ev);
    const potted = ev.pocketed.map((e) => e.id).filter((id) => id !== 0);
    const cueIn = ev.pocketed.some((e) => e.id === 0);
    const myG = s.groups[p];
    const onEight = !!myG && ![...pre].some((id) => groupOf(id) === myG);
    const wasBreak = s.isBreak;
    const msgs = [];

    let foul = null;
    if (cueIn) foul = 'la blanca entró en tronera';
    else if (ev.firstHit === null) foul = 'no tocó ninguna bola';
    else if (!wasBreak) {
      if (!myG && ev.firstHit === 8) foul = 'con la mesa abierta no se puede tocar primero la 8';
      else if (myG && !onEight && groupOf(ev.firstHit) !== myG) foul = `tocó primero una bola ${ev.firstHit === 8 ? 'negra' : GROUP_NAME[other(myG)].slice(0, -1)}`;
      else if (onEight && ev.firstHit !== 8) foul = 'debía tocar primero la 8';
      else if (!potted.length && !ev.railAfterContact) foul = 'ninguna bola tocó banda tras el contacto';
    }

    if (potted.includes(8)) {
      if (wasBreak) {
        respot(world, 8);
        msgs.push('La 8 entró en el saque y vuelve al punto de pie.');
      } else {
        const p8 = ev.pocketed.find((e) => e.id === 8).p;
        const callOk = !s.settings.callEight || shot.call === p8;
        if (onEight && !foul && callOk) {
          s.over = { winner: p, text: `${me} mete la 8 y gana la partida` };
        } else {
          const why = foul ? `metió la 8 con falta (${foul})`
            : !onEight ? 'metió la 8 antes de tiempo'
              : 'la 8 entró en otra tronera';
          s.over = { winner: o, text: `${me} ${why}. Gana ${opp}` };
        }
        s.log = s.over.text;
        return { state: s, foul, msg: s.log };
      }
    }

    if (!myG && !wasBreak && !foul) {
      const first = potted.find((id) => groupOf(id));
      if (first) {
        s.groups[p] = groupOf(first);
        s.groups[o] = other(s.groups[p]);
        msgs.push(`${me} juega con ${GROUP_NAME[s.groups[p]]}.`);
      }
    }

    const g = s.groups[p];
    let cont = false;
    if (!foul) {
      if (wasBreak) cont = potted.length > 0;
      else if (g) cont = potted.some((id) => groupOf(id) === g);
    }
    s.isBreak = false;
    if (foul) {
      s.turn = o;
      s.ballInHand = 'anywhere';
      if (cueIn) placeCue(world, 'anywhere');
      msgs.unshift(`Falta de ${me}: ${foul}.`);
      msgs.push(`Bola en mano para ${opp}.`);
    } else if (cont) {
      s.ballInHand = null;
      if (!msgs.length) msgs.push(`${me} sigue tirando.`);
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
    s.turn = 1 - p;
    s.ballInHand = 'anywhere';
    s.isBreak = false;
    if (!world.ball(0).on) placeCue(world, 'anywhere');
    s.log = `${s.seats[p].name} agotó el tiempo. Bola en mano para ${s.seats[s.turn].name}.`;
    return { state: s, foul: 'tiempo', msg: s.log };
  },

  hud(state, world) {
    return state.seats.map((seat, i) => {
      const g = state.groups[i];
      const balls = g ? remaining(world, g) : [];
      return {
        sub: g ? GROUP_NAME[g][0].toUpperCase() + GROUP_NAME[g].slice(1) : 'Mesa abierta',
        balls: g && !balls.length && world.ball(8)?.on ? [8] : balls,
      };
    });
  },
};
