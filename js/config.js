// Configuración de red de WildPool.
//
// Por defecto se usa el servidor público de señalización de PeerJS (0.peerjs.com)
// y sus servidores STUN/TURN. Solo sirve para que los navegadores se encuentren:
// la partida y el chat viajan después directamente entre jugadores (WebRTC, cifrado DTLS).
//
// Si quieres tu propio servidor (npx peer --port 9000), rellena `peer`, por ejemplo:
//   peer: { host: 'peer.midominio.com', port: 443, path: '/', secure: true },
// Y si algunos jugadores no consiguen conectar (NAT estrictas), añade tu TURN en iceServers.
export const NET = {
  peer: {},
  iceServers: null, // p. ej. [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'turn:...', username: '...', credential: '...' }]
  idPrefix: 'wildpool-v1-',
  maxMembers: 10,
};

export const PROTOCOL = 1;
