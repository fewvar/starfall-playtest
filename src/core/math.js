/** Мелкая математика, которой пользуется весь проект. */

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Случайное число в [b, a). rnd(5) → [0,5), rnd(5,-5) → [-5,5) */
export const rnd = (a = 1, b = 0) => b + Math.random() * (a - b);
export const rndInt = (a, b = 0) => Math.floor(rnd(a, b));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** Кратчайшая разница углов в диапазоне [-PI, PI]. */
export const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
/** Плавный доворот угла a к b на долю t. */
export const angLerp = (a, b, t) => a + angDiff(a, b) * t;

/** Кадронезависимое сглаживание: доля per-second, а не per-frame. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.pow(rate, dt));

/**
 * Гиперболическое накопление процентов (модель Risk of Rain 2).
 *
 *   hyper(0.14, 1) = 12%   hyper(0.14, 5) = 41%   hyper(0.14, 20) = 74%
 *
 * Каждое следующее очко слабее предыдущего, но результат никогда не
 * достигает 100%. Так шанс крита, брони и уклонения не схлопывается
 * в гарантию после десятой карточки — билд остаётся выбором, а не стакингом.
 */
export const hyper = (a, points) => (points > 0 ? 1 - 1 / (1 + a * points) : 0);

/** Перемешивание массива на месте (Фишер–Йетс). */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Взвешенный выбор: items — массив объектов с полем weight. */
export function weighted(items) {
  let total = 0;
  for (const it of items) total += it.weight ?? 1;
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight ?? 1;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

export const fmt = (n) => Math.round(n).toLocaleString('ru-RU');
