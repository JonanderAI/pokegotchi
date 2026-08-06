import { loadState, saveState, clearSave, TICK_MS } from './state.js';
import * as care from './care.js';
import { hatchNewEgg, refineEggSpecies } from './lifecycle.js';
import { getSpeciesInfo } from './pokeapi.js';
import { registerSeen } from './pokedex.js';
import { initUI, render, showBanner, goHome } from './ui.js';

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

function handleEvents(events) {
  events.forEach((ev) => {
    if (ev.type === 'hatched') {
      showBanner('¡El huevo ha eclosionado!');
      ensureSpeciesRegistered();
    } else if (ev.type === 'sick') {
      showBanner('Tu Pokémon está enfermo. Dale una medicina en la Mochila.', { sticky: true });
    } else if (ev.type === 'mischief_start') {
      showBanner('¡Tu Pokémon está haciendo una travesura!', {
        sticky: true,
        actionLabel: 'Regañar',
        onAction: () => {
          care.discipline(state);
          render(state);
          saveState(state);
        },
      });
    } else if (ev.type === 'mischief_timeout') {
      showBanner('Se le pasó la travesura sin que le regañaras...');
    } else if (ev.type === 'stage_advance') {
      showBanner(ev.goodCare ? '¡Ha crecido feliz y sano!' : 'Ha crecido, pero necesita más cuidados...');
    }
  });

  if (state.pendingEvolutionNotice) {
    state.pendingEvolutionNotice = null;
    showBanner('¡Tu Pokémon ha evolucionado!');
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

function loop() {
  const events = care.tick(state);
  handleEvents(events);
  render(state);
  saveState(state);
}

initUI(state, { care, onOakContinue, saveState, resetGame });
ensureSpeciesRegistered();
tryRefineEgg();
render(state);
setInterval(loop, TICK_MS);
