import { WORLD_CHUNK_SIZE, canonicalShift } from './torus.js';

const movePoint = (point, dx, dy) => {
  if (!point) return;
  if (Number.isFinite(point.x)) point.x += dx;
  if (Number.isFinite(point.y)) point.y += dy;
};

const moveLine = (line, dx, dy) => {
  if (!line) return;
  if (Number.isFinite(line.x1)) line.x1 += dx;
  if (Number.isFinite(line.y1)) line.y1 += dy;
  if (Number.isFinite(line.x2)) line.x2 += dx;
  if (Number.isFinite(line.y2)) line.y2 += dy;
};

function moveBossMemory(enemy, dx, dy) {
  for (const key of [
    'rockAt', 'ringAt', 'zapAt', 'blinkTo', 'seedRingAt', 'acidAt',
    'beaconBlinkTo', 'crossAt',
  ]) movePoint(enemy[key], dx, dy);
  moveLine(enemy.pulseLine, dx, dy);
  // memo активной связки: точка, в которой была зафиксирована геометрия удара.
  // Если её не сдвинуть, на шве связка ударит по старым координатам, а телеграф
  // (он в общем списке выше) уже уедет — подсветка разойдётся с ударом.
  const memo = enemy.string?.memo;
  if (memo) {
    movePoint(memo, dx, dy);
    moveLine(memo, dx, dy);
    for (const point of memo.points ?? []) movePoint(point, dx, dy);
  }
  for (const line of enemy.crossLines ?? []) moveLine(line, dx, dy);
  for (const node of enemy.nodes ?? []) movePoint(node, dx, dy);
  for (const pool of enemy.acidPools ?? []) movePoint(pool, dx, dy);
}

function moveDecor(decor, dx, dy) {
  if (!decor) return;
  movePoint(decor, dx, dy);
  // Перебираем ЛЮБЫЕ массивы декора, а не список ключей: список приходилось
  // дополнять с каждым новым биомом, и забытый ключ (лианы Зарослей, жилы
  // Диссонанса) молча оставлял декор висеть на старом месте после шва.
  for (const value of Object.values(decor)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) movePoint(item, dx, dy);
  }
}

/**
 * Переносит всю активную симуляцию тем же вектором, что и игрока.
 * Канонические станции, waypoint и центры биомов намеренно не трогаются.
 */
export function wrapActiveSimulation(game, camera) {
  const shift = canonicalShift(game.player.x, game.player.y);
  const { x: dx, y: dy } = shift;
  if (dx === 0 && dy === 0) return shift;

  movePoint(game.player, dx, dy);
  movePoint(game.aim, dx, dy);
  movePoint(camera, dx, dy);

  const pointLists = [
    game.entities.enemies,
    game.entities.asteroids,
    game.entities.pickups,
    game.projectiles.bullets,
    game.projectiles.foeBullets,
    game.projectiles.mines,
    game.turrets,
    game.singularities,
    game.strikes,
    game.decoys,
    game.mirrors,
    game.anchors,
    game.player.drones,
    game.fx.particles,
    game.fx.floaters,
    game.fx.blasts,
  ];
  for (const list of pointLists) for (const item of list ?? []) movePoint(item, dx, dy);

  for (const bullet of game.projectiles.bullets) {
    if (Number.isFinite(bullet.spawnX)) bullet.spawnX += dx;
    if (Number.isFinite(bullet.spawnY)) bullet.spawnY += dy;
  }
  for (const line of game.rifts ?? []) moveLine(line, dx, dy);
  for (const line of game.fx.beams ?? []) moveLine(line, dx, dy);
  for (const shape of game.telegraphs ?? []) {
    movePoint(shape, dx, dy);
    moveLine(shape, dx, dy);
  }
  for (const enemy of game.entities.enemies) moveBossMemory(enemy, dx, dy);
  for (const snapshot of game.player.effects?.rewindBuffer ?? []) movePoint(snapshot, dx, dy);

  // Активная арена станции — локальная копия канонической станции.
  movePoint(game.run.stationEncounter, dx, dy);

  // Чанки уже загружены в image space. Переносим и переименовываем их,
  // чтобы на шве содержимое не исчезло и не родилось заново в тот же кадр.
  const dcx = dx / WORLD_CHUNK_SIZE;
  const dcy = dy / WORLD_CHUNK_SIZE;
  const movedChunks = new Map();
  const chunkKeys = new Map();
  for (const [oldKey, chunk] of game.world.chunks) {
    chunk.cx += dcx;
    chunk.cy += dcy;
    moveDecor(chunk.decor, dx, dy);
    const newKey = `${chunk.cx},${chunk.cy}`;
    movedChunks.set(newKey, chunk);
    chunkKeys.set(oldKey, newKey);
  }
  game.world.chunks = movedChunks;
  for (const asteroid of game.entities.asteroids) {
    if (chunkKeys.has(asteroid.chunk)) asteroid.chunk = chunkKeys.get(asteroid.chunk);
  }
  for (const pickup of game.entities.pickups) {
    if (chunkKeys.has(pickup.chunk)) pickup.chunk = chunkKeys.get(pickup.chunk);
  }

  return shift;
}
