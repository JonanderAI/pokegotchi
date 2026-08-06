import { TIMING } from './state.js';
import { advanceStageIfNeeded, sendToOak } from './lifecycle.js';

function clamp(v) {
  return Math.max(0, Math.min(100, v));
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
    pet.stageAge += 1;
    if (pet.stageAge >= TIMING.eggHatch) {
      pet.phase = 'baby';
      pet.stageAge = 0;
      events.push({ type: 'hatched' });
    }
    return events;
  }

  if (pet.phase === 'oak') {
    return events;
  }

  pet.cycleTick += 1;
  pet.stageAge += 1;

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
  return { woke };
}

export function clean(state) {
  const pet = state.pet;
  pet.poopCount = 0;
  pet.hygiene = clamp(pet.hygiene + 40);
  pet.careGoodEvents += 1;
}

// Quita un único "leftover" tocado en pantalla (en vez de limpiar todos de golpe).
export function removeLeftover(state) {
  const pet = state.pet;
  if (pet.poopCount <= 0) return;
  pet.poopCount -= 1;
  pet.hygiene = clamp(pet.hygiene + 15);
  pet.careGoodEvents += 1;
}

export function giveMedicine(state) {
  const pet = state.pet;
  const wasSick = pet.sick;
  pet.sick = false;
  pet.hygiene = clamp(pet.hygiene + 10);
  if (wasSick) pet.careGoodEvents += 1;
  return { wasSick };
}

export function discipline(state) {
  const pet = state.pet;
  if (!pet.mischiefActive) return { resolved: false };
  pet.mischiefActive = false;
  pet.careGoodEvents += 1;
  pet.happiness = clamp(pet.happiness + 4);
  return { resolved: true };
}

export function applyPlayResult(state, success) {
  const pet = state.pet;
  const woke = wakeAtNightPenalty(pet);
  if (success) {
    pet.happiness = clamp(pet.happiness + 25);
    pet.energy = clamp(pet.energy - 10);
    pet.careGoodEvents += 1;
  } else {
    pet.happiness = clamp(pet.happiness + 8);
    pet.energy = clamp(pet.energy - 10);
  }
  return { woke };
}

export function careScore(pet) {
  return (pet.hunger + pet.happiness + pet.hygiene + pet.energy) / 4 + pet.careGoodEvents * 2 - pet.careBadEvents * 4;
}

export { sendToOak };
