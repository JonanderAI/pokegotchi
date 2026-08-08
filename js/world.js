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

// Una nube: círculos solapados sobre una base plana, que es exactamente cómo
// están hechas las de los juegos.
function cloudShape(cx, cy, w, color, opacity) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('fill', color);
  g.setAttribute('opacity', String(opacity));

  const h = w * 0.42;
  const puffs = [
    [-0.34, 0.06, 0.30],
    [-0.05, -0.12, 0.40],
    [0.28, 0.02, 0.32],
    [0.05, 0.14, 0.34],
  ];
  puffs.forEach(([dx, dy, r]) => {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', (cx + dx * w).toFixed(1));
    c.setAttribute('cy', (cy + dy * h).toFixed(1));
    c.setAttribute('r', (r * h * 1.5).toFixed(1));
    g.appendChild(c);
  });

  // la base recta, que es lo que las hace nube y no un montón de bolas
  const base = document.createElementNS(SVG_NS, 'rect');
  base.setAttribute('x', (cx - w / 2).toFixed(1));
  base.setAttribute('y', (cy + h * 0.05).toFixed(1));
  base.setAttribute('width', w.toFixed(1));
  base.setAttribute('height', (h * 0.42).toFixed(1));
  base.setAttribute('rx', (h * 0.2).toFixed(1));
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

  // Nubes: tres filas, las de arriba más grandes y las de abajo más pequeñas y
  // apretadas, que es lo que da sensación de que el cielo también tiene fondo.
  const clouds = document.createElementNS(SVG_NS, 'g');
  clouds.setAttribute('class', 'sky-clouds');
  const rows = [
    { y: 0.16, w: 0.42, n: 2, o: 0.95, dur: 190 },
    { y: 0.40, w: 0.30, n: 3, o: 0.85, dur: 260 },
    { y: 0.64, w: 0.20, n: 3, o: 0.7, dur: 330 },
  ];
  let seed = 4242;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

  rows.forEach((row) => {
    // Cada fila es una banda que se repite: se dibuja dos veces seguidas y se
    // desplaza el conjunto, así el bucle no tiene costura.
    const band = document.createElementNS(SVG_NS, 'g');
    band.setAttribute('class', 'sky-cloud-row');
    band.style.setProperty('--drift', `${row.dur}s`);

    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < row.n; i += 1) {
        const cx = ((i + rnd() * 0.6) / row.n) * W + pass * W;
        const cy = row.y * horizon;
        band.appendChild(cloudShape(cx, cy, row.w * W, palette.cloud, row.o));
      }
    }
    clouds.appendChild(band);
  });
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

  // La hierba, dibujada en un canvas y metida como imagen: son miles de
  // pinceladas y hacerlas de una en una en SVG dejaría el escenario de rodillas.
  // Se dibuja tan ancha como el terreno, no como el encuadre: al alejar la
  // cámara la capa se encoge y si midiera justo la ventana se vería el corte.
  const grass = document.createElementNS(SVG_NS, 'image');
  grass.setAttribute('href', grassTexture(proj));
  grass.setAttribute('x', String(-proj.width));
  grass.setAttribute('y', far.y.toFixed(1));
  grass.setAttribute('width', String(proj.width * 3));
  grass.setAttribute('height', (near.y - far.y).toFixed(1));
  grass.setAttribute('preserveAspectRatio', 'none');
  grass.setAttribute('class', 'floor-grass');
  svg.appendChild(grass);

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

// --- hierba ------------------------------------------------------------------
//
// El suelo es un tablero de baldosas de hierba en perspectiva, como el overworld
// de los juegos: dos verdes que se alternan, con muy poco contraste. Las
// baldosas miden lo mismo sobre el terreno, así que se van encogiendo y juntando
// hacia el horizonte solas, y eso es lo que hace que se lea como suelo y no como
// una trama pegada encima.
//
// Va en un canvas porque son más de mil baldosas: en SVG serían mil nodos.

const GRASS_A = 'rgba(255, 255, 255, .07)';
const GRASS_B = 'rgba(60, 110, 60, .07)';
const GRASS_LINE = 'rgba(70, 120, 70, .07)';

const grassCache = new Map();

// Cuánto ocupa una baldosa sobre el terreno, en coordenadas del mundo.
const TILE_U = 0.16;
const TILE_V = 0.075;

function grassTexture(proj) {
  const key = `${proj.width}x${proj.height}`;
  const hit = grassCache.get(key);
  if (hit) return hit;

  // De la línea del horizonte al borde delantero del terreno, que cae bastante
  // por debajo de la ventana: si el lienzo acabara en el borde, al alejar la
  // cámara se vería el corte de la hierba.
  const top = proj.project(0.5, 0).y;
  const bottom = proj.project(0.5, 1.6).y;
  const h = Math.max(1, Math.round(bottom - top));
  const w = Math.round(proj.width * 3);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // El canvas cubre de -1 a +2 anchos de pantalla, así que hay que correr todo
  // un ancho a la derecha para que el 0 del mundo caiga en su sitio.
  const OFF_X = proj.width;
  const U_MIN = -3;
  const U_MAX = 4;
  const V_NEAR = 1.6;

  const quad = (u0, u1, v0, v1, fill) => {
    const a1 = proj.project(u0, v0);
    const b1 = proj.project(u1, v0);
    const b2 = proj.project(u1, v1);
    const a2 = proj.project(u0, v1);
    ctx.beginPath();
    ctx.moveTo(a1.x + OFF_X, a1.y - top);
    ctx.lineTo(b1.x + OFF_X, b1.y - top);
    ctx.lineTo(b2.x + OFF_X, b2.y - top);
    ctx.lineTo(a2.x + OFF_X, a2.y - top);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  let row = 0;
  for (let v = 0; v < V_NEAR; v += TILE_V, row += 1) {
    const v2 = Math.min(V_NEAR, v + TILE_V);
    let col = 0;
    for (let u = U_MIN; u < U_MAX; u += TILE_U, col += 1) {
      const u2 = Math.min(U_MAX, u + TILE_U);
      // solo se pinta una de cada dos: el tablero sale del hueco que queda
      if ((row + col) % 2 === 0) quad(u, u2, v, v2, GRASS_A);
      else if ((row + col) % 4 === 1) quad(u, u2, v, v2, GRASS_B);
    }
  }

  // Y las juntas entre filas, muy flojas, que es lo que remata la sensación de
  // profundidad: se van juntando hacia el fondo.
  ctx.strokeStyle = GRASS_LINE;
  ctx.lineWidth = 1;
  for (let v = 0; v < V_NEAR; v += TILE_V) {
    const p1 = proj.project(U_MIN, v);
    const p2 = proj.project(U_MAX, v);
    ctx.beginPath();
    ctx.moveTo(p1.x + OFF_X, p1.y - top);
    ctx.lineTo(p2.x + OFF_X, p2.y - top);
    ctx.stroke();
  }

  const url = canvas.toDataURL('image/png');
  grassCache.set(key, url);
  return url;
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
