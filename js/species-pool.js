// Especies base (sin pre-evolución) usadas para el huevo, repartidas por generación 1-5.
// Los datos de nombre/tipo/evolución reales se piden a PokeAPI en pokeapi.js;
// aquí solo decidimos qué IDs de la Pokédex nacional pueden salir del huevo.
export const SPECIES_POOL = [
  // Gen 1
  1, 4, 7, 10, 16, 19, 23, 27, 37, 43, 54, 74, 129, 133,
  // Gen 2
  152, 155, 158, 161, 163, 170, 179, 183, 187, 194, 216, 220, 246,
  // Gen 3
  252, 255, 258, 261, 263, 276, 300, 304, 328, 349, 371, 374,
  // Gen 4
  387, 390, 393, 396, 399, 403, 427, 441, 443, 449, 456, 459,
  // Gen 5
  495, 498, 501, 504, 506, 517, 529, 546, 570, 585, 610, 636,
];

export function randomSpeciesId() {
  return SPECIES_POOL[Math.floor(Math.random() * SPECIES_POOL.length)];
}
