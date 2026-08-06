import { randomSpeciesId } from './species-pool.js';

const STORAGE_KEY = 'pokegotchi-save-v1';
const SCHEMA_VERSION = 1;

// Cada cuánto se repinta la pantalla. No tiene nada que ver con la velocidad
// del juego: es solo para que la interfaz vaya al día.
export const TICK_MS = 500;

// Cada cuánto avanza la simulación de verdad. Estaba a 500 ms, lo que hacía que
// un Pokémon naciera, creciera y se fuera con Oak en menos de tres minutos:
// ritmo de demo. A un minuto por tick el ciclo día/noche dura 1h10 y una vida
// entera unas 6 horas, que es lo que hace que cuidarlo signifique algo.
export const SIM_TICK_MS = 60000;

// Tope de la puesta al día al volver: 8 horas. Más que eso y no se sigue
// castigando, para que dejar la pestaña cerrada un fin de semana no te lo
// devuelva muerto de hambre.
export const MAX_CATCHUP_TICKS = 480;

export const TIMING = {
  eggHatch: 5,      // ticks para que el huevo eclosione
  dayTicks: 40,     // duración del día
  nightTicks: 30,   // duración de la noche
  stageDuration: { baby: 50, child: 70, teen: 90, adult: 140 },
  poopInterval: 22,
  mischiefChance: 0.01,   // por tick, mientras está despierto
  mischiefWindow: 14,     // ticks para regañar antes de que se resuelva solo
  sicknessCheckChance: 0.05,
};

export const XP_PER_LEVEL = 50;
export const XP_PER_TICK = 0.2; // se gana solo, poco a poco, con el paso del tiempo

function freshPet() {
  return {
    phase: 'egg', // egg | baby | child | teen | adult | oak
    speciesId: randomSpeciesId(),
    stageAge: 0,      // ticks en la etapa actual
    cycleTick: 0,     // ticks totales, para el ciclo día/noche
    xp: 0,            // experiencia de la etapa actual (tiempo + interacciones)
    hunger: 100,
    happiness: 100,
    hygiene: 100,
    energy: 100,
    sick: false,
    poopCount: 0,
    mischiefActive: false,
    mischiefDeadline: 0,
    awakenedThisNight: false,
    careGoodEvents: 0,
    careBadEvents: 0,
  };
}

function freshState() {
  return {
    version: SCHEMA_VERSION,
    pet: freshPet(),
    pokedex: {}, // { [speciesId]: { seen: true, raised: bool, name, types } }
    lastSeenAt: Date.now(),
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== SCHEMA_VERSION) return freshState();
    return parsed;
  } catch {
    return freshState();
  }
}

export function saveState(state) {
  state.lastSeenAt = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* almacenamiento no disponible, se continúa solo en memoria */
  }
}

export function startNewEgg(state) {
  state.pet = freshPet();
}

export function clearSave() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}
