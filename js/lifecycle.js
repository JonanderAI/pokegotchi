import { TIMING } from './state.js';
import { getSpeciesInfo } from './pokeapi.js';
import { randomSpeciesId, pickBaseStageSpeciesId } from './species-pool.js';

const STAGE_ORDER = ['baby', 'child', 'teen', 'adult'];

function goodCare(pet) {
  const avg = (pet.hunger + pet.happiness + pet.hygiene + pet.energy) / 4;
  return avg >= 55 && pet.careBadEvents <= pet.careGoodEvents;
}

// Se llama cada tick; si toca subir de etapa, cambia pet.phase y lanza (sin bloquear)
// la comprobación de evolución contra PokeAPI.
export function advanceStageIfNeeded(state) {
  const pet = state.pet;
  const idx = STAGE_ORDER.indexOf(pet.phase);
  if (idx === -1) return null;
  const duration = TIMING.stageDuration[pet.phase];
  if (pet.stageAge < duration) return null;

  if (pet.phase === 'adult') {
    pet.phase = 'oak';
    pet.stageAge = 0;
    return { type: 'oak_farewell' };
  }

  const wasGoodCare = goodCare(pet);
  pet.phase = STAGE_ORDER[idx + 1];
  pet.stageAge = 0;
  pet.xp = 0;
  pet.careGoodEvents = 0;
  pet.careBadEvents = 0;

  if (wasGoodCare) tryEvolve(state);

  return { type: 'stage_advance', stage: pet.phase, goodCare: wasGoodCare };
}

async function tryEvolve(state) {
  const pet = state.pet;
  const fromId = pet.speciesId;
  const info = await getSpeciesInfo(fromId);
  if (info.offline || !info.evolvesTo) return;
  if (state.pet.speciesId !== fromId) return; // el estado ya cambió mientras esperábamos
  state.pet.speciesId = info.evolvesTo;
  state.pendingEvolutionNotice = { from: fromId, to: info.evolvesTo };
}

export function sendToOak(state, pokedex) {
  const pet = state.pet;
  if (pokedex[pet.speciesId]) pokedex[pet.speciesId].raised = true;
}

export function hatchNewEgg(state) {
  state.pet.phase = 'egg';
  state.pet.speciesId = randomSpeciesId();
  state.pet.stageAge = 0;
  state.pet.cycleTick = 0;
  state.pet.xp = 0;
  state.pet.hunger = 100;
  state.pet.happiness = 100;
  state.pet.hygiene = 100;
  state.pet.energy = 100;
  state.pet.sick = false;
  state.pet.poopCount = 0;
  state.pet.mischiefActive = false;
  state.pet.awakenedThisNight = false;
  state.pet.careGoodEvents = 0;
  state.pet.careBadEvents = 0;
}

// El huevo empieza con una especie de base del respaldo local (síncrono), pero de
// fondo intentamos afinar con una especie de base real elegida al azar entre el
// 1 y el 493 vía PokeAPI. Solo se aplica si el huevo sigue sin eclosionar.
export async function refineEggSpecies(state) {
  if (state.pet.phase !== 'egg') return false;
  const id = await pickBaseStageSpeciesId();
  if (id && state.pet.phase === 'egg') {
    state.pet.speciesId = id;
    return true;
  }
  return false;
}
