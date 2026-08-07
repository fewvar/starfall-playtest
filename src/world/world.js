import { rngAt } from '../core/rng.js';
import { rnd, TAU } from '../core/math.js';
import { emit } from '../core/events.js';
import { LOCATIONS, getLocation } from '../data/locations.js';
import { generateDecor } from './decor.js';
import {
  WORLD_CHUNK_SIZE,
  canonicalChunk,
  torDistance,
} from './torus.js';
import { locationsForSeed as layoutForSeed } from './placement.js';
import { createGrid, rebuildGrid, queryGrid } from '../core/grid.js';

/**
 * Мир нарезан на чанки. Содержимое чанка выводится из хеша его координат,
 * поэтому конечный тор воспроизводим и не занимает память: далёкие image-чанки
 * выгружаются вместе со своими астероидами.
 *
 * Врагов чанки не порождают — за них отвечает система волн (systems/waves.js).
 */

export const CHUNK = WORLD_CHUNK_SIZE;
export const OPEN_BOSS_X = CHUNK * 6;
export const OPEN_BOSS_Y = 0;
export const locationsForSeed = (seed = 0) => layoutForSeed(seed);

/** Фоновый открытый космос — единая территория между 15 крупными областями. */
export const openBiomeId = (seed = 0) => `open-space:${seed >>> 0}`;

const openLocation = (seed) => ({
  ...LOCATIONS.open,
  biomeId: openBiomeId(seed),
  // Дредноут живёт в фоновом открытом космосе, а стартовая область отдельна.
  clusterX: OPEN_BOSS_X,
  clusterY: OPEN_BOSS_Y,
  clusterRadius: Infinity,
  clusterCellX: null,
  clusterCellY: null,
});

/**
 * Совместимый API карты: конечный мир всегда возвращает единый manifest из
 * 15 областей; аргументы точки сохранены для старых вызовов и тестов.
 */
export function clustersAround(cx, cy, seed, cellsAround = 4) {
  void cx; void cy; void cellsAround;
  return locationsForSeed(seed).map((location) => ({ ...location }));
}

/**
 * Локация в точке (cx,cy) чанков, детерминированно от сида забега.
 * У найденного кластера дополнительно возвращаются его мировые координаты
 * центра и радиус (clusterX/clusterY/clusterRadius, в юнитах) — нужно для
 * гравитации «Разлома» и порталов (systems/locations.js), которые тянут
 * именно к центру КОНКРЕТНОГО кластера, а не локации вообще.
 */
export function locationAt(cx, cy, seed = 0) {
  const x = (canonicalChunk(cx) + 0.5) * CHUNK;
  const y = (canonicalChunk(cy) + 0.5) * CHUNK;
  let best = null;
  let bestDistance = Infinity;
  for (const region of locationsForSeed(seed)) {
    const d = torDistance(x, y, region.x, region.y);
    if (d <= region.radius && d < bestDistance) {
      best = region;
      bestDistance = d;
    }
  }
  if (!best) return openLocation(seed);
  return {
    ...getLocation(best.type),
    instanceId: best.id,
    biomeId: best.biomeId,
    recommendedLevel: best.recommendedLevel,
    placementKind: best.placementKind,
    clusterX: best.x,
    clusterY: best.y,
    clusterRadius: best.radius,
    clusterCellX: best.id,
    clusterCellY: 0,
  };
}

export const chunkKey = (cx, cy) => cx + ',' + cy;

/** Сколько чанков вокруг игрока держать активными, чтобы экран был покрыт. */
export const viewRadius = (W, H) => Math.max(1, Math.ceil(Math.max(W, H) / 2 / CHUNK));

export function makeAsteroid(x, y, r, random = Math.random) {
  const n = 8 + ((random() * 5) | 0);
  const verts = [];
  for (let i = 0; i < n; i++) verts.push(0.7 + random() * 0.5);
  return {
    x, y, r, verts,
    vx: (random() - 0.5) * 46,
    vy: (random() - 0.5) * 46,
    angle: random() * TAU,
    spin: (random() - 0.5) * 1.1,
    hp: r * 1.5,
    maxHp: r * 1.5,
    flash: 0,
    chunk: null,
  };
}

export function createWorld() {
  return { chunks: new Map() };
}

/** Генерация и выгрузка чанков вокруг игрока + смена текущей локации. */
export function updateWorld(game) {
  const { world, player, entities, view, run } = game;
  const pcx = Math.floor(player.x / CHUNK);
  const pcy = Math.floor(player.y / CHUNK);
  const R = viewRadius(view.width, view.height);

  for (let dx = -R; dx <= R; dx++) {
    for (let dy = -R; dy <= R; dy++) spawnChunk(game, pcx + dx, pcy + dy);
  }

  const keep = R + 1;
  for (const [key, chunk] of world.chunks) {
    if (Math.abs(chunk.cx - pcx) > keep || Math.abs(chunk.cy - pcy) > keep) {
      world.chunks.delete(key);
      entities.asteroids = entities.asteroids.filter((a) => a.chunk !== key);
      entities.pickups = entities.pickups.filter((pickup) => pickup.chunk !== key);
    }
  }

  // отметка посещённой клетки для карты (M) — по клеткам кластеров, а не по
  // отдельным чанкам, иначе список рос бы без пользы для карты
  const loc = locationAt(pcx, pcy, run.seed ?? 0);
  run.visited ??= new Set();
  run.visited.add(loc.biomeId);

  // смена локации оповещается событием — systems/locations.js вешает/снимает
  // модификаторы, world.js ничего не знает об игровых эффектах (см. core/events.js)
  // В бесконечном режиме арену задаёт систем волн (run.arenaLocked), а не карта.
  if (run.arenaLocked) return;
  if (loc.biomeId !== run.biomeId) {
    const from = run.location;
    const fromBiomeId = run.biomeId;
    run.location = loc.id;
    run.biomeId = loc.biomeId;
    run.biome = {
      id: loc.biomeId,
      locationId: loc.id,
      x: loc.clusterX,
      y: loc.clusterY,
      radius: loc.clusterRadius,
      recommendedLevel: loc.recommendedLevel,
      cellX: loc.clusterCellX,
      cellY: loc.clusterCellY,
    };
    emit('location:change', {
      from,
      to: loc.id,
      fromBiomeId,
      toBiomeId: loc.biomeId,
      biome: run.biome,
    });
  }
}

function spawnChunk(game, cx, cy) {
  const { world, entities, run } = game;
  const key = chunkKey(cx, cy);
  if (world.chunks.has(key)) return;

  const canonicalCx = canonicalChunk(cx);
  const canonicalCy = canonicalChunk(cy);
  const location = locationAt(canonicalCx, canonicalCy, run.seed ?? 0);
  const random = rngAt(canonicalCx, canonicalCy, 1337);

  const ox = cx * CHUNK;
  const oy = cy * CHUNK;
  const home = canonicalCx === 0 && canonicalCy === 0;
  const count = home ? 4 : location.asteroids;

  for (let i = 0; i < count; i++) {
    const a = makeAsteroid(ox + random() * CHUNK, oy + random() * CHUNK, 22 + random() * 46, random);
    a.chunk = key;
    entities.asteroids.push(a);
  }

  // ЛОЗЫ ЗАРОСЛЕЙ. Разрушаемый объект, а не декор: живут в том же списке, что
  // астероиды, потому что им нужно ровно то же — HP, попадания снарядов,
  // владение чанком и выгрузка вместе с ним. Отличает их флаг vine.
  for (let i = 0; i < (location.vines ?? 0); i++) {
    const vine = makeAsteroid(ox + random() * CHUNK, oy + random() * CHUNK, 30 + random() * 22, random);
    vine.vine = true;
    vine.hp = vine.maxHp = vine.r * 2.4;
    vine.vx *= 0.25;
    vine.vy *= 0.25;
    vine.spin *= 0.4;
    vine.chunk = key;
    entities.asteroids.push(vine);
  }

  for (let i = 0; i < location.drops; i++) {
    entities.pickups.push({
      x: ox + random() * CHUNK,
      y: oy + random() * CHUNK,
      vx: rnd(40, -40), vy: rnd(40, -40),
      kind: random() < 0.5 ? 'hp' : 'xp',
      value: 6, r: 7, age: 0, chunk: key,
    });
  }

  // Декор не имеет коллизий, поэтому стартовые обломки читают историю места,
  // но не могут перекрыть безопасный коридор появления игрока.
  const decor = generateDecor(location, canonicalCx, canonicalCy, ox, oy, CHUNK, random);
  world.chunks.set(key, { cx, cy, canonicalCx, canonicalCy, location, decor });
}

/**
 * Столкновения астероидов друг с другом (упругие, с учётом массы).
 *
 * Раньше камни свободно проходили насквозь: поле выглядело не полем, а
 * набором независимых спрайтов на одном слое. Масса берётся от площади —
 * мелкий обломок отлетает от глыбы, а не двигает её.
 *
 * Перебор идёт по сетке, а не парами: на поздних волнах в поясе бывает под
 * сотню камней, и N² здесь стоил бы дороже всей остальной физики.
 */
const asteroidGrid = createGrid(220);
const REST = 0.86;   // потеря энергии на удар: камни не пружинят вечно

function resolveAsteroidPairs(game) {
  const list = game.entities.asteroids;
  if (list.length < 2) return;
  rebuildGrid(asteroidGrid, list);

  for (const a of list) {
    queryGrid(asteroidGrid, a.x, a.y, a.r + 90, (b) => {
      // каждую пару обрабатываем один раз: сравнение по ссылке через индекс
      // не подходит, сетка их не упорядочивает — берём стабильный признак
      if (b === a || b.r > a.r || (b.r === a.r && b.x <= a.x)) return false;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) return false;

      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      const ma = a.r * a.r;
      const mb = b.r * b.r;
      const total = ma + mb;

      // расталкивание: без него камни залипают друг в друге и дрожат
      const overlap = min - d;
      a.x -= nx * overlap * (mb / total);
      a.y -= ny * overlap * (mb / total);
      b.x += nx * overlap * (ma / total);
      b.y += ny * overlap * (ma / total);

      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel > 0) return false;          // уже расходятся
      const impulse = (-(1 + REST) * rel) / total;
      a.vx -= impulse * mb * nx;
      a.vy -= impulse * mb * ny;
      b.vx += impulse * ma * nx;
      b.vy += impulse * ma * ny;
      a.spin += rel * 0.0006 * (mb / total);
      b.spin -= rel * 0.0006 * (ma / total);
      return false;
    });
  }
}

export function updateAsteroids(game, dt) {
  for (const a of game.entities.asteroids) {
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.angle += a.spin * dt;
    a.flash -= dt;
  }
  resolveAsteroidPairs(game);
}
