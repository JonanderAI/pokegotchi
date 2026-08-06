// Sombra bajo el sprite.
//
// Cada generación trae el sprite con un lienzo distinto (Gen 2: 60x60 sin alfa y
// con matte blanca, Gen 3: 96x96, Gen 4: 80x80) y con el Pokémon colocado en un
// sitio distinto dentro de ese lienzo. Una elipse fija en CSS quedaría flotando
// en unos y cortada en otros, así que medimos el sprite en un canvas y sacamos
// dónde están los pies de verdad.
//
// De cada sprite calculamos:
//   - la caja de píxeles visibles (para saber la línea del suelo),
//   - el ancho de la banda inferior (los pies), que es lo que apoya y por tanto
//     lo que marca el ancho de la sombra: así a un Charizard no le sale una
//     sombra del ancho de las alas.
//
// La sombra se dibuja como una elipse a la resolución nativa del sprite y se
// escala con image-rendering: pixelated, para que sus píxeles midan lo mismo
// que los del Pokémon y no desentone con el pixel art.

const cache = new Map();

// Un píxel cuenta como visible si no es transparente y (cuando el sprite no
// tiene alfa) tampoco es del color de la matte de las esquinas.
const ALPHA_MIN = 16;
const MATTE_TOLERANCE = 24;

// La banda de "pies" es el 22% inferior de la caja del sprite.
const FOOT_BAND = 0.22;
// Píxeles mínimos por fila para contarla: evita que un píxel suelto (una cola,
// una antena) desplace la sombra.
const MIN_RUN = 2;

// `cell` limita la medida a la primera celda: los sprites animados vienen en
// una rejilla y la sombra se saca de su primer frame (la pose de reposo), que
// es lo que la mantiene quieta mientras el Pokémon se mueve.
function measurePixels(img, cell) {
  const w = cell ? cell.w : img.naturalWidth;
  const h = cell ? cell.h : img.naturalHeight;
  if (!w || !h) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h, 0, 0, w, h);

  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // Canvas contaminado (p.ej. abriendo el juego con file://): sin medida.
    return null;
  }

  // Color de fondo: la esquina superior izquierda. Si es transparente nos vale
  // el alfa y no hace falta comparar colores (Gen 3 y Gen 4).
  const matteOpaque = data[3] >= ALPHA_MIN;
  const mr = data[0];
  const mg = data[1];
  const mb = data[2];

  const visible = (i) => {
    if (data[i + 3] < ALPHA_MIN) return false;
    if (!matteOpaque) return true;
    return (
      Math.abs(data[i] - mr) > MATTE_TOLERANCE ||
      Math.abs(data[i + 1] - mg) > MATTE_TOLERANCE ||
      Math.abs(data[i + 2] - mb) > MATTE_TOLERANCE
    );
  };

  let top = -1;
  let bottom = -1;
  let left = w;
  let right = -1;
  const rowLeft = new Int32Array(h).fill(-1);
  const rowRight = new Int32Array(h).fill(-1);

  for (let y = 0; y < h; y++) {
    let count = 0;
    let rl = -1;
    let rr = -1;
    for (let x = 0; x < w; x++) {
      if (!visible((y * w + x) * 4)) continue;
      count++;
      if (rl < 0) rl = x;
      rr = x;
    }
    if (count < MIN_RUN) continue;
    rowLeft[y] = rl;
    rowRight[y] = rr;
    if (top < 0) top = y;
    bottom = y;
    if (rl < left) left = rl;
    if (rr > right) right = rr;
  }

  if (bottom < 0) return null;

  // Ancho de apoyo: la banda inferior del sprite, no la caja entera.
  const bandTop = Math.max(top, Math.round(bottom - (bottom - top) * FOOT_BAND));
  let footLeft = w;
  let footRight = -1;
  for (let y = bandTop; y <= bottom; y++) {
    if (rowLeft[y] < 0) continue;
    if (rowLeft[y] < footLeft) footLeft = rowLeft[y];
    if (rowRight[y] > footRight) footRight = rowRight[y];
  }
  if (footRight < 0) {
    footLeft = left;
    footRight = right;
  }

  return {
    // El sprite viene con fondo opaco (los GIF de Gen 2 traen matte blanca en
    // vez de alfa): hay que recortarlo antes de pintarlo sobre la sombra.
    matte: matteOpaque,
    // +1 porque son índices de píxel y queremos el borde exterior.
    boxTop: top,
    boxLeft: left,
    boxRight: right + 1,
    boxBottom: bottom + 1,
    footLeft,
    footRight: footRight + 1,
    naturalWidth: w,
    naturalHeight: h,
  };
}

// Mide un sprite (cacheado por URL). Devuelve null si no se ha podido medir.
// `cell` (opcional) acota la medida al primer frame de una rejilla.
export function measureSprite(src, cell) {
  if (!src) return Promise.resolve(null);
  if (cache.has(src)) return cache.get(src);

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(measurePixels(img, cell));
    img.onerror = () => resolve(null);
    img.src = src;
  });

  cache.set(src, promise);
  return promise;
}

// --- dibujo de la elipse ---------------------------------------------------

// Dos tonos, como las sombras de los juegos: núcleo sólido y un borde más flojo.
const SHADOW_RGB = '28, 33, 52';
const CORE_ALPHA = 0.34;
const RIM_ALPHA = 0.18;
const CORE_RATIO = 0.62; // parte central (en distancia elíptica al cuadrado)

const ellipseCache = new Map();

// Elipse pixelada de w x h píxeles nativos, como data URL.
function ellipseUrl(w, h) {
  const key = `${w}x${h}`;
  if (ellipseCache.has(key)) return ellipseCache.get(key);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const rx = w / 2;
  const ry = h / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - rx) / rx;
      const dy = (y + 0.5 - ry) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      ctx.fillStyle = `rgba(${SHADOW_RGB}, ${d <= CORE_RATIO ? CORE_ALPHA : RIM_ALPHA})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  const url = canvas.toDataURL('image/png');
  ellipseCache.set(key, url);
  return url;
}

// --- colocación ------------------------------------------------------------

// Proporción del ancho de apoyo que ocupa la sombra, y suelo mínimo respecto a
// la caja del sprite para que los Pokémon redondos o que flotan (Voltorb,
// Zubat) no se queden con una manchita.
const SHADOW_SCALE = 1.12;
const MIN_SHADOW_RATIO = 0.45;
const FLAT_RATIO = 0.32; // alto de la elipse respecto al ancho

// Traduce la medida en píxeles del sprite a la caja pintada, teniendo en cuenta
// el object-fit: contain (los lienzos son cuadrados salvo alguna excepción,
// pero así no dependemos de ello).
function toBoxMetrics(m, boxW, boxH) {
  const scale = Math.min(boxW / m.naturalWidth, boxH / m.naturalHeight);
  const offsetX = (boxW - m.naturalWidth * scale) / 2;
  const offsetY = (boxH - m.naturalHeight * scale) / 2;

  const footW = m.footRight - m.footLeft;
  const spriteW = m.boxRight - m.boxLeft;

  // en píxeles del sprite, para que la elipse tenga su misma rejilla
  const nativeW = Math.max(6, Math.round(Math.max(footW * SHADOW_SCALE, spriteW * MIN_SHADOW_RATIO)));
  const nativeH = Math.max(3, Math.round(nativeW * FLAT_RATIO));

  return {
    nativeW,
    nativeH,
    scale,
    centerX: offsetX + ((m.footLeft + m.footRight) / 2) * scale,
    centerY: offsetY + m.boxBottom * scale,
  };
}

// Además de la elipse normal se guarda una versión un píxel más estrecha: es la
// que se usa mientras el Pokémon está en el aire dando el saltito. Se dibuja
// aparte en vez de escalar la normal para que los píxeles sigan midiendo
// exactamente lo mismo que los del sprite.
function writeVars(wrapEl, { nativeW, nativeH, scale, centerX, centerY }) {
  const smallW = Math.max(4, nativeW - 2);
  const smallH = Math.max(2, nativeH - 1);

  wrapEl.style.setProperty('--shadow-img', `url("${ellipseUrl(nativeW, nativeH)}")`);
  wrapEl.style.setProperty('--shadow-w', `${(nativeW * scale).toFixed(1)}px`);
  wrapEl.style.setProperty('--shadow-h', `${(nativeH * scale).toFixed(1)}px`);
  wrapEl.style.setProperty('--shadow-img-s', `url("${ellipseUrl(smallW, smallH)}")`);
  wrapEl.style.setProperty('--shadow-w-s', `${(smallW * scale).toFixed(1)}px`);
  wrapEl.style.setProperty('--shadow-h-s', `${(smallH * scale).toFixed(1)}px`);
  wrapEl.style.setProperty('--shadow-x', `${centerX.toFixed(1)}px`);
  wrapEl.style.setProperty('--shadow-y', `${centerY.toFixed(1)}px`);
}

// Dónde está de verdad el Pokémon dentro de su caja, que no la llena: los
// lienzos de Emerald dejan la mitad vacía. Sirve para saber hasta dónde puede
// acercarse a los bordes sin que se le corte nada, y para colgarle cosas de la
// cabeza (las Zzz) sin que queden flotando en el vacío.
function writeSpriteBox(wrapEl, m, metrics, boxW, boxH) {
  const { scale } = metrics;
  const offsetX = (boxW - m.naturalWidth * scale) / 2;
  const offsetY = (boxH - m.naturalHeight * scale) / 2;
  wrapEl.style.setProperty('--sprite-w', `${((m.boxRight - m.boxLeft) * scale).toFixed(1)}px`);
  wrapEl.style.setProperty('--sprite-right', `${(offsetX + m.boxRight * scale).toFixed(1)}px`);
  wrapEl.style.setProperty('--sprite-top', `${(offsetY + m.boxTop * scale).toFixed(1)}px`);
}

// Escribe posición, tamaño e imagen de la sombra como variables CSS del
// contenedor, que debe tener un hijo .pet-shadow (ver base.css).
export function applyShadow(wrapEl, imgEl, src, cell) {
  return measureSprite(src, cell).then((m) => {
    if (!wrapEl.isConnected) return;

    // Los sprites con matte se recortan por filtro (ver #key-matte en el HTML):
    // si no, al pintarlos sobre la sombra se les vería el cuadrado de fondo.
    imgEl.classList.toggle('keyed', !!(m && m.matte));

    const boxW = imgEl.clientWidth || wrapEl.clientWidth;
    const boxH = imgEl.clientHeight || wrapEl.clientHeight;
    if (!boxW || !boxH) return;

    if (!m) {
      // Sin medida (canvas contaminado con file://): elipse genérica apoyada en
      // el borde inferior del lienzo, que es donde suele pisar el sprite.
      const nativeW = 30;
      writeVars(wrapEl, {
        nativeW,
        nativeH: Math.round(nativeW * FLAT_RATIO),
        scale: boxW / 80,
        centerX: imgEl.offsetLeft + boxW / 2,
        centerY: imgEl.offsetTop + boxH * 0.88,
      });
      return;
    }

    const metrics = toBoxMetrics(m, boxW, boxH);
    writeSpriteBox(wrapEl, m, metrics, boxW, boxH);
    writeVars(wrapEl, {
      ...metrics,
      centerX: imgEl.offsetLeft + metrics.centerX,
      centerY: imgEl.offsetTop + metrics.centerY,
    });
    wrapEl.classList.add('has-measured-shadow');
  });
}

// Punto donde el Pokémon apoya los pies, en coordenadas del contenedor. Sirve
// para llevarlo hasta un sitio concreto (p. ej. la baya que le tiran).
export function footOffset(wrapEl) {
  const x = parseFloat(wrapEl.style.getPropertyValue('--shadow-x'));
  const y = parseFloat(wrapEl.style.getPropertyValue('--shadow-y'));
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  return { x: wrapEl.clientWidth / 2, y: wrapEl.clientHeight * 0.88 };
}
