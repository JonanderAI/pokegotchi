import { isBaseStage } from './pokeapi.js';

// Pokémon de cualquier generación hasta la 4 (1-493): los sprites de Crystal,
// Emerald y HeartGold/SoulSilver incluyen también a los de Kanto (gen 1), así
// que pueden mostrarse con esos sprites animados. Gen 5 no tiene animación en
// el pack, así que se descarta.
const MIN_ID = 1;
const MAX_ID = 493;

// Respaldo local (especies sin pre-evolución conocidas de antemano) para cuando
// no hay red y no se puede preguntar a PokeAPI si una especie es de base.
export const SPECIES_POOL = [
  1, 4, 7, 10, 16, 19, 23, 27, 37, 43, 54, 74, 129, 133,
  152, 155, 158, 161, 163, 170, 179, 183, 187, 194, 216, 220, 246,
  252, 255, 258, 261, 263, 276, 300, 304, 328, 349, 371, 374,
  387, 390, 393, 396, 399, 403, 427, 441, 443, 449, 456, 459,
];

export function randomSpeciesId() {
  return SPECIES_POOL[Math.floor(Math.random() * SPECIES_POOL.length)];
}

// Intenta encontrar una especie de base de verdad (sin pre-evolución) al azar
// entre el 1 y el 493 preguntando a PokeAPI. Devuelve null si no hay red o si
// no se encuentra ninguna en los intentos permitidos (se usa el respaldo local).
export async function pickBaseStageSpeciesId(maxAttempts = 12) {
  for (let i = 0; i < maxAttempts; i += 1) {
    const id = MIN_ID + Math.floor(Math.random() * (MAX_ID - MIN_ID + 1));
    const base = await isBaseStage(id);
    if (base === true) return id;
    if (base === null) return null; // sin conexión: no seguimos gastando intentos
  }
  return null;
}
