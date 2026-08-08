// Resuelve rutas de sprites dentro de sprites/.
//
// Todos los Pokémon usan los sprites de Emerald (Gen 3): son los únicos del
// pack con animación de verdad (mediana de 26 frames por especie, frente a los
// 2 de HeartGold/SoulSilver), y al venir todos de la misma generación el juego
// tiene un solo estilo. A cambio, el juego llega hasta el 386: Emerald no tiene
// sprites de Sinnoh.
const BASE = 'sprites';

export const MAX_SPECIES_ID = 386;

// La animación sale de la rejilla generada (ver sprite-anim.js). El PNG suelto
// de Emerald queda de respaldo por si la rejilla no carga.
export function resolveSprite(id) {
  return {
    kind: 'sheet',
    src: `${BASE}/generated/emerald/${id}.png`,
    fallback: `${BASE}/generation-3/pokemon/main-sprites/emerald/${id}.png`,
  };
}

export function iconFor(id) {
  return `${BASE}/pokemon-icons/pokemon/icons/${id}.png`;
}

export const EGG_ICON = `${BASE}/pokemon-icons/pokemon/icons/egg.png`;
export const EGG_SPRITE = `${BASE}/generation-4/pokemon/main-sprites/heartgold-soulsilver/egg.png`;

// Bayas disponibles en el pack de items: la comida sale al azar de aquí.
const BERRIES = [
  'aguav', 'apicot', 'aspear', 'babiri', 'belue', 'bluk', 'charti', 'cheri',
  'chesto', 'chilan', 'chople', 'coba', 'colbur', 'cornn', 'custap', 'durin',
  'enigma', 'figy', 'ganlon', 'grepa', 'haban', 'hondew', 'iapapa', 'jaboca',
  'kasib', 'kebia', 'kelpsy', 'lansat', 'leppa', 'liechi', 'lum', 'mago',
  'magost', 'micle', 'nanab', 'nomel', 'occa', 'oran', 'pamtre', 'passho',
  'payapa', 'pecha', 'persim', 'petaya', 'pinap', 'pomeg', 'qualot', 'rabuta',
  'rawst', 'razz', 'rindo', 'rowap', 'salac', 'shuca', 'sitrus', 'spelon',
  'starf', 'tamato', 'tanga', 'wacan', 'watmel', 'wepear', 'wiki', 'yache',
];

export function berryNamed(name) {
  return { name, src: `${BASE}/items/items/berries/${name}-berry.png` };
}

// Un puñado de bayas distintas para elegir, como si rebuscaras en la mochila.
export function randomBerries(count) {
  const pool = [...BERRIES];
  const out = [];
  while (out.length < count && pool.length) {
    out.push(berryNamed(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]));
  }
  return out;
}

export const ITEM_ICONS = {
  feed: `${BASE}/items/items/berries/oran-berry.png`,
  happiness: `${BASE}/items/items/heart-scale.png`,
  hygiene: `${BASE}/items/items/cleanse-tag.png`,
  medicine: `${BASE}/items/items/potion.png`,
  play: `${BASE}/items/items/poke-toy.png`,
  pokedex: `${BASE}/items/items/poke-ball.png`,
  day: `${BASE}/chrome/chrome/time-of-day/daytime.png`,
  night: `${BASE}/chrome/chrome/time-of-day/night.png`,
  leftovers: `${BASE}/items/items/leftovers.png`,
  stone: `${BASE}/items/items/common-stone.png`,
};
