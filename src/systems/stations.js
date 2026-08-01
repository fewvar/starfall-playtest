import { emit } from '../core/events.js';
import { clamp, hyper, TAU } from '../core/math.js';
import { hash32, mulberry, rngAt } from '../core/rng.js';
import { availableEnemies, getEnemy } from '../data/enemies.js';
import { getLocation } from '../data/locations.js';
import {
  STATION_ACTIVATION_RADIUS,
  STATION_ACTIVE_LIMIT,
  STATION_ARENA_RADIUS,
  STATION_CHANCE_LIMITS,
  STATION_DISCOVERY_MIN_RADIUS,
  STATION_GENERATOR_VERSION,
  STATION_MIN_GAP_CHUNKS,
  STATION_MIN_HOME_CHUNKS,
  STATION_REWARDS,
  stationRewardById,
} from '../data/stations.js';
import { makeEnemy } from '../entities/factory.js';
import { ARMOR_A, CRIT_A, DODGE_A } from '../entities/player.js';
import { CHUNK, clustersAround } from '../world/world.js';
import {
  WORLD_MAX_CHUNK,
  WORLD_MIN_CHUNK,
  nearestPointImage,
  torChunkDistance,
  torDistance,
} from '../world/torus.js';
import { enemyDamageScale, enemyHpScale, enemySpeedScale, waveBudget } from './waves.js';

const COUNT_SALT = 0x51a710;
const PLACE_SALT = 0x51a711;
const SHAPE_SALT = 0x51a712;
const WAVE_SALT = 0x51a713;
const REWARD_SALT = 0x51a714;
const EPSILON = 1e-9;

/** Единственная ручка геометрии постоянных станций. */
export const stationDistance = torDistance;

/** Обнаружение всегда начинается дальше диагонали обычного экрана. */
export const stationDiscoveryRadius = (view = {}) =>
  Math.max(STATION_DISCOVERY_MIN_RADIUS, Math.hypot(view.width ?? 0, view.height ?? 0) * 0.62);

/**
 * Снимок ближайшей локации: внутри/на пересечении побеждает более опасная,
 * между кластерами — ближайшая граница. Расстояние до старта не участвует.
 */
export function stationAnchorAt(x, y, seed, suppliedClusters = null) {
  const cx = Math.floor(x / CHUNK);
  const cy = Math.floor(y / CHUNK);
  const clusters = suppliedClusters ?? clustersAround(cx, cy, seed, 4);
  let best = null;

  for (const cluster of clusters) {
    const loc = getLocation(cluster.type ?? cluster.locationId);
    const edgeDistance = Math.max(0, stationDistance(x, y, cluster.x, cluster.y) - cluster.radius);
    // Difficulty belongs to this exact area instance, not to its content type.
    const level = cluster.recommendedLevel ?? loc.recommendedLevel ?? 1;
    const stableKey = cluster.id ?? `${cluster.chunkX ?? cluster.x}:${cluster.chunkY ?? cluster.y}:${loc.id}`;
    if (!best
      || edgeDistance < best.edgeDistance - EPSILON
      || (Math.abs(edgeDistance - best.edgeDistance) <= EPSILON && level > best.recommendedLevel)
      || (Math.abs(edgeDistance - best.edgeDistance) <= EPSILON
        && level === best.recommendedLevel && stableKey < best.stableKey)) {
      best = {
        locationId: loc.id,
        recommendedLevel: level,
        edgeDistance,
        stableKey,
      };
    }
  }

  if (best) return best;
  return { locationId: 'open', recommendedLevel: 1, edgeDistance: Infinity, stableKey: 'open' };
}

/** Сила encounter целиком выводится из сохранённого уровня локации. */
export function stationDifficultyFor(recommendedLevel, locationId = 'open') {
  const level = Math.max(1, Math.round(recommendedLevel || 1));
  const referenceWave = clamp(level + 1, 2, 14);
  const modifiers = getLocation(locationId).modifiers ?? {};
  const baseBudget = Math.min(48, Math.ceil(waveBudget(referenceWave) * 1.25 + 2));
  return {
    recommendedLevel: level,
    referenceWave,
    budget: Math.max(1, Math.ceil(baseBudget * (modifiers.enemyCountMul ?? 1))),
    hpMul: 1.20 * enemyHpScale(referenceWave) * (modifiers.enemyHpMul ?? 1),
    damageMul: 1.12 * enemyDamageScale(referenceWave),
    speedMul: Math.min(1.55, 1.03 * enemySpeedScale(referenceWave)),
  };
}

function buildCombatPlan(station, seed) {
  const random = rngAt(station.chunkX, station.chunkY, seed + WAVE_SALT);
  const difficulty = station.difficulty;
  const pool = availableEnemies(difficulty.referenceWave, station.locationId);
  const roster = [];
  let budget = difficulty.budget;
  let guard = 500;

  while (budget > 0 && guard-- > 0) {
    const affordable = pool.filter((id) => getEnemy(id).cost <= budget);
    if (!affordable.length) break;
    const id = affordable[(random() * affordable.length) | 0];
    roster.push(id);
    budget -= getEnemy(id).cost;
  }

  const spawns = roster.map((type, index) => ({
    type,
    angle: random() * TAU,
    radius: STATION_ARENA_RADIUS * (0.64 + random() * 0.22),
    seed: hash32(index, station.chunkX - station.chunkY, seed + WAVE_SALT),
  }));
  return { ...difficulty, roster, spawns };
}

/** Ровно 5–7 постоянных станций для одного seed. */
export function generateStations(seed) {
  const normalizedSeed = seed >>> 0;
  const count = 5 + (hash32(normalizedSeed, 0, COUNT_SALT) % 3);
  const candidates = [];

  for (let chunkX = WORLD_MIN_CHUNK; chunkX <= WORLD_MAX_CHUNK; chunkX++) {
    for (let chunkY = WORLD_MIN_CHUNK; chunkY <= WORLD_MAX_CHUNK; chunkY++) {
      if (Math.hypot(chunkX, chunkY) < STATION_MIN_HOME_CHUNKS) continue;
      candidates.push({
        chunkX,
        chunkY,
        rank: hash32(chunkX, chunkY, normalizedSeed + PLACE_SALT),
      });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.chunkX - b.chunkX || a.chunkY - b.chunkY);

  const stations = [];
  for (const candidate of candidates) {
    if (stations.some((s) => torChunkDistance(
      candidate.chunkX, candidate.chunkY, s.chunkX, s.chunkY,
    ) < STATION_MIN_GAP_CHUNKS)) continue;

    const random = rngAt(candidate.chunkX, candidate.chunkY, normalizedSeed + SHAPE_SALT);
    const x = (candidate.chunkX + 0.5 + (random() - 0.5) * 0.48) * CHUNK;
    const y = (candidate.chunkY + 0.5 + (random() - 0.5) * 0.48) * CHUNK;
    const anchor = stationAnchorAt(x, y, normalizedSeed);
    const difficulty = stationDifficultyFor(anchor.recommendedLevel, anchor.locationId);
    const station = {
      id: `station:${normalizedSeed.toString(16)}:${stations.length}`,
      seed: normalizedSeed,
      generatorVersion: STATION_GENERATOR_VERSION,
      chunkX: candidate.chunkX,
      chunkY: candidate.chunkY,
      x,
      y,
      angle: random() * TAU,
      wreckVariant: (random() * 4) | 0,
      locationId: anchor.locationId,
      recommendedLevel: anchor.recommendedLevel,
      difficulty,
      discovered: false,
      status: 'hidden',
      promptDismissed: false,
      promptOpen: false,
      rewardClaimed: null,
    };
    station.combat = buildCombatPlan(station, normalizedSeed);
    stations.push(station);
    if (stations.length === count) break;
  }

  if (stations.length !== count) {
    throw new Error(`station generator produced ${stations.length}/${count} stations`);
  }
  return stations;
}

export function initStationRun(run) {
  run.stations = generateStations(run.seed ?? 0);
  run.stationEncounter = null;
  run.stationPromptId = null;
  run.stationsCleared = 0;
  return run.stations;
}

export const activeStation = (run) => {
  const id = run.stationEncounter?.stationId;
  return id ? run.stations?.find((station) => station.id === id) ?? null : null;
};

/** Локальная копия активной станции остаётся рядом с боем при переходе шва. */
export const activeStationImage = (game) => {
  const station = activeStation(game.run);
  if (!station) return null;
  const encounter = game.run.stationEncounter;
  if (Number.isFinite(encounter?.x) && Number.isFinite(encounter?.y)) {
    return { ...station, x: encounter.x, y: encounter.y };
  }
  return nearestPointImage(station, game.player);
};

export const stationEnemies = (game, stationId = game.run.stationEncounter?.stationId) =>
  game.entities.enemies.filter((enemy) => enemy.source === 'station' && enemy.encounterId === stationId);

export function canActivateStation(game, station) {
  if (!station || station.status === 'active' || station.status === 'reward' || station.status === 'cleared') return false;
  if (game.run.stationEncounter || game.run.phase !== 'breather') return false;
  if (game.entities.enemies.some((enemy) => enemy.fromWave)) return false;
  return stationDistance(game.player.x, game.player.y, station.x, station.y) <= STATION_ACTIVATION_RADIUS;
}

export function activateStation(game, stationId) {
  const station = game.run.stations?.find((item) => item.id === stationId);
  if (!canActivateStation(game, station)) return false;

  station.discovered = true;
  station.status = 'active';
  station.promptOpen = false;
  game.run.stationPromptId = null;
  const stationImage = nearestPointImage(station, game.player);
  game.run.stationEncounter = {
    stationId,
    x: stationImage.x,
    y: stationImage.y,
    status: 'active',
    queue: station.combat.spawns.map((spawn) => ({ ...spawn })),
    spawnTimer: 0,
    remaining: station.combat.spawns.length,
    rewards: null,
    rewardClaimed: false,
  };
  releaseStationEnemies(game, true);
  emit('station:activated', { station });
  return true;
}

export function declineStationPrompt(run, stationId) {
  const station = run.stations?.find((item) => item.id === stationId);
  if (!station) return false;
  station.promptOpen = false;
  station.promptDismissed = true;
  if (run.stationPromptId === stationId) run.stationPromptId = null;
  return true;
}

function releaseStationEnemies(game, initial = false) {
  const encounter = game.run.stationEncounter;
  const station = activeStationImage(game);
  if (!encounter || encounter.status !== 'active' || !station || !encounter.queue.length) return;

  let slots = STATION_ACTIVE_LIMIT - stationEnemies(game, station.id).length;
  const release = initial ? Math.min(slots, 12) : slots;
  slots = release;
  while (slots-- > 0 && encounter.queue.length) {
    const spawn = encounter.queue.shift();
    const random = mulberry(spawn.seed);
    const enemy = makeEnemy(
      station.x + Math.cos(spawn.angle) * spawn.radius,
      station.y + Math.sin(spawn.angle) * spawn.radius,
      spawn.type,
      1,
      random,
    );
    enemy.hp = enemy.maxHp = Math.max(1, Math.round(enemy.maxHp * station.combat.hpMul));
    enemy.damage *= station.combat.damageMul;
    enemy.speed *= station.combat.speedMul;
    enemy.stationScale = {
      hp: station.combat.hpMul,
      damage: station.combat.damageMul,
      speed: station.combat.speedMul,
    };
    enemy.fromWave = false;
    enemy.source = 'station';
    enemy.encounterId = station.id;

    const tough = game.player.effects.flags.toughEnemies ?? 0;
    if (tough) {
      enemy.cursed = true;
      enemy.maxHp = Math.round(enemy.maxHp * (1 + tough));
      enemy.hp = enemy.maxHp;
    }
    game.entities.enemies.push(enemy);
  }
}

function constrainObject(object, station, radius) {
  const dx = object.x - station.x;
  const dy = object.y - station.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius || distance === 0) return;
  const nx = dx / distance;
  const ny = dy / distance;
  object.x = station.x + nx * radius;
  object.y = station.y + ny * radius;
  const outward = (object.vx ?? 0) * nx + (object.vy ?? 0) * ny;
  if (outward > 0) {
    object.vx -= nx * outward;
    object.vy -= ny * outward;
  }
}

/** Физическая граница действует только во время боя станции. */
export function constrainStationArena(game) {
  const encounter = game.run.stationEncounter;
  const station = activeStationImage(game);
  if (!station || encounter?.status !== 'active') return false;
  constrainObject(game.player, station, STATION_ARENA_RADIUS - game.player.r - 8);
  for (const enemy of stationEnemies(game, station.id)) {
    constrainObject(enemy, station, STATION_ARENA_RADIUS - enemy.r - 4);
  }
  return true;
}

function chanceBase(player, stat) {
  if (stat === 'crit') return hyper(CRIT_A, player.critPoints);
  if (stat === 'armor') return hyper(ARMOR_A, player.armorPoints);
  if (stat === 'dodge') return hyper(DODGE_A, player.dodgePoints);
  return 0;
}

export function stationRewardAvailable(player, reward) {
  if (!reward || !['crit', 'armor', 'dodge'].includes(reward.stat)) return Boolean(reward);
  const existing = player.stationBonuses?.[reward.stat] ?? 0;
  return chanceBase(player, reward.stat) + existing + reward.value
    <= STATION_CHANCE_LIMITS[reward.stat] + EPSILON;
}

/** Три разных предложения; порядок воспроизводим для самой станции. */
export function offerStationRewards(player, station) {
  const pool = STATION_REWARDS.filter((reward) => stationRewardAvailable(player, reward)).map((r) => ({ ...r }));
  const random = mulberry(hash32(station.chunkX, station.chunkY, REWARD_SALT + (station.seed ?? 0)));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

/** Прямые дельты обходят обычную систему уровней карточек и её diminishing. */
export function applyStationReward(player, rewardOrId) {
  const reward = typeof rewardOrId === 'string' ? stationRewardById[rewardOrId] : rewardOrId;
  if (!stationRewardAvailable(player, reward)) return false;
  player.stationBonuses ??= { crit: 0, armor: 0, dodge: 0 };
  player.stationUpgrades ??= {};

  switch (reward.stat) {
    case 'damage': player.dmgAdd += reward.value; break;
    case 'ram': player.ram += reward.value; break;
    case 'rate': player.attackSpeed += reward.value; break;
    case 'hull': player.maxHp += reward.value; player.hp = player.maxHp; break;
    case 'shield':
      player.maxShield += reward.value;
      player.shieldRegen += reward.regen;
      player.shield = player.maxShield;
      break;
    case 'regen': player.regen += reward.value; break;
    case 'speed': player.thrust *= reward.value; player.maxSpeed *= reward.value; break;
    case 'crit':
    case 'armor':
    case 'dodge': player.stationBonuses[reward.stat] += reward.value; break;
    default: return false;
  }
  player.stationUpgrades[reward.stat] = (player.stationUpgrades[reward.stat] ?? 0) + 1;
  return true;
}

export function finishStationReward(game, rewardId) {
  const encounter = game.run.stationEncounter;
  const station = activeStation(game.run);
  if (!encounter || encounter.status !== 'reward' || encounter.rewardClaimed || !station) return false;
  const reward = encounter.rewards?.find((item) => item.id === rewardId);
  if (!reward || !applyStationReward(game.player, reward)) return false;

  encounter.rewardClaimed = true;
  station.rewardClaimed = reward.id;
  station.status = 'cleared';
  game.run.stationsCleared = (game.run.stationsCleared ?? 0) + 1;
  game.run.stationEncounter = null;
  emit('station:rewarded', { station, reward });
  return true;
}

/** Обнаружение, prompt и независимая очередь подкреплений. */
export function updateStations(game, dt) {
  const run = game.run;
  if (!run.stations?.length || run.over) return;

  const discoveryRadius = stationDiscoveryRadius(game.view);
  for (const station of run.stations) {
    const distance = stationDistance(game.player.x, game.player.y, station.x, station.y);
    if (!station.discovered && distance <= discoveryRadius) {
      station.discovered = true;
      station.status = 'discovered';
      emit('station:discovered', { station });
    }
    if (distance > STATION_ACTIVATION_RADIUS * 1.25) {
      station.promptDismissed = false;
      station.promptOpen = false;
      if (run.stationPromptId === station.id) run.stationPromptId = null;
    }
  }

  const encounter = run.stationEncounter;
  if (encounter?.status === 'active') {
    encounter.spawnTimer -= dt;
    if (encounter.spawnTimer <= 0) {
      encounter.spawnTimer = 0.75;
      releaseStationEnemies(game);
    }
    constrainStationArena(game);
    const alive = stationEnemies(game, encounter.stationId).length;
    encounter.remaining = alive + encounter.queue.length;
    if (encounter.remaining === 0) {
      const station = activeStation(run);
      encounter.status = 'reward';
      station.status = 'reward';
      encounter.rewards = offerStationRewards(game.player, station);
      emit('station:cleared', { station, rewards: encounter.rewards });
    }
    return;
  }

  if (run.stationEncounter || run.stationPromptId) return;
  for (const station of run.stations) {
    if (!station.discovered || station.status !== 'discovered' || station.promptDismissed) continue;
    if (!canActivateStation(game, station)) continue;
    station.promptOpen = true;
    run.stationPromptId = station.id;
    emit('station:prompt', { station });
    break;
  }
}
