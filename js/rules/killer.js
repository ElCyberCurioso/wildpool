import { rack8, baseState, placeCue, nextAlive, objectBallsOn } from './common.js';

export default {
  id: 'killer',
  name: 'Killer',
  blurb: 'De 2 a 8 jugadores. Un tiro cada uno: si no metes, pierdes una vida.',
  table: 'pool',
  min: 2,
  max: 8,
  options: [
    { key: 'lives', label: 'Vidas', type: 'select', def: 3, choices: [[2, '2'], [3, '3'], [4, '4'], [5, '5']] },
    { key: 'eightLife', label: 'Meter la 8 da una vida extra', type: 'bool', def: true },
  ],

  initialState(seats, settings) {
    const s = baseState('killer', seats, settings);
    const lives = Number(settings.lives) || 3;
    s.lives = seats.map(() => lives);
    s.turn = 0;
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
    const foul = ev.timeout ? 'se le acabó el tiempo' : cueIn ? 'la blanca entró en tronera' : ev.firstHit === null ? 'no tocó ninguna bola' : null;
    const success = !foul && potted.length > 0;
    const maxLives = (Number(s.settings.lives) || 3) + 2;
    const msgs = [];

    if (success) {
      msgs.push(`${me} mete ${potted.length > 1 ? potted.length + ' bolas' : 'la ' + potted[0]}.`);
      if (s.settings.eightLife && potted.includes(8) && s.lives[p] < maxLives) {
        s.lives[p]++;
        msgs.push(`¡La 8 le da una vida extra!`);
      }
    } else {
      s.lives[p]--;
      msgs.push(foul ? `Falta de ${me}: ${foul}.` : `${me} no mete nada.`);
      if (s.lives[p] <= 0) {
        s.seats[p].alive = false;
        msgs.push(`${me} queda eliminado.`);
      } else {
        msgs.push(s.lives[p] > 1 ? `Le quedan ${s.lives[p]} vidas.` : 'Le queda 1 vida.');
      }
    }

    const alive = s.seats.map((x, i) => (x.alive ? i : -1)).filter((i) => i >= 0);
    if (alive.length <= 1) {
      const w = alive.length ? alive[0] : p;
      s.over = { winner: w, text: `${s.seats[w].name} es el último en pie y gana` };
      s.log = s.over.text;
      return { state: s, foul, msg: s.log };
    }

    s.turn = nextAlive(s, p);
    s.isBreak = false;
    s.ballInHand = null;
    if (!objectBallsOn(world).length) {
      rack8(world);
      s.ballInHand = 'kitchen';
      s.isBreak = true;
      msgs.push('Mesa vacía: nuevo triángulo.');
    } else if (foul) {
      s.ballInHand = 'anywhere';
      if (cueIn) placeCue(world, 'anywhere');
    }
    msgs.push(`Turno de ${s.seats[s.turn].name}.`);
    s.log = msgs.join(' ');
    return { state: s, foul, msg: s.log };
  },

  timeout(state, world) {
    return this.resolve(state, { pocketed: [], firstHit: null, cueId: 0, timeout: true }, world);
  },

  hud(state) {
    return state.seats.map((seat, i) => ({
      sub: seat.alive ? `${state.lives[i]} vida${state.lives[i] === 1 ? '' : 's'}` : 'Eliminado',
      lives: state.lives[i],
      out: !seat.alive,
      balls: [],
    }));
  },
};
