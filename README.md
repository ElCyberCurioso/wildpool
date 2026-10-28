# WildPool

Billar en el navegador para jugar con amigos: salas privadas con enlace de invitación, chat dentro de la sala, cinco modos de juego, CPU con tres niveles y personalización de taco, mesa y bolas. Es un sitio 100 % estático, listo para GitHub Pages: sin backend, sin build y sin dependencias que instalar.

## Desplegar en GitHub Pages

1. Crea un repositorio (por ejemplo `WildPool`) y sube **el contenido** de esta carpeta a la raíz de la rama `main`.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. En un par de minutos estará en `https://TU_USUARIO.github.io/WildPool/`.

El archivo `.nojekyll` evita que GitHub procese el sitio con Jekyll.

## Probar en local

Los módulos ES no funcionan abriendo `index.html` con doble clic (`file://`). Sirve la carpeta con cualquier servidor estático:

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

Para probar el multijugador sin depender del servidor público de PeerJS, levanta uno local y añade `?peer=127.0.0.1:9000` a la URL (solo se acepta cuando la página se sirve desde `localhost`):

```bash
npx peer --port 9000
```

## Qué incluye

**Modos de juego**

| Modo | Jugadores | Resumen |
|---|---|---|
| Bola 8 | 2 | Lisas contra rayadas, mesa abierta tras el saque, cantar tronera para la 8 (opcional). Faltas con bola en mano. |
| Bola 9 | 2 | Siempre hay que tocar primero la bola más baja; quien mete la 9 legalmente gana. Tres faltas seguidas pierden (opcional). |
| Killer | 2–8 | Un tiro por turno; si no metes, pierdes una vida. La 8 da vida extra (opcional). Nuevo triángulo cuando se vacía la mesa. |
| Carambola | 2 | Mesa sin troneras, variantes libre y tres bandas, partida a 5/10/15/25 puntos. |
| Mesa libre | 1–8 | Sin faltas ni grupos, para practicar o tirar por turnos. |

**Online (salas privadas)**

- *Crear sala privada* genera un código de 6 caracteres. El botón *Copiar enlace* da una URL con `?sala=CÓDIGO`: quien la abre entra directamente en la sala (si no tiene nombre guardado, se le pide uno y entra).
- Contraseña opcional, expulsar jugadores, elegir entre jugar o mirar, modo y reglas, tiempo por tiro (30/45/60 s) y tipo de línea de guía.
- Chat en la sala y durante la partida, con frases rápidas y límite anti-spam.
- Si un jugador se desconecta en mitad de la partida tiene 60 s para volver (recargar la página le devuelve a su asiento). Revancha y vuelta a la sala al terminar.
- Los espectadores ven el apuntado del jugador en tiempo real.

**En este dispositivo**: contra la CPU (Bola 8, Bola 9 o Killer contra hasta 3 CPU; fácil, media o difícil), dos jugadores en la misma pantalla y práctica.

**Personalización** (se guarda en el navegador): 10 tacos (clásico, carbono, cebra, tigre, leopardo, selva, llamas, neón, hielo, oro negro), 8 tapetes, 6 maderas, 5 acabados de troneras y diamantes, 5 juegos de bolas, avatar y sonido. Tu taco y tu avatar los ven los demás jugadores de la sala.

## Controles

- **Ratón**: mueve para apuntar; pulsa, arrastra hacia atrás y suelta para tirar. Rueda o flechas ←/→ para el ajuste fino (Mayús para ir más rápido); ↑/↓ y Enter también sirven para potencia y tiro.
- **Táctil**: toca o arrastra sobre la mesa para apuntar; usa la barra de potencia (arrastra y suelta). Botones ‹ › para el ajuste fino.
- **Efecto**: toca la bola pequeña. Arriba sigue, abajo retrocede, a los lados cambia el rebote en banda. Doble clic la centra.
- **Bola en mano**: arrastra la blanca. En el saque solo detrás de la línea.
- Mantén pulsada la mesa mientras ruedan las bolas para acelerar la animación.
- En vertical la mesa gira para aprovechar la pantalla del móvil.

## Cómo funciona por dentro

- **Física propia y determinista** (`js/physics.js`): pasos fijos de 1/120 s con subpasos según la velocidad, contacto exacto bola-bola, mandíbulas de tronera reales, efecto alto/bajo/lateral. El bucle solo usa `+ − × ÷` y `Math.sqrt`, que IEEE-754 garantiza idénticos en todos los navegadores, así que cada cliente reproduce el mismo tiro.
- **Red P2P con PeerJS** (`js/net.js`): el anfitrión de la sala es la autoridad. Los invitados solo envían intenciones (apuntado y tiro); el anfitrión las valida, simula el resultado, aplica las reglas y lo reparte. Cada cliente anima el tiro localmente y al final se sincroniza con la posición oficial.
- **Render** (`js/render.js`): canvas 2D con las bolas sombreadas píxel a píxel y orientación 3D, así que los números y las rayas ruedan de verdad. Tacos y mesa se dibujan por código; no hay imágenes externas.
- **CPU** (`js/ai.js`): genera tiros con bola fantasma hacia cada tronera, los simula con el mismo motor y elige el mejor según el resultado y la posición que deja; el nivel controla cuántos tiros evalúa y cuánto error añade.

```
index.html          estructura de pantallas
css/style.css       estilos
js/main.js          interfaz: inicio, personalización, sala y partida
js/gameview.js      pantalla de juego: animación, apuntado, marcador
js/physics.js       motor físico
js/match.js         autoridad de la partida (valida y resuelve tiros)
js/rules/*.js       reglas de cada modo
js/net.js           salas P2P (anfitrión e invitado)
js/session-local.js partidas en este dispositivo
js/ai.js            CPU
js/render.js        dibujo de mesa, bolas y tacos
js/cosmetics.js     catálogo de personalización y preferencias
js/audio.js         sonidos sintetizados (WebAudio)
js/config.js        servidor de señalización y STUN/TURN
js/vendor/          PeerJS 1.5.5 (MIT) incluido en el repo
```

## Red, privacidad y seguridad

- **Señalización**: por defecto se usa el servidor público gratuito de PeerJS (`0.peerjs.com`) solo para que los navegadores se encuentren. La partida y el chat van directos entre jugadores por WebRTC (cifrado DTLS). Para no depender de él, monta tu servidor (`npx peer`) y configúralo en `js/config.js`.
- **NAT estrictas**: PeerJS trae STUN/TURN por defecto. Si alguien no consigue conectar desde redes corporativas o móviles con CG-NAT, añade tu propio TURN en `js/config.js`.
- **IP visibles**: como en cualquier WebRTC P2P, los participantes de una sala pueden ver la IP de los demás (en concreto, la del anfitrión). Juega con gente de confianza.
- **El anfitrión manda**: valida todo lo que llega (tipos, rangos numéricos, turno, colocación de la blanca, longitud de nombres y mensajes, ritmo de mensajes) y nada se interpreta como HTML (el chat se pinta con `textContent`). Lo que no puede evitarse sin un servidor propio es que un anfitrión con el código modificado haga trampas en su propia sala.
- **Contraseña**: la comprueba el anfitrión en memoria; no se guarda en ningún servidor. El invitado la recuerda solo en la pestaña (sessionStorage) para reconectar.
- **Si el anfitrión cierra la pestaña, la sala desaparece.** Los invitados que recargan vuelven a su asiento durante 60 s.
- Los códigos de sala usan `crypto.getRandomValues` sobre un alfabeto sin caracteres confusos (31⁶ ≈ 887 millones de combinaciones).

## Licencias

El código de WildPool es tuyo. PeerJS se distribuye bajo licencia MIT (`js/vendor/PEERJS-LICENSE`). Las fuentes (Shrikhand y Barlow Semi Condensed) se cargan desde Google Fonts con licencia OFL.
