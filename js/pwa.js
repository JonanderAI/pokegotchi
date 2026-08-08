// Instalación en el móvil: service worker, manifiesto e icono.
//
// Lo que tiene de particular esto es el icono. Un manifiesto es un JSON
// estático, pero aquí el icono no puede serlo: cada partida cría un Pokémon
// distinto, y el que sale en la pantalla de inicio tiene que ser el tuyo. Así
// que el icono se dibuja en un canvas a partir del sprite de la especie actual
// y el manifiesto se genera al vuelo, apuntando el <link rel="manifest"> a un
// blob.
//
// Ojo con lo que eso significa de verdad: el navegador se queda con el icono
// del momento en que instalas. Si tu Pokémon evoluciona o el profesor Oak se lo
// lleva, el de la pantalla de inicio no cambia solo (hay que reinstalar). El
// del aviso y el de la pestaña sí, esos se pintan cada vez.

import { iconFor, EGG_ICON } from './sprite-resolver.js';

// El degradado ya solo lo usa el icono de iOS, que no admite transparencia: lo
// que quede transparente en un apple-touch-icon lo rellena el sistema de negro.
const GRADIENT_TOP = '#7fd0ff';
const GRADIENT_BOTTOM = '#2a75bb';
const FILL_ANY = 0.68;
// El favicon va sin fondo, así que el bicho puede ocupar casi todo el lienzo:
// no hay chapa de la que separarse.
const FILL_BARE = 0.92;

// Respaldo por si el navegador no se traga el manifiesto generado. Estos sí
// llevan chapa: son ficheros hechos de antemano (ver tools/build-app-icons.py) y
// no se pueden dibujar al vuelo.
const STATIC_ICONS = [
  { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
];

let manifestBlobUrl = null;
let lastIconKey = null;
const iconCache = new Map();   // `${src}|${size}|${fill}` -> data URL

function abs(path) {
  return new URL(path, document.baseURI).href;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`no se pudo cargar ${src}`));
    img.src = src;
  });
}

// Los iconos del pack son lienzos de 40x30 con el dibujo suelto dentro. Sin
// recortar el transparente de alrededor, el bicho sale diminuto en medio del
// icono.
function contentBox(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let minX = c.width;
  let minY = c.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < c.height; y += 1) {
    for (let x = 0; x < c.width; x += 1) {
      if (data[(y * c.width + x) * 4 + 3] < 8) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return { x: 0, y: 0, w: c.width, h: c.height };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// `background` es lo que separa el icono de la app (chapa con degradado, que es
// lo que quiere Android para la pantalla de inicio) del favicon de la pestaña,
// que va suelto: ahí una chapa de color canta, y el fondo de la pestaña lo pone
// el navegador.
async function drawIcon(src, size, fill, { background = true } = {}) {
  const key = `${src}|${size}|${fill}|${background}`;
  const hit = iconCache.get(key);
  if (hit) return hit;

  const img = await loadImage(src);
  const box = contentBox(img);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (background) {
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, GRADIENT_TOP);
    grad.addColorStop(1, GRADIENT_BOTTOM);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }

  // Escala entera y sin suavizado: es pixel art, cualquier interpolación le
  // emborrona el contorno.
  const scale = Math.max(1, Math.floor(Math.min((size * fill) / box.w, (size * fill) / box.h)));
  const w = box.w * scale;
  const h = box.h * scale;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, box.x, box.y, box.w, box.h, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);

  const url = canvas.toDataURL('image/png');
  iconCache.set(key, url);
  return url;
}

// Mientras es un huevo no se sabe quién hay dentro, así que el icono es el
// huevo. En la despedida de Oak sigue siendo el suyo: es de él de quien habla
// el aviso.
function spriteIconFor(pet) {
  return pet.phase === 'egg' ? EGG_ICON : iconFor(pet.speciesId);
}

// El icono del Pokémon de ahora mismo, listo para usar como icono de un aviso.
export async function currentIconDataUrl(state, size = 192) {
  try {
    return await drawIcon(spriteIconFor(state.pet), size, FILL_ANY);
  } catch {
    return abs('icons/icon-192.png');
  }
}

function setLink(rel, href, extra = {}) {
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  Object.entries(extra).forEach(([k, v]) => el.setAttribute(k, v));
  el.href = href;
  return el;
}

// Se reescribe el manifiesto con los iconos del Pokémon actual metidos como
// data URL. Si el navegador no se los traga, detrás van los ficheros estáticos
// de icons/, así que la app se sigue pudiendo instalar igual.
async function refreshManifest(state) {
  // Todo sin fondo: el Pokémon suelto, sin la chapa de degradado. Del hueco se
  // encarga el sistema, que pone el suyo.
  const [any192, any512, bare] = await Promise.all([
    drawIcon(spriteIconFor(state.pet), 192, FILL_BARE, { background: false }),
    drawIcon(spriteIconFor(state.pet), 512, FILL_BARE, { background: false }),
    drawIcon(spriteIconFor(state.pet), 192, FILL_BARE, { background: false }),
  ]);

  const base = await fetch(abs('manifest.webmanifest')).then((r) => r.json());

  const manifest = {
    ...base,
    // En un manifiesto servido desde blob: no hay ruta relativa que valga:
    // todo tiene que ir absoluto o el navegador lo resuelve contra el propio
    // blob y no encuentra nada.
    start_url: abs('./'),
    scope: abs('./'),
    // Sin icono "maskable" a propósito: un maskable es, por definición, a sangre,
    // y Android le pinta detrás el background_color, con lo que la chapa volvería
    // por otro lado. Dejando solo los "any" transparentes, el lanzador pone su
    // propio fondo y se ve el Pokémon recortado, que es lo que se busca.
    icons: [
      { src: any192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: any512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      ...STATIC_ICONS.map((icon) => ({ ...icon, src: abs(icon.src) })),
    ],
  };

  const next = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
  setLink('manifest', next);
  if (manifestBlobUrl) URL.revokeObjectURL(manifestBlobUrl);
  manifestBlobUrl = next;

  // La pestaña y el "añadir a pantalla de inicio" de iOS, que no miran el
  // manifiesto. El favicon va sin fondo; el de iOS no, porque ahí lo que quede
  // transparente lo rellena el sistema con negro.
  setLink('icon', bare, { type: 'image/png' });
  drawIcon(spriteIconFor(state.pet), 192, FILL_ANY)
    .then((plated) => setLink('apple-touch-icon', plated))
    .catch(() => {});
}

// Se llama en cada render, pero solo hace algo cuando cambia el Pokémon: al
// eclosionar, al evolucionar y al recibir un huevo nuevo.
export function syncAppIcon(state) {
  const key = state.pet.phase === 'egg' ? 'egg' : String(state.pet.speciesId);
  if (key === lastIconKey) return;
  lastIconKey = key;
  refreshManifest(state).catch(() => {
    /* sin icono a medida; se queda el manifiesto estático del HTML */
  });
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // file:// no vale, y sin HTTPS tampoco (salvo en localhost).
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

  const register = () => {
    navigator.serviceWorker.register(abs('sw.js'), { scope: abs('./') }).catch(() => {
      /* sin service worker se juega igual, solo que sin instalar ni avisos */
    });
  };

  // No basta con esperar al evento load: main.js tiene un await de nivel
  // superior (las rejillas de sprites), así que para cuando se llega aquí lo
  // normal es que load ya haya pasado y el listener no llegue a dispararse
  // nunca. Se registra igualmente si la página ya está cargada.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
