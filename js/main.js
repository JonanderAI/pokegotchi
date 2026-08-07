import { loadState, saveState, clearSave, TICK_MS, SIM_TICK_MS } from './state.js';
import { loadSpriteSheets } from './sprite-anim.js';
import * as care from './care.js';
import { hatchNewEgg, refineEggSpecies } from './lifecycle.js';
import { getSpeciesInfo } from './pokeapi.js';
import { registerSeen } from './pokedex.js';
import { initUI, render, showBanner, goHome, playIntro, askNickname } from './ui.js';

const state = loadState();

async function ensureSpeciesRegistered() {
  if (state.pet.phase === 'egg' || state.pet.phase === 'oak') return;
  const info = await getSpeciesInfo(state.pet.speciesId);
  registerSeen(state, state.pet.speciesId, info);
  render(state);
  saveState(state);
}

async function tryRefineEgg() {
  const changed = await refineEggSpecies(state);
  if (changed) {
    render(state);
    saveState(state);
  }
}

// `quiet` sirve para la puesta al día: al volver tras horas fuera llegan
// decenas de eventos de golpe y no tiene sentido soltarlos uno detrás de otro,
// pero sus efectos (registrar la especie tras eclosionar o evolucionar) sí.
function handleEvents(events, { quiet = false } = {}) {
  const notify = (...args) => { if (!quiet) showBanner(...args); };

  events.forEach((ev) => {
    if (ev.type === 'hatched') {
      notify('¡El huevo ha eclosionado!', { actionLabel: 'Ponerle nombre', onAction: askNickname });
      if (!quiet) playIntro('hatch');
      ensureSpeciesRegistered();
    } else if (ev.type === 'sick') {
      notify('Tu Pokémon está enfermo. Dale una medicina en la Mochila.', { sticky: true });
    } else if (ev.type === 'mischief_start') {
      notify('¡Tu Pokémon está haciendo una travesura!', {
        sticky: true,
        actionLabel: 'Regañar',
        onAction: () => {
          care.discipline(state);
          render(state);
          saveState(state);
        },
      });
    } else if (ev.type === 'mischief_timeout') {
      notify('Se le pasó la travesura sin que le regañaras...');
    } else if (ev.type === 'stage_advance') {
      notify(ev.goodCare ? '¡Ha crecido feliz y sano!' : 'Ha crecido, pero necesita más cuidados...');
    }
  });

  if (state.pendingEvolutionNotice) {
    state.pendingEvolutionNotice = null;
    notify('¡Tu Pokémon ha evolucionado!');
    if (!quiet) playIntro('evolve');
    ensureSpeciesRegistered();
  }
}

function onOakContinue() {
  care.sendToOak(state, state.pokedex);
  hatchNewEgg(state);
  goHome();
  render(state);
  saveState(state);
  tryRefineEgg();
}

function resetGame() {
  clearSave();
  location.reload();
}

// La pantalla se repinta cada TICK_MS, pero la simulación avanza por tiempo
// real transcurrido, no por veces que se ha llamado a loop: los navegadores
// frenan los timers de las pestañas en segundo plano, y si contáramos llamadas
// el Pokémon iría más lento por tenerlo de fondo.
let pending = 0;
let lastLoopAt = Date.now();

function loop() {
  const now = Date.now();
  const elapsed = now - lastLoopAt;
  pending += elapsed;

  const events = [];

  // el huevo va por su cuenta, con el reloj de la pantalla
  if (state.pet.phase === 'egg') events.push(...care.tickEgg(state, elapsed));

  while (pending >= SIM_TICK_MS) {
    pending -= SIM_TICK_MS;
    events.push(...care.tick(state));
  }

  lastLoopAt = now;
  // sin condicion: handleEvents tambien recoge el aviso de evolucion, que lo
  // deja puesto la consulta a PokeAPI cuando le da la gana y no viene como
  // evento del tick
  handleEvents(events);
  render(state);
  saveState(state);
}

function describeAway(ticks) {
  const minutes = Math.round((ticks * SIM_TICK_MS) / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// Lo que ha pasado mientras no estabas, antes de arrancar el bucle.
function applyTimeAway() {
  const { ticks, events } = care.catchUp(state);
  if (!ticks) return;

  handleEvents(events, { quiet: true });

  // El aviso se saca del estado en el que ha quedado, no del último evento de
  // la ráfaga: lo urgente manda, y si no, se resume el rato que ha pasado solo.
  if (state.pet.phase === 'oak') {
    // la despedida del profesor ya ocupa la pantalla entera
  } else if (state.pet.mischiefActive) {
    handleEvents([{ type: 'mischief_start' }]);
  } else if (state.pet.sick) {
    handleEvents([{ type: 'sick' }]);
  } else {
    const crecio = events.some((ev) => ev.type === 'stage_advance');
    showBanner(`Han pasado ${describeAway(ticks)} desde tu última visita${crecio ? ' y ha crecido' : ''}.`);
  }

  saveState(state);
}

// Las rejillas de fotogramas hacen falta antes de pintar nada: sin ellas los
// sprites se quedarian en el estatico.
await loadSpriteSheets();

initUI(state, { care, onOakContinue, saveState, resetGame });
applyTimeAway();
ensureSpeciesRegistered();
tryRefineEgg();
render(state);
setInterval(loop, TICK_MS);
