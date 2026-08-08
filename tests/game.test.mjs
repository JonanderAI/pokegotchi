// Pruebas de la lógica del juego.
//
// Solo se prueba lo que es cálculo puro y no toca el DOM: la curva de niveles,
// el ciclo día/noche, qué reclama el Pokémon y qué hace cada cuidado. Ahí es
// donde viven las reglas, y donde romper algo no se nota hasta que juegas un
// rato.
//
// Se ejecutan con el runner de Node, sin instalar nada:
//
//     node --test tests/
//
// state.js toca localStorage al importarse desde el navegador, así que se le
// pone uno de mentira antes de cargar nada.

import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { xpForLevel, levelFromXp, TIMING } = await import('../js/state.js');
const care = await import('../js/care.js');
const { STARTERS } = await import('../js/species-pool.js');

// Un Pokémon de laboratorio: sano, despierto y sin nada pendiente.
function pet(extra = {}) {
  return {
    phase: 'baby',
    speciesId: 25,
    cycleTick: 0,
    stageAge: 0,
    xp: 0,
    hunger: 100,
    happiness: 100,
    hygiene: 100,
    energy: 100,
    sick: false,
    pendingEvolution: null,
    poopCount: 0,
    awakenedThisNight: false,
    careGoodEvents: 0,
    careBadEvents: 0,
    ...extra,
  };
}

const stateWith = (extra) => ({ pet: pet(extra), gifts: [], pokedex: {} });

// --- niveles ----------------------------------------------------------------

test('subir de nivel cuesta cada vez más', () => {
  const costes = [1, 2, 3, 4, 5].map(xpForLevel);
  for (let i = 1; i < costes.length; i += 1) {
    assert.ok(costes[i] > costes[i - 1], `el nivel ${i + 1} debería costar más que el ${i}`);
  }
});

test('los primeros niveles son más baratos que los 40 fijos de antes', () => {
  assert.ok(xpForLevel(1) < 40);
  assert.ok(xpForLevel(2) < 40);
});

test('levelFromXp cuadra con lo que cuesta cada nivel', () => {
  assert.deepEqual(levelFromXp(0), { level: 0, into: 0, need: xpForLevel(1) });

  // justo antes de subir sigue en el mismo nivel
  const primero = xpForLevel(1);
  assert.equal(levelFromXp(primero - 1).level, 0);
  // y con lo justo, sube y empieza el siguiente de cero
  assert.deepEqual(levelFromXp(primero), { level: 1, into: 0, need: xpForLevel(2) });

  // acumulando dos niveles enteros
  assert.equal(levelFromXp(xpForLevel(1) + xpForLevel(2)).level, 2);
});

test('levelFromXp aguanta valores raros sin colgarse', () => {
  assert.equal(levelFromXp(-50).level, 0);
  assert.ok(levelFromXp(1e6).level > 0);
});

// --- ciclo día/noche --------------------------------------------------------

test('el día va primero y la noche después', () => {
  assert.equal(care.isNight(pet({ cycleTick: 0 })), false);
  assert.equal(care.isNight(pet({ cycleTick: TIMING.dayTicks - 1 })), false);
  assert.equal(care.isNight(pet({ cycleTick: TIMING.dayTicks })), true);
  assert.equal(care.isNight(pet({ cycleTick: TIMING.dayTicks + TIMING.nightTicks - 1 })), true);
});

test('el ciclo se repite', () => {
  const ciclo = TIMING.dayTicks + TIMING.nightTicks;
  assert.equal(care.isNight(pet({ cycleTick: ciclo })), false);
  assert.equal(care.isNight(pet({ cycleTick: ciclo + TIMING.dayTicks })), true);
});

// --- dormir y despertar -----------------------------------------------------

test('no se le puede acostar si va sobrado de energía', () => {
  const state = stateWith({ energy: 100 });
  const res = care.sendToSleep(state);
  assert.equal(res.ok, false);
  assert.equal(care.isNight(state.pet), false);
});

test('acostarle adelanta la noche', () => {
  const state = stateWith({ energy: 30, cycleTick: 10 });
  assert.equal(care.sendToSleep(state).ok, true);
  assert.equal(care.isNight(state.pet), true);
});

test('despertarle termina la noche, y le sienta mal si no ha descansado', () => {
  const dormido = stateWith({ cycleTick: TIMING.dayTicks + 5, energy: 40, happiness: 80 });
  const res = care.wakeUp(dormido);
  assert.equal(res.ok, true);
  assert.equal(res.rested, false);
  assert.equal(care.isNight(dormido.pet), false);
  assert.ok(dormido.pet.happiness < 80, 'debería costarle felicidad');

  const descansado = stateWith({ cycleTick: TIMING.dayTicks + 5, energy: 95, happiness: 80 });
  assert.equal(care.wakeUp(descansado).rested, true);
  assert.equal(descansado.pet.happiness, 80, 'descansado no debería costarle nada');
});

test('de día no hay a quién despertar', () => {
  assert.equal(care.wakeUp(stateWith({ cycleTick: 0 })).ok, false);
});

// --- qué reclama ------------------------------------------------------------

test('si está todo bien no pide nada', () => {
  assert.deepEqual(care.currentNeeds(pet()), []);
});

test('lo urgente va primero', () => {
  const needs = care.currentNeeds(pet({ sick: true, hunger: 5, poopCount: 2 }));
  assert.equal(needs[0].key, 'sick');
  assert.ok(needs.some((n) => n.key === 'hungry'));
});

test('la evolución pendiente manda sobre todo lo demás', () => {
  const needs = care.currentNeeds(pet({ pendingEvolution: 26, sick: true }));
  assert.equal(needs[0].key, 'evolving');
  assert.equal(needs[0].action, true);
});

test('no salen más de tres a la vez', () => {
  const needs = care.currentNeeds(pet({
    sick: true, poopCount: 3, hunger: 1, happiness: 1, energy: 1, cycleTick: 45,
  }));
  assert.ok(needs.length <= 3, `salieron ${needs.length}`);
});

test('lo muy bajo se marca como urgente y lo flojo no', () => {
  const [critico] = care.currentNeeds(pet({ hunger: 5 }));
  assert.equal(critico.urgent, true);
  const [flojo] = care.currentNeeds(pet({ hunger: 35 }));
  assert.equal(flojo.urgent, false);
});

test('el huevo y la despedida no piden nada', () => {
  assert.deepEqual(care.currentNeeds(pet({ phase: 'egg', hunger: 0 })), []);
  assert.deepEqual(care.currentNeeds(pet({ phase: 'oak', hunger: 0 })), []);
});

// --- cuidados ---------------------------------------------------------------

test('darle de comer sube el hambre sin pasarse de 100', () => {
  const state = stateWith({ hunger: 90 });
  care.feed(state);
  assert.equal(state.pet.hunger, 100);
});

test('limpiar deja la higiene a tope y se lleva los restos', () => {
  const state = stateWith({ hygiene: 20, poopCount: 3 });
  care.clean(state);
  assert.equal(state.pet.poopCount, 0);
  assert.ok(state.pet.hygiene > 20);
});

test('la medicina solo cuenta como cuidado si estaba malo', () => {
  const malo = stateWith({ sick: true, careGoodEvents: 0 });
  assert.equal(care.giveMedicine(malo).wasSick, true);
  assert.equal(malo.pet.sick, false);
  assert.equal(malo.pet.careGoodEvents, 1);

  const sano = stateWith({ sick: false, careGoodEvents: 0 });
  assert.equal(care.giveMedicine(sano).wasSick, false);
  assert.equal(sano.pet.careGoodEvents, 0, 'dar medicina a uno sano no debería premiar');
});

test('despertarle de noche para jugar cuesta felicidad, y solo la primera vez', () => {
  const state = stateWith({ cycleTick: TIMING.dayTicks + 1, happiness: 80 });
  assert.equal(care.applyPlayResult(state, true).woke, true);
  assert.equal(care.applyPlayResult(state, true).woke, false);
});

// --- iniciales --------------------------------------------------------------

test('los iniciales están dentro del rango de sprites que hay', () => {
  assert.ok(STARTERS.length > 0);
  STARTERS.forEach((id) => {
    assert.ok(id >= 1 && id <= 386, `${id} se sale del rango`);
  });
});

test('Pikachu y Eevee cuentan como iniciales', () => {
  assert.ok(STARTERS.includes(25), 'falta Pikachu');
  assert.ok(STARTERS.includes(133), 'falta Eevee');
});
