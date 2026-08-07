import { TIMING, XP_PER_TICK, SIM_TICK_MS, MAX_CATCHUP_TICKS } from './state.js';
import { advanceStageIfNeeded, sendToOak, commitEvolution } from './lifecycle.js';

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

// `special` son las bayas que regalan los salvajes: alimentan mas y dan mas
// experiencia, para que valga la pena guardarlas.
export function feed(state, { special = false } = {}) {
  const pet = state.pet;
  const woke = wakeAtNightPenalty(pet);
  pet.hunger = clamp(pet.hunger + (special ? 45 : 30));
  if (special) pet.happiness = clamp(pet.happiness + 6);
  pet.careGoodEvents += 1;
  gainXp(pet, special ? 18 : 12);
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

// Por debajo de esto se le puede mandar a la cama: si va sobrado de energía no
// hay quien lo acueste, igual que en la vida real.
const SLEEPY_ENERGY = 65;

// Mandarle a dormir adelanta la noche: se salta lo que quedaba de día y empieza
// ya el tramo nocturno, que es cuando recupera energía. No acorta la noche.
export function sendToSleep(state) {
  const pet = state.pet;
  if (isNight(pet)) return { ok: false, reason: 'already' };
  if (pet.energy > SLEEPY_ENERGY) return { ok: false, reason: 'not_sleepy' };

  const cycleLen = TIMING.dayTicks + TIMING.nightTicks;
  pet.cycleTick = Math.floor(pet.cycleTick / cycleLen) * cycleLen + TIMING.dayTicks;
  pet.awakenedThisNight = false;
  pet.careGoodEvents += 1;
  gainXp(pet, 6);
  return { ok: true };
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

// Bayas ricas: son las que regalan los salvajes al jugar con ellos.
const GIFT_BERRIES = ['sitrus', 'lum', 'leppa', 'oran', 'aguav', 'figy', 'mago', 'wiki', 'iapapa'];
const MAX_GIFTS = 6;
const GIFT_CHANCE = 0.45;

// Jugar con un Pokémon salvaje que se ha acercado: es la interacción que más
// da, porque hay que estar delante y pillarlo mientras anda por ahí. A veces
// además se despide dejándote una baya.
export function playWithWild(state) {
  const pet = state.pet;
  const woke = wakeAtNightPenalty(pet);
  pet.happiness = clamp(pet.happiness + 14);
  pet.energy = clamp(pet.energy - 4);
  pet.careGoodEvents += 1;
  gainXp(pet, 18);

  let gift = null;
  if (!state.gifts) state.gifts = [];
  if (Math.random() < GIFT_CHANCE && state.gifts.length < MAX_GIFTS) {
    gift = GIFT_BERRIES[Math.floor(Math.random() * GIFT_BERRIES.length)];
    state.gifts.push(gift);
  }
  return { woke, gift };
}

export function takeGift(state, name) {
  const i = (state.gifts || []).indexOf(name);
  if (i >= 0) state.gifts.splice(i, 1);
}

// Cada baya atrapada en el minijuego cuenta: la partida entera se resuelve
// luego con applyPlayResult.
export function catchBerry(state) {
  const pet = state.pet;
  pet.happiness = clamp(pet.happiness + 2);
  pet.hunger = clamp(pet.hunger + 3);
  gainXp(pet, 3);
}

// De 0 a 1: como se encuentra. La UI lo usa para animarlo mas rapido o mas
// lento, que es la forma mas directa de que se le note el animo.
export function mood(pet) {
  if (pet.sick) return 0.15;
  return Math.max(0, Math.min(1, (pet.happiness * 0.7 + pet.energy * 0.3) / 100));
}

// Por debajo de esto una necesidad ya pide atención; por debajo de CRITICO, urge.
const NEED_LOW = 40;
const NEED_CRITICAL = 20;

// Cuántos bocadillos caben al lado sin taparlo entero.
const MAX_NEEDS = 3;

// Qué le pasa ahora mismo, de lo más urgente a lo menos. La UI lo pinta como
// bocadillos junto a su cabeza: la barra de estados dice cuánto le queda de cada
// cosa, esto dice qué mirar primero.
export function currentNeeds(pet) {
  if (pet.phase === 'egg' || pet.phase === 'oak') return [];

  const need = (key, value) => ({ key, urgent: value <= NEED_CRITICAL });
  const out = [];

  // La evolución manda sobre todo lo demás: es el momento del juego.
  if (pet.pendingEvolution) out.push({ key: 'evolving', urgent: false, action: true });
  if (pet.sick) out.push(need('sick', 0));
  if (pet.mischiefActive) out.push(need('mischief', 0));
  if (isNight(pet)) out.push(need('sleeping', 100));
  if (pet.poopCount > 0 || pet.hygiene < NEED_LOW) {
    out.push(need('dirty', pet.poopCount > 0 ? Math.min(pet.hygiene, NEED_CRITICAL) : pet.hygiene));
  }

  // Entre las que van flojas, primero la que peor está.
  [
    { key: 'hungry', value: pet.hunger },
    { key: 'tired', value: pet.energy },
    { key: 'sad', value: pet.happiness },
  ].filter((c) => c.value < NEED_LOW)
    .sort((a, b) => a.value - b.value)
    .forEach((c) => out.push(need(c.key, c.value)));

  // Si no hay nada que reclamar, que al menos se le vea contento.
  if (!out.length) out.push(need('happy', 100));
  return out.slice(0, MAX_NEEDS);
}

export function careScore(pet) {
  return (pet.hunger + pet.happiness + pet.hygiene + pet.energy) / 4 + pet.careGoodEvents * 2 - pet.careBadEvents * 4;
}

export { sendToOak, commitEvolution };
