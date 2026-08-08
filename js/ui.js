import { resolveSprite, iconFor, randomBerries, berryNamed, EGG_SPRITE, EGG_ICON, ITEM_ICONS } from './sprite-resolver.js';
import { applyShadow, footOffset, pixelShadowUrl } from './sprite-shadow.js';
import { animateSprite } from './sprite-anim.js';
import { createProjection, buildFloor, placeActor, placeProp, uRangeFor, quantizeScale, STEP_U, STEP_V } from './world.js';
import { mountWildPokemon } from './wild.js';
import { getSpeciesInfo } from './pokeapi.js';
import { getKnownIds, getEntry, registerSeen } from './pokedex.js';
import { isNight, eggProgress, mood, currentNeeds } from './care.js';
import { levelFromXp } from './state.js';
import * as notify from './notify.js';

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
let cameraEl = null;
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

// Hasta dónde puede irse por el suelo. Va de casi el fondo a casi el borde de
// delante: el sitio lo hay, y con la cámara siguiéndole ya no se pierde de vista
// por alejarse.
const PET_MIN_V = 0.22;
const PET_MAX_V = 1.02;

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

const screenEl = document.getElementById('screen');
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
    // el panel tarda en abrirse, así que el aviso se recoloca cuando ya ha crecido
    positionBanner();
    setTimeout(positionBanner, 260);
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

  // Un guiño a cada toque, en cualquier parte: unas rayitas azules que salen del
  // dedo y se apagan. No hace nada, pero la pantalla deja de sentirse muerta.
  screenEl.addEventListener('pointerdown', (ev) => {
    const rect = screenEl.getBoundingClientRect();
    spawnTapBurst(ev.clientX - rect.left, ev.clientY - rect.top);
  });

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

const TAP_BURST_BARS = 8;

function spawnTapBurst(x, y) {
  const burst = document.createElement('div');
  burst.className = 'tap-burst';
  burst.style.left = `${x.toFixed(1)}px`;
  burst.style.top = `${y.toFixed(1)}px`;

  // El grupo entero sale girado al azar y cada rayita se separa un poco de su
  // sitio exacto: si van siempre en los mismos ángulos, tocar dos veces seguidas
  // se ve como la misma estampa repetida.
  const spin = Math.random() * 360;

  for (let i = 0; i < TAP_BURST_BARS; i += 1) {
    const bar = document.createElement('i');
    const angle = spin + (i * 360) / TAP_BURST_BARS + (Math.random() - 0.5) * 16;
    bar.style.setProperty('--angle', `${angle.toFixed(1)}deg`);
    bar.style.setProperty('--reach', `${(18 + Math.random() * 12).toFixed(1)}px`);
    bar.style.setProperty('--len', `${(8 + Math.random() * 6).toFixed(1)}px`);
    bar.style.animationDelay = `${(Math.random() * 70).toFixed(0)}ms`;
    burst.appendChild(bar);
  }

  screenEl.appendChild(burst);
  setTimeout(() => burst.remove(), 700);
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
const MAX_BANNER_ACTIONS = 2;

// Dónde acaba la tarjeta del Pokémon; lo actualiza renderInfoCard, que es quien
// la tiene delante.
let cardTop = 18;
let cardHeight = 84;

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
    hideBanner();
    return;
  }

  // Hay avisos que no se asoman: se ponen en el sitio de la tarjeta del Pokémon
  // y la sustituyen mientras duran (la partida, por ejemplo). Así no hay dos
  // tarjetas a la vez y el aviso manda mientras está pasando algo.
  screenEl.classList.toggle('banner-as-card', !!opts.asCard);
  // Pegado al borde de abajo de la tarjeta, medido: la altura de la tarjeta
  // depende de lo que ponga dentro, así que un número fijo se descuadra solo.
  bannerAsCard = !!opts.asCard;
  positionBanner();

  const tone = BANNER_TONES[opts.tone] ? opts.tone : 'info';
  // className limpio: se lleva por delante 'hidden' y el 'out' de un aviso que
  // se estuviera yendo, que si no se comería al que entra
  bannerEl.className = `banner-tone-${tone}`;
  bannerEl.innerHTML = '';

  const icon = document.createElement('span');
  icon.className = 'banner-icon';
  // El anillo alrededor del icono es el mismo truco que el de la exp: aquí
  // cuenta lo que le queda al aviso antes de irse solo. En los que se quedan
  // puestos no hay nada que contar, así que no sale.
  icon.innerHTML = `
    <svg class="banner-ring" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <rect class="ring-track" x="1.5" y="1.5" width="41" height="41" rx="10.5" />
      <rect class="ring-fill" x="1.5" y="1.5" width="41" height="41" rx="10.5" />
    </svg>
    <i class="fa-solid ${opts.icon || BANNER_TONES[tone]}"></i>`;
  bannerEl.appendChild(icon);

  // Titular corto y, debajo, la explicación: el titular se lee de pasada y la
  // descripción está ahí para quien quiera saber qué hacer.
  const text = document.createElement('div');
  text.className = 'banner-text';
  const title = document.createElement('p');
  title.className = 'banner-title';
  title.textContent = message;
  text.appendChild(title);

  // La descripción solo sale cuando hay algo que hacer (o cuando el aviso se
  // queda puesto): en los de paso, el titular ya lo dice todo y dos líneas más
  // tapan media pantalla para nada.
  // Como mucho dos: un aviso con más botones deja de ser un aviso.
  const actions = (opts.actions || []).slice(0, MAX_BANNER_ACTIONS);

  const withDesc = opts.sticky || actions.length || opts.keepDesc;
  if (opts.desc && withDesc) {
    const desc = document.createElement('p');
    desc.className = 'banner-desc';
    desc.textContent = opts.desc;
    text.appendChild(desc);
  }
  bannerEl.appendChild(text);

  // Los botones son iconos y van a la derecha: con texto ensanchaban el aviso
  // hasta el borde y lo que se leía primero era el botón, no lo que pasaba.
  if (actions.length) {
    const box = document.createElement('div');
    box.className = 'banner-actions';

    actions.forEach((action, i) => {
      const btn = document.createElement('button');
      // el primero es el que se espera que pulses, el segundo va en discreto
      btn.className = i === 0 ? 'banner-action primary' : 'banner-action';
      btn.innerHTML = `<i class="fa-solid ${action.icon}"></i>`;
      btn.setAttribute('aria-label', action.label);
      btn.title = action.label;
      btn.addEventListener('click', () => {
        if (action.onAction) action.onAction();
        hideBanner();
      });
      box.appendChild(btn);
    });

    bannerEl.appendChild(box);
  }

  // reinicia la entrada aunque llegue un aviso pisando al anterior
  bannerEl.classList.remove('in');
  void bannerEl.offsetWidth;
  bannerEl.classList.add('in');

  if (opts.sticky) {
    // no hay cuenta atrás: el aviso se queda hasta que hagas algo
    icon.querySelector('.banner-ring').remove();
  } else {
    const ms = opts.autoHideMs || 3500;
    runBannerCountdown(icon.querySelector('.banner-ring'), ms);
    bannerTimeout = setTimeout(hideBanner, ms);
  }
}

// El anillo se vacía en el tiempo que le queda al aviso. Va con la animación del
// navegador y no con el bucle del juego: es cosa de la pantalla, y así no se
// come un tick si el móvil frena la pestaña.
function runBannerCountdown(ring, ms) {
  if (!ring) return;
  const fill = ring.querySelector('.ring-fill');
  const m = ringMetrics(fill);
  if (!m) return;
  const len = m.len;

  fill.animate(
    [{ strokeDasharray: `${len} 0` }, { strokeDasharray: `0 ${len}` }],
    { duration: ms, easing: 'linear', fill: 'forwards' },
  );
}

// Se va hacia arriba en vez de desaparecer de golpe. El 'hidden' se pone al
// acabar la animación, y solo si no ha entrado otro aviso por el camino.
function hideBanner() {
  if (bannerTimeout) {
    clearTimeout(bannerTimeout);
    bannerTimeout = null;
  }
  if (bannerEl.classList.contains('hidden')) return;

  screenEl.classList.remove('banner-as-card');
  bannerEl.classList.remove('in');
  bannerEl.classList.add('out');
  setTimeout(() => {
    if (bannerEl.classList.contains('out')) bannerEl.classList.add('hidden');
  }, 260);
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
  measureInfoCard();
  const info = getEntry(state, pet.speciesId);
  infoIconEl.src = iconFor(pet.speciesId);
  // manda el mote; si no le has puesto ninguno, el nombre de su especie
  infoNameEl.textContent = pet.nickname || (info ? info.name : '???');
  infoStageEl.textContent = statusText(pet);
  infoLevelEl.innerHTML = `<b>Nv.</b>${levelFor(pet)}`;
  setXpRing(xpProgress(pet));
}

// --- anillos de progreso -----------------------------------------------------
//
// Los usan la experiencia, los avisos y los estados, así que el cómo se dibujan
// vive en un solo sitio. El trazo se recorta con dasharray: un trozo visible con
// lo que lleva y otro invisible con lo que le falta.
//
// El path de un <rect> arranca en (x + rx, y), o sea justo después de la esquina
// de arriba a la izquierda. Como todos deben empezar arriba en el centro, se
// corre el patrón media arista superior con el dashoffset.

const ringCache = new WeakMap();

function ringMetrics(fill) {
  const hit = ringCache.get(fill);
  if (hit) return hit;

  const len = typeof fill.getTotalLength === 'function' ? fill.getTotalLength() : 0;
  if (!len) return null;
  const w = parseFloat(fill.getAttribute('width'));
  const rx = parseFloat(fill.getAttribute('rx'));
  const metrics = { len, start: (w - 2 * rx) / 2 };

  fill.style.strokeDashoffset = -metrics.start;
  ringCache.set(fill, metrics);
  return metrics;
}

function setRing(fill, progress) {
  if (!fill) return;
  const m = ringMetrics(fill);
  if (!m) return;
  const done = m.len * Math.max(0, Math.min(1, progress));
  fill.style.strokeDasharray = `${done} ${m.len - done}`;
}

function setXpRing(progress) {
  setRing(infoXpEl.querySelector('.xp-fill'), progress);
}

// El aviso cuelga de lo último que haya arriba: de la tarjeta, o del panel de
// estados si está desplegado. Se recalcula también al desplegarlo, porque si no
// el aviso que ya estaba puesto se queda debajo y lo tapa.
let bannerAsCard = false;

function positionBanner() {
  const statsH = statbarEl.classList.contains('expanded') ? statbarEl.offsetHeight : 0;
  bannerEl.style.top = `${bannerAsCard ? cardTop : cardTop + cardHeight + statsH}px`;
}

// La tarjeta solo se puede medir cuando está a la vista: mientras la tapa un
// aviso de partida se queda con lo último que se midió, que es lo que vale.
function measureInfoCard() {
  if (!infoCardEl.offsetHeight) return;
  cardTop = infoCardEl.offsetTop;
  cardHeight = infoCardEl.offsetHeight;
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
  statbarEl.querySelectorAll('.stat-cell').forEach((el) => {
    const stat = el.dataset.stat;
    el.querySelector('img').src = icons[stat];

    // El anillo alrededor de la chapa, como el de la experiencia: se ve el matiz
    // (un 55% y un 45% ya no son lo mismo) y el color dice si hay que hacer algo.
    const value = Math.max(0, Math.min(100, values[stat]));
    setRing(el.querySelector('.ring-fill'), value / 100);
    el.dataset.level = value >= 60 ? 'good' : value >= 30 ? 'warn' : 'bad';
    el.setAttribute('aria-label', `${el.querySelector('.stat-name').textContent}: ${Math.round(value)}%`);
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
// Una sombra plana sobre el suelo, centrada en el punto (no apoyada como los
// props, que se colocan por su base).
function placeGroundShadow(el, pos) {
  if (!projection) return;
  if (!el.style.backgroundImage) el.style.backgroundImage = `url("${pixelShadowUrl()}")`;
  const p = projection.project(pos.u, pos.v);
  el.style.setProperty('--depth-scale', quantizeScale(p.scale).toFixed(3));
  el.style.left = `${p.x.toFixed(1)}px`;
  el.style.top = `${p.y.toFixed(1)}px`;
  el.style.zIndex = String(projection.layerFor(pos.v) - 1);
}

function placePet() {
  if (!petWrapEl || !projection) return;
  placeActor(petWrapEl, projection, petPos, footOffset(petWrapEl));
  // la cámara va pegada a él: si se recoloca, se reencuadra
  updateCamera();
}

// Paseo intermitente a saltos de píxeles (sin transición suave ni giros): a ratos
// quieto, a ratos da una tanda corta de pasos, como un Tamagotchi real.
function scheduleWalk() {
  stopWalkTimer();
  if (!petStageEl || !petWrapEl || feeding || playdate || game || calling || isNight(_state.pet)) return;

  const willWalk = Math.random() < 0.55;
  if (willWalk) {
    walkBurst(3 + Math.floor(Math.random() * 5));
  } else {
    walkTimer = setTimeout(scheduleWalk, 1500 + Math.random() * 2800);
  }
}

function walkBurst(stepsLeft) {
  if (!petStageEl || !petWrapEl || feeding || playdate || game || calling || isNight(_state.pet)) return;
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

// Mirar a un lado voltea el sprite, y la sombra tiene que voltear con él: se
// mide de los pies del Pokémon, que no están en el centro de su lienzo, así que
// al reflejarse el sprite la sombra se quedaba a un lado.
function faceTo(dir) {
  if (petImgEl) petImgEl.style.setProperty('--flip', dir < 0 ? '1' : '-1');
  if (petWrapEl) petWrapEl.classList.toggle('mirrored', dir >= 0);
}

// Un salto de verdad, más alto que el saltito de cada paso: se usa cuando se
// pone contento (al acariciarle o al llegar donde le llamas).
function happyJump() {
  [petImgEl, petShadowEl].forEach((el) => {
    if (!el) return;
    el.classList.remove('big-hop');
    void el.offsetWidth;
    el.classList.add('big-hop');
  });
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

// --- llamarle con dos toques -----------------------------------------------
//
// Tocando dos veces seguidas un punto del suelo, el Pokémon te hace caso: da dos
// saltitos donde está, como diciendo "voy", y se acerca corriendo (pasos más
// largos y más seguidos que en el paseo de siempre).

const DOUBLE_TAP_MS = 340;   // margen entre los dos toques
const DOUBLE_TAP_PX = 44;    // y lo cerca que tienen que caer el uno del otro
const CALL_STEP_MS = 190;    // frente a los 500 del paseo normal
const CALL_STEP_MUL = 1.7;   // zancada más larga
const MAX_CALL_STEPS = 40;

let calling = null;
let lastStageTap = null;

// Un toque en el suelo, no en algo que ya tenga lo suyo que hacer al tocarlo.
function isBareFloorTap(ev) {
  return !ev.target.closest('.pet-sprite-wrap, .leftover-item, .berry-item, .tappable');
}

function onStageTap(ev) {
  if (feeding || playdate || game || evolving) return;
  if (!petStageEl || !projection || isNight(_state.pet)) return;
  if (!isBareFloorTap(ev)) return;

  const p = stagePoint(ev);
  const x = p.x;
  const y = p.y;
  const now = Date.now();

  const isDouble = lastStageTap
    && now - lastStageTap.at < DOUBLE_TAP_MS
    && Math.hypot(x - lastStageTap.x, y - lastStageTap.y) < DOUBLE_TAP_PX;

  if (!isDouble) {
    lastStageTap = { at: now, x, y };
    return;
  }
  lastStageTap = null;
  callPetTo(x, y);
}

function callPetTo(x, y) {
  const { u, v } = projection.unproject(x, y);
  const target = { v: Math.min(PET_MAX_V, Math.max(PET_MIN_V, v)) };
  const limits = petULimits(target.v);
  target.u = Math.min(limits.max, Math.max(limits.min, u));

  stopCall();
  stopWalkTimer();
  calling = { pos: target, steps: 0, timer: null };

  // primero los dos saltitos de "voy", y luego sale corriendo
  if (Math.abs(target.u - petPos.u) > 0.01) faceTo(target.u < petPos.u ? -1 : 1);
  hopOnce();
  calling.timer = setTimeout(() => {
    if (!calling) return;
    hopOnce();
    calling.timer = setTimeout(walkToCall, 180);
  }, 180);
}

function walkToCall() {
  if (!calling || !petWrapEl || !petStageEl || feeding || playdate || game) return stopCall();
  if (isNight(_state.pet)) return stopCall();

  const du = calling.pos.u - petPos.u;
  const dv = calling.pos.v - petPos.v;

  if ((Math.abs(du) <= REACH_U && Math.abs(dv) <= REACH_V) || calling.steps >= MAX_CALL_STEPS) {
    stopCall();
    happyJump(); // llega y salta: ha venido porque le has llamado
    if (!walkTimer) scheduleWalk();
    return;
  }
  calling.steps += 1;

  if (Math.abs(du) > 0.01) faceTo(du < 0 ? -1 : 1);

  const stepU = STEP_U * CALL_STEP_MUL;
  const stepV = STEP_V * CALL_STEP_MUL;
  petPos.u += Math.max(-stepU, Math.min(stepU, du));
  petPos.v += Math.max(-stepV, Math.min(stepV, dv));
  placePet();

  hopOnce();
  calling.timer = setTimeout(walkToCall, CALL_STEP_MS);
}

function stopCall() {
  if (!calling) return;
  clearTimeout(calling.timer);
  calling = null;
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
  if (feeding.shadowEl) feeding.shadowEl.remove();
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
  cameraEl.appendChild(el);

  // La sombra va aparte del sprite porque tiene que quedarse en el suelo
  // mientras la baya bota: son dos cosas distintas moviéndose a la vez.
  const shadowEl = document.createElement('div');
  shadowEl.className = 'berry-shadow hidden';
  cameraEl.appendChild(shadowEl);

  feeding = {
    berryEl: el,
    shadowEl,
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
// De dónde has tocado en pantalla al punto del escenario SIN el zoom de la
// cámara: si no se deshace, con la cámara acercada el dedo apuntaría a otro
// sitio. La caja de la capa de cámara ya viene transformada, así que el factor
// sale de comparar su ancho con el del escenario.
function stagePoint(ev) {
  if (!petStageEl) return { x: 0, y: 0 };
  const rect = (cameraEl || petStageEl).getBoundingClientRect();
  const k = rect.width ? petStageEl.clientWidth / rect.width : 1;
  return { x: (ev.clientX - rect.left) * k, y: (ev.clientY - rect.top) * k };
}

// Deja la baya en el punto del suelo que hay bajo el dedo, dentro de la zona
// por la que la mascota se puede mover.
function placeBerry(x, y) {
  const { u, v } = projection.unproject(x, y);
  feeding.pos.v = Math.min(PET_MAX_V, Math.max(PET_MIN_V, v));
  const limits = petULimits(feeding.pos.v);
  feeding.pos.u = Math.min(limits.max, Math.max(limits.min, u));
  placeProp(feeding.berryEl, projection, feeding.pos, propSize);
  placeGroundShadow(feeding.shadowEl, feeding.pos);
}

// La baya cae desde arriba y bota un par de veces antes de quedarse quieta.
// El transform lleva dentro la escala de profundidad, que si no se perdería.
function throwBerry() {
  const el = feeding.berryEl;
  const scale = el.style.getPropertyValue('--depth-scale') || 1;
  const fall = `scale(${scale})`;
  el.classList.remove('hidden');

  // La sombra sigue los mismos tiempos que el bote: se abre y se aclara cuando
  // la baya sube, y se cierra y se oscurece cuando toca suelo. Es lo que hace
  // que se lea la altura.
  const sh = feeding.shadowEl;
  sh.classList.remove('hidden');
  const ground = { opacity: .38, transform: 'translate(-50%, -50%) scale(1)' };
  const air = (k) => ({
    opacity: .38 - .3 * k,
    transform: `translate(-50%, -50%) scale(${(1 - .55 * k).toFixed(2)})`,
  });
  sh.animate(
    [
      { ...air(1), offset: 0 },
      { ...air(.95), offset: 0.05 },
      { ...ground, offset: 0.55 },
      { ...air(.55), offset: 0.72 },
      { ...ground, offset: 0.85 },
      { ...air(.2), offset: 0.93 },
      { ...ground, offset: 1 },
    ],
    { duration: 750, easing: 'linear', fill: 'forwards' },
  );
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
  const sh = feeding.shadowEl;
  const berry = feeding.berry;
  feeding = null;
  if (el) el.remove();
  if (sh) sh.remove();
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
  wild = mountWildPokemon(cameraEl, () => projection, {
    excludeId: state.pet.speciesId,
    // de noche no sale nadie (y los que estén se van)
    // ni de noche ni durante una partida: el minijuego pide la pantalla entera
    isPaused: () => !petStageEl || isNight(_state.pet) || !!game,
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

// Rojo y rosa pastel, para que la tanda no salga toda del mismo color.
const HEART_COLORS = ['#ff9db1', '#ffb3c4', '#f4788f', '#ffc2cf'];

// Cada corazón sale con su propia desviación, y se inclina hacia donde se va:
// si tira a la derecha se ladea a la derecha. Así no parecen tres copias.
function spawnHeart() {
  if (!petWrapEl) return;
  const heart = document.createElement('i');
  heart.className = 'play-heart fa-solid fa-heart';

  const drift = Math.round((Math.random() - 0.5) * 70);
  heart.style.setProperty('--drift', `${drift}px`);
  // el ladeo acompaña a la deriva, con algo de suelto para que no sea calcado
  heart.style.setProperty('--tilt', `${(drift * 0.35 + (Math.random() - 0.5) * 14).toFixed(1)}deg`);
  heart.style.setProperty('--rise', `${-(52 + Math.random() * 26).toFixed(0)}px`);
  heart.style.setProperty('--size', `${(15 + Math.random() * 9).toFixed(0)}px`);
  heart.style.setProperty('--spin', `${((Math.random() - 0.5) * 26).toFixed(1)}deg`);
  heart.style.setProperty('--heart-color', HEART_COLORS[Math.floor(Math.random() * HEART_COLORS.length)]);

  petWrapEl.appendChild(heart);
  setTimeout(() => heart.remove(), 1100);
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
// --- cámara ------------------------------------------------------------------
//
// Cuando pasa algo (una partida, o tu Pokémon jugando con un salvaje) la cámara
// se acerca y encuadra la acción. El resto del tiempo se queda quieta y entera,
// que es como se ve mejor el escenario.

// La cámara no está fija: le sigue siempre, y con retraso. El acercamiento de
// base existe solo para poder moverla: al desplazar la capa se destaparían los
// bordes del escenario, así que se agranda lo justo para que el hueco que deja
// el desplazamiento siga estando cubierto (de ahí que el tope sea exactamente
// (zoom - 1) / 2 del lienzo). Cuando hay algo en marcha se acerca más.
const CAM_ZOOM_IDLE = 1.16;
const CAM_ZOOM_ACTION = 1.28;

function cameraZoom() {
  return (game || (playdate && playdate.actor)) ? CAM_ZOOM_ACTION : CAM_ZOOM_IDLE;
}

// --- cámara a mano -----------------------------------------------------------
//
// Se puede mirar por ahí: dos dedos para mover y pellizcar para acercar; en el
// ordenador, botón derecho para arrastrar y la ruleta para el zoom. Es solo
// mirar, así que a los pocos segundos sin tocar nada se vuelve sola al Pokémon.
//
// En el móvil se piden dos dedos a propósito: con uno solo chocaría con el doble
// toque para llamarle y con el arrastre de los minijuegos.

// Se puede alejar bastante más de lo que se acerca: el suelo está dibujado mucho
// más ancho de lo que se ve, así que hay terreno de sobra que enseñar.
const CAM_MIN_ZOOM = 0.6;
const CAM_MAX_ZOOM = 3;
const CAM_RETURN_MS = 3500;   // lo que aguanta donde la dejes antes de volver

let camManual = null;         // { tx, ty, zoom, until }
let pinch = null;             // el pellizco en curso
const camPointers = new Map();

function manualActive() {
  return camManual && Date.now() < camManual.until;
}

// Arranca (o prolonga) el control a mano desde donde esté la cámara ahora.
function touchCamera() {
  if (!camManual) {
    const zoom = cameraZoom();
    const m = new DOMMatrix(cameraEl ? cameraEl.style.transform : '');
    camManual = { tx: m.e || 0, ty: m.f || 0, zoom: m.a || zoom, until: 0 };
  }
  camManual.until = Date.now() + CAM_RETURN_MS;
  return camManual;
}

function panCamera(dx, dy) {
  const cam = touchCamera();
  cam.tx += dx;
  cam.ty += dy;
  updateCamera();
}

// El zoom tira hacia donde tienes el dedo (o el ratón): se corrige el
// desplazamiento para que el punto bajo el puntero se quede donde está.
function zoomCamera(factor, cx, cy) {
  const cam = touchCamera();
  const next = Math.max(CAM_MIN_ZOOM, Math.min(CAM_MAX_ZOOM, cam.zoom * factor));
  const real = next / cam.zoom;

  const w = petStageEl ? petStageEl.clientWidth : 0;
  const h = petStageEl ? petStageEl.clientHeight : 0;
  const ox = (cx ?? w / 2) - w / 2;
  const oy = (cy ?? h / 2) - h / 2;

  cam.tx = ox - (ox - cam.tx) * real;
  cam.ty = oy - (oy - cam.ty) * real;
  cam.zoom = next;
  updateCamera();
}

function bindCameraGestures(stage) {
  // el menú del botón derecho estorba: aquí ese botón es para mirar alrededor
  stage.addEventListener('contextmenu', (ev) => ev.preventDefault());

  stage.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const p = stagePoint(ev);
    zoomCamera(ev.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
  }, { passive: false });

  stage.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' && ev.button !== 2) return;
    camPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (camPointers.size === 2) {
      const [a, b] = [...camPointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
    }
  });

  stage.addEventListener('pointermove', (ev) => {
    const prev = camPointers.get(ev.pointerId);
    if (!prev) return;
    const dx = ev.clientX - prev.x;
    const dy = ev.clientY - prev.y;
    camPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    // dos dedos: pellizco para el zoom y el arrastre del conjunto para mover
    if (camPointers.size === 2 && pinch) {
      const [a, b] = [...camPointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.dist > 0) {
        const rect = petStageEl.getBoundingClientRect();
        zoomCamera(dist / pinch.dist, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      }
      pinch.dist = dist;
      panCamera(dx / 2, dy / 2);
      return;
    }

    // un dedo solo mueve si es el botón derecho del ratón
    if (ev.pointerType === 'mouse') panCamera(dx, dy);
  });

  const release = (ev) => {
    camPointers.delete(ev.pointerId);
    if (camPointers.size < 2) pinch = null;
    if (camManual) camManual.until = Date.now() + CAM_RETURN_MS;
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('pointerleave', release);
}

function updateCamera() {
  if (!cameraEl || !projection || !petStageEl) return;
  if (_state.pet.phase === 'egg' || _state.pet.phase === 'oak') {
    cameraEl.style.transform = '';
    return;
  }

  const w = petStageEl.clientWidth;
  const h = petStageEl.clientHeight;
  const manual = manualActive();
  const zoom = manual ? camManual.zoom : cameraZoom();

  // Tope: lo que se puede desplazar sin que asome el borde de lo que hay pintado.
  const maxX = Math.max(0, ((zoom - 1) / 2) * w);
  const maxY = Math.max(0, ((zoom - 1) / 2) * h);

  let tx;
  let ty;
  if (manual) {
    tx = Math.max(-maxX, Math.min(maxX, camManual.tx));
    ty = Math.max(-maxY, Math.min(maxY, camManual.ty));
    camManual.tx = tx;
    camManual.ty = ty;
  } else {
    if (camManual) camManual = null;   // se acabó el rato: vuelve con él
    const p = projection.project(petPos.u, petPos.v);
    tx = Math.max(-maxX, Math.min(maxX, -(p.x - w / 2) * zoom));
    ty = Math.max(-maxY, Math.min(maxY, -(p.y - h / 2) * zoom));
  }

  // A mano va sin suavizado, que si no el dedo arrastra y la imagen llega tarde.
  // Siguiéndole al pasear va lenta a propósito; en partida se pone al día.
  // El desenfoque se recoloca para que el plano enfocado sea el del Pokémon: lo
  // que está más cerca o más lejos que él es lo que se difumina, como una cámara
  // de verdad. Antes eran dos bandas fijas arriba y abajo, así que si se metía al
  // fondo se desenfocaba él.
  const focusY = projection.project(petPos.u, petPos.v).y;
  cameraEl.style.setProperty('--focus-y', `${((focusY / h) * 100).toFixed(1)}%`);

  cameraEl.classList.toggle('manual', manual);
  cameraEl.classList.toggle('chasing', !manual && !game && !(playdate && playdate.actor));
  cameraEl.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${zoom.toFixed(3)})`;
}

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
  else if (cameraEl) cameraEl.prepend(nextFloor);
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
  stopCall();
  stopWalkTimer();
  destroyPetAnim();
  camManual = null;
  pinch = null;
  camPointers.clear();
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
  cameraEl = null;
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

  // El escenario recorta y recibe los toques; lo que se mueve al acercar la
  // cámara es esta capa de dentro, con el suelo y todos los actores. Si moviera
  // el escenario se movería también su recorte y se verían los bordes.
  const camera = document.createElement('div');
  camera.className = 'stage-camera';
  stage.appendChild(camera);
  cameraEl = camera;

  applyStageMetrics(stage);
  projection = createProjection(stage.clientWidth, stage.clientHeight, cameraOptions(stage));
  floorEl = buildFloor(projection);
  camera.appendChild(floorEl);

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
    _deps.care.petTap(_state);

    img.classList.remove('tap-bounce');
    shadow.classList.remove('tap-bounce');
    void img.offsetWidth; // reinicia la animación aunque se repita rápido
    img.classList.add('tap-bounce');
    shadow.classList.add('tap-bounce');

    // Corazones saliendo escalonados y, cuando acaba la caricia, un salto de
    // contento: la respuesta a que le hagas caso tiene que verse.
    for (let i = 0; i < 3; i += 1) setTimeout(spawnHeart, i * 140);
    setTimeout(happyJump, 340);

    renderStatbar(_state);
    _deps.saveState(_state);
  });

  stage.addEventListener('pointerdown', onStageTap);
  bindCameraGestures(stage);
  camera.appendChild(wrap);

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
    camera.appendChild(item);
    placeProp(item, projection, slot, propSize);
    return item;
  });

  // Van al final para quedar por encima de todo lo que hay sobre el suelo: son
  // el desenfoque de la cámara, no una capa del escenario.
  ['depth', 'sides'].forEach((zone) => {
    const layer = document.createElement('div');
    layer.className = `tilt-shift ${zone}`;
    camera.appendChild(layer);
  });

  // La viñeta cierra el escenario por los bordes, así que va fuera de la capa de
  // cámara: tiene que quedarse quieta aunque el mundo se mueva.
  const fade = document.createElement('div');
  fade.className = 'stage-fade';
  stage.appendChild(fade);

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
// Dónde se pone cada globo según cuántos haya, en grados desde la derecha. El
// primero (el más urgente) siempre arriba; los demás se abren a los lados sin
// llegar a tocarse.
const BUBBLE_SLOTS = [
  [90],
  [68, 112],
  [90, 43, 137],
];

const NEED_LOOK = {
  evolving: { icon: 'fa-wand-magic-sparkles',   color: '#a78bfa', label: '¡Quiere evolucionar! Tócalo' },
  sick:     { icon: 'fa-virus',                 color: '#c79ae8', label: 'Se encuentra mal' },
  mischief: { icon: 'fa-face-grin-tongue-wink', color: '#f5c469', label: 'Está haciendo una travesura' },
  sleeping: { icon: 'fa-moon',                  color: '#9aa8dd', label: 'Está durmiendo' },
  dirty:    { icon: 'fa-poo',                   color: '#c9a888', label: 'Esto está sucio' },
  hungry:   { icon: 'fa-drumstick-bite',        color: '#f4a973', label: 'Tiene hambre' },
  tired:    { icon: 'fa-face-tired',            color: '#aab6cc', label: 'Está cansado' },
  sad:      { icon: 'fa-face-frown',            color: '#93c1f0', label: 'Está triste' },
};

// Cuánto dura el "cargando" antes de que cambie el sprite: el Pokémon tiembla y
// se pone blanco, como en los juegos, y solo entonces se aplica el cambio.
const EVOLVE_CHARGE_MS = 1400;

function startEvolution() {
  if (evolving || !_state.pet.pendingEvolution) return;
  evolving = true;

  stopCall();
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

      // En órbita alrededor de la cabeza, no apilados: cada uno en su ángulo,
      // todos a la misma distancia y con el rabito apuntando al Pokémon. El más
      // urgente se queda arriba del todo, que es donde antes se mira.
      const angle = BUBBLE_SLOTS[needs.length - 1][i];
      const rad = (angle * Math.PI) / 180;
      el.style.setProperty('--x', `${Math.cos(rad).toFixed(4)}`);
      el.style.setProperty('--y', `${(-Math.sin(rad)).toFixed(4)}`);
      el.style.setProperty('--i', i); // solo para escalonar el flotar
      el.classList.toggle('urgent', need.urgent);
      el.classList.toggle('calm', need.key === 'sleeping');
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

  updateCamera();
  renderBubbles(state);

  if (zEl) zEl.classList.toggle('hidden', !night);
  if (petWrapEl) petWrapEl.classList.toggle('asleep', night);
  petStageEl.classList.toggle('night', night);

  if (night) {
    stopCall();
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
  { key: 'dodge', label: 'Esquivar', icon: ITEM_ICONS.stone },
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
  const night = isNight(pet);
  const urgent = {
    medicine: pet.sick,
    feed: pet.hunger < 35,
    clean: pet.poopCount >= 2,
    sleep: pet.energy < 30 && !night,
  };

  // La misma casilla sirve para acostarle y para despertarle: de noche no tiene
  // sentido ofrecer "Dormir", y sin esto no había forma de terminar la noche
  // antes de tiempo.
  const sleepBtn = bagPanelEl.querySelector('.bag-item[data-key="sleep"]');
  if (sleepBtn) {
    sleepBtn.querySelector('span').textContent = night ? 'Despertar' : 'Dormir';
    sleepBtn.querySelector('img').src = night ? ITEM_ICONS.day : ITEM_ICONS.night;
  }
  bagPanelEl.querySelectorAll('.bag-item').forEach((btn) => {
    btn.classList.toggle('urgent', !!urgent[btn.dataset.key]);
  });
}

function onMenuAction(key) {
  const { care, saveState } = _deps;
  closeSheets();
  stopMinigame();
  if (key === 'play') {
    startMinigame('catch');
    return;
  }
  if (key === 'dodge') {
    startMinigame('dodge');
    return;
  }
  if (key === 'feed') {
    startFeeding();
    return;
  }
  if (key === 'sleep') {
    if (isNight(_state.pet)) {
      const { rested } = care.wakeUp(_state);
      showBanner(rested ? '¡Buenos días!' : 'Le has despertado', {
        tone: rested ? 'good' : 'warn',
        icon: 'fa-sun',
        desc: rested
          ? 'Ya había descansado bastante, así que se levanta como nuevo.'
          : 'Todavía le faltaba sueño y se ha llevado un disgusto.',
      });
      render(_state);
      saveState(_state);
      return;
    }
    // aquí ya se sabe que es de día, así que el único "no" posible es que no
    // tenga sueño
    const { ok } = care.sendToSleep(_state);
    if (ok) {
      showBanner('Buenas noches', {
        tone: 'good',
        icon: 'fa-moon',
        desc: 'Se acuesta antes de tiempo. Mientras duerme recupera energía.',
      });
    } else {
      showBanner('No tiene sueño', {
        icon: 'fa-moon',
        desc: 'Todavía va sobrado de energía. Cánsale jugando un rato.',
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

// --- minijuegos -------------------------------------------------------------
//
// Dos, y los dos se juegan dentro del mundo en vez de en otra pantalla: por eso
// se mueven con la misma proyección y los mismos saltitos que el paseo normal,
// solo que más rápido.
//
//   catch  Caen bayas y arrastras el dedo para que corra a cogerlas antes de
//          que toquen el suelo.
//   dodge  Caen piedras y hay que quitarse de en medio. Es el mismo motor al
//          revés: aquí lo que cuenta es lo que NO te toca, y se acaba antes si
//          te quedas sin vidas.

const GAME_MS = 26000;
const GAME_STEP_MS = 150;    // el paso durante la partida, mucho más ágil
const GAME_STEP_U = 0.045;
const GAME_HIT_U = 0.1;      // lo cerca que tiene que caer para tocarle
const DODGE_LIVES = 3;

// Lo que cambia de un juego a otro. Lo demás (mover al Pokémon, tirar cosas,
// mirar dónde caen) es común.
const GAME_MODES = {
  catch: {
    dropMs: 1300,
    fallMs: 2100,
    goal: 5,
    title: '¡A por las bayas!',
    help: 'Arrastra el dedo para moverlo y que las atrape antes de que caigan.',
  },
  dodge: {
    dropMs: 800,
    fallMs: 1500,
    goal: 8,
    title: '¡Esquiva las piedras!',
    help: 'Arrastra el dedo para apartarlo. Tres piedras encima y se acabó.',
  },
};

function startMinigame(mode = 'catch') {
  cancelPlaydate();
  cancelFeeding();
  stopCall();
  goHome();
  render(_state);
  if (!petStageEl) return;

  stopWalkTimer();
  game = {
    mode,
    rules: GAME_MODES[mode] || GAME_MODES.catch,
    berries: [],
    score: 0,
    lives: DODGE_LIVES,
    targetU: petPos.u,
    endsAt: Date.now() + GAME_MS,
    dropTimer: null,
    stepTimer: null,
    endTimer: null,
  };

  petStageEl.classList.add('playing');
  petStageEl.addEventListener('pointerdown', onGamePoint);
  petStageEl.addEventListener('pointermove', onGamePoint);

  // El anillo del aviso hace de reloj de la partida: se vacía justo cuando se
  // acaba, así que el aviso se va solo en el momento exacto.
  showBanner(game.rules.title, {
    icon: 'fa-hand-pointer',
    desc: game.rules.help,
    keepDesc: true,
    asCard: true,
    autoHideMs: GAME_MS,
  });
  gameDrop();
  gameStep();
  game.endTimer = setTimeout(endMinigame, GAME_MS);
}

function onGamePoint(ev) {
  if (!game || ev.buttons === 0 && ev.type === 'pointermove') return;
  const p = stagePoint(ev);
  const { u } = projection.unproject(p.x, p.y);
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

  const el = document.createElement('img');
  el.className = game.mode === 'dodge' ? 'berry-item falling rock' : 'berry-item falling';
  el.src = game.mode === 'dodge' ? ITEM_ICONS.stone : randomBerries(1)[0].src;
  el.alt = '';
  cameraEl.appendChild(el);

  const limits = petULimits(petPos.v);
  const pos = {
    u: limits.min + Math.random() * (limits.max - limits.min),
    v: petPos.v,
  };
  placeProp(el, projection, pos, propSize);

  // La sombra marca dónde va a caer: crece y se oscurece a la vez que la baya
  // baja, que es lo que deja ver a qué altura viene.
  const shadow = document.createElement('div');
  shadow.className = 'berry-shadow';
  placeGroundShadow(shadow, pos);
  cameraEl.appendChild(shadow);
  shadow.animate(
    [
      { opacity: .06, transform: 'translate(-50%, -50%) scale(.35)' },
      { opacity: .38, transform: 'translate(-50%, -50%) scale(1)' },
    ],
    { duration: game.rules.fallMs, easing: 'cubic-bezier(.5,0,1,.5)', fill: 'forwards' },
  );

  const scale = el.style.getPropertyValue('--depth-scale') || 1;
  const anim = el.animate(
    [
      { transform: `translateY(-320px) scale(${scale})` },
      { transform: `translateY(0) scale(${scale})` },
    ],
    { duration: game.rules.fallMs, easing: 'cubic-bezier(.5,0,1,.5)' },
  );

  const item = { el, shadow, anim, pos };
  game.berries.push(item);
  anim.onfinish = () => resolveBerry(item);

  game.dropTimer = setTimeout(gameDrop, game.rules.dropMs);
}

// Al tocar el suelo se mira si la mascota estaba debajo. Lo que eso signifique
// depende del juego: en uno es cogerla y en el otro es llevarse el golpe.
function resolveBerry(item) {
  if (!game) return;
  const i = game.berries.indexOf(item);
  if (i >= 0) game.berries.splice(i, 1);

  if (item.shadow) item.shadow.remove();
  const encima = Math.abs(item.pos.u - petPos.u) <= GAME_HIT_U;

  if (game.mode === 'dodge') {
    if (encima) {
      game.lives -= 1;
      item.el.remove();
      shakePet();
      if (game.lives <= 0) endMinigame();
    } else {
      game.score += 1;
      item.el.classList.add('missed');
      setTimeout(() => item.el.remove(), 400);
    }
    return;
  }

  if (encima) {
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

// El golpe: se sacude y parpadea, para que se note que le ha dado.
function shakePet() {
  [petImgEl, petShadowEl].forEach((el) => {
    if (!el) return;
    el.classList.remove('hurt');
    void el.offsetWidth;
    el.classList.add('hurt');
  });
}

function endMinigame() {
  if (!game) return;
  const { score, mode, rules, lives } = game;
  stopMinigame();

  // En el de esquivar no basta con puntuar: si te quedas sin vidas, se perdió.
  const exito = mode === 'dodge' ? lives > 0 && score >= rules.goal : score >= rules.goal;
  _deps.care.applyPlayResult(_state, exito);

  if (mode === 'dodge') {
    showBanner(lives > 0 ? '¡Ni un rasguño!' : 'Le han dado', {
      tone: exito ? 'good' : 'info',
      icon: 'fa-shield-halved',
      desc: lives > 0
        ? `${score} piedras esquivadas y le quedaban ${lives} vidas.`
        : `Aguantó ${score} piedras antes de quedarse sin vidas.`,
    });
  } else {
    showBanner(exito ? '¡Lo habéis pasado en grande!' : 'Se acabó el tiempo', {
      tone: exito ? 'good' : 'info',
      icon: 'fa-trophy',
      desc: exito ? `${score} bayas atrapadas: ha sido una partidaza.`
        : `${score} bayas... la próxima vez seguro que caen más.`,
    });
  }
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
    if (b.shadow) b.shadow.remove();
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

// Interruptor de los avisos. Va aparte porque tiene que repintarse solo al
// tocarlo: la pantalla de Ajustes solo se monta al entrar en ella (ver
// mountedTab), así que un render() no lo actualizaría.
// --- ajustes -----------------------------------------------------------------
//
// Las opciones van en fichas de cristal, como el resto: cada fila con su icono,
// su nombre, una línea de explicación y a la derecha lo que haga (un
// interruptor, una flecha). Antes eran botones sueltos con el estado metido en
// el propio texto ("Avisos: activados"), que se lee peor y no deja ver de un
// vistazo qué está puesto.

function settingsGroup(title) {
  const group = document.createElement('section');
  group.className = 'settings-group';
  if (title) {
    const h = document.createElement('p');
    h.className = 'settings-group-title';
    h.textContent = title;
    group.appendChild(h);
  }
  const box = document.createElement('div');
  box.className = 'settings-card';
  group.appendChild(box);
  group.box = box;
  return group;
}

function settingsRow({ icon, label, note, tone }) {
  const row = document.createElement('div');
  row.className = `settings-row${tone ? ` tone-${tone}` : ''}`;

  const chip = document.createElement('span');
  chip.className = 'settings-icon';
  chip.innerHTML = `<i class="fa-solid ${icon}"></i>`;

  const text = document.createElement('div');
  text.className = 'settings-text';
  const name = document.createElement('p');
  name.className = 'settings-label';
  name.textContent = label;
  text.appendChild(name);

  const noteEl = document.createElement('p');
  noteEl.className = 'settings-note';
  noteEl.textContent = note || '';
  noteEl.classList.toggle('hidden', !note);
  text.appendChild(noteEl);

  row.append(chip, text);
  row.noteEl = noteEl;
  row.labelEl = name;
  return row;
}

// Interruptor de los de toda la vida: se ve puesto o quitado sin leer nada.
function settingsSwitch(on) {
  const sw = document.createElement('span');
  sw.className = `settings-switch${on ? ' on' : ''}`;
  sw.innerHTML = '<i></i>';
  return sw;
}

function buildNotificationsSetting() {
  const row = settingsRow({ icon: 'fa-bell', label: 'Avisos' });
  const sw = settingsSwitch(false);
  row.appendChild(sw);

  function paint() {
    const permission = notify.permission();

    if (permission === 'unsupported' || permission === 'denied') {
      row.classList.add('disabled');
      sw.classList.remove('on');
      row.labelEl.textContent = permission === 'denied' ? 'Avisos bloqueados' : 'Avisos no disponibles';
      row.noteEl.textContent = permission === 'denied'
        ? 'Los bloqueaste para esta página. Hay que volver a permitirlos desde los ajustes del navegador.'
        : 'Este navegador no sabe enseñar avisos. En Chrome para Android sí funciona.';
      row.noteEl.classList.remove('hidden');
      return;
    }

    const on = Boolean(_state.settings && _state.settings.notifications) && permission === 'granted';
    row.classList.remove('disabled');
    row.labelEl.textContent = 'Avisos';
    sw.classList.toggle('on', on);
    row.noteEl.textContent = on
      ? 'Te avisamos cuando necesite algo, mientras el juego siga abierto de fondo. Cerrado del todo no hay avisos: al volver se te cuenta.'
      : 'Actívalos para que te avise cuando necesite algo teniendo el juego de fondo.';
    row.noteEl.classList.remove('hidden');
  }

  row.addEventListener('click', async () => {
    if (row.classList.contains('disabled')) return;
    const on = Boolean(_state.settings && _state.settings.notifications) && notify.permission() === 'granted';

    if (on) {
      _state.settings.notifications = false;
      _deps.saveState(_state);
      paint();
      return;
    }

    // El permiso se pide aquí, dentro del gesto: los navegadores descartan la
    // petición si no viene de una interacción del usuario.
    const result = await notify.requestPermission();
    if (result !== 'granted') {
      paint();
      showBanner(result === 'denied' ? 'Avisos bloqueados' : 'Sin permiso no hay avisos', {
        tone: 'warn',
        icon: 'fa-bell-slash',
        desc: result === 'denied'
          ? 'Los has bloqueado para esta página. Hay que volver a permitirlos desde los ajustes del navegador.'
          : 'Hace falta darle a "Permitir" para que te podamos avisar.',
      });
      return;
    }

    _state.settings.notifications = true;
    _deps.saveState(_state);
    paint();
    const sent = await notify.sendTestNotification(_state);
    if (!sent) {
      showBanner('Avisos activados', {
        tone: 'warn',
        icon: 'fa-bell',
        desc: 'Aunque este navegador no ha podido enseñar el de prueba.',
      });
    }
  });

  paint();
  return row;
}

function renderSettings() {
  viewRoot.innerHTML = '';
  const title = document.createElement('p');
  title.className = 'screen-title';
  title.textContent = 'Ajustes';
  viewRoot.appendChild(title);

  const pet = settingsGroup('Tu Pokémon');
  const nameRow = settingsRow({
    icon: 'fa-pen',
    label: 'Ponerle un mote',
    note: _state.pet.nickname ? `Ahora se llama ${_state.pet.nickname}.` : 'Va con el nombre de su especie.',
  });
  const chevron = document.createElement('i');
  chevron.className = 'fa-solid fa-chevron-right settings-chevron';
  nameRow.appendChild(chevron);
  nameRow.addEventListener('click', askNickname);
  pet.box.appendChild(nameRow);
  viewRoot.appendChild(pet);

  const alerts = settingsGroup('Avisos');
  alerts.box.appendChild(buildNotificationsSetting());
  viewRoot.appendChild(alerts);

  const danger = settingsGroup('Partida');
  const resetRow = settingsRow({
    icon: 'fa-trash',
    label: 'Reiniciar partida',
    note: 'Se borra el Pokémon, la Pokédex y todo lo demás.',
    tone: 'danger',
  });

  // Dos toques: borrar la partida no puede pasar por resbalar el dedo.
  let armed = false;
  let armTimeout = null;
  resetRow.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      resetRow.classList.add('armed');
      resetRow.labelEl.textContent = '¿Seguro?';
      resetRow.noteEl.textContent = 'Toca otra vez para borrarlo todo.';
      armTimeout = setTimeout(() => {
        armed = false;
        resetRow.classList.remove('armed');
        resetRow.labelEl.textContent = 'Reiniciar partida';
        resetRow.noteEl.textContent = 'Se borra el Pokémon, la Pokédex y todo lo demás.';
      }, 3000);
      return;
    }
    clearTimeout(armTimeout);
    _deps.resetGame();
  });
  danger.box.appendChild(resetRow);
  viewRoot.appendChild(danger);
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
