import { resolveSprite, iconFor, EGG_SPRITE, EGG_ICON, ITEM_ICONS } from './sprite-resolver.js';
import { getKnownIds, getEntry } from './pokedex.js';
import { mountMinigame } from './minigame.js';
import { isNight } from './care.js';
import { XP_PER_LEVEL } from './state.js';

let _state = null;
let _deps = null;
let uiTab = 'home';
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
let zEl = null;
let leftoverEls = [];
let currentSprite = null;
let asleepAnimApplied = false;
let statsExpanded = false;

const PET_SIZE = 168;

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

  pillnavEl.querySelectorAll('.pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      stopMinigame();
      if (btn.dataset.tab === 'more') {
        morePanelEl.classList.toggle('hidden');
        if (!morePanelEl.classList.contains('hidden')) showBanner(null);
        renderPillnav();
        return;
      }
      morePanelEl.classList.add('hidden');
      uiTab = btn.dataset.tab;
      render(_state);
    });
  });

  morePanelEl.querySelectorAll('.more-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      stopMinigame();
      morePanelEl.classList.add('hidden');
      uiTab = btn.dataset.more;
      render(_state);
    });
  });
}

export function goHome() {
  uiTab = 'home';
  morePanelEl.classList.add('hidden');
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

  if (uiTab === 'bag') renderMenu(state);
  else if (uiTab === 'pokedex') renderPokedex(state);
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
  if (hide) morePanelEl.classList.add('hidden');

  const moreActive = MORE_TABS.includes(uiTab) || !morePanelEl.classList.contains('hidden');
  pillnavEl.querySelectorAll('.pill-btn').forEach((btn) => {
    const isMore = btn.dataset.tab === 'more';
    btn.classList.toggle('active', isMore ? moreActive : btn.dataset.tab === uiTab);
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

const STEP_PX = 10;
const STEP_MS = 500;

// Paseo intermitente a saltos de píxeles (sin transición suave ni giros): a ratos
// quieto, a ratos da una tanda corta de pasos, como un Tamagotchi real.
function scheduleWalk() {
  stopWalkTimer();
  if (!petStageEl || !petWrapEl || isNight(_state.pet)) return;

  const willWalk = Math.random() < 0.55;
  if (willWalk) {
    walkBurst(3 + Math.floor(Math.random() * 5));
  } else {
    walkTimer = setTimeout(scheduleWalk, 1500 + Math.random() * 2800);
  }
}

function walkBurst(stepsLeft) {
  if (!petStageEl || !petWrapEl || isNight(_state.pet)) return;
  if (stepsLeft <= 0) {
    walkTimer = setTimeout(scheduleWalk, 1200 + Math.random() * 2200);
    return;
  }
  stepOnce();
  walkTimer = setTimeout(() => walkBurst(stepsLeft - 1), STEP_MS);
}

let walkDir = 1;
let walkDirY = 1;

// Movimiento a saltos discretos de STEP_PX cada STEP_MS: horizontal siempre,
// vertical solo de vez en cuando (un ligero vaivén arriba/abajo).
function stepOnce() {
  const sw = petStageEl.clientWidth;
  const sh = petStageEl.clientHeight;
  const w = petWrapEl.offsetWidth || 128;
  const h = petWrapEl.offsetHeight || 128;
  const maxX = Math.max(0, sw - w);
  const maxY = Math.max(0, sh - h);
  const left = parseFloat(petWrapEl.style.left || '0');
  const top = parseFloat(petWrapEl.style.top || '0');

  if (left <= 0) walkDir = 1;
  else if (left >= maxX) walkDir = -1;
  else if (Math.random() < 0.06) walkDir = -walkDir;

  if (petImgEl) petImgEl.style.transform = walkDir < 0 ? 'scaleX(1)' : 'scaleX(-1)';

  const nextLeft = Math.min(maxX, Math.max(0, left + walkDir * STEP_PX));
  petWrapEl.style.left = `${Math.round(nextLeft)}px`;

  if (Math.random() < 0.35) {
    if (top <= 0) walkDirY = 1;
    else if (top >= maxY) walkDirY = -1;
    else if (Math.random() < 0.2) walkDirY = -walkDirY;
    const nextTop = Math.min(maxY, Math.max(0, top + walkDirY * STEP_PX));
    petWrapEl.style.top = `${Math.round(nextTop)}px`;
  }
}

function leaveHome() {
  if (homeKey === null) return;
  homeKey = null;
  stopWalkTimer();
  stopFlipTimer();
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
  viewRoot.innerHTML = '';
  petStageEl = null;
  petWrapEl = null;
  petImgEl = null;
  zEl = null;
  leftoverEls = [];

  const pet = state.pet;

  if (pet.phase === 'egg') {
    const wrap = document.createElement('div');
    wrap.className = 'egg-wrap';
    const img = document.createElement('img');
    img.src = EGG_SPRITE;
    img.onerror = () => { img.src = EGG_ICON; };
    wrap.appendChild(img);
    const label = document.createElement('p');
    label.className = 'pet-substatus';
    label.textContent = 'Un huevo misterioso... ¡está a punto de eclosionar!';
    viewRoot.appendChild(wrap);
    viewRoot.appendChild(label);
    return;
  }

  const sprite = resolveSprite(pet.speciesId);
  currentSprite = sprite;

  const stage = document.createElement('div');
  stage.className = 'pet-stage';

  const wrap = document.createElement('div');
  wrap.className = 'pet-sprite-wrap tappable';

  const img = document.createElement('img');
  img.className = 'pet-img';
  img.src = sprite.src;
  img.onerror = () => { if (sprite.fallback) img.src = sprite.fallback; };
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
    void img.offsetWidth; // reinicia la animación aunque se repita rápido
    img.classList.add('tap-bounce');
    renderStatbar(_state);
  });

  stage.appendChild(wrap);

  const LEFTOVER_SLOTS = [
    { left: '8%', top: '72%' },
    { left: '80%', top: '18%' },
    { left: '78%', top: '70%' },
  ];
  leftoverEls = LEFTOVER_SLOTS.map((slot) => {
    const item = document.createElement('img');
    item.className = 'leftover-item hidden';
    item.src = ITEM_ICONS.leftovers;
    item.style.left = slot.left;
    item.style.top = slot.top;
    item.addEventListener('click', () => {
      _deps.care.removeLeftover(_state);
      render(_state);
      _deps.saveState(_state);
    });
    stage.appendChild(item);
    return item;
  });

  viewRoot.appendChild(stage);

  petStageEl = stage;
  petWrapEl = wrap;
  petImgEl = img;
  zEl = z;

  requestAnimationFrame(() => {
    if (!petStageEl) return;
    const sw = petStageEl.clientWidth;
    const sh = petStageEl.clientHeight;
    wrap.style.left = `${Math.max(0, sw / 2 - PET_SIZE / 2)}px`;
    wrap.style.top = `${Math.max(0, sh / 2 - PET_SIZE / 2)}px`;
  });

  asleepAnimApplied = false;
  if (isNight(state.pet)) {
    asleepAnimApplied = true;
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

function renderMenu(state) {
  viewRoot.innerHTML = '';
  const pet = state.pet;

  if (pet.phase === 'egg') {
    const p = document.createElement('p');
    p.className = 'screen-title';
    p.textContent = 'Todavía no hay nada que cuidar. ¡Espera a que eclosione el huevo!';
    viewRoot.appendChild(p);
    return;
  }

  const title = document.createElement('p');
  title.className = 'screen-title';
  title.textContent = 'Mochila';
  viewRoot.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'menu-grid';

  const items = [
    { key: 'feed', label: 'Comida', icon: ITEM_ICONS.feed },
    { key: 'play', label: 'Jugar', icon: ITEM_ICONS.play },
    { key: 'clean', label: 'Limpiar', icon: ITEM_ICONS.hygiene },
    { key: 'medicine', label: 'Medicina', icon: ITEM_ICONS.medicine },
  ];

  items.forEach((item) => {
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    const img = document.createElement('img');
    img.src = item.icon;
    const span = document.createElement('span');
    span.textContent = item.label;
    btn.appendChild(img);
    btn.appendChild(span);
    btn.addEventListener('click', () => onMenuAction(item.key));
    grid.appendChild(btn);
  });

  viewRoot.appendChild(grid);
}

function onMenuAction(key) {
  const { care, saveState } = _deps;
  if (key === 'play') {
    startMinigame();
    return;
  }
  if (key === 'feed') care.feed(_state);
  else if (key === 'clean') care.clean(_state);
  else if (key === 'medicine') {
    const { wasSick } = care.giveMedicine(_state);
    showBanner(wasSick ? '¡Se ha recuperado!' : 'No hace falta medicina ahora mismo.');
  }
  render(_state);
  saveState(_state);
}

function startMinigame() {
  viewRoot.innerHTML = '';
  mountedTab = null; // que la Mochila se reconstruya al volver del minijuego
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
