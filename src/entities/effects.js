import { rnd, TAU } from '../core/math.js';

/**
 * Визуальные эффекты без игровой логики: частицы, всплывающий текст,
 * лучи рельсы и ударные кольца взрывов.
 */

/** Потолок частиц: в поздних волнах со всеми перками их иначе тысячи и кадры проседают. */
const MAX_PARTICLES = 900;
const MAX_FLOATERS = 60;

export function createEffects() {
  return { particles: [], floaters: [], beams: [], blasts: [] };
}

export function spark(fx, x, y, count, color, speed = 220, life = 0.5, size = 2) {
  const room = MAX_PARTICLES - fx.particles.length;
  if (room <= 0) return;
  count = Math.min(count, room);
  for (let i = 0; i < count; i++) {
    const a = rnd(TAU);
    const s = rnd(speed, speed * 0.2);
    fx.particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life, max: life, color,
      size: size * rnd(1.4, 0.6),
    });
  }
}

export function trail(fx, x, y, vx, vy, color, life = 0.3, size = 3) {
  if (fx.particles.length >= MAX_PARTICLES) return;
  fx.particles.push({ x, y, vx, vy, life, max: life, color, size });
}

export function floatText(fx, x, y, text, color) {
  if (fx.floaters.length >= MAX_FLOATERS) fx.floaters.shift();
  fx.floaters.push({ x, y, text, color, life: 0.8 });
}

export function beam(fx, x1, y1, x2, y2, color, width) {
  fx.beams.push({ x1, y1, x2, y2, color, width, life: 0.18, max: 0.18 });
}

export function blastRing(fx, x, y, r, color) {
  fx.blasts.push({ x, y, r, color, life: 0.3, max: 0.3 });
}

export function updateEffects(fx, dt) {
  for (let i = fx.particles.length - 1; i >= 0; i--) {
    const p = fx.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.95;
    p.vy *= 0.95;
    p.life -= dt;
    if (p.life <= 0) fx.particles.splice(i, 1);
  }
  for (let i = fx.floaters.length - 1; i >= 0; i--) {
    const f = fx.floaters[i];
    f.y -= dt * 34;
    f.life -= dt;
    if (f.life <= 0) fx.floaters.splice(i, 1);
  }
  for (let i = fx.beams.length - 1; i >= 0; i--) {
    fx.beams[i].life -= dt;
    if (fx.beams[i].life <= 0) fx.beams.splice(i, 1);
  }
  for (let i = fx.blasts.length - 1; i >= 0; i--) {
    fx.blasts[i].life -= dt;
    if (fx.blasts[i].life <= 0) fx.blasts.splice(i, 1);
  }
}

export function clearEffects(fx) {
  fx.particles.length = 0;
  fx.floaters.length = 0;
  fx.beams.length = 0;
  fx.blasts.length = 0;
}
