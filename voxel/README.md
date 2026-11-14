# Gotham — mundo abierto de vóxeles

Una ciudad nocturna e infinita hecha de bloques, con Batman, el Joker y el Pingüino. Es un juego
3D completo en **WebGL2 puro**: sin librerías, sin imágenes, sin sonidos grabados. Todo (la ciudad,
los personajes, la luz, la música) se genera con código.

`index.html` es el juego autónomo; `artifact.html` es el mismo juego como fragmento para el
visor de artefactos. Los dos salen de `node voxel/build.js` a partir de `voxel/src/`.

## Cómo se juega

| | |
|---|---|
| WASD / stick | Mover · Shift: correr |
| Ratón / arrastrar | Cámara |
| Espacio | Saltar · **en el aire, otra vez: planear** (la capa; la cámara dirige el vuelo) |
| E | **Garfio**: apunta a un muro y sube hasta su cornisa |
| Clic / J | Golpear (combo de tres) · F / clic derecho: batarang · Q: esquivar |
| M | Mapa y viaje rápido entre balizas · P / Esc: pausa · N: sonido · G: calidad gráfica |

Hay ocho balizas (una por distrito, más la azotea de la comisaría), cincuenta y tantos trofeos del
Acertijo en los tejados y las torres, bandas de matones por toda la ciudad, y dos jefes con arena
propia: el **Pingüino** (Muelle Helado) y el **Joker** (Carnaval de Arkham). El progreso se guarda en
el navegador. Hay mando (stick, A, X, B, bumpers) y controles táctiles.

Los ocho niveles del juego 2D son ahora los distritos: Muelles de Gotham, Azoteas, Torre de Arkham,
Muelle Helado, Alcantarillas, Fundición de Acero, El Puente de Gotham y Carnaval de Arkham.

## Cómo está hecho

El mundo es una **función pura de (x, y, z)**: cualquier chunk de 16×16×128 se puede construir solo,
en cualquier worker y en cualquier orden, y los vecinos coinciden en las costuras. Por eso es infinito.

| Módulo | Qué hace |
|---|---|
| `worldgen`, `landmarks` | La ciudad: cuadrícula de calles, distritos, edificios analíticos, y los lugares diseñados (torre de la comisaría con la Batseñal, puente colgante, arenas, balizas, noria, grúas, fundición) |
| `bake`, `jobs`, `world` | Malla de cada chunk con **luz horneada por vértice** (visibilidad del cielo y de la luna por separado, farolas, escaparates y neones trazados contra vóxeles reales, oclusión ambiental) en un Web Worker; si no hay workers, en el hilo principal a trozos. También el mapa de refugio de la lluvia |
| `far` | Horizonte lejano de baja resolución, para que el borde del mundo nunca se vea |
| `render`, `shaders`, `sh_light`, `sh_fx`, `sh_post`, `tex` | El motor gráfico diferido (ver **Gráficos**, abajo) |
| `phys`, `player`, `anim` | Colisión AABB contra vóxeles con escalón; planeo, garfio, combos; esqueleto humanoide con capa de resortes |
| `models`, `fx` | Personajes de vóxeles con AO horneado; partículas y proyectiles |
| `enemies`, `bosses` | Bandas por hash del mapa, IA con avisos legibles; los dos jefes en tres fases |
| `props`, `ui`, `audio`, `input`, `game` | Balizas y objetivos, HUD, música y efectos sintetizados, teclado/ratón/táctil/mando, bucle |

## Gráficos

El dibujo es **diferido**: la geometría se pinta una sola vez en un G-buffer (color, normal, id de
bloque y la luz horneada) y un único pase de pantalla completa hace todo lo caro, una vez por píxel
visible.

- **Materiales procedurales** por tipo de bloque, sin una sola imagen: baldosas y juntas, ladrillo y
  mortero, grano, grietas, óxido, chapa ondulada, pintura desgastada. Salen de dos texturas de ruido
  de 256 px que se calculan al arrancar.
- **Lluvia de verdad**: el suelo expuesto tiene una película de agua y charcos con ondas; bajo un
  techo o el puente está seco (mapa de refugio por columna). Las gotas se iluminan al cruzar la luz
  de una farola y salpican donde caen.
- **Luces**: la luz difusa y sus sombras vienen horneadas; los brillos de farolas y neones se
  calculan por píxel con una rejilla de listas de luces. Explosiones y disparos iluminan la escena.
- **Reflejos en espacio de pantalla** sobre asfalto mojado, vidrio, hielo, coches y agua, con un
  panorama del cielo como respaldo.
- **Ventanas con interior** (*interior mapping*): cada ventana encendida es una habitación con su
  lámpara, muebles, persianas o cortinas. Escaparates, rótulos con letras, neones y vallas LED.
- **Luz en el aire**: el halo de cada farola y cada neón es la integral analítica de la luz
  dispersada por la niebla, cortada por la profundidad de la escena. La ciudad lejana también brilla.
- **Cielo**: dos capas de nubes iluminadas por la luna desde arriba y por la ciudad desde abajo,
  relámpagos dentro de la nube, horizonte fundido con la bruma.
- **Personajes**: sombra suave de cápsula hacia la luz que más les da, oclusión bajo los pies, luz
  de borde.
- **Posprocesado**: antialiasing temporal, bloom sin umbral en pirámide, destello anamórfico,
  adaptación del ojo, curva ACES, aberración cromática leve, nitidez y grano.

Cinco niveles de calidad (MÍNIMA, BAJA, MEDIA, ALTA, ULTRA). Por defecto el juego elige y ajusta
solo según el rendimiento real (con el tiempo de GPU cuando el navegador lo da); **G** o un clic en
el pie de la pausa lo fija a mano, y ULTRA solo se elige a mano. Sin texturas de coma flotante el
motor sigue funcionando en 8 bits, y si un controlador no compila el shader completo va quitando
funciones hasta que compila.

Aviso honesto: todo esto está probado en el renderizador por software de las herramientas (que da
la imagen exacta pero no la velocidad). El rendimiento en GPU reales lo gobierna la escalera de
calidad, no una medición hecha aquí.

## Herramientas (`voxel/demo/`)

- `verify.js` — la batería completa en un navegador real: arranque, bucle real, todos los estados, planes B (sin WebGL2, sin Workers) y las dos disposiciones táctiles.
- `sim.js` + `feel.js` — **todo el juego bajo Node, sin GPU**: mide cómo se siente (velocidad, salto, planeo, garfio, combate).
- `soak.js` — un bot de entrada aleatoria juega minutos por toda la ciudad buscando excepciones, NaN y cuerpos dentro de sólidos.
- `boss-smoke.js`, `phys-test.js` — guiones de los jefes y física sobre la ciudad real.
- `vshot.js`, `vtour.js`, `vplay.js`, `vlive.js` — capturas deterministas: escenas libres, un recorrido por los lugares, escenarios de juego, y el bucle real con teclas reales. Con antialiasing temporal un fotograma es una sola muestra, así que acumulan varios: `VX_FRAMES` (20 por defecto), `VX_Q` fija el nivel de calidad (0–4) y `VX_NOHDR=1` prueba el camino de 8 bits.
- `map.js` — mapa cenital de la ciudad sin navegador.
- `loadcore.js` — carga los módulos en un solo ámbito: medir velocidad dentro de `vm` engaña (10–50× más lento).

## El tráiler (`voxel/demo/trailer/`)

`make.sh <carpeta> [ancho alto]` graba el tráiler del juego real, fotograma a fotograma:
`director.js` (se inyecta en la página) monta cada toma, juega como un jugador y mueve una
cámara de cine; `pilot.js` vuela el planeo esquivando torres (el plan sale de `plan-glide.js`,
que prueba cientos de rutas en la simulación de Node); `capture.js` graba grupos de tomas en
paralelo y registra cada sonido con su tiempo; `score.js` + `mkscore.js` sintetizan la banda
sonora con el propio audio del juego en un `OfflineAudioContext`; `wavstat.js` mide su volumen.
Con `capture.js … --stills N` se hace un guion gráfico rápido en lugar del vídeo.
