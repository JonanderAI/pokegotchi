// El escenario deja de ser un rectángulo plano y pasa a ser un suelo visto en
// perspectiva, como el overworld de los juegos: la cámara mira desde algo de
// altura, así que lo que está al fondo se ve más arriba, más pequeño y más
// estrecho. Los sprites siguen siendo pixel art de frente (billboards), que es
// justo como lo hacen los juegos.
//
// Coordenadas del mundo:
//   u ∈ [0,1]  de izquierda a derecha del suelo
//   v ∈ [0,1]  de fondo (0) a primer plano (1)

// El punto de fuga queda por encima del encuadre (ratio negativo): así el suelo
// llena la ventana entera en vez de verse como una alfombra flotando, que es
// como se encuadra el overworld de los juegos.
const HORIZON_RATIO = -0.45;
const D_NEAR = 1;           // distancia de cámara al borde delantero del suelo
const D_FAR = 2.3;          // ...y al fondo
const EDGE_MARGIN = 0.04;   // margen para que nadie pise el borde exacto

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

// Todo (posición en pantalla, tamaño y ancho del suelo) sale de la misma
// división por la distancia, así que suelo y sprites siempre encajan.
//
// `bottom` es dónde cae el borde delantero de la zona que pisa el Pokémon
// (v = 1). No tiene por qué ser el borde de la ventana: dejando hueco debajo,
// la franja por la que se mueve queda centrada en pantalla en vez de pegada
// abajo, que es lo que hace que la cámara parezca apuntarle a él.
export function createProjection(width, height, opts = {}) {
  const bottom = opts.bottom ?? height;
  const horizon = height * (opts.horizonRatio ?? HORIZON_RATIO);
  const depthGain = (bottom - horizon) * D_NEAR; // y = horizon + depthGain / d

  const yFor = (d) => horizon + depthGain / d;
  // v puede salirse de [0,1]: el suelo se dibuja más allá de la zona pisable
  // para que llegue hasta los bordes de la ventana.
  const depthFor = (v) => D_NEAR + (1 - v) * (D_FAR - D_NEAR);

  return {
    width,
    height,
    horizon,
    yFor,
    depthFor,

    // Punto del suelo -> pantalla. `scale` es lo que hay que encoger un sprite
    // colocado ahí para que parezca que está a esa distancia.
    // u fuera de [0,1] es suelo que se sale del encuadre: se usa para dibujar
    // el terreno más allá de los bordes.
    project(u, v) {
      const d = depthFor(v);
      const k = D_NEAR / d;
      const halfW = (width / 2) * k * (1 - EDGE_MARGIN);
      return { x: width / 2 + (u * 2 - 1) * halfW, y: yFor(d), scale: k };
    },

    // Pantalla -> punto del suelo (para soltar cosas donde toque el dedo).
    unproject(x, y) {
      const clampedY = Math.min(Math.max(y, yFor(D_FAR) + 1), yFor(D_NEAR));
      const d = depthGain / (clampedY - horizon);
      const k = D_NEAR / d;
      const halfW = (width / 2) * k * (1 - EDGE_MARGIN);
      return {
        u: clamp01(((x - width / 2) / halfW + 1) / 2),
        v: clamp01(1 - (d - D_NEAR) / (D_FAR - D_NEAR)),
      };
    },

    // Quien está más cerca tapa a quien está más lejos.
    layerFor(v) {
      return 10 + Math.round(clamp01(v) * 100);
    },
  };
}

// Hasta dónde puede llegar de lado un sprite de `spriteWidth` sin que se le
// corte nada: cuanto más cerca de la cámara está, más grande se ve y antes
// topa con el borde de la pantalla.
export function uRangeFor(proj, v, spriteWidth) {
  const { scale } = proj.project(0.5, v);
  const half = (spriteWidth * quantizeScale(scale)) / 2;
  const halfFloor = (proj.width / 2) * scale * (1 - EDGE_MARGIN);
  const margin = (proj.width / 2 - half) / (2 * halfFloor);
  return {
    min: Math.max(0, 0.5 - margin),
    max: Math.min(1, 0.5 + margin),
  };
}

// Un paso "de verdad" mide siempre lo mismo sobre el suelo, así que al fondo se
// ve más corto en pantalla, que es lo que vende la perspectiva.
export const STEP_U = 0.055;
export const STEP_V = 0.05;

// La escala se redondea a saltos para que el pixel art no hierva al moverse.
export function quantizeScale(scale) {
  return Math.max(0.35, Math.round(scale * 12) / 12);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Rejilla del suelo: líneas a distancia constante (paralelas al horizonte) y
// líneas que se van juntando hacia el punto de fuga. Se dibujan con la misma
// proyección que los sprites, así que pisan donde deben.
export function buildFloor(proj) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'world-floor');
  svg.setAttribute('viewBox', `0 0 ${proj.width} ${proj.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  // El terreno se dibuja mucho más ancho y más adelante que la zona pisable,
  // para que no se le vean los lados ni el borde de delante: solo el del fondo.
  const U_MIN = -3;
  const U_MAX = 4;
  const V_NEAR = 1.6;

  const far = proj.project(U_MIN, 0);
  const farRight = proj.project(U_MAX, 0);
  const near = proj.project(U_MIN, V_NEAR);
  const nearRight = proj.project(U_MAX, V_NEAR);

  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.innerHTML = `
    <linearGradient id="floor-fade" x1="0" y1="${far.y}" x2="0" y2="${near.y}" gradientUnits="userSpaceOnUse">
      <stop offset="0" class="floor-far" />
      <stop offset="1" class="floor-near" />
    </linearGradient>
    <linearGradient id="floor-haze-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="haze-top" />
      <stop offset="0.45" class="haze-mid" />
      <stop offset="1" class="haze-bottom" />
    </linearGradient>`;
  svg.appendChild(defs);

  const ground = document.createElementNS(SVG_NS, 'polygon');
  ground.setAttribute('class', 'floor-fill');
  ground.setAttribute('points', [
    `${far.x},${far.y}`,
    `${farRight.x},${farRight.y}`,
    `${nearRight.x},${nearRight.y}`,
    `${near.x},${near.y}`,
  ].join(' '));
  svg.appendChild(ground);

  // Textura: matas sueltas repartidas por el suelo. Se colocan en coordenadas del
  // mundo y se proyectan como todo lo demás, así que al fondo salen pequeñas y
  // juntas y cerca grandes y separadas. Una trama plana encima habría matado la
  // perspectiva, que es lo único que vende que esto es un suelo.
  //
  // El reparto es pseudoaleatorio pero fijo: con Math.random las matas cambiarían
  // de sitio cada vez que se redibuja el suelo (al girar el móvil, por ejemplo).
  const patches = document.createElementNS(SVG_NS, 'g');
  patches.setAttribute('class', 'floor-patches');
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  for (let i = 0; i < 90; i += 1) {
    const u = U_MIN + rnd() * (U_MAX - U_MIN);
    const v = rnd() * V_NEAR;
    const p = proj.project(u, v);
    if (p.y < far.y) continue;             // por encima del horizonte no hay suelo

    const rx = (5 + rnd() * 11) * p.scale;
    const blob = document.createElementNS(SVG_NS, 'ellipse');
    blob.setAttribute('cx', p.x.toFixed(1));
    blob.setAttribute('cy', p.y.toFixed(1));
    blob.setAttribute('rx', rx.toFixed(1));
    blob.setAttribute('ry', (rx * 0.42).toFixed(1));
    blob.setAttribute('opacity', (0.5 + rnd() * 0.5).toFixed(2));
    patches.appendChild(blob);
  }
  svg.appendChild(patches);

  // Neblina donde el suelo se junta con el fondo, para que el borde del terreno
  // no se vea como un corte recto.
  const haze = document.createElementNS(SVG_NS, 'rect');
  haze.setAttribute('class', 'floor-haze');
  haze.setAttribute('x', '0');
  haze.setAttribute('y', (far.y - proj.height * 0.06).toFixed(1));
  haze.setAttribute('width', String(proj.width));
  haze.setAttribute('height', (proj.height * 0.14).toFixed(1));
  svg.appendChild(haze);

  return svg;
}

// Coloca un actor (mascota o Pokémon salvaje) sobre el suelo. El punto de
// apoyo es el de su sombra, así que se escala desde ahí: los pies se quedan
// clavados en el suelo pase lo que pase.
export function placeActor(wrapEl, proj, pos, foot) {
  const p = proj.project(pos.u, pos.v);
  const scale = quantizeScale(p.scale);
  wrapEl.style.left = `${(p.x - foot.x).toFixed(1)}px`;
  wrapEl.style.top = `${(p.y - foot.y).toFixed(1)}px`;
  wrapEl.style.transformOrigin = `${foot.x.toFixed(1)}px ${foot.y.toFixed(1)}px`;
  wrapEl.style.transform = `scale(${scale})`;
  wrapEl.style.zIndex = String(proj.layerFor(pos.v));
}

// Lo mismo para cosas sueltas que no tienen sombra medida (bayas, restos). La
// escala va en una variable CSS en vez de en el transform: así las animaciones
// (el botecito de la baya, los mordiscos) pueden componerla sin perderla.
export function placeProp(el, proj, pos, size) {
  const p = proj.project(pos.u, pos.v);
  el.style.setProperty('--depth-scale', quantizeScale(p.scale).toFixed(3));
  el.style.left = `${(p.x - size / 2).toFixed(1)}px`;
  el.style.top = `${(p.y - size).toFixed(1)}px`;
  el.style.zIndex = String(proj.layerFor(pos.v));
}
