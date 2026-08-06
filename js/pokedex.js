// Rango completo que puede aparecer en el juego (gen 1 a gen 4, ver species-pool.js).
const MIN_DEX_ID = 1;
const MAX_DEX_ID = 493;

// Registra una especie como "vista" la primera vez que aparece como mascota activa.
export function registerSeen(state, id, info) {
  const existing = state.pokedex[id];
  if (existing) {
    existing.name = info.name;
    existing.types = info.types;
    return;
  }
  state.pokedex[id] = {
    seen: true,
    raised: false,
    name: info.name,
    types: info.types || [],
  };
}

// IDs a mostrar en la rejilla: toda la Pokédex nacional del 1 al 493.
export function getKnownIds() {
  const ids = [];
  for (let id = MIN_DEX_ID; id <= MAX_DEX_ID; id += 1) ids.push(id);
  return ids;
}

export function getEntry(state, id) {
  return state.pokedex[id] || null;
}

export function countRaised(state) {
  return Object.values(state.pokedex).filter((e) => e.raised).length;
}
