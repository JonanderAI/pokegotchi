/* Service worker de PokéGotchi.
 *
 * Hace dos cosas:
 *
 *  1. Que el juego se pueda instalar y abrir sin conexión. Todo lo que necesita
 *     es estático (sprites, CSS, módulos), así que basta con guardarlo a medida
 *     que se pide. Lo único que sale a la red de verdad es PokeAPI, y eso ya se
 *     cachea aparte en localStorage (ver js/pokeapi.js).
 *
 *  2. Enseñar los avisos. Las notificaciones se piden desde la página con
 *     registration.showNotification, pero el toque en el aviso llega aquí:
 *     es el service worker quien tiene que traer la app al frente.
 *
 * No hay push del servidor: esto es un sitio estático en GitHub Pages, no hay
 * nadie que pueda despertar al navegador. Los avisos los lanza la propia página
 * mientras está viva (ver js/notify.js).
 */

const VERSION = 'v1';
const SHELL_CACHE = `pokegotchi-shell-${VERSION}`;
const RUNTIME_CACHE = `pokegotchi-runtime-${VERSION}`;

// En local no se sirve nada de la caché. La estrategia de abajo (dar lo
// guardado y refrescar por detrás) está bien para quien juega, pero
// desarrollando significa que cada cambio tarda dos recargas en verse, y eso
// acaba haciéndote creer que algo no funciona cuando en realidad estás mirando
// la versión de antes. El service worker se sigue registrando, así que instalar
// y los avisos se pueden probar igual.
const DEV_HOSTS = ['localhost', '127.0.0.1'];
const DEV = DEV_HOSTS.includes(self.location.hostname);

// Lo que hace falta para que la primera pantalla se pinte estando sin conexión.
// Los sprites no entran: son miles de ficheros y se van guardando conforme el
// juego los pide.
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/base.css',
  'js/main.js',
  'js/care.js',
  'js/lifecycle.js',
  'js/notify.js',
  'js/pokeapi.js',
  'js/pokedex.js',
  'js/pwa.js',
  'js/species-pool.js',
  'js/sprite-anim.js',
  'js/sprite-resolver.js',
  'js/sprite-shadow.js',
  'js/state.js',
  'js/ui.js',
  'js/wild.js',
  'js/world.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'sprites/pokemon-icons/pokemon/icons/egg.png',
  'sprites/generation-4/pokemon/main-sprites/heartgold-soulsilver/egg.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // De uno en uno y sin cortar: si un fichero del listado falla (un rename
      // que se olvidó aquí), addAll entero se va al traste y el usuario se
      // queda sin service worker.
      await Promise.all(
        SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, RUNTIME_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

// Guarda la respuesta y la devuelve. Las opacas (cross-origin sin CORS) también
// valen: no se pueden leer, pero el navegador sí sabe pintarlas.
async function cachePut(cacheName, request, response) {
  if (!response || (response.status !== 200 && response.type !== 'opaque')) return response;
  const cache = await caches.open(cacheName);
  cache.put(request, response.clone()).catch(() => {});
  return response;
}

// Se sirve lo cacheado al momento y se refresca por detrás: los sprites no
// cambian nunca, y para el CSS y los módulos vale con que el cambio entre en la
// siguiente visita.
async function staleWhileRevalidate(cacheName, request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((res) => cachePut(cacheName, request, res))
    .catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // En local se deja pasar todo a la red: lo que hay en el disco es lo que se ve.
  if (DEV) return;

  const url = new URL(request.url);

  // Abrir la app: se intenta la red para no quedarse con un index viejo, y si
  // no hay, el de la caché. Es lo que hace que funcione sin conexión.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          return await cachePut(SHELL_CACHE, request, res);
        } catch {
          return (
            (await caches.match(request)) ||
            (await caches.match('index.html')) ||
            (await caches.match('./')) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(SHELL_CACHE, request));
    return;
  }

  // Los iconos de Font Awesome vienen de un CDN. Se guardan para que la barra
  // de abajo no se quede sin iconos al abrir sin conexión.
  if (url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(staleWhileRevalidate(RUNTIME_CACHE, request));
  }

  // Lo demás (PokeAPI) va directo a la red: ya tiene su propia caché.
});

// Tocar el aviso trae al juego al frente; si no queda ninguna ventana abierta,
// se abre una.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    (async () => {
      const scope = self.registration.scope;
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      for (const client of clientList) {
        if (client.url.startsWith(scope) && 'focus' in client) {
          await client.focus();
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(scope);
    })(),
  );
});
