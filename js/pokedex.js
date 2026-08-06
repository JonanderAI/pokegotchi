import { SPECIES_POOL } from './species-pool.js';

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

// IDs a mostrar en la rejilla: el pool base de huevos + cualquier evolución ya descubierta.
export function getKnownIds(state) {
  const ids = new Set(SPECIES_POOL);
  Object.keys(state.pokedex).forEach((k) => ids.add(Number(k)));
  return Array.from(ids).sort((a, b) => a - b);
}

export function getEntry(state, id) {
  return state.pokedex[id] || null;
}

export function countRaised(state) {
  return Object.values(state.pokedex).filter((e) => e.raised).length;
}
