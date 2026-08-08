import { randomSpeciesId, randomStarterId } from './species-pool.js';

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
  // El huevo va aparte del reloj del juego: es la entrada, y hacer esperar
  // minutos delante de un huevo quieto no tiene ninguna gracia. Se mueve por
  // tiempo real y eclosiona en 12 segundos, agitandose cada vez mas.
  eggHatchMs: 12000,
  dayTicks: 40,     // duración del día
  nightTicks: 30,   // duración de la noche
  stageDuration: { baby: 50, child: 70, teen: 90, adult: 140 },
  poopInterval: 22,
  mischiefChance: 0.01,   // por tick, mientras está despierto
  mischiefWindow: 14,     // ticks para regañar antes de que se resuelva solo
  sicknessCheckChance: 0.05,
};

// Subir de nivel cuesta cada vez más. Antes eran 40 de experiencia fijos por
// nivel, lo que hacía que los primeros se atragantaran y los últimos cayeran
// solos: los primeros son el enganche y tienen que ir rápido, y a partir de ahí
// cada uno tiene que costar un poco más que el anterior.
const XP_BASE = 20;   // lo que cuesta el primer nivel de la etapa
const XP_CURVE = .75; // cuánto se empina la cuesta

// Lo que cuesta pasar al nivel n de la etapa (n = 1 es el primero).
export function xpForLevel(n) {
  return Math.round(XP_BASE * Math.pow(n, XP_CURVE));
}

// De la experiencia acumulada en la etapa a: cuántos niveles lleva, cuánto tiene
// del nivel en curso y cuánto pide ese nivel. La barra sale de los dos últimos.
export function levelFromXp(xp) {
  let level = 0;
  let rest = Math.max(0, xp);
  for (let guard = 0; guard < 999; guard += 1) {
    const cost = xpForLevel(level + 1);
    if (rest < cost) return { level, into: rest, need: cost };
    rest -= cost;
    level += 1;
  }
  return { level, into: 0, need: xpForLevel(level + 1) };
}
// Se gana algo solo con el paso del tiempo, pero poco: la experiencia de verdad
// sale de hacerle caso (ver los valores de cada cuidado en care.js). Antes un
// nivel eran 4 horas de reloj y las interacciones daban migajas, asi que subir
// de nivel no dependia de ti.
export const XP_PER_TICK = 0.5;

function freshPet() {
  return {
    phase: 'egg', // egg | baby | child | teen | adult | oak
    speciesId: randomSpeciesId(),
    starter: false,   // el primero de la partida, que es un inicial
    nickname: '',     // el mote que le pongas; si no, va con el de su especie
    eggMs: 0,         // lo que lleva el huevo, en tiempo real
    stageAge: 0,      // ticks en la etapa actual
    cycleTick: 0,     // ticks totales, para el ciclo día/noche
    xp: 0,            // experiencia de la etapa actual (tiempo + interacciones)
    hunger: 100,
    happiness: 100,
    hygiene: 100,
    energy: 100,
    sick: false,
    pendingEvolution: null, // especie a la que evolucionará cuando toques el bocadillo
    poopCount: 0,
    mischiefActive: false,
    mischiefDeadline: 0,
    awakenedThisNight: false,
    careGoodEvents: 0,
    careBadEvents: 0,
  };
}

// El primer Pokémon de una partida nueva es un inicial. Se decide aquí y no en
// freshPet porque freshPet también se usa al reiniciar dentro de una partida ya
// empezada, y ahí ya no toca.
function firstPet() {
  const pet = freshPet();
  pet.speciesId = randomStarterId();
  pet.starter = true;
  return pet;
}

function freshState() {
  return {
    version: SCHEMA_VERSION,
    pet: firstPet(),
    pokedex: {}, // { [speciesId]: { seen: true, raised: bool, name, types } }
    gifts: [],   // bayas que te han regalado los salvajes, por su nombre
    settings: { notifications: false },
    notifiedAt: {}, // { [tipo de aviso]: cuándo se mandó el último }
    lastSeenAt: Date.now(),
  };
}

// Los campos que se han ido añadiendo después se rellenan aquí en vez de subir
// SCHEMA_VERSION: cambiar la versión hace que loadState tire la partida, y
// nadie quiere perder su Pokédex porque el juego haya aprendido a avisar.
function withDefaults(state) {
  if (!state.settings) state.settings = { notifications: false };
  if (typeof state.settings.notifications !== 'boolean') state.settings.notifications = false;
  if (!state.notifiedAt) state.notifiedAt = {};
  if (!state.gifts) state.gifts = [];
  return state;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== SCHEMA_VERSION) return freshState();
    return withDefaults(parsed);
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
  // Los avisos empiezan de cero con el Pokémon nuevo: si no, el que se acaba de
  // llevar Oak le deja puesta la espera al que viene.
  state.notifiedAt = {};
}

export function clearSave() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}
