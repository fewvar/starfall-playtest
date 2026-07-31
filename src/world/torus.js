/**
 * Геометрия конечного мира.
 *
 * Постоянные данные (ID биомов, станции, waypoint) живут в canonical space,
 * а бой — в ближайшем непрерывном image space. Полуоткрытый диапазон мира
 * намеренно не симметричен вокруг нуля: чанк 0 начинается в 0, зато старые
 * координаты старта и генератора не приходится перенумеровывать.
 */
export const WORLD_CHUNK_SIZE = 900;
export const WORLD_CHUNKS = 55;
export const WORLD_HALF_CHUNKS = Math.floor(WORLD_CHUNKS / 2);
export const WORLD_MIN_CHUNK = -WORLD_HALF_CHUNKS;
export const WORLD_MAX_CHUNK = WORLD_HALF_CHUNKS;
export const WORLD_SIZE = WORLD_CHUNK_SIZE * WORLD_CHUNKS;
export const WORLD_MIN = WORLD_MIN_CHUNK * WORLD_CHUNK_SIZE;
export const WORLD_MAX = (WORLD_MAX_CHUNK + 1) * WORLD_CHUNK_SIZE;

const positiveModulo = (value, size) => ((value % size) + size) % size;

/** Каноническое число в полуоткрытом диапазоне [min, min + size). */
export const wrapRange = (value, min, size) =>
  min + positiveModulo(value - min, size);

export const canonicalChunk = (chunk) =>
  wrapRange(chunk, WORLD_MIN_CHUNK, WORLD_CHUNKS);

export const canonicalWorld = (value) =>
  wrapRange(value, WORLD_MIN, WORLD_SIZE);

/** Кратчайшая подписанная разность to - from на одной оси тора. */
export function torDelta(from, to, size = WORLD_SIZE) {
  const half = size / 2;
  return positiveModulo(to - from + half, size) - half;
}

export const torDistance = (ax, ay, bx, by) =>
  Math.hypot(torDelta(ax, bx), torDelta(ay, by));

export const torChunkDelta = (from, to) => torDelta(from, to, WORLD_CHUNKS);
export const torChunkDistance = (ax, ay, bx, by) =>
  Math.hypot(torChunkDelta(ax, bx), torChunkDelta(ay, by));

/** Каноническая координата объекта, показанная ближайшей копией к origin. */
export const nearestWorldImage = (coordinate, origin) =>
  origin + torDelta(origin, coordinate);

export const nearestPointImage = (point, origin) => ({
  ...point,
  x: nearestWorldImage(point.x, origin.x),
  y: nearestWorldImage(point.y, origin.y),
});

/** Девять соседних копий нужны карте, когда область пересекает шов тора. */
export function worldImages(point, origin) {
  const nearX = nearestWorldImage(point.x, origin.x);
  const nearY = nearestWorldImage(point.y, origin.y);
  const out = [];
  for (const ox of [-WORLD_SIZE, 0, WORLD_SIZE]) {
    for (const oy of [-WORLD_SIZE, 0, WORLD_SIZE]) {
      out.push({ ...point, x: nearX + ox, y: nearY + oy });
    }
  }
  return out;
}

/** Сдвиг, который возвращает локальную позицию в canonical space. */
export const canonicalShift = (x, y) => ({
  // Внутри диапазона возвращаем точный ноль без modulo: на дробных
  // координатах обратное сложение даёт epsilon и ложно запускает дорогой
  // перенос всей симуляции каждый кадр.
  x: x >= WORLD_MIN && x < WORLD_MAX ? 0 : canonicalWorld(x) - x,
  y: y >= WORLD_MIN && y < WORLD_MAX ? 0 : canonicalWorld(y) - y,
});
