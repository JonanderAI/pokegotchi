import { resolveSprite, iconFor, randomBerries, berryNamed, EGG_SPRITE, EGG_ICON, ITEM_ICONS } from './sprite-resolver.js';
import { applyShadow, footOffset } from './sprite-shadow.js';
import { animateSprite } from './sprite-anim.js';
import { createProjection, buildFloor, placeActor, placeProp, uRangeFor, STEP_U, STEP_V } from './world.js';
import { mountWildPokemon } from './wild.js';
import { getSpeciesInfo } from './pokeapi.js';
import { getKnownIds, getEntry, registerSeen } from './pokedex.js';
import { isNight, eggProgress, mood, currentNeeds } from './care.js';
import { levelFromXp } from './state.js';

let _state = null;
let _deps = null;
let uiTab = 'home';
let openSheet = null; // 'bag' | 'more' | null
let dexSelected = null;
let game = null;   // partida del minijuego en curso
let lastPetTapAt = 0;
let bannerTimeout = null;
let walkTimer = null;
let homeKey = null;
let petStageEl = null;
let petWrapEl = null;
let petImgEl = null;
let petShadowEl = null;
let petAnim = null;
let zEl = null;
let bubbleEl = null;
let bubbleKey = null;  // el estado que ya está pintado, para no rehacerlo cada tick
let evolving = false;  // durante la animación de evolución, antes de cambiar el sprite
let feeding = null;
let leftoverEls = [];
let currentSprite = null;
let asleepAnimApplied = false;
let statsExpanded = false;

// El escenario es un suelo en perspectiva (ver world.js). La mascota se mueve
// por la mitad delantera y los Pokémon salvajes salen por el fondo.
let projection = null;
let floorEl = null;
let petPos = { u: 0.5, v: 0.78 };
let wild = null;
let lastWildTapAt = 0;
let playdate = null;
let eggImgEl = null;
let pendingIntro = null; // 'hatch' | 'evolve'

const PET_MIN_V = 0.45;
const PET_MAX_V = 0.98;

// Los límites laterales no son fijos: dependen de lo ancho que se vea el
// Pokémon a esa profundidad, para que nunca se le corte medio cuerpo. Se usa el
// ancho medido del sprite y no el de su caja, porque los lienzos de Emerald
// dejan la mitad vacía.
function petULimits(v) {
  const measured = parseFloat(petWrapEl && petWrapEl.style.getPropertyValue('--sprite-w'));
  return uRangeFor(projection, v, Number.isFinite(measured) && measured > 0 ? measured : petSize);
}

// Con el mundo a ventana completa, el sprite ya no puede medir 168px fijos: se
// ata al tamaño de la pantalla para que el Pokémon sea el protagonista y no una
// figurita en medio del suelo. propSize son las cosas del suelo (bayas, restos).
let petSize = 168;
let propSize = 40;

function applyStageMetrics(stage) {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  // Los sprites de Emerald ocupan la mitad de su lienzo (mediana del 52% del
  // alto), así que la caja tiene que ser bastante mayor que el Pokémon que se
  // acaba viendo: con esto sale a unos 200px de alto en un móvil.
  petSize = Math.round(Math.max(220, Math.min(460, Math.min(w * 0.9, h * 0.5))));
  propSize = Math.round(petSize * 0.13);
  stage.style.setProperty('--pet-size', `${petSize}px`);
  stage.style.setProperty('--prop-size', `${propSize}px`);
}

const LEFTOVER_SLOTS = [
  { u: 0.12, v: 0.62 },
  { u: 0.88, v: 0.3 },
  { u: 0.82, v: 0.92 },
];

function destroyPetAnim() {
  if (!petAnim) return;
  petAnim.destroy();
  petAnim = null;
}

function startSpriteAnimation() {
  if (petAnim) petAnim.play();
}

// De noche se queda en la pose de reposo, quieto de verdad: con los GIF de
// antes esto era imposible y seguia moviendose mientras dormia.
function pauseSpriteAnimation() {
  if (petAnim) petAnim.rest();
}

const viewRoot = document.getElementById('view-root');
const bannerEl = document.getElementById('banner');
const pillnavEl = document.getElementById('pillnav');
const morePanelEl = document.getElementById('more-panel');
const bagPanelEl = document.getElementById('bag-panel');
const scrimEl = document.getElementById('sheet-scrim');
const berryPanelEl = document.getElementById('berry-panel');
const namePanelEl = document.getElementById('name-panel');
const nameFormEl = document.getElementById('name-form');
const nameInputEl = document.getElementById('name-input');
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
  return base + levelFromXp(pet.xp).level;
}

function xpProgress(pet) {
  const { into, need } = levelFromXp(pet.xp);
  return need > 0 ? into / need : 0;
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

  nameFormEl.addEventListener('submit', (ev) => {
    ev.preventDefault();
    _state.pet.nickname = nameInputEl.value.trim().slice(0, 12);
    closeSheets();
    render(_state);
    _deps.saveState(_state);
    if (_state.pet.nickname) {
      showBanner('Ya tiene nombre', {
        tone: 'good',
        icon: 'fa-pen',
        desc: `A partir de ahora se llama ${_state.pet.nickname}.`,
      });
    }
  });

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

const SHEETS = { bag: bagPanelEl, more: morePanelEl, berry: berryPanelEl, name: namePanelEl };

function sheetFor(name) {
  return SHEETS[name];
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
  Object.values(SHEETS).forEach((el) => el.classList.add('hidden'));
  scrimEl.classList.add('hidden');
  renderPillnav();
}

// La bandeja de bayas no es una pestaña de la barra: se abre desde la Mochila.
function openSheetNamed(name) {
  closeSheets();
  openSheet = name;
  sheetFor(name).classList.remove('hidden');
  scrimEl.classList.remove('hidden');
  renderPillnav();
}

// main.js avisa de que toca celebrar algo; la animación se aplica al montar el
// sprite nuevo, que es cuando existe el elemento.
// El mote se pide al eclosionar (desde el aviso) y se puede cambiar en Ajustes.
export function askNickname() {
  if (_state.pet.phase === 'egg' || _state.pet.phase === 'oak') return;
  nameInputEl.value = _state.pet.nickname || '';
  openSheetNamed('name');
  setTimeout(() => nameInputEl.focus(), 60);
}

export function playIntro(kind) {
  pendingIntro = kind;
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

// Los avisos van por tono, no todos iguales: el color y el icono ya dicen si es
// una buena noticia o algo que hay que atender antes de leer la frase.
const BANNER_TONES = {
  info: 'fa-circle-info',
  good: 'fa-circle-check',
  warn: 'fa-triangle-exclamation',
  bad:  'fa-circle-exclamation',
};

export function showBanner(message, opts = {}) {
  if (bannerTimeout) {
    clearTimeout(bannerTimeout);
    bannerTimeout = null;
  }
  if (!message) {
    bannerEl.classList.add('hidden');
    return;
  }

  const tone = BANNER_TONES[opts.tone] ? opts.tone : 'info';
  bannerEl.className = `banner-tone-${tone}`;
  bannerEl.innerHTML = '';

  const icon = document.createElement('span');
  icon.className = 'banner-icon';
  icon.innerHTML = `<i class="fa-solid ${opts.icon || BANNER_TONES[tone]}"></i>`;
  bannerEl.appendChild(icon);

  // Titular corto y, debajo, la explicación: el titular se lee de pasada y la
  // descripción está ahí para quien quiera saber qué hacer.
  const text = document.createElement('div');
  text.className = 'banner-text';
  const title = document.createElement('p');
  title.className = 'banner-title';
  title.textContent = message;
  text.appendChild(title);
  if (opts.desc) {
    const desc = document.createElement('p');
    desc.className = 'banner-desc';
    desc.textContent = opts.desc;
    text.appendChild(desc);
  }
  bannerEl.appendChild(text);

  if (opts.actionLabel) {
    const btn = document.createElement('button');
    btn.textContent = opts.actionLabel;
    btn.addEventListener('click', () => {
      if (opts.onAction) opts.onAction();
      bannerEl.classList.add('hidden');
    });
    bannerEl.appendChild(btn);
  }

  // reinicia la entrada aunque llegue un aviso pisando al anterior
  bannerEl.classList.remove('in');
  void bannerEl.offsetWidth;
  bannerEl.classList.add('in');

  if (!opts.sticky) {
    bannerTimeout = setTimeout(() => bannerEl.classList.add('hidden'), opts.autoHideMs || 3500);
  }
}

function renderInfoCard(state) {
  const pet = state.pet;
  const hide = pet.phase === 'oak';
  infoCardEl.style.display = hide ? 'none' : 'flex';
  if (hide) return;

  if (pet.phase === 'egg') {
    infoIconEl.src = EGG_ICON;
    infoNameEl.textContent = '???';
    infoStageEl.textContent = 'Huevo';
    infoLevelEl.textContent = '';
    infoLevelEl.classList.add('hidden');
    setXpRing(0);
    return;
  }
  infoLevelEl.classList.remove('hidden');
  const info = getEntry(state, pet.speciesId);
  infoIconEl.src = iconFor(pet.speciesId);
  // manda el mote; si no le has puesto ninguno, el nombre de su especie
  infoNameEl.textContent = pet.nickname || (info ? info.name : '???');
  infoStageEl.textContent = statusText(pet);
  infoLevelEl.textContent = levelFor(pet);
  setXpRing(xpProgress(pet));
}

// El trazo del borde se recorta con dasharray: se deja al descubierto la parte
// que toca y se esconde el resto. La longitud se mide del propio rectángulo, que
// es quien sabe cuánto mide su perímetro con las esquinas redondeadas.
let xpRingLength = 0;

function setXpRing(progress) {
  const fill = infoXpEl.querySelector('.xp-fill');
  if (!fill) return;
  if (!xpRingLength) {
    xpRingLength = typeof fill.getTotalLength === 'function' ? fill.getTotalLength() : 0;
    if (!xpRingLength) return;
    fill.style.strokeDasharray = xpRingLength;
  }
  const p = Math.max(0, Math.min(1, progress));
  fill.style.strokeDashoffset = xpRingLength * (1 - p);
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

    // Barra en vez de cinco puntos: se ve el matiz (un 55% y un 45% ya no son
    // lo mismo) y el color dice solo si hay que hacer algo.
    const value = Math.max(0, Math.min(100, values[stat]));
    el.querySelector('.stat-meter i').style.width = `${value}%`;
    el.dataset.level = value >= 60 ? 'good' : value >= 30 ? 'warn' : 'bad';
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
  if (!petStageEl || !petWrapEl || feeding || playdate || game || isNight(_state.pet)) return;

  const willWalk = Math.random() < 0.55;
  if (willWalk) {
    walkBurst(3 + Math.floor(Math.random() * 5));
  } else {
    walkTimer = setTimeout(scheduleWalk, 1500 + Math.random() * 2800);
  }
}

function walkBurst(stepsLeft) {
  if (!petStageEl || !petWrapEl || feeding || playdate || game || isNight(_state.pet)) return;
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
  const limits = petULimits(petPos.v);
  if (petPos.u <= limits.min) walkDir = 1;
  else if (petPos.u >= limits.max) walkDir = -1;
  else if (Math.random() < 0.06) walkDir = -walkDir;

  faceTo(walkDir);
  petPos.u = Math.min(limits.max, Math.max(limits.min, petPos.u + walkDir * STEP_U));

  // de vez en cuando también se acerca o se aleja de la cámara
  if (Math.random() < 0.35) {
    const towards = Math.random() < 0.5 ? -1 : 1;
    petPos.v = Math.min(PET_MAX_V, Math.max(PET_MIN_V, petPos.v + towards * STEP_V));
    const after = petULimits(petPos.v);
    petPos.u = Math.min(after.max, Math.max(after.min, petPos.u));
  }

  placePet();
  hopOnce();
}

// --- dar de comer ----------------------------------------------------------
//
// La comida no se da desde el menú: aparece una baya al azar que hay que
// arrastrar hasta un punto del escenario. El Pokémon va andando (a saltitos)
// hasta ella y se la come a mordiscos; solo entonces cuenta como alimentado.

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
  cancelPlaydate();
  goHome();
  render(_state); // si venimos de la mochila, monta la vista del Pokémon
  cancelFeeding();
  if (!petStageEl) return;

  // Primero se elige la baya (cada vez salen otras, como si rebuscaras en la
  // mochila) y luego se lanza tocando el suelo.
  const grid = berryPanelEl.querySelector('.berry-grid');
  grid.innerHTML = '';

  // Delante las que te han regalado los salvajes: alimentan más y se gastan.
  const regalos = (_state.gifts || []).map((name) => ({ ...berryNamed(name), gift: true }));
  const opciones = [...regalos, ...randomBerries(Math.max(2, 6 - regalos.length))];

  opciones.forEach((berry) => {
    const btn = document.createElement('button');
    btn.className = `berry-choice${berry.gift ? ' gift' : ''}`;
    const img = document.createElement('img');
    img.src = berry.src;
    img.alt = berry.name;
    btn.appendChild(img);
    btn.addEventListener('click', () => armBerry(berry));
    grid.appendChild(btn);
  });
  openSheetNamed('berry');
}

// Baya elegida: queda "en la mano" hasta que se toca un punto del suelo.
function armBerry(berry) {
  closeSheets();
  if (!petStageEl) return;

  const el = document.createElement('img');
  el.className = 'berry-item hidden';
  el.src = berry.src;
  el.alt = 'Baya';
  petStageEl.appendChild(el);

  feeding = {
    berryEl: el,
    berry,
    stageEl: petStageEl,
    phase: 'aiming',
    pos: { u: 0.5, v: 0.8 },
    timer: null,
    steps: 0,
  };

  petStageEl.classList.add('placing-food');
  petStageEl.addEventListener('pointerdown', onStagePlace);
  showBanner('¿Dónde se la dejas?', {
    icon: 'fa-hand-pointer',
    desc: 'Toca el suelo y la baya caerá ahí; él irá a por ella.',
    sticky: true,
  });
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
  feeding.pos.v = Math.min(PET_MAX_V, Math.max(PET_MIN_V, v));
  const limits = petULimits(feeding.pos.v);
  feeding.pos.u = Math.min(limits.max, Math.max(limits.min, u));
  placeProp(feeding.berryEl, projection, feeding.pos, propSize);
}

// La baya cae desde arriba y bota un par de veces antes de quedarse quieta.
// El transform lleva dentro la escala de profundidad, que si no se perdería.
function throwBerry() {
  const el = feeding.berryEl;
  const scale = el.style.getPropertyValue('--depth-scale') || 1;
  const fall = `scale(${scale})`;
  el.classList.remove('hidden');
  el.animate(
    [
      { transform: `translateY(-260px) ${fall}`, opacity: 0, offset: 0 },
      { transform: `translateY(-240px) ${fall}`, opacity: 1, offset: 0.05 },
      { transform: `translateY(0) ${fall}`, offset: 0.55 },
      { transform: `translateY(-38px) ${fall}`, offset: 0.72 },
      { transform: `translateY(0) ${fall}`, offset: 0.85 },
      { transform: `translateY(-12px) ${fall}`, offset: 0.93 },
      { transform: `translateY(0) ${fall}`, offset: 1 },
    ],
    { duration: 750, easing: 'linear' },
  );
}

// Se lanza donde toques: cae del cielo a ese punto del suelo.
function onStagePlace(ev) {
  if (!feeding || feeding.phase !== 'aiming') return;
  const p = stagePoint(ev);
  placeBerry(p.x, p.y);
  throwBerry();
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
  const berry = feeding.berry;
  feeding = null;
  if (el) el.remove();
  if (petImgEl) petImgEl.classList.remove('eating');

  const especial = !!(berry && berry.gift);
  if (especial) _deps.care.takeGift(_state, berry.name);
  const { woke } = _deps.care.feed(_state, { special: especial });
  showBanner('¡Ñam!', {
    tone: woke ? 'warn' : 'good',
    icon: 'fa-drumstick-bite',
    desc: woke ? 'Le has despertado para comer, pero no ha dejado ni las hojas.'
      : especial ? 'Esa baya le ha encantado: alimenta más que las normales.'
        : 'Se ha comido la baya y ya tiene menos hambre.',
  });
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

// Tocar a un salvaje manda a tu Pokémon a jugar con él: va andando hasta
// donde está, saltan juntos un rato y se lleva experiencia y felicidad. Es la
// interacción que más da, porque hay que pillarlo mientras anda por ahí.
const PLAY_REACH_U = 0.09;
const PLAY_REACH_V = 0.09;
const PLAY_HOPS = 5;
const PLAY_HOP_MS = 340;
const MAX_PLAY_STEPS = 40;

function onWildTap(actor) {
  if (game) return;
  const now = Date.now();
  if (now - lastWildTapAt < 1200) return;
  lastWildTapAt = now;

  nameOf(actor.speciesId).then((name) => {
    if (playdate && playdate.actor === actor) {
      showBanner('¡A jugar!', {
        tone: 'good',
        icon: 'fa-heart',
        desc: name ? `${name} se ha acercado con ganas de fiesta.`
          : 'Un Pokémon salvaje se ha acercado con ganas de fiesta.',
      });
    }
  });

  // si está durmiendo, comiendo o ya jugando, solo saluda
  if (playdate || feeding || isNight(_state.pet) || !petWrapEl) {
    _state.pet.happiness = Math.min(100, _state.pet.happiness + 2);
    renderStatbar(_state);
    return;
  }

  // Se para a su lado, no encima: se acerca por el lado del que viene y un
  // poco por delante, para que se vean los dos.
  const side = petPos.u <= actor.pos.u ? -1 : 1;
  const limits = petULimits(Math.min(PET_MAX_V, actor.pos.v + 0.06));
  playdate = {
    actor,
    target: {
      u: Math.min(limits.max, Math.max(limits.min, actor.pos.u + side * 0.13)),
      v: Math.min(PET_MAX_V, Math.max(PET_MIN_V, actor.pos.v + 0.06)),
    },
    steps: 0,
    hops: 0,
    timer: null,
  };
  actor.busy = true;
  stopWalkTimer();
  walkToPlaymate();
}

// El nombre solo se sabe si hay red; de paso queda registrado en la Pokédex.
async function nameOf(speciesId) {
  const known = getEntry(_state, speciesId);
  if (known) return known.name;
  const info = await getSpeciesInfo(speciesId);
  if (!info) return null;
  registerSeen(_state, speciesId, info);
  _deps.saveState(_state);
  return info.name;
}

function walkToPlaymate() {
  if (!playdate || !petWrapEl) return;
  const du = playdate.target.u - petPos.u;
  const dv = playdate.target.v - petPos.v;

  const llegado = Math.abs(du) <= PLAY_REACH_U && Math.abs(dv) <= PLAY_REACH_V;
  if (llegado || playdate.steps >= MAX_PLAY_STEPS) {
    startPlaydate();
    return;
  }
  playdate.steps += 1;

  if (Math.abs(du) > 0.01) faceTo(du < 0 ? -1 : 1);
  petPos.u += Math.max(-STEP_U, Math.min(STEP_U, du));
  petPos.v += Math.max(-STEP_V, Math.min(STEP_V, dv));
  placePet();
  hopOnce();

  playdate.timer = setTimeout(walkToPlaymate, STEP_MS);
}

// Ya juntos: saltan a la vez, salen corazones y se reparte el premio.
function startPlaydate() {
  if (!playdate) return;
  const { actor } = playdate;

  // se miran el uno al otro
  const dir = actor.pos.u < petPos.u ? -1 : 1;
  faceTo(dir);
  actor.faceTo?.(-dir);

  const bounce = () => {
    if (!playdate) return;
    hopOnce();
    actor.cheer?.();
    spawnHeart();
    playdate.hops += 1;
    if (playdate.hops >= PLAY_HOPS) {
      finishPlaydate();
      return;
    }
    playdate.timer = setTimeout(bounce, PLAY_HOP_MS);
  };
  bounce();
}

function spawnHeart() {
  if (!petWrapEl) return;
  const heart = document.createElement('img');
  heart.className = 'play-heart';
  heart.src = ITEM_ICONS.happiness;
  heart.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 40)}px`);
  petWrapEl.appendChild(heart);
  setTimeout(() => heart.remove(), 900);
}

function finishPlaydate() {
  if (!playdate) return;
  const { actor, timer } = playdate;
  clearTimeout(timer);
  playdate = null;

  actor.busy = false;
  actor.leaving = true; // se despide y sigue su camino

  const { woke, gift } = _deps.care.playWithWild(_state);
  if (gift) {
    showBanner('¡Qué bien lo habéis pasado!', {
      tone: 'good',
      icon: 'fa-gift',
      desc: 'Se despide dejándote una baya: la tienes en la Mochila.',
    });
  } else {
    showBanner('¡Qué bien lo habéis pasado!', {
      tone: woke ? 'warn' : 'good',
      icon: 'fa-heart',
      desc: woke ? 'Le has despertado para jugar, pero ha merecido la pena.'
        : 'Un rato de juego y se le nota en la felicidad.',
    });
  }
  render(_state);
  _deps.saveState(_state);
  scheduleWalk();
}

function cancelPlaydate() {
  if (!playdate) return;
  clearTimeout(playdate.timer);
  playdate.actor.busy = false;
  playdate = null;
}

// El escenario cambia de tamaño al girar el móvil: se recalcula la proyección
// y se recoloca todo lo que vive sobre el suelo.
// La cámara encuadra la franja por la que anda el Pokémon: el borde delantero
// del suelo se deja justo encima de la barra de abajo, así su zona queda
// centrada en pantalla en vez de pegada al borde inferior.
function cameraOptions(stage) {
  const stageTop = stage.getBoundingClientRect().top;
  const navTop = pillnavEl.getBoundingClientRect().top;
  const usable = navTop - stageTop - 14;
  return { bottom: usable > stage.clientHeight * 0.5 ? usable : stage.clientHeight };
}

function onStageResize() {
  if (!petStageEl || !petStageEl.isConnected) return;
  applyStageMetrics(petStageEl);
  projection = createProjection(petStageEl.clientWidth, petStageEl.clientHeight, cameraOptions(petStageEl));

  const nextFloor = buildFloor(projection);
  if (floorEl) floorEl.replaceWith(nextFloor);
  else petStageEl.prepend(nextFloor);
  floorEl = nextFloor;

  if (petAnim) petAnim.reflow();
  placePet();
  leftoverEls.forEach((el, i) => placeProp(el, projection, LEFTOVER_SLOTS[i], propSize));
  if (feeding) placeProp(feeding.berryEl, projection, feeding.pos, propSize);
  if (wild) wild.reflow();
}

function leaveHome() {
  if (homeKey === null) return;
  homeKey = null;
  stopMinigame();
  cancelPlaydate();
  cancelFeeding();
  stopWild();
  stopWalkTimer();
  destroyPetAnim();
  floorEl = null;
}

function renderHome(state) {
  const pet = state.pet;
  const key = `${pet.phase}:${pet.speciesId}`;

  if (key !== homeKey) {
    homeKey = key;
    stopWalkTimer();
    buildHomeDOM(state);
  }
  updateHomeDynamic(state);
}

function buildHomeDOM(state) {
  stopMinigame();
  cancelPlaydate();
  cancelFeeding();
  stopWild();
  viewRoot.innerHTML = '';
  eggImgEl = null;
  floorEl = null;
  petStageEl = null;
  petWrapEl = null;
  petImgEl = null;
  petShadowEl = null;
  zEl = null;
  bubbleEl = null;
  bubbleKey = null;
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
    eggImgEl = img;
    wrap.appendChild(img);
    const label = document.createElement('p');
    label.className = 'pet-substatus';
    label.textContent = 'Un huevo misterioso... ¡está a punto de eclosionar!';
    viewRoot.appendChild(wrap);
    viewRoot.appendChild(label);
    applyShadow(wrap, img, EGG_SPRITE);
    updateEgg(state);
    return;
  }

  const sprite = resolveSprite(pet.speciesId);
  currentSprite = sprite;

  const stage = document.createElement('div');
  stage.className = 'pet-stage';
  // se inserta ya para poder medirlo: la proyección depende de su tamaño
  viewRoot.appendChild(stage);

  applyStageMetrics(stage);
  projection = createProjection(stage.clientWidth, stage.clientHeight, cameraOptions(stage));
  floorEl = buildFloor(projection);
  stage.appendChild(floorEl);

  petPos = { u: 0.5, v: 0.78 };

  const wrap = document.createElement('div');
  wrap.className = 'pet-sprite-wrap tappable';

  // La sombra va antes que el sprite en el DOM para que quede por debajo.
  const shadow = document.createElement('div');
  shadow.className = 'pet-shadow';
  wrap.appendChild(shadow);

  // El sprite es un div con la rejilla de fotogramas de fondo, no un <img>:
  // así la animación la lleva el juego (ver sprite-anim.js).
  const img = document.createElement('div');
  img.className = 'pet-img';
  wrap.appendChild(img);

  // Tres Z sueltas en vez de un "Zzz" de una pieza: cada una sale por su cuenta
  // y así se ve el ritmo de la respiración.
  const z = document.createElement('div');
  z.className = 'sleep-z hidden';
  z.innerHTML = '<span>Z</span><span>Z</span><span>Z</span>';
  wrap.appendChild(z);

  // Los bocadillos cuelgan del wrap, no del escenario: así se mueven con él
  // cuando camina y no hay que recolocarlos a mano en cada paso.
  const bubble = document.createElement('div');
  bubble.className = 'pet-bubbles hidden';
  wrap.appendChild(bubble);

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
    placeProp(item, projection, slot, propSize);
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
  bubbleEl = bubble;
  bubbleKey = null;

  destroyPetAnim();
  petAnim = animateSprite(img, pet.speciesId);
  if (petAnim) {
    applyShadow(wrap, img, sprite.src, { w: petAnim.sheet.cellW, h: petAnim.sheet.cellH }).then(placePet);
  } else {
    // sin rejilla (no ha cargado el manifiesto): el sprite estático
    img.style.backgroundImage = `url("${sprite.fallback}")`;
    img.style.backgroundSize = 'contain';
    img.style.backgroundRepeat = 'no-repeat';
    applyShadow(wrap, img, sprite.fallback).then(placePet);
  }

  placePet();

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
  playPendingIntro(wrap, img);
}

// La eclosión y la evolución se celebran igual: fogonazo de luz y el sprite
// saliendo de golpe, parpadeando en blanco como en los juegos. Se hace aquí
// porque es cuando existe el sprite nuevo.
function playPendingIntro(wrap, img) {
  if (!pendingIntro) return;
  const kind = pendingIntro;
  pendingIntro = null;

  img.classList.add(kind === 'evolve' ? 'evolving' : 'hatching');

  const burst = document.createElement('div');
  burst.className = 'pet-burst';
  wrap.appendChild(burst);
  setTimeout(() => burst.remove(), 700);
}

// Cuanto menos le queda al huevo, más rápido y más fuerte se remueve.
function updateEgg(state) {
  if (!eggImgEl) return;
  const p = eggProgress(state.pet);
  eggImgEl.style.setProperty('--egg-period', `${(2.6 - p * 2.05).toFixed(2)}s`);
  eggImgEl.style.setProperty('--egg-tilt', `${(1.5 + p * 8).toFixed(1)}deg`);
  eggImgEl.style.setProperty('--egg-lift', `${Math.round(p * 7)}px`);
}

// Cada estado con su icono y su color. El color hace casi todo el trabajo: se
// lee de un vistazo sin llegar a mirar qué icono es.
const NEED_LOOK = {
  evolving: { icon: 'fa-wand-magic-sparkles',   color: '#a78bfa', label: '¡Quiere evolucionar! Tócalo' },
  sick:     { icon: 'fa-virus',                 color: '#c79ae8', label: 'Se encuentra mal' },
  mischief: { icon: 'fa-face-grin-tongue-wink', color: '#f5c469', label: 'Está haciendo una travesura' },
  sleeping: { icon: 'fa-moon',                  color: '#9aa8dd', label: 'Está durmiendo' },
  dirty:    { icon: 'fa-poo',                   color: '#c9a888', label: 'Esto está sucio' },
  hungry:   { icon: 'fa-drumstick-bite',        color: '#f4a973', label: 'Tiene hambre' },
  tired:    { icon: 'fa-face-tired',            color: '#aab6cc', label: 'Está cansado' },
  sad:      { icon: 'fa-face-frown',            color: '#93c1f0', label: 'Está triste' },
  happy:    { icon: 'fa-face-smile-beam',       color: '#86d9b3', label: 'Está genial' },
};

// Cuánto dura el "cargando" antes de que cambie el sprite: el Pokémon tiembla y
// se pone blanco, como en los juegos, y solo entonces se aplica el cambio.
const EVOLVE_CHARGE_MS = 1400;

function startEvolution() {
  if (evolving || !_state.pet.pendingEvolution) return;
  evolving = true;

  if (bubbleEl) bubbleEl.classList.add('hidden');
  if (petImgEl) petImgEl.classList.add('evolve-charge');
  if (petStageEl) petStageEl.classList.add('evolve-charge-stage');
  stopWalkTimer();

  setTimeout(() => {
    evolving = false;
    if (petStageEl) petStageEl.classList.remove('evolve-charge-stage');
    // El aviso, el fogonazo y el sprite nuevo los recoge el bucle de main.js en
    // cuanto ve pendingEvolutionNotice: aquí solo se confirma el cambio.
    if (!_deps.care.commitEvolution(_state)) return;
    _deps.saveState(_state);
  }, EVOLVE_CHARGE_MS);
}

function renderBubbles(state) {
  if (!bubbleEl) return;
  if (evolving) { bubbleEl.classList.add('hidden'); return; } // ya está en marcha

  const needs = currentNeeds(state.pet).filter((n) => NEED_LOOK[n.key]);
  if (!needs.length) {
    bubbleEl.classList.add('hidden');
    bubbleKey = null;
    return;
  }

  // Se reconstruye solo cuando cambia la lista: si no, cada medio segundo se
  // reiniciaría la animación de entrada de todos.
  const key = needs.map((n) => `${n.key}:${n.urgent}`).join('|');
  if (key !== bubbleKey) {
    bubbleKey = key;
    bubbleEl.innerHTML = '';
    needs.forEach((need, i) => {
      const look = NEED_LOOK[need.key];
      const el = document.createElement('div');
      el.className = 'pet-bubble';
      el.style.setProperty('--i', i); // su sitio en la diagonal, lo coloca el CSS
      el.classList.toggle('urgent', need.urgent);
      el.classList.toggle('calm', need.key === 'happy' || need.key === 'sleeping');
      // el de evolución no es un aviso, es un botón: se puede tocar
      el.classList.toggle('action', !!need.action);
      el.style.setProperty('--bubble-color', look.color);
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', look.label);
      el.innerHTML = `<i class="fa-solid ${look.icon}"></i>`;
      if (need.action) {
        el.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation(); // si no, cuenta también como caricia al Pokémon
          startEvolution();
        });
      }
      bubbleEl.appendChild(el);
    });
  }
  bubbleEl.classList.remove('hidden');
}

function updateHomeDynamic(state) {
  const pet = state.pet;
  if (pet.phase === 'egg') {
    updateEgg(state);
    return;
  }
  if (!petStageEl) return;

  const night = isNight(pet);

  leftoverEls.forEach((el, i) => {
    el.classList.toggle('hidden', i >= pet.poopCount);
  });

  // El ánimo se ve en cómo se mueve: contento va más vivo, decaído o malito se
  // arrastra. Es lo que se puede hacer ahora que la animación la llevamos
  // nosotros y no el GIF.
  if (petAnim) petAnim.setSpeed(0.6 + mood(pet) * 0.7);

  renderBubbles(state);

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
    // mientras evoluciona se queda quieto: es su momento
    if (!walkTimer && !evolving) scheduleWalk();
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
  { key: 'sleep', label: 'Dormir', icon: ITEM_ICONS.night },
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
  const urgent = {
    medicine: pet.sick,
    feed: pet.hunger < 35,
    clean: pet.poopCount >= 2,
    sleep: pet.energy < 30 && !isNight(pet),
  };
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
  if (key === 'sleep') {
    const { ok, reason } = care.sendToSleep(_state);
    if (ok) {
      showBanner('Buenas noches', {
        tone: 'good',
        icon: 'fa-moon',
        desc: 'Se acuesta antes de tiempo. Mientras duerme recupera energía.',
      });
    } else {
      showBanner(reason === 'already' ? 'Ya está durmiendo' : 'No tiene sueño', {
        icon: 'fa-moon',
        desc: reason === 'already'
          ? 'Déjale descansar: si le despiertas ahora se llevará un disgusto.'
          : 'Todavía va sobrado de energía. Cánsale jugando un rato.',
      });
    }
  } else if (key === 'clean') care.clean(_state);
  else if (key === 'medicine') {
    const { wasSick } = care.giveMedicine(_state);
    showBanner(wasSick ? '¡Se ha recuperado!' : 'No le hace falta', {
      tone: wasSick ? 'good' : 'info',
      icon: 'fa-pills',
      desc: wasSick ? 'Ya está sano otra vez. Cuídale la higiene para que no repita.'
        : 'Ahora mismo está sano, guarda la medicina para cuando toque.',
    });
  }
  render(_state);
  saveState(_state);
}

// --- minijuego: atrapar bayas ----------------------------------------------
//
// Caen bayas del cielo y arrastras el dedo para que tu Pokémon corra a
// cogerlas antes de que toquen el suelo. Se juega dentro del mundo, no en otra
// pantalla: por eso se mueve con la misma proyección y los mismos saltitos que
// el paseo normal, solo que más rápido.

const GAME_MS = 26000;
const GAME_DROP_MS = 1300;   // cada cuánto cae una baya
const GAME_FALL_MS = 2100;   // lo que tarda en llegar al suelo
const GAME_STEP_MS = 150;    // el paso durante la partida, mucho más ágil
const GAME_STEP_U = 0.045;
const GAME_CATCH_U = 0.1;
const GAME_GOAL = 5;         // bayas para considerar la partida un éxito

function startMinigame() {
  cancelPlaydate();
  cancelFeeding();
  goHome();
  render(_state);
  if (!petStageEl) return;

  stopWalkTimer();
  game = {
    berries: [],
    score: 0,
    targetU: petPos.u,
    endsAt: Date.now() + GAME_MS,
    dropTimer: null,
    stepTimer: null,
    endTimer: null,
  };

  petStageEl.classList.add('playing');
  petStageEl.addEventListener('pointerdown', onGamePoint);
  petStageEl.addEventListener('pointermove', onGamePoint);

  showBanner('¡A por las bayas!', {
    icon: 'fa-hand-pointer',
    desc: 'Arrastra el dedo para moverlo y que las atrape antes de que caigan.',
    sticky: true,
  });
  gameDrop();
  gameStep();
  game.endTimer = setTimeout(endMinigame, GAME_MS);
}

function onGamePoint(ev) {
  if (!game || ev.buttons === 0 && ev.type === 'pointermove') return;
  const rect = petStageEl.getBoundingClientRect();
  const { u } = projection.unproject(ev.clientX - rect.left, ev.clientY - rect.top);
  const limits = petULimits(petPos.v);
  game.targetU = Math.min(limits.max, Math.max(limits.min, u));
}

// La mascota corre hacia donde tengas el dedo, a pasos cortos y rápidos.
function gameStep() {
  if (!game || !petWrapEl) return;
  const du = game.targetU - petPos.u;
  if (Math.abs(du) > 0.005) {
    faceTo(du < 0 ? -1 : 1);
    petPos.u += Math.max(-GAME_STEP_U, Math.min(GAME_STEP_U, du));
    placePet();
    hopOnce();
  }
  game.stepTimer = setTimeout(gameStep, GAME_STEP_MS);
}

function gameDrop() {
  if (!game) return;

  const [berry] = randomBerries(1);
  const el = document.createElement('img');
  el.className = 'berry-item falling';
  el.src = berry.src;
  el.alt = '';
  petStageEl.appendChild(el);

  const limits = petULimits(petPos.v);
  const pos = {
    u: limits.min + Math.random() * (limits.max - limits.min),
    v: petPos.v,
  };
  placeProp(el, projection, pos, propSize);

  const scale = el.style.getPropertyValue('--depth-scale') || 1;
  const anim = el.animate(
    [
      { transform: `translateY(-320px) scale(${scale})` },
      { transform: `translateY(0) scale(${scale})` },
    ],
    { duration: GAME_FALL_MS, easing: 'cubic-bezier(.5,0,1,.5)' },
  );

  const item = { el, pos, anim };
  game.berries.push(item);
  anim.onfinish = () => resolveBerry(item);

  game.dropTimer = setTimeout(gameDrop, GAME_DROP_MS);
}

// Al tocar el suelo se mira si la mascota estaba debajo.
function resolveBerry(item) {
  if (!game) return;
  const i = game.berries.indexOf(item);
  if (i >= 0) game.berries.splice(i, 1);

  const cogida = Math.abs(item.pos.u - petPos.u) <= GAME_CATCH_U;
  if (cogida) {
    game.score += 1;
    _deps.care.catchBerry(_state);
    spawnHeart();
    hopOnce();
    item.el.remove();
    renderInfoCard(_state);
  } else {
    item.el.classList.add('missed');
    setTimeout(() => item.el.remove(), 400);
  }
}

function endMinigame() {
  if (!game) return;
  const { score } = game;
  stopMinigame();

  const exito = score >= GAME_GOAL;
  _deps.care.applyPlayResult(_state, exito);
  showBanner(exito ? '¡Lo habéis pasado en grande!' : 'Se acabó el tiempo', {
    tone: exito ? 'good' : 'info',
    icon: 'fa-trophy',
    desc: exito ? `${score} bayas atrapadas: ha sido una partidaza.`
      : `${score} bayas... la próxima vez seguro que caen más.`,
  });
  render(_state);
  _deps.saveState(_state);
  scheduleWalk();
}

function stopMinigame() {
  if (!game) return;
  clearTimeout(game.dropTimer);
  clearTimeout(game.stepTimer);
  clearTimeout(game.endTimer);
  game.berries.forEach((b) => {
    b.anim.onfinish = null;
    b.anim.cancel();
    b.el.remove();
  });
  game = null;
  if (petStageEl) {
    petStageEl.classList.remove('playing');
    petStageEl.removeEventListener('pointerdown', onGamePoint);
    petStageEl.removeEventListener('pointermove', onGamePoint);
  }
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

  const nameBtn = document.createElement('button');
  nameBtn.className = 'menu-item';
  nameBtn.style.width = '100%';
  nameBtn.textContent = 'Ponerle un mote';
  nameBtn.addEventListener('click', askNickname);
  viewRoot.appendChild(nameBtn);

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
