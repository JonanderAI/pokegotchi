// Pokémon salvajes que se pasean por el fondo del escenario. Son actores igual
// que la mascota (mismo sprite por generación, misma sombra medida, mismos
// saltitos), pero con vida propia: entran por un lado, deambulan un rato y se
// van.

import { resolveSprite } from './sprite-resolver.js';
import { applyShadow, footOffset } from './sprite-shadow.js';
import { placeActor, STEP_U, STEP_V } from './world.js';
import { SPECIES_POOL } from './species-pool.js';

const MAX_WILD = 3;
const STEP_MS = 620;          // andan un poco más lentos que la mascota
const FLIP_MS = 500;
const SPAWN_MIN_MS = 5000;
const SPAWN_MAX_MS = 13000;
const LIFE_STEPS = [14, 30];  // pasos que se quedan antes de irse
const FADE_MS = 400;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Los salvajes salen del fondo, nunca en primer plano: el protagonista es la
// mascota.
function spawnPosition() {
  const fromLeft = Math.random() < 0.5;
  return {
    u: fromLeft ? 0.02 : 0.98,
    v: randomBetween(0.05, 0.55),
    dir: fromLeft ? 1 : -1,
  };
}

// getProjection es una función y no la proyección directamente porque el
// escenario puede cambiar de tamaño (girar el móvil) mientras hay salvajes.
export function mountWildPokemon(stageEl, getProjection, opts = {}) {
  const { onTap, isPaused, excludeId } = opts;
  const actors = [];
  let spawnTimer = null;
  let stopped = false;

  function scheduleSpawn() {
    clearTimeout(spawnTimer);
    spawnTimer = setTimeout(() => {
      if (stopped) return;
      if (!isPaused?.() && actors.length < MAX_WILD) spawn();
      scheduleSpawn();
    }, randomBetween(SPAWN_MIN_MS, SPAWN_MAX_MS));
  }

  function pickSpecies() {
    const options = SPECIES_POOL.filter((id) => id !== excludeId);
    return options[Math.floor(Math.random() * options.length)];
  }

  function spawn() {
    const speciesId = pickSpecies();
    const sprite = resolveSprite(speciesId);
    const start = spawnPosition();

    const wrap = document.createElement('div');
    wrap.className = 'wild-wrap pet-sprite-wrap tappable';

    const shadow = document.createElement('div');
    shadow.className = 'pet-shadow';
    wrap.appendChild(shadow);

    const img = document.createElement('img');
    img.className = 'pet-img';
    img.src = sprite.src;
    img.style.setProperty('--flip', start.dir > 0 ? '-1' : '1');
    img.onerror = () => {
      if (sprite.fallback) {
        img.src = sprite.fallback;
        applyShadow(wrap, img, sprite.fallback).then(() => place(actor));
      }
    };
    wrap.appendChild(img);

    const actor = {
      speciesId,
      sprite,
      wrap,
      img,
      shadow,
      pos: { u: start.u, v: start.v },
      dir: start.dir,
      stepsLeft: Math.round(randomBetween(LIFE_STEPS[0], LIFE_STEPS[1])),
      leaving: false,
      timer: null,
      flipTimer: null,
      frame2: false,
    };

    wrap.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      hop(actor);
      onTap?.(actor);
    });

    stageEl.appendChild(wrap);
    actors.push(actor);

    place(actor);
    applyShadow(wrap, img, sprite.src).then(() => place(actor));

    if (sprite.kind === 'flip' && sprite.src2) {
      actor.flipTimer = setInterval(() => {
        actor.frame2 = !actor.frame2;
        img.src = actor.frame2 ? sprite.src2 : sprite.src;
      }, FLIP_MS);
    }

    requestAnimationFrame(() => wrap.classList.add('visible'));
    actor.timer = setTimeout(() => step(actor), STEP_MS);
  }

  function place(actor) {
    placeActor(actor.wrap, getProjection(), actor.pos, footOffset(actor.wrap));
  }

  function hop(actor) {
    [actor.img, actor.shadow].forEach((el) => {
      el.classList.remove('hop');
      void el.offsetWidth;
      el.classList.add('hop');
    });
  }

  function step(actor) {
    if (stopped) return;

    // De noche (o cuando la vista no está activa) se van yendo.
    if (isPaused?.()) actor.leaving = true;

    if (actor.leaving) {
      // se marchan por el lado más cercano
      const exit = actor.pos.u < 0.5 ? 0 : 1;
      actor.dir = exit === 0 ? -1 : 1;
      actor.pos.u += actor.dir * STEP_U;
      actor.img.style.setProperty('--flip', actor.dir > 0 ? '-1' : '1');
      hop(actor);
      place(actor);
      if (actor.pos.u <= 0.02 || actor.pos.u >= 0.98) {
        despawn(actor);
        return;
      }
    } else {
      if (actor.stepsLeft <= 0) {
        actor.leaving = true;
        actor.wrap.classList.remove('visible');
      } else {
        actor.stepsLeft -= 1;
        if (actor.pos.u <= 0.05) actor.dir = 1;
        else if (actor.pos.u >= 0.95) actor.dir = -1;
        else if (Math.random() < 0.15) actor.dir = -actor.dir;

        actor.pos.u = Math.min(0.98, Math.max(0.02, actor.pos.u + actor.dir * STEP_U));
        if (Math.random() < 0.3) {
          actor.pos.v = Math.min(0.7, Math.max(0.02, actor.pos.v + (Math.random() < 0.5 ? -1 : 1) * STEP_V));
        }
        actor.img.style.setProperty('--flip', actor.dir > 0 ? '-1' : '1');
        hop(actor);
        place(actor);
      }
    }

    actor.timer = setTimeout(() => step(actor), STEP_MS);
  }

  function despawn(actor) {
    clearTimeout(actor.timer);
    clearInterval(actor.flipTimer);
    actor.wrap.classList.remove('visible');
    const idx = actors.indexOf(actor);
    if (idx >= 0) actors.splice(idx, 1);
    setTimeout(() => actor.wrap.remove(), FADE_MS);
  }

  scheduleSpawn();

  return {
    // al cambiar el tamaño del escenario hay que recolocarlos
    reflow() {
      actors.forEach(place);
    },
    stop() {
      stopped = true;
      clearTimeout(spawnTimer);
      actors.forEach((actor) => {
        clearTimeout(actor.timer);
        clearInterval(actor.flipTimer);
        actor.wrap.remove();
      });
      actors.length = 0;
    },
  };
}
