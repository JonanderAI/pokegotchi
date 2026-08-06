// Animación de sprites a partir de las rejillas que genera
// tools/build-spritesheets.py.
//
// Antes los sprites eran GIF y los animaba el navegador: no había forma de
// pararlos, así que el Pokémon seguía moviéndose mientras dormía. Aquí el
// reloj lo lleva el juego, así que se puede pausar en seco, congelar en un
// frame concreto o cambiar la velocidad según cómo se encuentre.

const BASE = 'sprites/generated/emerald';

let manifest = null;

// El manifiesto trae, por especie: cuántos frames, en cuántas columnas, el
// tamaño de cada celda y cuánto dura cada frame (los GIF de Emerald no van a
// ritmo constante: mezclan frames de 20 ms con pausas de 100).
export async function loadSpriteSheets() {
  if (manifest) return manifest;
  try {
    const res = await fetch(`${BASE}/manifest.json`);
    if (!res.ok) throw new Error('manifest no disponible');
    manifest = await res.json();
  } catch {
    manifest = {}; // sin manifiesto se cae al sprite estático
  }
  return manifest;
}

export function sheetFor(speciesId) {
  const entry = manifest && manifest[speciesId];
  if (!entry) return null;
  return {
    src: `${BASE}/${speciesId}.png`,
    frames: entry.n,
    cols: entry.c,
    rows: Math.ceil(entry.n / entry.c),
    cellW: entry.w,
    cellH: entry.h,
    durations: entry.d,
  };
}

// Coloca la rejilla en el elemento y deja a la vista el frame que toque. La
// celda se encaja dentro del cuadro como haría object-fit: contain.
function paint(el, sheet, frame) {
  const box = el.clientWidth || parseFloat(getComputedStyle(el).width) || sheet.cellW;
  const scale = Math.min(box / sheet.cellW, box / sheet.cellH);
  const cw = sheet.cellW * scale;
  const ch = sheet.cellH * scale;
  const offsetX = (box - cw) / 2;
  const offsetY = (box - ch) / 2;
  const col = frame % sheet.cols;
  const row = Math.floor(frame / sheet.cols);

  el.style.backgroundSize = `${(sheet.cols * cw).toFixed(2)}px ${(sheet.rows * ch).toFixed(2)}px`;
  el.style.backgroundPosition = `${(offsetX - col * cw).toFixed(2)}px ${(offsetY - row * ch).toFixed(2)}px`;
}

// Devuelve el mando de la animación: se le puede dar al play, pausar en el
// frame actual o descansar (volver a la pose de reposo y quedarse quieto).
export function animateSprite(el, speciesId, opts = {}) {
  const sheet = sheetFor(speciesId);
  if (!sheet) return null;

  el.style.backgroundImage = `url("${sheet.src}")`;
  el.style.backgroundRepeat = 'no-repeat';

  let frame = 0;
  let timer = null;
  let speed = opts.speed || 1;

  // Estas animaciones hacen su gracia en medio segundo y luego aguantan la pose
  // un par de segundos antes de repetir. Ese frame largo es la postura de
  // reposo del Pokémon, así que es el que se deja fijo cuando duerme.
  const restFrame = sheet.durations.indexOf(Math.max(...sheet.durations));

  paint(el, sheet, frame);

  const step = () => {
    frame = (frame + 1) % sheet.frames;
    paint(el, sheet, frame);
    schedule();
  };

  const schedule = () => {
    const delay = (sheet.durations[frame] || 100) / speed;
    timer = setTimeout(step, delay);
  };

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return {
    sheet,
    play() {
      if (timer) return;
      schedule();
    },
    pause() {
      stop();
    },
    // Congelado en la pose de reposo: es lo que se usa para que duerma de
    // verdad, algo que con los GIF era imposible.
    rest() {
      stop();
      frame = restFrame;
      paint(el, sheet, frame);
    },
    setSpeed(value) {
      speed = value || 1;
    },
    // al cambiar de tamaño la ventana hay que recolocar la rejilla
    reflow() {
      paint(el, sheet, frame);
    },
    destroy() {
      stop();
    },
  };
}
