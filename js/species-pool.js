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

// El primer huevo de la partida no sale de la bolsa común: toca un inicial, que
// es como empieza todo el mundo en los juegos. Van los nueve de Kanto, Johto y
// Hoenn (hasta donde llegan los sprites animados) más Pikachu y Eevee, que son
// iniciales de pleno derecho en Amarillo y en el Coliseo.
export const STARTERS = [
  1, 4, 7,          // Bulbasaur, Charmander, Squirtle
  25, 133,          // Pikachu, Eevee
  152, 155, 158,    // Chikorita, Cyndaquil, Totodile
  252, 255, 258,    // Treecko, Torchic, Mudkip
];

export function randomStarterId() {
  return STARTERS[Math.floor(Math.random() * STARTERS.length)];
}

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
