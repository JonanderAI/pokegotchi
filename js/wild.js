// Pokémon salvajes que se pasean por el fondo del escenario. Son actores igual
// que la mascota (mismo sprite por generación, misma sombra medida, mismos
// saltitos), pero con vida propia: entran por un lado, deambulan un rato y se
// van.

import { resolveSprite } from './sprite-resolver.js';
import { animateSprite } from './sprite-anim.js';
import { applyShadow, footOffset } from './sprite-shadow.js';
import { placeActor, STEP_U, STEP_V } from './world.js';
import { SPECIES_POOL } from './species-pool.js';

const MAX_WILD = 3;
const STEP_MS = 620;          // andan un poco más lentos que la mascota

// De vez en cuando, en lugar de un salvaje suelto, aparece una familia: un
// Pokémon ya evolucionado con sus crías detrás, en fila, como una mamá pato con
// sus patitos. Es un acontecimiento, así que sale poco.
const FAMILY_CHANCE = 0.28;
const FAMILY_BABIES = [2, 4];   // cuántas crías, de mínimo a máximo
const BABY_SIZE = 0.5;          // lo que miden respecto a su madre
const BABY_GAP = 2;             // pasos de retraso entre uno y el siguiente
const BABY_SCATTER = 0.09;      // cuánto se sale cada cría de la fila

// Parejas conocidas de antemano (final de línea evolutiva y su forma de base).
// Va a mano y no vía PokeAPI a propósito: esto tiene que salir igual de bien sin
// red, y preguntar la cadena entera de cada especie para ir hacia atrás sería
// mucho pedir para un adorno.
const FAMILIES = [
  { parent: 3, baby: 1 },      // Venusaur / Bulbasaur
  { parent: 6, baby: 4 },      // Charizard / Charmander
  { parent: 9, baby: 7 },      // Blastoise / Squirtle
  { parent: 12, baby: 10 },    // Butterfree / Caterpie
  { parent: 15, baby: 13 },    // Beedrill / Weedle
  { parent: 18, baby: 16 },    // Pidgeot / Pidgey
  { parent: 26, baby: 25 },    // Raichu / Pikachu
  { parent: 59, baby: 58 },    // Arcanine / Growlithe
  { parent: 154, baby: 152 },  // Meganium / Chikorita
  { parent: 157, baby: 155 },  // Typhlosion / Cyndaquil
  { parent: 160, baby: 158 },  // Feraligatr / Totodile
  { parent: 254, baby: 252 },  // Sceptile / Treecko
  { parent: 257, baby: 255 },  // Blaziken / Torchic
  { parent: 260, baby: 258 },  // Swampert / Mudkip
];
// Con cuentagotas, pero no tanto: a 25-60 segundos y viviendo diez, podías
// estar un buen rato sin ver ninguno, y el temporizador se reinicia cada vez que
// se recarga la página, así que jugando a ratos cortos no aparecía nunca.
const SPAWN_MIN_MS = 11000;
const SPAWN_MAX_MS = 26000;
const LIFE_STEPS = [26, 52];  // pasos que se quedan antes de irse
const FADE_MS = 400;

// Hasta dónde deambulan en profundidad. Va con la zona por la que se mueve tu
// Pokémon (ver PET_MIN_V y PET_MAX_V en ui.js): si ellos llegan al primer plano
// y los salvajes no, se nota que hay una valla invisible.
const WILD_MIN_V = 0.03;
const WILD_MAX_V = 1.12;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Entran por cualquier borde, no solo por el fondo: por los lados a cualquier
// profundidad, por detrás del todo o por delante, cruzando por primer plano.
// Saliendo siempre del mismo sitio, el escenario se sentía plano.
function spawnPosition() {
  const side = Math.floor(Math.random() * 4);

  if (side === 0 || side === 1) {
    const fromLeft = side === 0;
    return {
      u: fromLeft ? 0.02 : 0.98,
      v: randomBetween(WILD_MIN_V, WILD_MAX_V),
      dir: fromLeft ? 1 : -1,
    };
  }

  // por detrás o por delante: entran a media altura y se cruzan hacia un lado
  const goRight = Math.random() < 0.5;
  return {
    u: randomBetween(0.15, 0.85),
    v: side === 2 ? WILD_MIN_V : WILD_MAX_V,
    dir: goRight ? 1 : -1,
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
      if (!isPaused?.()) {
        // La familia ocupa media pantalla, así que solo sale si el escenario
        // está vacío; si no, un salvaje suelto de los de siempre.
        if (!actors.length && Math.random() < FAMILY_CHANCE) spawnFamily();
        else if (actors.length < MAX_WILD) spawn();
      }
      scheduleSpawn();
    }, randomBetween(SPAWN_MIN_MS, SPAWN_MAX_MS));
  }

  function pickSpecies() {
    const options = SPECIES_POOL.filter((id) => id !== excludeId);
    return options[Math.floor(Math.random() * options.length)];
  }

  // `opts` es lo que cambia entre un salvaje suelto y una cría: la especie, por
  // dónde entra, lo grande que es y si se le puede tocar (a las crías no: van
  // detrás de su madre y sacarlas de la fila para jugar las dejaría colgadas).
  function spawn(opts = {}) {
    const speciesId = opts.speciesId || pickSpecies();
    const sprite = resolveSprite(speciesId);
    const start = opts.start || spawnPosition();
    const tappable = opts.tappable !== false;

    const wrap = document.createElement('div');
    wrap.className = `wild-wrap pet-sprite-wrap${tappable ? ' tappable' : ''}`;
    if (opts.size) {
      // El tamaño del sprite sale de --pet-size, que hereda del escenario: aquí
      // se pisa para la cría, y como la sombra se mide de la caja ya pintada,
      // sale a escala sola.
      const base = parseFloat(getComputedStyle(stageEl).getPropertyValue('--pet-size')) || 220;
      wrap.style.setProperty('--pet-size', `${Math.round(base * opts.size)}px`);
    }

    const shadow = document.createElement('div');
    shadow.className = 'pet-shadow';
    wrap.appendChild(shadow);

    const img = document.createElement('div');
    img.className = 'pet-img';
    img.style.setProperty('--flip', start.dir > 0 ? '-1' : '1');
    wrap.classList.toggle('mirrored', start.dir > 0);
    wrap.appendChild(img);

    const actor = {
      speciesId,
      sprite,
      wrap,
      img,
      shadow,
      anim: null,
      pos: { u: start.u, v: start.v },
      dir: start.dir,
      stepsLeft: Math.round(randomBetween(LIFE_STEPS[0], LIFE_STEPS[1])),
      leaving: false,
      timer: null,
      followers: null,   // las crías, si es una madre
      trail: null,       // por dónde ha pasado, para que la sigan
    };

    if (tappable) {
      wrap.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        hop(actor);
        onTap?.(actor);
      });
    }

    actor.cheer = () => hop(actor);
    actor.faceTo = (dir) => face(actor, dir);

    stageEl.appendChild(wrap);
    actors.push(actor);

    place(actor);
    actor.anim = animateSprite(img, speciesId);
    if (actor.anim) {
      actor.anim.play();
      applyShadow(wrap, img, sprite.src, { w: actor.anim.sheet.cellW, h: actor.anim.sheet.cellH })
        .then(() => place(actor));
    } else {
      img.style.backgroundImage = `url("${sprite.fallback}")`;
      img.style.backgroundSize = 'contain';
      applyShadow(wrap, img, sprite.fallback).then(() => place(actor));
    }

    requestAnimationFrame(() => wrap.classList.add('visible'));
    // Las crías no andan por su cuenta: las mueve su madre en su propio paso.
    if (!opts.follows) actor.timer = setTimeout(() => step(actor), STEP_MS);
    return actor;
  }

  // Una madre y sus crías detrás, en fila. Entran todas por el mismo lado y
  // desde el fondo, para que la fila se vea entera.
  function spawnFamily() {
    const family = FAMILIES[Math.floor(Math.random() * FAMILIES.length)];
    const start = spawnPosition();
    const count = Math.round(randomBetween(FAMILY_BABIES[0], FAMILY_BABIES[1]));

    const mother = spawn({ speciesId: family.parent, start });
    mother.trail = [];
    mother.followers = [];

    for (let i = 0; i < count; i += 1) {
      const baby = spawn({
        speciesId: family.baby,
        // arrancan pegadas a su madre; en cuanto ella ande, cada una se coloca
        // en el trozo de camino que le toca
        start: { u: start.u, v: start.v, dir: start.dir },
        size: BABY_SIZE,
        tappable: false,
        follows: true,
      });
      // Cada una con su desvío y su retraso: siguen el mismo camino, pero no
      // pisándolo exacto. En fila perfecta parecían un tren, no crías.
      baby.offset = {
        u: (Math.random() - 0.5) * BABY_SCATTER,
        v: (Math.random() - 0.5) * BABY_SCATTER,
      };
      baby.gap = BABY_GAP + Math.floor(Math.random() * 2);
      mother.followers.push(baby);
    }
  }

  // Cada cría se pone donde estuvo su madre hace unos pasos: no se calcula un
  // camino nuevo, se reaprovecha el suyo. Por eso van en fila india y no en
  // montón, y por eso giran donde giró ella y no antes.
  function moveFollowers(mother) {
    if (!mother.followers || !mother.followers.length) return;

    mother.trail.unshift({ u: mother.pos.u, v: mother.pos.v, dir: mother.dir });
    const needed = mother.followers.length * (BABY_GAP + 1) + 2;
    if (mother.trail.length > needed) mother.trail.length = needed;

    mother.followers.forEach((baby, i) => {
      const back = (i + 1) * (baby.gap || BABY_GAP);
      const point = mother.trail[Math.min(back, mother.trail.length - 1)];
      if (!point) return;
      const off = baby.offset || { u: 0, v: 0 };
      baby.pos.u = Math.min(0.98, Math.max(0.02, point.u + off.u));
      baby.pos.v = Math.min(WILD_MAX_V, Math.max(WILD_MIN_V, point.v + off.v));
      face(baby, point.dir);
      hop(baby);
      place(baby);
    });
  }

  // Voltear al actor: el sprite y su sombra. La sombra se mide de los pies, que
  // no caen en el centro del lienzo, así que si solo se refleja el sprite la
  // sombra se queda a un lado.
  function face(actor, dir) {
    actor.img.style.setProperty('--flip', dir > 0 ? '-1' : '1');
    actor.wrap.classList.toggle('mirrored', dir > 0);
  }

  function place(actor) {
    placeActor(actor.wrap, getProjection(), actor.pos, footOffset(actor.wrap));
    if (actor.anim) actor.anim.reflow();
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

    // mientras juega con tu Pokémon se queda donde está
    if (actor.busy) {
      actor.timer = setTimeout(() => step(actor), STEP_MS);
      return;
    }

    // De noche (o cuando la vista no está activa) se van yendo.
    if (isPaused?.()) actor.leaving = true;

    if (actor.leaving) {
      // se marchan por el lado más cercano
      const exit = actor.pos.u < 0.5 ? 0 : 1;
      actor.dir = exit === 0 ? -1 : 1;
      actor.pos.u += actor.dir * STEP_U;
      face(actor, actor.dir);
      hop(actor);
      place(actor);
      moveFollowers(actor);
      if (actor.pos.u <= 0.02 || actor.pos.u >= 0.98) {
        despawn(actor);
        return;
      }
    } else {
      if (actor.stepsLeft <= 0) {
        actor.leaving = true;
        actor.wrap.classList.remove('visible');
        if (actor.followers) actor.followers.forEach((b) => b.wrap.classList.remove('visible'));
      } else {
        actor.stepsLeft -= 1;
        if (actor.pos.u <= 0.05) actor.dir = 1;
        else if (actor.pos.u >= 0.95) actor.dir = -1;
        else if (Math.random() < 0.15) actor.dir = -actor.dir;

        actor.pos.u = Math.min(0.98, Math.max(0.02, actor.pos.u + actor.dir * STEP_U));
        if (Math.random() < 0.3) {
          actor.pos.v = Math.min(WILD_MAX_V, Math.max(WILD_MIN_V, actor.pos.v + (Math.random() < 0.5 ? -1 : 1) * STEP_V));
        }
        face(actor, actor.dir);
        hop(actor);
        place(actor);
        moveFollowers(actor);
      }
    }

    actor.timer = setTimeout(() => step(actor), STEP_MS);
  }

  function despawn(actor) {
    // si es una madre, se lleva a las crías con ella
    if (actor.followers) actor.followers.forEach(despawn);
    clearTimeout(actor.timer);
    if (actor.anim) actor.anim.destroy();
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
        if (actor.anim) actor.anim.destroy();
        actor.wrap.remove();
      });
      actors.length = 0;
    },
  };
}
