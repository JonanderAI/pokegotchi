import { TIMING, XP_PER_TICK, SIM_TICK_MS, MAX_CATCHUP_TICKS } from './state.js';
import { advanceStageIfNeeded, sendToOak } from './lifecycle.js';

function clamp(v) {
  return Math.max(0, Math.min(100, v));
}

function gainXp(pet, amount) {
  pet.xp += amount;
}

export function isNight(pet) {
  const cycleLen = TIMING.dayTicks + TIMING.nightTicks;
  return (pet.cycleTick % cycleLen) >= TIMING.dayTicks;
}

// Avanza la simulación un tick. Devuelve una lista de eventos para que la UI muestre avisos.
export function tick(state) {
  const pet = state.pet;
  const events = [];

  if (pet.phase === 'egg') {
    // El huevo se mide en segundos, no en ticks del juego: si ha pasado un tick
    // entero (un minuto) es que hace mucho que le tocaba salir.
    hatch(pet);
    events.push({ type: 'hatched' });
    return events;
  }

  if (pet.phase === 'oak') {
    return events;
  }

  pet.cycleTick += 1;
  pet.stageAge += 1;
  gainXp(pet, XP_PER_TICK);

  const night = isNight(pet);
  if (!night) pet.awakenedThisNight = false;

  const energyDelta = night ? 1.4 : -0.3;
  pet.hunger = clamp(pet.hunger - 0.6);
  pet.happiness = clamp(pet.happiness - 0.35);
  pet.hygiene = clamp(pet.hygiene - 0.5);
  pet.energy = clamp(pet.energy + energyDelta);

  if (pet.stageAge > 0 && pet.stageAge % TIMING.poopInterval === 0 && pet.poopCount < 3) {
    pet.poopCount += 1;
  }
  if (pet.poopCount > 0) {
    pet.hygiene = clamp(pet.hygiene - pet.poopCount * 0.4);
  }

  if (!pet.sick && (pet.hygiene < 25 || pet.hunger < 20) && Math.random() < TIMING.sicknessCheckChance) {
    pet.sick = true;
    events.push({ type: 'sick' });
  }

  if (!pet.mischiefActive && !night && Math.random() < TIMING.mischiefChance) {
    pet.mischiefActive = true;
    pet.mischiefDeadline = pet.stageAge + TIMING.mischiefWindow;
    events.push({ type: 'mischief_start' });
  }
  if (pet.mischiefActive && pet.stageAge >= pet.mischiefDeadline) {
    pet.mischiefActive = false;
    pet.careBadEvents += 1;
    pet.happiness = clamp(pet.happiness - 8);
    events.push({ type: 'mischief_timeout' });
  }

  const stageEvent = advanceStageIfNeeded(state);
  if (stageEvent) events.push(stageEvent);

  return events;
}

// Al abrir el juego se recupera el tiempo que ha pasado con la pestaña cerrada:
// se ejecutan los ticks que tocaban, con tope, para que el Pokémon siga su vida
// aunque no estés mirando. Devuelve cuánto tiempo ha pasado y qué ha ocurrido.
export function catchUp(state) {
  const elapsed = Date.now() - (state.lastSeenAt || Date.now());
  const due = Math.floor(elapsed / SIM_TICK_MS);
  if (due <= 0) return { ticks: 0, skipped: 0, events: [] };

  const ticks = Math.min(due, MAX_CATCHUP_TICKS);
  const events = [];
  for (let i = 0; i < ticks; i += 1) events.push(...tick(state));
  return { ticks, skipped: due - ticks, events };
}

function hatch(pet) {
  pet.phase = 'baby';
  pet.stageAge = 0;
  pet.eggMs = 0;
}

// El huevo corre con el reloj de la pantalla (cada 500 ms), no con el del
// juego: son 12 segundos, no un tick.
export function tickEgg(state, elapsedMs) {
  const pet = state.pet;
  if (pet.phase !== 'egg') return [];
  pet.eggMs = (pet.eggMs || 0) + elapsedMs;
  if (pet.eggMs < TIMING.eggHatchMs) return [];
  hatch(pet);
  return [{ type: 'hatched' }];
}

// De 0 a 1: cuanto le queda al huevo. La UI lo usa para agitarlo cada vez mas.
export function eggProgress(pet) {
  if (pet.phase !== 'egg') return 0;
  return Math.min(1, (pet.eggMs || 0) / TIMING.eggHatchMs);
}

function wakeAtNightPenalty(pet) {
  if (isNight(pet) && !pet.awakenedThisNight) {
    pet.awakenedThisNight = true;
    pet.happiness = clamp(pet.happiness - 5);
    return true;
  }
  return false;
}

export function feed(state) {
  const pet = state.pet;
  const woke = wakeAtNightPenalty(pet);
  pet.hunger = clamp(pet.hunger + 30);
  pet.careGoodEvents += 1;
  gainXp(pet, 12);
  return { woke };
}

export function clean(state) {
  const pet = state.pet;
  pet.poopCount = 0;
  pet.hygiene = clamp(pet.hygiene + 40);
  pet.careGoodEvents += 1;
  gainXp(pet, 8);
}

// Quita un único "leftover" tocado en pantalla (en vez de limpiar todos de golpe).
export function removeLeftover(state) {
  const pet = state.pet;
  if (pet.poopCount <= 0) return;
  pet.poopCount -= 1;
  pet.hygiene = clamp(pet.hygiene + 15);
  pet.careGoodEvents += 1;
  gainXp(pet, 5);
}

export function giveMedicine(state) {
  const pet = state.pet;
  const wasSick = pet.sick;
  pet.sick = false;
  pet.hygiene = clamp(pet.hygiene + 10);
  if (wasSick) {
    pet.careGoodEvents += 1;
    gainXp(pet, 14);
  }
  return { wasSick };
}

export function discipline(state) {
  const pet = state.pet;
  if (!pet.mischiefActive) return { resolved: false };
  pet.mischiefActive = false;
  pet.careGoodEvents += 1;
  pet.happiness = clamp(pet.happiness + 4);
  gainXp(pet, 8);
  return { resolved: true };
}

export function applyPlayResult(state, success) {
  const pet = state.pet;
  const woke = wakeAtNightPenalty(pet);
  if (success) {
    pet.happiness = clamp(pet.happiness + 25);
    pet.energy = clamp(pet.energy - 10);
    pet.careGoodEvents += 1;
    gainXp(pet, 22);
  } else {
    pet.happiness = clamp(pet.happiness + 8);
    pet.energy = clamp(pet.energy - 10);
    gainXp(pet, 8);
  }
  return { woke };
}

// Tocar directamente al Pokémon en pantalla (una caricia rápida).
export function petTap(state) {
  const pet = state.pet;
  pet.happiness = clamp(pet.happiness + 4);
  gainXp(pet, 2);
}

// Jugar con un Pokémon salvaje que se ha acercado: es la interacción que más
// da, porque hay que estar delante y pillarlo mientras anda por ahí.
export function playWithWild(state) {
  const pet = state.pet;
  const woke = wakeAtNightPenalty(pet);
  pet.happiness = clamp(pet.happiness + 14);
  pet.energy = clamp(pet.energy - 4);
  pet.careGoodEvents += 1;
  gainXp(pet, 18);
  return { woke };
}

export function careScore(pet) {
  return (pet.hunger + pet.happiness + pet.hygiene + pet.energy) / 4 + pet.careGoodEvents * 2 - pet.careBadEvents * 4;
}

export { sendToOak };
