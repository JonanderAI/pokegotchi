// Avisos para hacerle caso al Pokémon cuando lo necesita.
//
// Importante saber hasta dónde llega esto: PokéGotchi es un sitio estático, no
// hay servidor que pueda mandar push, así que los avisos los lanza la propia
// página mientras sigue viva. En la práctica eso cubre justo el caso que
// molesta -tener el juego abierto de fondo y no enterarte de que tu Pokémon se
// ha puesto malo-, tanto en una pestaña como en la app instalada. Lo que no
// puede hacer es avisarte con el juego cerrado del todo: ahí no hay nadie
// ejecutando la simulación. Al volver, la puesta al día de main.js te cuenta lo
// que ha pasado.
//
// Solo se avisa con la pantalla oculta: si estás mirando al Pokémon, ya lo ves.

import { getEntry } from './pokedex.js';
import { currentIconDataUrl } from './pwa.js';
import { isNight } from './care.js';

// Cada aviso tiene su propia espera, en minutos de reloj. Lo urgente insiste
// más, y de lo que solo baja despacio no tiene sentido dar la lata.
const NEEDS = [
  {
    kind: 'oak',
    cooldownMin: 120,
    applies: (pet) => pet.phase === 'oak',
    title: (name) => `El profesor Oak se lleva a ${name}`,
    body: () => 'Ha venido a recogerlo para estudiarlo. Pásate a despedirte y a por un huevo nuevo.',
  },
  {
    // La evolución no ocurre sola: se queda esperando a que toques el bocadillo
    // (ver lifecycle.js). Es lo mejor que le puede pasar y se queda ahí parada
    // hasta que vuelvas, así que va por delante de todo lo demás.
    kind: 'evolution',
    cooldownMin: 60,
    applies: (pet) => Boolean(pet.pendingEvolution),
    title: (name) => `${name} está a punto de evolucionar`,
    body: () => 'Te está esperando: entra y toca el bocadillo para que dé el paso.',
  },
  {
    kind: 'sick',
    cooldownMin: 45,
    applies: (pet) => pet.sick,
    title: (name) => `${name} está enfermo`,
    body: () => 'Dale una medicina en la Mochila antes de que vaya a peor.',
  },
  {
    kind: 'mischief',
    cooldownMin: 20,
    applies: (pet) => pet.mischiefActive,
    title: (name) => `${name} está haciendo una travesura`,
    body: () => 'Regáñale ahora o se le pasará solo y se quedará triste.',
  },
  {
    kind: 'hunger',
    cooldownMin: 60,
    applies: (pet) => pet.hunger < 25,
    title: (name) => `${name} tiene hambre`,
    body: () => 'Toca darle de comer en la Mochila.',
  },
  {
    kind: 'hygiene',
    cooldownMin: 90,
    applies: (pet) => pet.hygiene < 25 || pet.poopCount >= 3,
    title: (name) => `Hay que limpiar donde vive ${name}`,
    body: () => 'Está todo hecho un asco y así acaba poniéndose malo.',
  },
  {
    kind: 'happiness',
    cooldownMin: 90,
    applies: (pet) => pet.happiness < 25,
    title: (name) => `${name} está triste`,
    body: () => 'Échale un rato: jugar es lo que más le sube el ánimo.',
  },
];

// Avisos de un momento concreto, que dispara main.js cuando pasan.
const EVENTS = {
  hatched: {
    title: () => '¡El huevo ha eclosionado!',
    body: () => 'Ya está aquí. Entra a ver quién ha salido y ponle un mote.',
  },
  evolved: {
    title: (name) => `¡${name} ha evolucionado!`,
    body: () => 'Entra a verlo.',
  },
};

export function supported() {
  return typeof Notification !== 'undefined' && 'serviceWorker' in navigator;
}

export function permission() {
  return supported() ? Notification.permission : 'unsupported';
}

// Devuelve el permiso resultante. Hay que llamarlo desde un gesto del usuario
// (el interruptor de Ajustes): los navegadores ignoran la petición si no.
export async function requestPermission() {
  if (!supported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function enabled(state) {
  return Boolean(state.settings && state.settings.notifications) && permission() === 'granted';
}

function petName(state) {
  const pet = state.pet;
  if (pet.nickname) return pet.nickname;
  const info = getEntry(state, pet.speciesId);
  return info && info.name && info.name !== '???' ? info.name : 'Tu Pokémon';
}

async function show(state, { tag, title, body, renotify = false }) {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;

  const icon = await currentIconDataUrl(state, 192);
  try {
    await reg.showNotification(title, {
      body,
      icon,
      badge: icon,
      tag,                       // el aviso nuevo sustituye al anterior del mismo tipo
      renotify,
      silent: false,
      requireInteraction: false,
    });
    return true;
  } catch {
    return false;
  }
}

function stamps(state) {
  if (!state.notifiedAt) state.notifiedAt = {};
  return state.notifiedAt;
}

// Se comprueba en cada tick de la simulación (un minuto de juego). Devuelve
// true si ha salido un aviso, para que main.js guarde la partida.
export function checkNeeds(state) {
  if (!enabled(state)) return false;
  // Con la pantalla delante no hace falta avisar de nada.
  if (document.visibilityState === 'visible') return false;

  const pet = state.pet;
  if (pet.phase === 'egg') return false;

  const need = NEEDS.find((n) => n.applies(pet));
  if (!need) return false;

  // De noche duerme: solo se avisa de lo que no puede esperar a mañana.
  if (pet.phase !== 'oak' && isNight(pet) && need.kind !== 'sick') return false;

  const now = Date.now();
  const last = stamps(state)[need.kind] || 0;
  if (now - last < need.cooldownMin * 60000) return false;

  stamps(state)[need.kind] = now;
  const name = petName(state);
  show(state, { tag: need.kind, title: need.title(name), body: need.body(name), renotify: true });
  return true;
}

// Los momentos que no son "necesita algo" sino "acaba de pasar": eclosionar y
// evolucionar. Sin espera entre avisos, porque pasan una vez.
export function notifyEvent(state, kind) {
  if (!enabled(state)) return;
  if (document.visibilityState === 'visible') return;
  const ev = EVENTS[kind];
  if (!ev) return;
  const name = petName(state);
  show(state, { tag: kind, title: ev.title(name), body: ev.body(name) });
}

// Al encender el interruptor: un aviso de prueba, para que se vea que llegan.
export async function sendTestNotification(state) {
  return show(state, {
    tag: 'test',
    title: 'Los avisos están activados',
    body: `Te escribiremos cuando ${petName(state)} necesite algo.`,
  });
}
