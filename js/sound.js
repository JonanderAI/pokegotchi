// Sonido del juego.
//
// No hay ficheros de audio: los pitidos se sintetizan con WebAudio. Son cuatro
// notas cuadradas con una envolvente corta, que es exactamente lo que sonaba en
// las maquinitas que esto imita, y así el juego no engorda ni un byte ni depende
// de que haya red para sonar.
//
// El navegador no deja crear el contexto de audio hasta que el usuario toca algo,
// así que se crea perezosamente en el primer sonido, que por definición viene de
// una interacción.

let ctx = null;
let enabled = true;

function audio() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

export function setSoundEnabled(on) {
  enabled = !!on;
}

export function soundEnabled() {
  return enabled;
}

// Una nota. `type` cambia el timbre: cuadrada para los pitidos de maquinita,
// triangular para lo suave.
function note(freq, start, dur, { type = 'square', gain = 0.06 } = {}) {
  const ac = audio();
  if (!ac) return;

  const osc = ac.createOscillator();
  const vol = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);

  // Ataque muy corto y caída exponencial: sin esto los pitidos chasquean al
  // empezar y al acabar.
  vol.gain.setValueAtTime(0.0001, start);
  vol.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  vol.gain.exponentialRampToValueAtTime(0.0001, start + dur);

  osc.connect(vol);
  vol.connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

// Toca una secuencia de [frecuencia, duración] una detrás de otra.
function play(seq, opts) {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;
  if (ac.state === 'suspended') ac.resume().catch(() => {});

  let t = ac.currentTime + 0.01;
  seq.forEach(([freq, dur]) => {
    note(freq, t, dur, opts);
    t += dur;
  });
}

// Las notas van en la escala pentatónica: cualquier combinación suena bien, que
// es lo que hace falta cuando se disparan varias a la vez sin control.
export const SOUNDS = {
  // mordisco corto y contento
  eat: () => play([[523, 0.06], [784, 0.08]]),
  // el saltito de cuando le acaricias
  happy: () => play([[659, 0.05], [880, 0.05], [1047, 0.09]]),
  // sube la escala entera: algo importante ha pasado
  evolve: () => play([[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.22]], { gain: 0.075 }),
  // dos notas hacia abajo: algo va mal
  bad: () => play([[392, 0.1], [294, 0.16]], { type: 'triangle', gain: 0.05 }),
  // el "toc" de tocar la pantalla, apenas audible
  tap: () => play([[880, 0.035]], { gain: 0.025 }),
  // cae la baya en el minijuego
  catchItem: () => play([[988, 0.05], [1319, 0.07]], { gain: 0.05 }),
  // el huevo se rompe
  hatch: () => play([[440, 0.07], [587, 0.07], [880, 0.18]], { gain: 0.07 }),
};

export function playSound(name) {
  const fn = SOUNDS[name];
  if (fn) fn();
}
