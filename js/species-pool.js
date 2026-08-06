import { isBaseStage } from './pokeapi.js';
import { MAX_SPECIES_ID } from './sprite-resolver.js';

// Todo el juego usa los sprites animados de Emerald, que llegan hasta el 386
// (Kanto, Johto y Hoenn). Sinnoh se queda fuera: en el pack no hay ni una
// especie del 387 al 493 con animacion de verdad.
const MIN_ID = 1;
const MAX_ID = MAX_SPECIES_ID;

// Respaldo local (especies sin pre-evolución conocidas de antemano) para cuando
// no hay red y no se puede preguntar a PokeAPI si una especie es de base.
export const SPECIES_POOL = [
  1, 4, 7, 10, 16, 19, 23, 27, 37, 43, 54, 74, 129, 133,
  152, 155, 158, 161, 163, 170, 179, 183, 187, 194, 216, 220, 246,
  252, 255, 258, 261, 263, 276, 300, 304, 328, 349, 371, 374,
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
