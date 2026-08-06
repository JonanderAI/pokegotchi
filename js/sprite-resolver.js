// Resuelve rutas de sprites dentro de sprites/ según la generación del Pokémon (por número de Pokédex nacional).
// Prioriza siempre la versión animada cuando existe en la carpeta de esa generación.
const BASE = 'sprites';

const GEN_MAX = [
  { gen: 1, max: 151 },
  { gen: 2, max: 251 },
  { gen: 3, max: 386 },
  { gen: 4, max: 493 },
  { gen: 5, max: 649 },
];

export function genForId(id) {
  for (const r of GEN_MAX) if (id <= r.max) return r.gen;
  return 5;
}

// kind: 'static' (1 imagen), 'gif' (animado nativo), 'flip' (2 frames que alternamos por JS)
export function resolveSprite(id) {
  const gen = genForId(id);
  switch (gen) {
    case 1:
      return {
        gen,
        kind: 'static',
        src: `${BASE}/generation-1/pokemon/main-sprites/yellow/gbc/${id}.png`,
        fallback: `${BASE}/generation-1/pokemon/main-sprites/red-blue/${id}.png`,
      };
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
      return {
        gen,
        kind: 'flip',
        src: `${BASE}/generation-4/pokemon/main-sprites/heartgold-soulsilver/${id}.png`,
        src2: `${BASE}/generation-4/pokemon/main-sprites/heartgold-soulsilver/frame2/${id}.png`,
      };
    case 5:
    default:
      return {
        gen,
        kind: 'static',
        src: `${BASE}/generation-5/pokemon/main-sprites/black-white/${id}.png`,
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
