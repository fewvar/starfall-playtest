import { hash32, rngAt } from '../core/rng.js';
import { LOCATIONS } from '../data/locations.js';
import {
  WORLD_CHUNK_SIZE,
  WORLD_MAX_CHUNK,
  WORLD_MIN_CHUNK,
  torDistance,
} from './torus.js';

/**
 * Единственная детерминированная расстановка крупных областей этапа E.2.
 * Тип — это контент, а recommendedLevel принадлежит конкретному экземпляру.
 */
export const LOCATION_GENERATOR_VERSION = 2;
export const LARGE_LOCATION_COUNT = 15;
export const START_RADIUS_CHUNKS = 4;
export const START_SAFE_GAP_CHUNKS = 5;
export const REGION_GAP_CHUNKS = 1;
export const LEVEL_NEIGHBOR_RADIUS_CHUNKS = 16;

const PLACE_SALT = 0x10ca710;
const RIFT_SALT = 0x10ca711;
const TYPE_SALT = 0x10ca712;
const RETRY_SALT = 0x10ca713;
const NORMAL_LEVELS = [2, 2, 3, 3, 4, 4, 6, 6, 7, 7, 9, 9, 10];
const CACHE = new Map();

const chunks = (value) => value * WORLD_CHUNK_SIZE;
const distance = (a, b) => torDistance(a.x, a.y, b.x, b.y);
const edgeGap = (a, b) => distance(a, b) - a.radius - b.radius;

function candidatePool(seed, salt) {
  const out = [];
  for (let chunkX = WORLD_MIN_CHUNK; chunkX <= WORLD_MAX_CHUNK; chunkX++) {
    for (let chunkY = WORLD_MIN_CHUNK; chunkY <= WORLD_MAX_CHUNK; chunkY++) {
      const random = rngAt(chunkX, chunkY, seed + salt);
      const radiusChunks = 3 + ((random() * 3) | 0);
      out.push({
        x: (chunkX + 0.18 + random() * 0.64) * WORLD_CHUNK_SIZE,
        y: (chunkY + 0.18 + random() * 0.64) * WORLD_CHUNK_SIZE,
        radius: chunks(radiusChunks),
        chunkX,
        chunkY,
        rank: hash32(chunkX, chunkY, seed + salt),
      });
    }
  }
  return out.sort((a, b) => a.rank - b.rank || a.chunkX - b.chunkX || a.chunkY - b.chunkY);
}

function typeForLevel(level, seed, index) {
  const candidates = Object.values(LOCATIONS).filter((loc) => {
    const placement = loc.placement;
    return placement?.kind === 'normal' && level >= placement.minLevel && level <= placement.maxLevel;
  });
  if (!candidates.length) throw new Error(`No normal location type supports level ${level}`);
  const random = rngAt(index, level, seed + TYPE_SALT);
  let total = candidates.reduce((sum, loc) => sum + (loc.placement.weight ?? 1), 0);
  let roll = random() * total;
  for (const loc of candidates) {
    roll -= loc.placement.weight ?? 1;
    if (roll <= 0) return loc.id;
  }
  return candidates[candidates.length - 1].id;
}

function record(candidate, { id, biomeId, type, recommendedLevel, placementKind }) {
  return {
    ...candidate,
    id,
    biomeId,
    type,
    recommendedLevel,
    placementKind,
    // Совместимость с прежним рендером; cell теперь — id области, а не сетка.
    cellX: id,
    cellY: 0,
  };
}

function isNormalNeighbor(a, b) {
  return a.placementKind === 'normal' && b.placementKind === 'normal'
    && distance(a, b) <= chunks(LEVEL_NEIGHBOR_RADIUS_CHUNKS);
}

function compatibleNormal(candidate, placed) {
  const nearby = placed.filter((other) => isNormalNeighbor(candidate, other));
  return nearby.every((other) =>
    Math.max(candidate.recommendedLevel, other.recommendedLevel)
      <= Math.min(candidate.recommendedLevel, other.recommendedLevel) * 1.5,
  );
}

function nonOverlapping(candidate, placed, { allowRiftNearStart = false } = {}) {
  return placed.every((other) => {
    if (other.placementKind === 'start' && allowRiftNearStart) {
      return edgeGap(candidate, other) >= chunks(REGION_GAP_CHUNKS);
    }
    const requiredGap = other.placementKind === 'start' || candidate.placementKind === 'start'
      ? chunks(START_SAFE_GAP_CHUNKS)
      : chunks(REGION_GAP_CHUNKS);
    return edgeGap(candidate, other) >= requiredGap;
  });
}

function generate(seed) {
  const normalizedSeed = seed >>> 0;
  const start = record({ x: 0, y: 0, radius: chunks(START_RADIUS_CHUNKS), chunkX: 0, chunkY: 0 }, {
    id: 'start', biomeId: `start:${normalizedSeed}`, type: 'start', recommendedLevel: 1, placementKind: 'start',
  });

  for (let attempt = 0; attempt < 32; attempt++) {
    const pool = candidatePool(normalizedSeed, PLACE_SALT + attempt * RETRY_SALT);
    const riftCandidate = candidatePool(normalizedSeed, RIFT_SALT + attempt * RETRY_SALT)
      .find((candidate) => nonOverlapping({ ...candidate, placementKind: 'wildcardFinal' }, [start], { allowRiftNearStart: true }));
    if (!riftCandidate) continue;
    const rift = record(riftCandidate, {
      id: 'rift', biomeId: `location:${normalizedSeed}:rift`, type: 'rift',
      recommendedLevel: LOCATIONS.rift.recommendedLevel, placementKind: 'wildcardFinal',
    });
    const placed = [start, rift];
    let failed = false;

    for (let index = 0; index < NORMAL_LEVELS.length; index++) {
      const level = NORMAL_LEVELS[index];
      const type = typeForLevel(level, normalizedSeed, index);
      const candidate = pool.find((point) => {
        const next = { ...point, recommendedLevel: level, placementKind: 'normal' };
        if (!nonOverlapping(next, placed)) return false;
        if (!compatibleNormal(next, placed)) return false;
        // Обычные области образуют единый путь прогрессии, но первая начинается
        // за безопасным кольцом старта.
        return index === 0 || placed.some((other) => isNormalNeighbor(next, other));
      });
      if (!candidate) { failed = true; break; }
      placed.push(record(candidate, {
        id: `location:${index}`, biomeId: `location:${normalizedSeed}:${index}`,
        type, recommendedLevel: level, placementKind: 'normal',
      }));
    }
    if (!failed && placed.length === LARGE_LOCATION_COUNT) return placed;
  }
  throw new Error(`Location generator could not place ${LARGE_LOCATION_COUNT} regions for seed ${normalizedSeed}`);
}

export function locationsForSeed(seed = 0) {
  const normalizedSeed = seed >>> 0;
  let layout = CACHE.get(normalizedSeed);
  if (!layout) {
    layout = generate(normalizedSeed);
    CACHE.set(normalizedSeed, layout);
  }
  return layout;
}

export const startLocationForSeed = (seed = 0) => locationsForSeed(seed).find((location) => location.placementKind === 'start');
