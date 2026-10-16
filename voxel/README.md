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
| M | Mapa y viaje rápido entre balizas · P / Esc: pausa · N: sonido |

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
| `bake`, `jobs`, `world` | Malla de cada chunk con **luz horneada por vértice** (cielo, luna, farolas trazadas contra vóxeles reales, oclusión ambiental) en un Web Worker; si no hay workers, en el hilo principal a trozos |
| `far` | Horizonte lejano de baja resolución, para que el borde del mundo nunca se vea |
| `render`, `shaders` | Niebla de altura integrada, HDR, bloom, ACES y gradación, FXAA; lluvia, agua, haz de la Batseñal |
| `phys`, `player`, `anim` | Colisión AABB contra vóxeles con escalón; planeo, garfio, combos; esqueleto humanoide con capa de resortes |
| `models`, `fx` | Personajes de vóxeles con AO horneado; partículas y proyectiles |
| `enemies`, `bosses` | Bandas por hash del mapa, IA con avisos legibles; los dos jefes en tres fases |
| `props`, `ui`, `audio`, `input`, `game` | Balizas y objetivos, HUD, música y efectos sintetizados, teclado/ratón/táctil/mando, bucle |

## Herramientas (`voxel/demo/`)

- `verify.js` — la batería completa en un navegador real: arranque, bucle real, todos los estados, planes B (sin WebGL2, sin Workers) y las dos disposiciones táctiles.
- `sim.js` + `feel.js` — **todo el juego bajo Node, sin GPU**: mide cómo se siente (velocidad, salto, planeo, garfio, combate).
- `soak.js` — un bot de entrada aleatoria juega minutos por toda la ciudad buscando excepciones, NaN y cuerpos dentro de sólidos.
- `boss-smoke.js`, `phys-test.js` — guiones de los jefes y física sobre la ciudad real.
- `vshot.js`, `vtour.js`, `vplay.js`, `vlive.js` — capturas deterministas: escenas libres, un recorrido por los lugares, escenarios de juego, y el bucle real con teclas reales.
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
