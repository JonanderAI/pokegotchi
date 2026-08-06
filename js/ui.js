import { resolveSprite, iconFor, randomBerry, EGG_SPRITE, EGG_ICON, ITEM_ICONS } from './sprite-resolver.js';
import { applyShadow, footOffset } from './sprite-shadow.js';
import { createProjection, buildFloor, placeActor, placeProp, STEP_U, STEP_V } from './world.js';
import { mountWildPokemon } from './wild.js';
import { getSpeciesInfo } from './pokeapi.js';
import { getKnownIds, getEntry, registerSeen } from './pokedex.js';
import { mountMinigame } from './minigame.js';
import { isNight } from './care.js';
import { XP_PER_LEVEL } from './state.js';

let _state = null;
let _deps = null;
let uiTab = 'home';
let openSheet = null; // 'bag' | 'more' | null
let dexSelected = null;
let minigameStop = null;
let lastPetTapAt = 0;
let bannerTimeout = null;
let flipTimer = null;
let walkTimer = null;
let homeKey = null;
let petStageEl = null;
let petWrapEl = null;
let petImgEl = null;
let petShadowEl = null;
let zEl = null;
let feeding = null;
let leftoverEls = [];
let currentSprite = null;
let asleepAnimApplied = false;
let statsExpanded = false;

// El escenario es un suelo en perspectiva (ver world.js). La mascota se mueve
// por la mitad delantera y los Pokémon salvajes salen por el fondo.
let projection = null;
let floorEl = null;
let petPos = { u: 0.5, v: 0.72 };
let wild = null;
let lastWildTapAt = 0;

const PET_MIN_U = 0.08;
const PET_MAX_U = 0.92;
const PET_MIN_V = 0.35;
const PET_MAX_V = 0.98;

const LEFTOVER_SIZE = 40;
const LEFTOVER_SLOTS = [
  { u: 0.12, v: 0.62 },
  { u: 0.88, v: 0.3 },
  { u: 0.82, v: 0.92 },
];

function startSpriteAnimation() {
  stopFlipTimer();
  if (!currentSprite || !petImgEl) return;
  if (currentSprite.kind === 'flip' && currentSprite.src2) {
    let toggled = false;
    flipTimer = setInterval(() => {
      toggled = !toggled;
      petImgEl.src = toggled ? currentSprite.src2 : currentSprite.src;
    }, 500);
  } else if (currentSprite.kind === 'gif') {
    petImgEl.src = currentSprite.src;
  }
}

function pauseSpriteAnimation() {
  stopFlipTimer();
  if (!currentSprite || !petImgEl) return;
  // Los GIF no se pueden pausar sin cambiar de imagen (y el estático suele tener
  // otro tamaño de lienzo, lo que hace "saltar" el zoom) así que esos se dejan animados.
  if (currentSprite.kind === 'flip') {
    petImgEl.src = currentSprite.src;
  }
}

const viewRoot = document.getElementById('view-root');
const bannerEl = document.getElementById('banner');
const pillnavEl = document.getElementById('pillnav');
const morePanelEl = document.getElementById('more-panel');
const bagPanelEl = document.getElementById('bag-panel');
const scrimEl = document.getElementById('sheet-scrim');
const statbarEl = document.getElementById('statbar');
const infoCardEl = document.getElementById('info-card');
const infoIconEl = document.getElementById('info-icon');
const infoNameEl = document.getElementById('info-name');
const infoStageEl = document.getElementById('info-stage');
const infoLevelEl = document.getElementById('info-level');
const infoXpEl = document.getElementById('info-xp');

const STAGE_LEVEL_BASE = { baby: 1, child: 16, teen: 32, adult: 50 };
const MORE_TABS = ['pokedex', 'settings', 'info'];

function levelFor(pet) {
  const base = STAGE_LEVEL_BASE[pet.phase] || 1;
  return base + Math.floor(pet.xp / XP_PER_LEVEL);
}

function xpProgress(pet) {
  return (pet.xp % XP_PER_LEVEL) / XP_PER_LEVEL;
}

function statusText(pet) {
  if (pet.sick) return 'Se encuentra mal...';
  return isNight(pet) ? 'Durmiendo tranquilamente' : '¡Se encuentra genial!';
}

export function initUI(state, deps) {
  _state = state;
  _deps = deps;

  infoCardEl.addEventListener('click', () => {
    statsExpanded = !statsExpanded;
    renderStatbar(_state);
  });

  buildBagPanel();

  pillnavEl.querySelectorAll('.pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      // La Mochila y el "Más" son paneles flotantes, no pantallas: se abren
      // encima de lo que haya sin sacarte de donde estás.
      if (tab === 'bag' || tab === 'more') {
        toggleSheet(tab);
        return;
      }

      stopMinigame();
      closeSheets();
      uiTab = tab;
      render(_state);
    });
  });

  window.addEventListener('resize', onStageResize);

  scrimEl.addEventListener('pointerdown', closeSheets);

  morePanelEl.querySelectorAll('.more-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      stopMinigame();
      closeSheets();
      uiTab = btn.dataset.more;
      render(_state);
    });
  });
}

// --- paneles flotantes ------------------------------------------------------

function sheetFor(name) {
  return name === 'bag' ? bagPanelEl : morePanelEl;
}

function toggleSheet(name) {
  const panel = sheetFor(name);
  const wasOpen = openSheet === name;
  closeSheets();
  if (wasOpen) return;

  openSheet = name;
  if (name === 'bag') updateBagPanel(_state);
  panel.classList.remove('hidden');
  scrimEl.classList.remove('hidden');
  showBanner(null);
  renderPillnav();
}

function closeSheets() {
  openSheet = null;
  bagPanelEl.classList.add('hidden');
  morePanelEl.classList.add('hidden');
  scrimEl.classList.add('hidden');
  renderPillnav();
}

export function goHome() {
  uiTab = 'home';
  closeSheets();
}

// Para las pestañas que no son "Pokémon", solo se reconstruye el contenido la
// primera vez que se entra en ellas: si no, cada tick (cada 500ms) borraría
// cualquier botón con estado propio (p. ej. el de "reiniciar partida" armado).
let mountedTab = null;

export function render(state) {
  _state = state;
  renderInfoCard(state);
  renderStatbar(state);
  renderPillnav();
  if (openSheet === 'bag') updateBagPanel(state);

  if (minigameStop) return; // el minijuego es dueño de #view-root mientras esté activo

  if (state.pet.phase === 'oak') {
    leaveHome();
    mountedTab = null;
    renderOak(state);
    return;
  }

  if (uiTab === 'home') {
    mountedTab = null;
    renderHome(state);
    return;
  }

  leaveHome();
  if (uiTab === mountedTab) return; // ya montado, no lo reconstruimos
  mountedTab = uiTab;

  if (uiTab === 'pokedex') renderPokedex(state);
  else if (uiTab === 'settings') renderSettings(state);
  else if (uiTab === 'info') renderInfo(state);
}

export function showBanner(message, opts = {}) {
  if (bannerTimeout) {
    clearTimeout(bannerTimeout);
    bannerTimeout = null;
  }
  if (!message) {
    bannerEl.classList.add('hidden');
    return;
  }
  bannerEl.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = message;
  bannerEl.appendChild(p);
  if (opts.actionLabel) {
    const btn = document.createElement('button');
    btn.textContent = opts.actionLabel;
    btn.addEventListener('click', () => {
      if (opts.onAction) opts.onAction();
      bannerEl.classList.add('hidden');
    });
    bannerEl.appendChild(btn);
  }
  bannerEl.classList.remove('hidden');
  if (!opts.sticky) {
    bannerTimeout = setTimeout(() => bannerEl.classList.add('hidden'), opts.autoHideMs || 3500);
  }
}

function stopMinigame() {
  if (minigameStop) {
    minigameStop();
    minigameStop = null;
  }
}

function renderInfoCard(state) {
  const pet = state.pet;
  const hide = pet.phase === 'oak';
  infoCardEl.style.display = hide ? 'none' : 'flex';
  infoXpEl.style.display = hide ? 'none' : 'block';
  if (hide) return;

  if (pet.phase === 'egg') {
    infoIconEl.src = EGG_ICON;
    infoNameEl.textContent = '???';
    infoStageEl.textContent = 'Huevo';
    infoLevelEl.innerHTML = '';
    infoXpEl.querySelector('i').style.width = '0%';
    return;
  }
  const info = getEntry(state, pet.speciesId);
  infoIconEl.src = iconFor(pet.speciesId);
  infoNameEl.textContent = info ? info.name : '???';
  infoStageEl.textContent = statusText(pet);
  infoLevelEl.innerHTML = `<span class="nvl-label">Nvl.</span> ${levelFor(pet)}`;
  infoXpEl.querySelector('i').style.width = `${Math.round(xpProgress(pet) * 100)}%`;
}

function renderStatbar(state) {
  const pet = state.pet;
  const visible = pet.phase !== 'egg' && pet.phase !== 'oak';
  statbarEl.classList.toggle('expanded', visible && statsExpanded);
  if (!visible) return;

  const values = { hunger: pet.hunger, happiness: pet.happiness, hygiene: pet.hygiene, energy: pet.energy };
  const icons = {
    hunger: ITEM_ICONS.feed,
    happiness: ITEM_ICONS.happiness,
    hygiene: ITEM_ICONS.hygiene,
    energy: isNight(pet) ? ITEM_ICONS.night : ITEM_ICONS.day,
  };
  statbarEl.querySelectorAll('.stat-row').forEach((el) => {
    const stat = el.dataset.stat;
    el.querySelector('img').src = icons[stat];
    const filled = Math.max(0, Math.min(5, Math.round(values[stat] / 20)));
    const dotsEl = el.querySelector('.stat-dots');
    dotsEl.innerHTML = '';
    for (let i = 0; i < 5; i += 1) {
      const dot = document.createElement('span');
      dot.className = `dot${i < filled ? ' filled' : ''}`;
      dotsEl.appendChild(dot);
    }
  });
}

function renderPillnav() {
  const hide = _state.pet.phase === 'oak';
  pillnavEl.style.display = hide ? 'none' : 'flex';
  if (hide && openSheet) closeSheets();

  pillnavEl.querySelectorAll('.pill-btn').forEach((btn) => {
    const tab = btn.dataset.tab;
    let active;
    if (tab === 'more') active = openSheet === 'more' || MORE_TABS.includes(uiTab);
    else if (tab === 'bag') active = openSheet === 'bag';
    else active = uiTab === tab && !openSheet;
    btn.classList.toggle('active', active);
  });
}

function stopWalkTimer() {
  if (walkTimer) {
    clearTimeout(walkTimer);
    walkTimer = null;
  }
}

function stopFlipTimer() {
  if (flipTimer) {
    clearInterval(flipTimer);
    flipTimer = null;
  }
}

const STEP_MS = 500;

// Recoloca a la mascota en el suelo según su posición en el mundo. Se llama en
// cada paso y cada vez que cambia el tamaño del escenario.
function placePet() {
  if (!petWrapEl || !projection) return;
  placeActor(petWrapEl, projection, petPos, footOffset(petWrapEl));
}

// Paseo intermitente a saltos de píxeles (sin transición suave ni giros): a ratos
// quieto, a ratos da una tanda corta de pasos, como un Tamagotchi real.
function scheduleWalk() {
  stopWalkTimer();
  if (!petStageEl || !petWrapEl || feeding || isNight(_state.pet)) return;

  const willWalk = Math.random() < 0.55;
  if (willWalk) {
    walkBurst(3 + Math.floor(Math.random() * 5));
  } else {
    walkTimer = setTimeout(scheduleWalk, 1500 + Math.random() * 2800);
  }
}

function walkBurst(stepsLeft) {
  if (!petStageEl || !petWrapEl || feeding || isNight(_state.pet)) return;
  if (stepsLeft <= 0) {
    walkTimer = setTimeout(scheduleWalk, 1200 + Math.random() * 2200);
    return;
  }
  stepOnce();
  walkTimer = setTimeout(() => walkBurst(stepsLeft - 1), STEP_MS);
}

let walkDir = 1;

// Cada paso es un saltito: el sprite sube y baja a frames fijos y la sombra se
// encoge un poco mientras está en el aire (las animaciones están en base.css).
function hopOnce() {
  [petImgEl, petShadowEl].forEach((el) => {
    if (!el) return;
    el.classList.remove('hop');
    void el.offsetWidth; // reinicia la animación en cada paso
    el.classList.add('hop');
  });
}

function faceTo(dir) {
  if (petImgEl) petImgEl.style.setProperty('--flip', dir < 0 ? '1' : '-1');
}

// Un paso mide siempre lo mismo sobre el suelo: al fondo se ve más corto y el
// Pokémon se hace más pequeño, que es lo que da la sensación de profundidad.
function stepOnce() {
  if (petPos.u <= PET_MIN_U) walkDir = 1;
  else if (petPos.u >= PET_MAX_U) walkDir = -1;
  else if (Math.random() < 0.06) walkDir = -walkDir;

  faceTo(walkDir);
  petPos.u = Math.min(PET_MAX_U, Math.max(PET_MIN_U, petPos.u + walkDir * STEP_U));

  // de vez en cuando también se acerca o se aleja de la cámara
  if (Math.random() < 0.35) {
    const towards = Math.random() < 0.5 ? -1 : 1;
    petPos.v = Math.min(PET_MAX_V, Math.max(PET_MIN_V, petPos.v + towards * STEP_V));
  }

  placePet();
  hopOnce();
}

// --- dar de comer ----------------------------------------------------------
//
// La comida no se da desde el menú: aparece una baya al azar que hay que
// arrastrar hasta un punto del escenario. El Pokémon va andando (a saltitos)
// hasta ella y se la come a mordiscos; solo entonces cuenta como alimentado.

const BERRY_SIZE = 40;
const REACH_U = 0.05;      // "ya la alcanza", en unidades del suelo
const REACH_V = 0.06;
const EAT_MS = 1000;
const MAX_FEED_STEPS = 60; // red de seguridad por si no consigue llegar

function cancelFeeding() {
  if (!feeding) return;
  clearTimeout(feeding.timer);
  if (feeding.berryEl) feeding.berryEl.remove();
  if (feeding.stageEl) {
    feeding.stageEl.classList.remove('placing-food');
    feeding.stageEl.removeEventListener('pointerdown', onStagePlace);
  }
  if (petImgEl) petImgEl.classList.remove('eating');
  feeding = null;
}

function startFeeding() {
  goHome();
  render(_state); // si venimos de la mochila, monta la vista del Pokémon
  cancelFeeding();
  if (!petStageEl) return;

  const berry = randomBerry();
  const el = document.createElement('img');
  el.className = 'berry-item grabbable waiting';
  el.src = berry.src;
  el.alt = 'Baya';
  el.addEventListener('pointerdown', onBerryGrab);
  petStageEl.appendChild(el);

  feeding = {
    berryEl: el,
    stageEl: petStageEl,
    phase: 'drag',
    pos: { u: 0.5, v: 0.95 }, // empieza en primer plano, a mano
    timer: null,
    steps: 0,
  };
  placeProp(el, projection, feeding.pos, BERRY_SIZE);
  stopWalkTimer();
  // mientras se coloca la baya, los salvajes no roban el toque
  petStageEl.classList.add('placing-food');
  petStageEl.addEventListener('pointerdown', onStagePlace);
  showBanner('Arrastra la baya donde quieras: irá a buscarla.', { sticky: true });
}

// Coordenadas del escenario a partir de un evento de puntero.
function stagePoint(ev) {
  const rect = feeding.stageEl.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

// Deja la baya en el punto del suelo que hay bajo el dedo, dentro de la zona
// por la que la mascota se puede mover.
function placeBerry(x, y) {
  const { u, v } = projection.unproject(x, y);
  feeding.pos.u = Math.min(PET_MAX_U, Math.max(PET_MIN_U, u));
  feeding.pos.v = Math.min(PET_MAX_V, Math.max(PET_MIN_V, v));
  placeProp(feeding.berryEl, projection, feeding.pos, BERRY_SIZE);
}

function onBerryGrab(ev) {
  if (!feeding || feeding.phase !== 'drag') return;
  ev.preventDefault();
  ev.stopPropagation();
  const el = feeding.berryEl;
  el.classList.remove('waiting');
  el.classList.add('grabbed');
  el.setPointerCapture(ev.pointerId);
  el.addEventListener('pointermove', onBerryMove);
  el.addEventListener('pointerup', onBerryDrop);
  el.addEventListener('pointercancel', onBerryDrop);
}

function onBerryMove(ev) {
  if (!feeding || feeding.phase !== 'drag') return;
  const p = stagePoint(ev);
  placeBerry(p.x, p.y);
}

function onBerryDrop(ev) {
  if (!feeding || feeding.phase !== 'drag') return;
  const el = feeding.berryEl;
  el.removeEventListener('pointermove', onBerryMove);
  el.removeEventListener('pointerup', onBerryDrop);
  el.removeEventListener('pointercancel', onBerryDrop);
  el.classList.remove('grabbed', 'grabbable');
  dropBerry();
}

// Tocar el escenario también vale para soltar ahí la baya (más cómodo que
// arrastrar en pantallas pequeñas).
function onStagePlace(ev) {
  if (!feeding || feeding.phase !== 'drag') return;
  if (ev.target === feeding.berryEl) return;
  const p = stagePoint(ev);
  placeBerry(p.x, p.y);
  feeding.berryEl.classList.remove('waiting', 'grabbable');
  dropBerry();
}

function dropBerry() {
  feeding.phase = 'walking';
  feeding.steps = 0;
  feeding.stageEl.classList.remove('placing-food');
  feeding.stageEl.removeEventListener('pointerdown', onStagePlace);
  showBanner(null);
  walkToBerry();
}

function walkToBerry() {
  if (!feeding || feeding.phase !== 'walking' || !petWrapEl || !petStageEl) return;

  const du = feeding.pos.u - petPos.u;
  const dv = feeding.pos.v - petPos.v;

  if ((Math.abs(du) <= REACH_U && Math.abs(dv) <= REACH_V) || feeding.steps >= MAX_FEED_STEPS) {
    startEating();
    return;
  }
  feeding.steps += 1;

  if (Math.abs(du) > 0.01) faceTo(du < 0 ? -1 : 1);

  petPos.u += Math.max(-STEP_U, Math.min(STEP_U, du));
  petPos.v += Math.max(-STEP_V, Math.min(STEP_V, dv));
  placePet();

  hopOnce();
  feeding.timer = setTimeout(walkToBerry, STEP_MS);
}

function startEating() {
  feeding.phase = 'eating';
  feeding.berryEl.classList.add('eaten');
  if (petImgEl) {
    petImgEl.classList.remove('eating');
    void petImgEl.offsetWidth;
    petImgEl.classList.add('eating');
  }
  feeding.timer = setTimeout(finishEating, EAT_MS);
}

function finishEating() {
  const el = feeding.berryEl;
  feeding = null;
  if (el) el.remove();
  if (petImgEl) petImgEl.classList.remove('eating');

  const { woke } = _deps.care.feed(_state);
  showBanner(woke ? '¡Ñam! Le has despertado, pero se la ha comido.' : '¡Ñam! Se ha comido la baya.');
  render(_state);
  _deps.saveState(_state);
  scheduleWalk();
}

// --- Pokémon salvajes ------------------------------------------------------

function mountWild(state) {
  stopWild();
  if (!petStageEl) return;
  wild = mountWildPokemon(petStageEl, () => projection, {
    excludeId: state.pet.speciesId,
    // de noche no sale nadie (y los que estén se van)
    isPaused: () => !petStageEl || isNight(_state.pet),
    onTap: onWildTap,
  });
}

function stopWild() {
  if (!wild) return;
  wild.stop();
  wild = null;
}

// Tocar a un salvaje: se saluda, la mascota se anima un poco y, si hay red, la
// especie queda registrada como vista en la Pokédex.
async function onWildTap(actor) {
  const now = Date.now();
  if (now - lastWildTapAt < 1500) return;
  lastWildTapAt = now;

  _state.pet.happiness = Math.min(100, _state.pet.happiness + 2);
  renderStatbar(_state);

  const known = getEntry(_state, actor.speciesId);
  if (known) {
    showBanner(`¡Un ${known.name} salvaje te saluda!`);
    return;
  }

  showBanner('¡Un Pokémon salvaje te saluda!');
  const info = await getSpeciesInfo(actor.speciesId);
  if (!info) return;
  registerSeen(_state, actor.speciesId, info);
  _deps.saveState(_state);
  showBanner(`¡Un ${info.name} salvaje te saluda!`);
}

// El escenario cambia de tamaño al girar el móvil: se recalcula la proyección
// y se recoloca todo lo que vive sobre el suelo.
function onStageResize() {
  if (!petStageEl || !petStageEl.isConnected) return;
  projection = createProjection(petStageEl.clientWidth, petStageEl.clientHeight);

  const nextFloor = buildFloor(projection);
  if (floorEl) floorEl.replaceWith(nextFloor);
  else petStageEl.prepend(nextFloor);
  floorEl = nextFloor;

  placePet();
  leftoverEls.forEach((el, i) => placeProp(el, projection, LEFTOVER_SLOTS[i], LEFTOVER_SIZE));
  if (feeding) placeProp(feeding.berryEl, projection, feeding.pos, BERRY_SIZE);
  if (wild) wild.reflow();
}

function leaveHome() {
  if (homeKey === null) return;
  homeKey = null;
  cancelFeeding();
  stopWild();
  stopWalkTimer();
  stopFlipTimer();
  floorEl = null;
}

function renderHome(state) {
  const pet = state.pet;
  const key = `${pet.phase}:${pet.speciesId}`;

  if (key !== homeKey) {
    homeKey = key;
    stopWalkTimer();
    stopFlipTimer();
    buildHomeDOM(state);
  }
  updateHomeDynamic(state);
}

function buildHomeDOM(state) {
  cancelFeeding();
  stopWild();
  viewRoot.innerHTML = '';
  floorEl = null;
  petStageEl = null;
  petWrapEl = null;
  petImgEl = null;
  petShadowEl = null;
  zEl = null;
  leftoverEls = [];

  const pet = state.pet;

  if (pet.phase === 'egg') {
    const wrap = document.createElement('div');
    wrap.className = 'egg-wrap';
    const shadow = document.createElement('div');
    shadow.className = 'pet-shadow';
    wrap.appendChild(shadow);
    const img = document.createElement('img');
    img.src = EGG_SPRITE;
    img.onerror = () => {
      img.src = EGG_ICON;
      applyShadow(wrap, img, EGG_ICON);
    };
    wrap.appendChild(img);
    const label = document.createElement('p');
    label.className = 'pet-substatus';
    label.textContent = 'Un huevo misterioso... ¡está a punto de eclosionar!';
    viewRoot.appendChild(wrap);
    viewRoot.appendChild(label);
    applyShadow(wrap, img, EGG_SPRITE);
    return;
  }

  const sprite = resolveSprite(pet.speciesId);
  currentSprite = sprite;

  const stage = document.createElement('div');
  stage.className = 'pet-stage';
  // se inserta ya para poder medirlo: la proyección depende de su tamaño
  viewRoot.appendChild(stage);

  projection = createProjection(stage.clientWidth, stage.clientHeight);
  floorEl = buildFloor(projection);
  stage.appendChild(floorEl);

  petPos = { u: 0.5, v: 0.72 };

  const wrap = document.createElement('div');
  wrap.className = 'pet-sprite-wrap tappable';

  // La sombra va antes que el sprite en el DOM para que quede por debajo.
  const shadow = document.createElement('div');
  shadow.className = 'pet-shadow';
  wrap.appendChild(shadow);

  const img = document.createElement('img');
  img.className = 'pet-img';
  img.src = sprite.src;
  img.onerror = () => {
    if (sprite.fallback) {
      img.src = sprite.fallback;
      applyShadow(wrap, img, sprite.fallback);
    }
  };
  wrap.appendChild(img);

  const z = document.createElement('div');
  z.className = 'sleep-z hidden';
  z.textContent = 'Zzz';
  wrap.appendChild(z);

  wrap.addEventListener('pointerdown', () => {
    const now = Date.now();
    if (now - lastPetTapAt < 2500) return;
    lastPetTapAt = now;
    _state.pet.happiness = Math.min(100, _state.pet.happiness + 4);
    img.classList.remove('tap-bounce');
    shadow.classList.remove('tap-bounce');
    void img.offsetWidth; // reinicia la animación aunque se repita rápido
    img.classList.add('tap-bounce');
    shadow.classList.add('tap-bounce');
    renderStatbar(_state);
  });

  stage.appendChild(wrap);

  // Los restos también están sobre el suelo, así que los de atrás se ven más
  // pequeños y quedan tapados por quien pase por delante.
  leftoverEls = LEFTOVER_SLOTS.map((slot) => {
    const item = document.createElement('img');
    item.className = 'leftover-item hidden';
    item.src = ITEM_ICONS.leftovers;
    item.addEventListener('click', () => {
      _deps.care.removeLeftover(_state);
      render(_state);
      _deps.saveState(_state);
    });
    stage.appendChild(item);
    placeProp(item, projection, slot, LEFTOVER_SIZE);
    return item;
  });

  // Van al final para quedar por encima de todo lo que hay sobre el suelo: son
  // el desenfoque de la cámara, no una capa del escenario.
  ['far', 'near'].forEach((zone) => {
    const layer = document.createElement('div');
    layer.className = `tilt-shift ${zone}`;
    stage.appendChild(layer);
  });

  petStageEl = stage;
  petWrapEl = wrap;
  petImgEl = img;
  petShadowEl = shadow;
  zEl = z;

  placePet();
  // la sombra medida da el punto de apoyo exacto: al llegar hay que recolocar
  applyShadow(wrap, img, sprite.src).then(placePet);

  mountWild(state);

  asleepAnimApplied = false;
  if (isNight(state.pet)) {
    asleepAnimApplied = true;
    wrap.classList.add('asleep');
    pauseSpriteAnimation();
  } else {
    startSpriteAnimation();
  }

  scheduleWalk();
}

function updateHomeDynamic(state) {
  const pet = state.pet;
  if (pet.phase === 'egg' || !petStageEl) return;

  const night = isNight(pet);

  leftoverEls.forEach((el, i) => {
    el.classList.toggle('hidden', i >= pet.poopCount);
  });

  if (zEl) zEl.classList.toggle('hidden', !night);
  if (petWrapEl) petWrapEl.classList.toggle('asleep', night);
  petStageEl.classList.toggle('night', night);

  if (night) {
    stopWalkTimer();
    if (!asleepAnimApplied) {
      asleepAnimApplied = true;
      pauseSpriteAnimation();
    }
  } else {
    if (!walkTimer) scheduleWalk();
    if (asleepAnimApplied) {
      asleepAnimApplied = false;
      startSpriteAnimation();
    }
  }
}

const BAG_ITEMS = [
  { key: 'feed', label: 'Comida', icon: ITEM_ICONS.feed },
  { key: 'play', label: 'Jugar', icon: ITEM_ICONS.play },
  { key: 'clean', label: 'Limpiar', icon: ITEM_ICONS.hygiene },
  { key: 'medicine', label: 'Medicina', icon: ITEM_ICONS.medicine },
];

// El contenido de la Mochila se monta una vez; al abrirla solo se actualiza
// qué hace falta ahora mismo.
function buildBagPanel() {
  const grid = bagPanelEl.querySelector('.bag-grid');
  BAG_ITEMS.forEach((item) => {
    const btn = document.createElement('button');
    btn.className = 'bag-item';
    btn.dataset.key = item.key;
    const img = document.createElement('img');
    img.src = item.icon;
    img.alt = '';
    const span = document.createElement('span');
    span.textContent = item.label;
    btn.append(img, span);
    btn.addEventListener('click', () => onMenuAction(item.key));
    grid.appendChild(btn);
  });
}

function updateBagPanel(state) {
  const pet = state.pet;
  const usable = pet.phase !== 'egg' && pet.phase !== 'oak';

  bagPanelEl.querySelector('.bag-grid').classList.toggle('hidden', !usable);
  bagPanelEl.querySelector('.sheet-empty').classList.toggle('hidden', usable);
  if (!usable) return;

  // un punto rojo en lo que toca: medicina si está malito, comida si tiene hambre
  const urgent = { medicine: pet.sick, feed: pet.hunger < 35, clean: pet.poopCount >= 2 };
  bagPanelEl.querySelectorAll('.bag-item').forEach((btn) => {
    btn.classList.toggle('urgent', !!urgent[btn.dataset.key]);
  });
}

function onMenuAction(key) {
  const { care, saveState } = _deps;
  closeSheets();
  stopMinigame();
  if (key === 'play') {
    startMinigame();
    return;
  }
  if (key === 'feed') {
    startFeeding();
    return;
  }
  if (key === 'clean') care.clean(_state);
  else if (key === 'medicine') {
    const { wasSick } = care.giveMedicine(_state);
    showBanner(wasSick ? '¡Se ha recuperado!' : 'No hace falta medicina ahora mismo.');
  }
  render(_state);
  saveState(_state);
}

function startMinigame() {
  // el minijuego se queda con #view-root, así que hay que soltar el mundo:
  // si no, al volver quedarían los timers y el DOM viejo colgando
  leaveHome();
  viewRoot.innerHTML = '';
  mountedTab = null;
  minigameStop = mountMinigame(viewRoot, (success) => {
    minigameStop = null;
    _deps.care.applyPlayResult(_state, success);
    showBanner(success ? '¡Buena partida! Tu Pokémon está más feliz.' : 'No ha ido muy bien, ¡pero lo ha pasado bien!');
    render(_state);
    _deps.saveState(_state);
  });
}

function renderPokedex(state) {
  viewRoot.innerHTML = '';
  const raisedCount = Object.values(state.pokedex).filter((e) => e.raised).length;

  const title = document.createElement('p');
  title.className = 'dex-title';
  title.textContent = `Pokédex — ${raisedCount} criados`;
  viewRoot.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'dex-grid';
  getKnownIds().forEach((id) => {
    const entry = getEntry(state, id);
    const cell = document.createElement('div');
    cell.className = `dex-cell${entry ? '' : ' locked'}`;
    const img = document.createElement('img');
    img.src = iconFor(id);
    cell.appendChild(img);
    cell.addEventListener('click', () => { dexSelected = id; renderPokedex(state); });
    grid.appendChild(cell);
  });
  viewRoot.appendChild(grid);

  if (dexSelected != null) {
    const entry = getEntry(state, dexSelected);
    const detail = document.createElement('div');
    detail.className = 'dex-detail';
    detail.textContent = entry
      ? `#${dexSelected} ${entry.name} — ${entry.types.join('/')} (${entry.raised ? 'criado' : 'visto'})`
      : `#${dexSelected} — ???`;
    viewRoot.appendChild(detail);
  }
}

function renderSettings() {
  viewRoot.innerHTML = '';
  const title = document.createElement('p');
  title.className = 'screen-title';
  title.textContent = 'Ajustes';
  viewRoot.appendChild(title);

  const btn = document.createElement('button');
  btn.className = 'menu-item';
  btn.style.width = '100%';
  btn.textContent = 'Reiniciar partida';
  let armed = false;
  let armTimeout = null;
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      btn.textContent = '¿Seguro? Toca otra vez para borrarlo todo';
      armTimeout = setTimeout(() => {
        armed = false;
        btn.textContent = 'Reiniciar partida';
      }, 3000);
      return;
    }
    clearTimeout(armTimeout);
    _deps.resetGame();
  });
  viewRoot.appendChild(btn);
}

function renderInfo() {
  viewRoot.innerHTML = '';
  const title = document.createElement('p');
  title.className = 'screen-title';
  title.textContent = 'PokéGotchi';
  const p = document.createElement('p');
  p.className = 'dex-detail';
  p.textContent = 'Cría un Pokémon desde que nace en un huevo hasta que el profesor Oak se lo lleva para estudiarlo, y así hasta llenar tu Pokédex. Sprites e iconos de los juegos originales; nombres y tipos vía PokeAPI.';
  viewRoot.appendChild(title);
  viewRoot.appendChild(p);
}

function renderOak(state) {
  viewRoot.innerHTML = '';
  const info = getEntry(state, state.pet.speciesId);
  const p = document.createElement('p');
  p.className = 'screen-title';
  p.textContent = `El profesor Oak ha venido a recoger a ${info ? info.name : 'tu Pokémon'} para estudiarlo. ¡Gracias por cuidarlo tan bien!`;
  const btn = document.createElement('button');
  btn.className = 'menu-item';
  btn.style.marginTop = '16px';
  btn.style.width = '100%';
  btn.textContent = 'Recibir un nuevo huevo';
  btn.addEventListener('click', () => _deps.onOakContinue());
  viewRoot.appendChild(p);
  viewRoot.appendChild(btn);
}
