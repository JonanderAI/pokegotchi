// Resuelve rutas de sprites dentro de sprites/ según la generación del Pokémon (por número de Pokédex nacional).
// Prioriza siempre la versión animada cuando existe en la carpeta de esa generación.
const BASE = 'sprites';

// Solo Gen 2, Gen 3 y Gen 4: son las únicas con sprite animado de verdad
// (GIF) o al menos 2 frames en el pack. Gen 1 y Gen 5 se descartan.
const GEN_MAX = [
  { gen: 2, max: 251 },
  { gen: 3, max: 386 },
  { gen: 4, max: 493 },
];

export function genForId(id) {
  for (const r of GEN_MAX) if (id <= r.max) return r.gen;
  return 4;
}

// kind: 'gif' (animado nativo) o 'flip' (2 frames que alternamos por JS)
export function resolveSprite(id) {
  const gen = genForId(id);
  switch (gen) {
    case 2:
      return {
        gen,
        kind: 'gif',
        src: `${BASE}/generation-2/pokemon/main-sprites/crystal/animated/${id}.gif`,
        fallback: `${BASE}/generation-2/pokemon/main-sprites/crystal/${id}.png`,
      };
    case 3:
      return {
        gen,
        kind: 'gif',
        src: `${BASE}/generation-3/pokemon/main-sprites/emerald/animated/${id}.gif`,
        fallback: `${BASE}/generation-3/pokemon/main-sprites/emerald/${id}.png`,
      };
    case 4:
    default:
      return {
        gen,
        kind: 'flip',
        src: `${BASE}/generation-4/pokemon/main-sprites/heartgold-soulsilver/${id}.png`,
        src2: `${BASE}/generation-4/pokemon/main-sprites/heartgold-soulsilver/frame2/${id}.png`,
      };
  }
}

export function iconFor(id) {
  return `${BASE}/pokemon-icons/pokemon/icons/${id}.png`;
}

export const EGG_ICON = `${BASE}/pokemon-icons/pokemon/icons/egg.png`;
export const EGG_SPRITE = `${BASE}/generation-4/pokemon/main-sprites/heartgold-soulsilver/egg.png`;

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
};
