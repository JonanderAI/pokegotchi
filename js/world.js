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

// --- cielo -------------------------------------------------------------------
//
// El cielo va con la hora del reloj de verdad, no con el día del juego: es lo
// que hace que abrir el juego de noche se sienta de noche.
//
// Está dibujado, no es un sprite: un degradado vertical, el sol (o la luna) con
// su halo y sus rayos, y nubes hechas de círculos solapados, que es como se ven
// las de los juegos de Game Boy Advance. Así se puede teñir entero según la hora
// sin tener una imagen por cada momento del día.

// De arriba del cielo a la línea del horizonte, más el color del astro y el de
// las nubes, que al atardecer se tiñen igual que todo lo demás.
const SKY_PALETTES = [
  { at: 0,  name: 'noche',     top: '#141a3c', mid: '#232a5c', low: '#3a4076', sun: '#e8ecff', cloud: '#5b64a0', night: true },
  { at: 5,  name: 'amanecer',  top: '#38407e', mid: '#8a6a97', low: '#e8a184', sun: '#ffe6c2', cloud: '#c9a8bb' },
  { at: 7,  name: 'alba',      top: '#6d9fda', mid: '#a9bfe4', low: '#f7cfa8', sun: '#fff4d6', cloud: '#ffffff' },
  { at: 9,  name: 'mañana',    top: '#3f8fdc', mid: '#79b6ea', low: '#c7e4f7', sun: '#ffffff', cloud: '#ffffff' },
  { at: 13, name: 'mediodía',  top: '#2f80d8', mid: '#67abe8', low: '#c2e2f6', sun: '#ffffff', cloud: '#ffffff' },
  { at: 18, name: 'tarde',     top: '#3f74c4', mid: '#9b9ccb', low: '#f5bd92', sun: '#fff0c8', cloud: '#f0dbdb' },
  { at: 20, name: 'ocaso',     top: '#2f3c78', mid: '#7d5590', low: '#e2865f', sun: '#ffd9a0', cloud: '#b98ea0' },
  { at: 22, name: 'anochecer', top: '#1a2049', mid: '#2b3364', low: '#474e88', sun: '#dfe4ff', cloud: '#6c74ab', night: true },
];

// La paleta que toca a esta hora.
export function skyPaletteFor(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  let pick = SKY_PALETTES[0];
  SKY_PALETTES.forEach((p) => { if (hour >= p.at) pick = p; });
  return pick;
}

// Dónde está el sol: sale por la izquierda a las 6, está arriba a las 13 y se
// pone por la derecha a las 20. De noche es la luna, y hace el mismo recorrido.
function sunPosition(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  const day = hour >= 6 && hour < 20;
  const from = day ? 6 : 20;
  const span = day ? 14 : 10;
  const t = (((hour - from) + 24) % 24) / span;   // 0 al salir, 1 al ponerse
  return {
    x: 0.12 + t * 0.76,
    // arco: alto en medio del recorrido, bajo en los extremos
    y: 0.72 - Math.sin(Math.PI * Math.min(1, Math.max(0, t))) * 0.55,
    day,
  };
}

// Una nube: bolas solapadas sobre una base plana, que es exactamente cómo están
// hechas las de los juegos. Cada una se monta con un número distinto de bolas y
// con los tamaños repartidos a ojo, no con una plantilla fija: si todas llevan
// las mismas cuatro bolas en los mismos sitios, se nota enseguida que es la
// misma nube repetida.
function cloudShape(cx, cy, w, color, opacity, rnd) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('fill', color);
  g.setAttribute('opacity', opacity.toFixed(2));

  const h = w * (0.34 + rnd() * 0.16);
  const puffs = 4 + Math.floor(rnd() * 4);

  for (let i = 0; i < puffs; i += 1) {
    // repartidas a lo ancho, las de en medio más altas y más gordas
    const t = (i + rnd() * 0.7) / puffs;          // 0 a 1 de izquierda a derecha
    const centro = 1 - Math.abs(t - 0.5) * 2;      // 1 en el medio, 0 en las puntas
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', (cx + (t - 0.5) * w).toFixed(1));
    c.setAttribute('cy', (cy - centro * h * (0.18 + rnd() * 0.22)).toFixed(1));
    c.setAttribute('r', (h * (0.42 + centro * 0.5 + rnd() * 0.18)).toFixed(1));
    g.appendChild(c);
  }

  // la base recta, que es lo que las hace nube y no un montón de bolas
  const base = document.createElementNS(SVG_NS, 'rect');
  base.setAttribute('x', (cx - w / 2).toFixed(1));
  base.setAttribute('y', cy.toFixed(1));
  base.setAttribute('width', w.toFixed(1));
  base.setAttribute('height', (h * 0.5).toFixed(1));
  base.setAttribute('rx', (h * 0.22).toFixed(1));
  g.appendChild(base);

  return g;
}

export function buildSky(proj, palette = skyPaletteFor(), now = new Date()) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'world-sky');
  svg.setAttribute('viewBox', `0 0 ${proj.width} ${proj.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.dataset.sky = palette.name;

  const horizon = proj.project(0.5, 0).y;
  const W = proj.width;

  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.innerHTML = `
    <linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="${horizon}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${palette.top}" />
      <stop offset="0.55" stop-color="${palette.mid}" />
      <stop offset="1" stop-color="${palette.low}" />
    </linearGradient>
    <radialGradient id="sun-halo">
      <stop offset="0" stop-color="${palette.sun}" stop-opacity="0.85" />
      <stop offset="0.45" stop-color="${palette.sun}" stop-opacity="0.25" />
      <stop offset="1" stop-color="${palette.sun}" stop-opacity="0" />
    </radialGradient>`;
  svg.appendChild(defs);

  // El fondo se pinta mucho más grande que el encuadre, igual que el terreno: al
  // alejar la cámara la capa se encoge, y si el cielo midiera justo su caja
  // asomaría el vacío por los lados. El degradado va en coordenadas del mundo,
  // así que por encima del cielo se prolonga con el color de arriba.
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(-W));
  bg.setAttribute('y', String(-proj.height));
  bg.setAttribute('width', String(W * 3));
  bg.setAttribute('height', String(proj.height * 3));
  bg.setAttribute('fill', 'url(#sky-grad)');
  svg.appendChild(bg);

  // De noche, unas estrellas quietas.
  if (palette.night) {
    let seed = 90210;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const stars = document.createElementNS(SVG_NS, 'g');
    stars.setAttribute('class', 'sky-stars');
    stars.setAttribute('fill', '#ffffff');
    for (let i = 0; i < 40; i += 1) {
      const st = document.createElementNS(SVG_NS, 'rect');
      st.setAttribute('x', (rnd() * W).toFixed(1));
      st.setAttribute('y', (rnd() * horizon * 0.8).toFixed(1));
      st.setAttribute('width', '2');
      st.setAttribute('height', '2');
      st.setAttribute('opacity', (0.25 + rnd() * 0.6).toFixed(2));
      stars.appendChild(st);
    }
    svg.appendChild(stars);
  }

  // El sol (o la luna): halo, disco y unos rayos cortos.
  const pos = sunPosition(now);
  const sx = pos.x * W;
  const sy = pos.y * horizon;
  const r = Math.max(9, W * 0.032);

  const halo = document.createElementNS(SVG_NS, 'circle');
  halo.setAttribute('cx', sx.toFixed(1));
  halo.setAttribute('cy', sy.toFixed(1));
  halo.setAttribute('r', (r * 4.5).toFixed(1));
  halo.setAttribute('fill', 'url(#sun-halo)');
  svg.appendChild(halo);

  if (pos.day) {
    const rays = document.createElementNS(SVG_NS, 'g');
    rays.setAttribute('class', 'sky-rays');
    rays.setAttribute('stroke', palette.sun);
    rays.setAttribute('stroke-width', '2');
    rays.setAttribute('stroke-linecap', 'round');
    rays.setAttribute('opacity', '0.75');
    rays.style.transformOrigin = `${sx.toFixed(1)}px ${sy.toFixed(1)}px`;
    for (let i = 0; i < 8; i += 1) {
      const a = (i * Math.PI) / 4;
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', (sx + Math.cos(a) * r * 1.5).toFixed(1));
      line.setAttribute('y1', (sy + Math.sin(a) * r * 1.5).toFixed(1));
      line.setAttribute('x2', (sx + Math.cos(a) * r * (i % 2 ? 2.2 : 2.8)).toFixed(1));
      line.setAttribute('y2', (sy + Math.sin(a) * r * (i % 2 ? 2.2 : 2.8)).toFixed(1));
      rays.appendChild(line);
    }
    svg.appendChild(rays);
  }

  const disc = document.createElementNS(SVG_NS, 'circle');
  disc.setAttribute('cx', sx.toFixed(1));
  disc.setAttribute('cy', sy.toFixed(1));
  disc.setAttribute('r', r.toFixed(1));
  disc.setAttribute('fill', palette.sun);
  svg.appendChild(disc);

  // Nubes por todo el cielo, sueltas y no en filas.
  //
  // Van en cuatro capas de profundidad, pero las alturas se solapan de sobra y
  // dentro de su tramo cada nube cae donde le toca, así que no se leen como
  // líneas. Las de arriba son las cercanas: más grandes, más opacas y más
  // rápidas; las de junto al horizonte, pequeñas, lavadas y lentas.
  //
  // Cada capa se dibuja cuatro veces seguidas, de -1 a +2 anchos de pantalla: la
  // cámara se puede ir a la izquierda del encuadre y allí también tiene que
  // haber cielo. El bucle desplaza exactamente un ancho, así que al terminar la
  // vuelta el dibujo coincide consigo mismo y no se ve la costura.
  const clouds = document.createElementNS(SVG_NS, 'g');
  clouds.setAttribute('class', 'sky-clouds');

  let seed = 4242;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

  const LAYERS = 4;
  const PASSES = [-1, 0, 1, 2];

  for (let l = 0; l < LAYERS; l += 1) {
    const cerca = 1 - l / (LAYERS - 1);            // 1 la de delante, 0 la del fondo
    const band = document.createElementNS(SVG_NS, 'g');
    band.setAttribute('class', 'sky-cloud-row');
    // las cercanas cruzan antes; las del fondo casi ni se mueven
    band.style.setProperty('--drift', `${Math.round(150 + (1 - cerca) * 320)}s`);
    band.style.setProperty('--shift', `${W}px`);

    // tramo de altura de esta capa, con solape generoso entre capas
    const desde = horizon * (0.03 + l * 0.20);
    const hasta = horizon * (0.22 + l * 0.20);

    // cuántas caben en un ancho de pantalla: al azar, pero pocas
    const cuantas = 2 + Math.floor(rnd() * 3);
    const semilla = seed;

    PASSES.forEach((pass) => {
      seed = semilla;                              // el mismo cielo en cada pasada
      for (let i = 0; i < cuantas; i += 1) {
        const w = W * (0.08 + cerca * 0.14) * (0.7 + rnd() * 0.6);
        const cx = rnd() * W + pass * W;
        // sin bajar de aquí: por debajo se meterían en el suelo
        const cy = Math.min(desde + rnd() * (hasta - desde), horizon * 0.82);
        const op = (0.3 + cerca * 0.42) * (0.75 + rnd() * 0.3);
        band.appendChild(cloudShape(cx, cy, w, palette.cloud, Math.min(1, op), rnd));
      }
    });

    clouds.appendChild(band);
  }
  svg.appendChild(clouds);

  return svg;
}

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
      <stop offset="1" class="haze-bottom" />
    </linearGradient>
`;
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

  // La costura entre cielo y suelo: sin esto se ve la línea recta donde acaba
  // uno y empieza el otro. Va del color del cielo a esa hora (lo pone la propia
  // capa del cielo en --horizon-color) a transparente, y tan ancha como el
  // terreno: midiendo justo la ventana quedaba flotando al alejar la cámara.
  const haze = document.createElementNS(SVG_NS, 'rect');
  haze.setAttribute('class', 'floor-haze');
  haze.setAttribute('x', String(-proj.width));
  haze.setAttribute('y', far.y.toFixed(1));
  haze.setAttribute('width', String(proj.width * 3));
  haze.setAttribute('height', (proj.height * 0.05).toFixed(1));
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
