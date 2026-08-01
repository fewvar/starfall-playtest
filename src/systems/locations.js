import { emit, on } from '../core/events.js';
import { setAudioScene } from '../core/audio.js';
import { getLocation } from '../data/locations.js';
import { cardById } from '../data/perks.js';
import { floatText } from '../entities/effects.js';
import { meta } from './meta.js';
import { applyUpgrade } from './progression.js';
import { hurtPlayer } from './combat.js';
import { perkBlast } from './effects.js';
import { rnd, TAU } from '../core/math.js';
import { DAMAGE_TYPE } from '../core/damage.js';
import { nearestWorldImage, torDelta, torDistance } from '../world/torus.js';
import { CHUNK, locationAt } from '../world/world.js';

const TECHNICAL_DAMAGE = { type: DAMAGE_TYPE.TECHNICAL, penetration: 0, fromEffect: false };

// Безопасные стартовые значения E.2. Они собраны здесь, чтобы плейтест мог
// менять темп механик без охоты за magic numbers по игровому циклу.
export const LOCATION_SPECIAL_TUNING = Object.freeze({
  acidDps: 5,
  seedBaseDps: 0.4,
  seedDpsPerSecond: 0.18,
  seedMaxDps: 8,
  groveAttuneSeconds: 4,
  dissonanceCleanseSeconds: 6,
  singularityPerkSeconds: 300,
  gatewayWarningSeconds: 1.2,
  gatewayActiveSeconds: 0.06, // один-два simulation tick: буквально «миллисекунды», но collision достижим
});

export function ensureLocationSpecials(run) {
  return run.locationSpecials ??= {
    acidProtection: false,
    seed: null,
    seedImmunity: 0,
    groveStructure: null,
    dissonanceArtifact: null,
    dissonanceStructure: null,
    hallucination: { active: false, elapsed: 0, seed: run.seed ?? 0 },
    gateway: null,
    gatewayTimer: 8,
  };
}

export function initLocations(game) {
  on('location:change', ({ from, to }) => {
    applyLocationModifiers(game, getLocation(to));
    handleLocationChange(game, from, to);
  });
}

function applyLocationModifiers(game, loc) {
  const p = game.player;
  if (!p) return;
  const m = loc.modifiers ?? {};
  p.locationRicochetBonus = m.ricochetBonus ?? 0;
  p.locationBulletLifeMul = m.bulletLifeMul ?? 1;
  p.locationLootMul = m.lootMul ?? 1;
  p.locationBulletSpeedMul = m.bulletSpeedMul ?? 1;
}

function pointInBiome(game, salt, distance = 360) {
  const biome = game.run.biome;
  const cx = Number.isFinite(biome?.x) ? biome.x : game.player.x;
  const cy = Number.isFinite(biome?.y) ? biome.y : game.player.y;
  const angle = ((game.run.seed ?? 0) * 0.000013 + salt * 2.399963) % TAU;
  const maxDistance = Number.isFinite(biome?.radius)
    ? Math.max(120, Math.min(distance, biome.radius * 0.45))
    : distance;
  return { x: cx + Math.cos(angle) * maxDistance, y: cy + Math.sin(angle) * maxDistance };
}

function handleLocationChange(game, from, to) {
  const state = ensureLocationSpecials(game.run);
  if (from === 'grove' && to !== 'grove') clearHullSeed(game, 'exit');
  if (to !== 'rift') {
    state.gateway = null;
    state.gatewayTimer = 8;
  }

  if (to === 'grove' && !state.groveStructure) {
    state.groveStructure = {
      ...pointInBiome(game, 11, 430),
      kind: 'acid-protection', biomeId: game.run.biomeId,
      r: 54, progress: 0, cleared: false,
    };
  }

  if (to === 'dissonance' && !state.dissonanceArtifact) {
    state.dissonanceArtifact = {
      ...pointInBiome(game, 23, 260),
      kind: 'dissonance-artifact', biomeId: game.run.biomeId,
      r: 15, collected: false,
    };
    state.dissonanceStructure = {
      ...pointInBiome(game, 37, 520),
      kind: 'dissonance-cleanser', biomeId: game.run.biomeId,
      r: 62, progress: 0, cleared: false,
    };
  }

  syncLocationAudio(game);
}

function syncLocationAudio(game) {
  const hallucinating = !!game.run.locationSpecials?.hallucination?.active;
  setAudioScene({
    location: game.run.realm?.id ?? game.run.location,
    silent: game.run.realm?.id === 'singularity',
    hallucinating,
  });
}

export function clearHullSeed(game, reason = 'dash') {
  const state = ensureLocationSpecials(game.run);
  if (!state.seed) return false;
  state.seed = null;
  state.seedImmunity = reason === 'dash' ? 0.9 : 0;
  if (game.player) floatText(game.fx, game.player.x, game.player.y - 34, 'СЕМЯ СБРОШЕНО', '#68f0b0');
  return true;
}

function updateGrove(game, dt) {
  const state = ensureLocationSpecials(game.run);
  const p = game.player;
  state.seedImmunity = Math.max(0, state.seedImmunity - dt);

  for (const asteroid of game.entities.asteroids) {
    // Только крупные камни становятся источниками семян: игрок видит причину,
    // а мелкая россыпь не превращает механику в неизбежный случайный дебафф.
    const owner = asteroid.chunk ? game.world.chunks.get(asteroid.chunk)?.location?.id : 'grove';
    asteroid.overgrown = owner === 'grove' && asteroid.r >= 42;
    if (state.seed || state.seedImmunity > 0 || !asteroid.overgrown) continue;
    if (torDistance(p.x, p.y, asteroid.x, asteroid.y) <= p.r + asteroid.r + 3) {
      state.seed = { age: 0, size: 3, sourceBiomeId: game.run.biomeId };
      floatText(game.fx, p.x, p.y - 36, 'СЕМЯ НА КОРПУСЕ', '#68f0b0');
    }
  }

  const structure = state.groveStructure;
  if (structure && !structure.cleared && structure.biomeId === game.run.biomeId) {
    const inside = torDistance(p.x, p.y, structure.x, structure.y) <= structure.r + p.r;
    structure.progress = inside
      ? Math.min(LOCATION_SPECIAL_TUNING.groveAttuneSeconds, structure.progress + dt)
      : Math.max(0, structure.progress - dt * 0.5);
    if (structure.progress >= LOCATION_SPECIAL_TUNING.groveAttuneSeconds) {
      structure.cleared = true;
      state.acidProtection = true; // предмет постоянен до конца текущего забега
      floatText(game.fx, p.x, p.y - 40, 'КИСЛОТНЫЙ ФИЛЬТР', '#7effc4');
      emit('location:item', { id: 'acidProtection' });
    }
  }
}

function updateSeed(game, dt) {
  const seed = ensureLocationSpecials(game.run).seed;
  if (!seed) return;
  seed.age += dt;
  seed.size = Math.min(19, 3 + seed.age * 0.42);
  const dps = Math.min(
    LOCATION_SPECIAL_TUNING.seedMaxDps,
    LOCATION_SPECIAL_TUNING.seedBaseDps + seed.age * LOCATION_SPECIAL_TUNING.seedDpsPerSecond,
  );
  // Формулировка «отнимает HP» реализована буквально: щит, броня, dash и
  // существующие i-frames не спасают, но стандартные revive/Second Wind остаются.
  hurtPlayer(game, dps * dt, {
    ...TECHNICAL_DAMAGE,
    continuous: true, directHull: true, bypassResistance: true,
    bypassInvulnerability: true, silent: true,
  });
}

function updateDissonance(game, dt) {
  const state = ensureLocationSpecials(game.run);
  const p = game.player;
  const artifact = state.dissonanceArtifact;
  if (artifact && !artifact.collected && artifact.biomeId === game.run.biomeId
      && torDistance(p.x, p.y, artifact.x, artifact.y) <= p.r + artifact.r + 5) {
    artifact.collected = true;
    state.hallucination.active = true;
    state.hallucination.elapsed = 0;
    state.hallucination.seed = (game.run.seed ?? 0) ^ 0xd1550;
    floatText(game.fx, p.x, p.y - 38, 'СИГНАЛ ПРИНЯТ', '#ff79c6');
    emit('location:item', { id: 'dissonanceArtifact' });
    syncLocationAudio(game);
  }

  if (state.hallucination.active) state.hallucination.elapsed += dt;
  const structure = state.dissonanceStructure;
  if (!structure || structure.cleared || structure.biomeId !== game.run.biomeId) return;
  const inside = state.hallucination.active
    && torDistance(p.x, p.y, structure.x, structure.y) <= structure.r + p.r;
  structure.progress = inside
    ? Math.min(LOCATION_SPECIAL_TUNING.dissonanceCleanseSeconds, structure.progress + dt)
    : Math.max(0, structure.progress - dt * 0.5);
  if (structure.progress >= LOCATION_SPECIAL_TUNING.dissonanceCleanseSeconds) {
    structure.cleared = true;
    state.hallucination.active = false;
    floatText(game.fx, p.x, p.y - 40, 'СИГНАЛ ОЧИЩЕН', '#7ee8ff');
    emit('location:cleansed', { id: 'dissonance' });
    syncLocationAudio(game);
  }
}

function clearRealmThreats(game) {
  const bossOwner = game.run.activeBossBiomeId;
  const bossProgress = bossOwner ? game.run.biomeProgress?.[bossOwner] : null;
  if (bossProgress && !bossProgress.bossDefeated) bossProgress.bossTriggered = false;
  game.entities.enemies.length = 0;
  game.projectiles.bullets.length = 0;
  game.projectiles.foeBullets.length = 0;
  game.projectiles.mines.length = 0;
  game.telegraphs.length = 0;
  game.run.queue.length = 0;
  game.run.remaining = 0;
  game.run.activeWaveBiomeId = null;
  game.run.activeBossBiomeId = null;
  game.run.isBoss = false;
  game.run.phase = 'idle';
  game.run.countdown = 0;
  game.rifts.length = 0;
  game.singularities.length = 0;
}

function realmExits(game, x, y) {
  const past = [...new Set(Object.values(game.run.biomeProgress ?? {}).map((progress) => progress.locationId))];
  if (!past.length) past.push(game.run.location ?? 'rift');
  return [0, 1, 2].map((index) => {
    const angle = (game.run.seed ?? 0) * 0.000019 + index * TAU / 3;
    return {
      x: x + Math.cos(angle) * 330,
      y: y + Math.sin(angle) * 330,
      r: 46,
      locationId: past[index % past.length],
    };
  });
}

export function enterSingularity(game) {
  if (game.run.realm || game.run.stationEncounter?.status === 'active') return false;
  const state = ensureLocationSpecials(game.run);
  const from = game.run.location;
  const fromBiomeId = game.run.biomeId;
  const returnState = {
    location: from,
    biomeId: fromBiomeId,
    biome: game.run.biome ? { ...game.run.biome } : null,
    x: game.player.x,
    y: game.player.y,
  };
  clearHullSeed(game, 'exit');
  clearRealmThreats(game);
  state.gateway = null;

  game.run.realm = {
    id: 'singularity', elapsed: 0, returnState,
    exits: realmExits(game, game.player.x, game.player.y),
    perk: null,
  };
  game.run.location = 'singularity';
  game.run.biomeId = `realm:${game.run.seed ?? 0}:singularity`;
  game.run.biome = { id: game.run.biomeId, locationId: 'singularity', x: game.player.x, y: game.player.y, radius: Infinity };
  emit('location:change', { from, to: 'singularity', fromBiomeId, toBiomeId: game.run.biomeId, biome: game.run.biome });
  syncLocationAudio(game);
  return true;
}

export function exitSingularity(game) {
  const realm = game.run.realm;
  if (realm?.id !== 'singularity') return false;
  const fromBiomeId = game.run.biomeId;
  const saved = realm.returnState;
  game.run.realm = null;
  game.player.x = saved.x;
  game.player.y = saved.y;
  game.player.vx = 0;
  game.player.vy = 0;
  game.player.iframes = Math.max(game.player.iframes, 1.5);
  game.run.location = saved.location;
  game.run.biomeId = saved.biomeId;
  game.run.biome = saved.biome;
  emit('location:change', {
    from: 'singularity', to: saved.location,
    fromBiomeId, toBiomeId: saved.biomeId, biome: saved.biome,
  });
  const fresh = meta.unlockAchievement('singularity_escape');
  floatText(game.fx, game.player.x, game.player.y - 42, fresh ? 'ДОСТИЖЕНИЕ: ВОЗВРАЩЕНИЕ' : 'ВОЗВРАЩЕНИЕ', '#d8c4ff');
  syncLocationAudio(game);
  return true;
}

function updateSingularity(game, dt) {
  const realm = game.run.realm;
  realm.elapsed += dt;
  const p = game.player;

  for (const exit of realm.exits) {
    if (Math.hypot(p.x - exit.x, p.y - exit.y) <= p.r + exit.r) {
      exitSingularity(game);
      return;
    }
  }

  if (!realm.perk && !game.run.singularityPerkTaken
      && realm.elapsed >= LOCATION_SPECIAL_TUNING.singularityPerkSeconds) {
    const angle = (game.run.seed ?? 0) * 0.000031 + 1.17;
    realm.perk = {
      x: p.x + Math.cos(angle) * 120,
      y: p.y + Math.sin(angle) * 120,
      r: 17,
      id: 'singularity_patience',
    };
  }

  if (realm.perk && Math.hypot(p.x - realm.perk.x, p.y - realm.perk.y) <= p.r + realm.perk.r + 5) {
    const card = cardById[realm.perk.id];
    if (card) applyUpgrade(game, card);
    game.run.singularityPerkTaken = true;
    realm.perk = null;
    emit('location:item', { id: 'singularity_patience' });
  }
}

function updateGateway(game, dt) {
  const state = ensureLocationSpecials(game.run);
  const p = game.player;
  let gateway = state.gateway;
  if (!gateway) {
    state.gatewayTimer -= dt;
    if (state.gatewayTimer > 0 || game.run.stationEncounter) return;
    const angle = rnd(TAU);
    gateway = state.gateway = {
      x: p.x + p.vx * LOCATION_SPECIAL_TUNING.gatewayWarningSeconds + Math.cos(angle) * rnd(130, 55),
      y: p.y + p.vy * LOCATION_SPECIAL_TUNING.gatewayWarningSeconds + Math.sin(angle) * rnd(130, 55),
      r: 30, phase: 'warning', life: LOCATION_SPECIAL_TUNING.gatewayWarningSeconds,
    };
  }

  gateway.life -= dt;
  if (gateway.phase === 'warning' && gateway.life <= 0) {
    gateway.phase = 'active';
    gateway.life = LOCATION_SPECIAL_TUNING.gatewayActiveSeconds;
  }
  if (gateway.phase === 'active'
      && Math.hypot(p.x - gateway.x, p.y - gateway.y) <= p.r + gateway.r) {
    enterSingularity(game);
    return;
  }
  if (gateway.life <= 0) {
    state.gateway = null;
    state.gatewayTimer = 18 + rnd(14);
  }
}

/** Тикающие эффекты текущей локации и realm. */
export function updateLocationEffects(game, dt) {
  ensureLocationSpecials(game.run);
  if (game.run.realm?.id === 'singularity') {
    updateSingularity(game, dt);
    syncLocationAudio(game);
    return;
  }

  const p = game.player;
  // locationAt сохраняет автономность системного тика в bench/devpanel, где
  // координаты иногда меняются без предварительного updateWorld(). В обычном
  // кадре результат совпадает с уже записанными run.location/run.biome.
  const resolved = locationAt(
    Math.floor(p.x / CHUNK), Math.floor(p.y / CHUNK), game.run.seed ?? 0,
  );
  const loc = resolved;
  const m = loc.modifiers ?? {};

  if (m.periodicShock) {
    game.run.shockTimer = (game.run.shockTimer ?? m.periodicShock.interval) - dt;
    if (game.run.shockTimer <= 0) {
      game.run.shockTimer = m.periodicShock.interval;
      hurtPlayer(game, m.periodicShock.damage, TECHNICAL_DAMAGE);
      perkBlast(game, p.x, p.y, 520, m.periodicShock.damage * 1.4, '#7ee8ff');
      floatText(game.fx, p.x, p.y - 40, 'РАЗРЯД', '#7ee8ff');
    }
  } else game.run.shockTimer = 0;

  if (m.gravityPull && Number.isFinite(loc.clusterX)) {
    const range = loc.clusterRadius || 600;
    const dx = torDelta(p.x, loc.clusterX);
    const dy = torDelta(p.y, loc.clusterY);
    const d = Math.hypot(dx, dy) || 1;
    if (d < range) {
      const pull = (1 - d / range) * m.gravityPull;
      p.vx += (dx / d) * pull * dt;
      p.vy += (dy / d) * pull * dt;
    }
    game.run.portalTimer = (game.run.portalTimer ?? 14) - dt;
    if (game.run.portalTimer <= 0) {
      game.run.portalTimer = 14 + rnd(10);
      spawnRiftPortal(game, loc);
    }
  } else game.run.portalTimer = 0;

  if (game.run.location === 'grove') updateGrove(game, dt);
  else {
    for (const asteroid of game.entities.asteroids) asteroid.overgrown = false;
  }
  updateSeed(game, dt);

  if (game.run.location === 'acid' && !game.run.locationSpecials.acidProtection) {
    // Ровный environmental damage игнорирует dash/i-frames, но броня и щит
    // остаются честной общей защитой. Запрет лечения задаёт location-policy.
    hurtPlayer(game, LOCATION_SPECIAL_TUNING.acidDps * dt, {
      ...TECHNICAL_DAMAGE,
      continuous: true, bypassInvulnerability: true, silent: true,
    });
  }

  if (game.run.location === 'dissonance') updateDissonance(game, dt);
  else if (game.run.locationSpecials.hallucination.active) {
    game.run.locationSpecials.hallucination.elapsed += dt;
  }

  if (game.run.location === 'rift') updateGateway(game, dt);
  syncLocationAudio(game);
}

/** Случайный обычный портал Разлома; gateway Сингулярности хранится отдельно. */
function spawnRiftPortal(game, loc) {
  const p = game.player;
  const angleIn = rnd(TAU);
  const inX = p.x + Math.cos(angleIn) * rnd(350, 200);
  const inY = p.y + Math.sin(angleIn) * rnd(350, 200);
  const angleOut = rnd(TAU);
  const dist = Math.min(loc.clusterRadius * 0.7, 700);
  const centerX = nearestWorldImage(loc.clusterX, p.x);
  const centerY = nearestWorldImage(loc.clusterY, p.y);
  const outX = centerX + Math.cos(angleOut) * dist;
  const outY = centerY + Math.sin(angleOut) * dist;
  game.rifts.push({ x1: inX, y1: inY, x2: outX, y2: outY, life: 8 });
}
