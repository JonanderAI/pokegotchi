import { ITEM_ICONS } from './sprite-resolver.js';

const ROUNDS = 5;
const ROUND_MS = 900;

// Minijuego táctil: toca la Poké Ball antes de que desaparezca. Suficientes aciertos = éxito.
// Llama a onComplete(success: boolean) al terminar.
export function mountMinigame(container, onComplete) {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'minigame-wrap';
  wrap.style.position = 'relative';
  wrap.style.width = '100%';
  wrap.style.height = '220px';
  wrap.style.border = '2px solid var(--border-color)';
  wrap.style.borderRadius = '8px';
  wrap.style.overflow = 'hidden';
  wrap.style.background = 'rgba(255,255,255,.12)';

  const info = document.createElement('p');
  info.className = 'screen-title';
  info.textContent = `¡Toca la Poké Ball! (0/${ROUNDS})`;

  container.appendChild(info);
  container.appendChild(wrap);

  let hits = 0;
  let round = 0;
  let currentBall = null;
  let cancelled = false;

  function clearBall() {
    if (currentBall) {
      currentBall.remove();
      currentBall = null;
    }
  }

  function nextRound() {
    if (cancelled) return;
    clearBall();
    round += 1;
    info.textContent = `¡Toca la Poké Ball! (${hits}/${ROUNDS})`;
    if (round > ROUNDS) {
      finish();
      return;
    }
    const ball = document.createElement('img');
    ball.src = ITEM_ICONS.play;
    ball.alt = 'toca';
    ball.style.position = 'absolute';
    ball.style.width = '40px';
    ball.style.height = '40px';
    const maxX = wrap.clientWidth - 40;
    const maxY = wrap.clientHeight - 40;
    ball.style.left = `${Math.max(0, Math.random() * maxX)}px`;
    ball.style.top = `${Math.max(0, Math.random() * maxY)}px`;
    ball.addEventListener('pointerdown', () => {
      if (cancelled || ball !== currentBall) return;
      hits += 1;
      clearBall();
      setTimeout(nextRound, 150);
    });
    currentBall = ball;
    wrap.appendChild(ball);

    setTimeout(() => {
      if (currentBall === ball) {
        clearBall();
        setTimeout(nextRound, 150);
      }
    }, ROUND_MS);
  }

  function finish() {
    cancelled = true;
    clearBall();
    const success = hits >= Math.ceil(ROUNDS * 0.6);
    onComplete(success, hits, ROUNDS);
  }

  nextRound();

  return () => {
    cancelled = true;
    clearBall();
  };
}
