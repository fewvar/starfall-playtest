import { emit } from '../core/events.js';
import { TAU } from '../core/math.js';
import { hash32, rngAt, mulberry } from '../core/rng.js';
import { BOSSES, BOSS_ORDER } from '../data/bosses.js';
import { getLocation } from '../data/locations.js';
import {
  COLLECTOR_COUNT,
  COLLECTOR_INTERVAL,
  NPC_COUNT_MAX,
  NPC_COUNT_MIN,
  NPC_DISCOVERY_MIN_RADIUS,
  NPC_HP,
  NPC_KINDS,
  npcKindById,
  NPC_MIN_GAP_CHUNKS,
  NPC_MIN_HOME_CHUNKS,
  NPC_TALK_RADIUS,
  REPUTATION_GOAL,
  SERVICES,
  serviceByKind,
  shopItemById,
} from '../data/npcs.js';
import { makeEnemy } from '../entities/factory.js';
import { floatText } from '../entities/effects.js';
import { CHUNK } from '../world/world.js';
import {
  WORLD_MAX_CHUNK,
  WORLD_MIN_CHUNK,
  torChunkDistance,
  torDistance,
} from '../world/torus.js';
import { stationAnchorAt } from './stations.js';
import { openPath } from './endings.js';

/**
 * NPC И УСЛУГИ — путь СВЯЗЕЙ (Notes/PLAYTEST_NOTES_2.md §3).
 *
 * Пять выполненных услуг открывают путь. Порог фиксированный: игрок должен
 * видеть цель с первой встречи, а не выводить её из размера карты.
 *
 * Провала по часам нет ни у одной услуги — таймер конфликтовал бы с
 * исследованием тора и боссами. Провал всегда событийный: погиб NPC, груз
 * выбит из трюма, груз унесён в Сингулярность. За провал приходят коллекторы
 * и остаются до конца забега.
 *
 * Всё живёт ровно один забег: в мета-профиль отсюда не течёт ничего.
 */

const COUNT_SALT = 0x9c0710;
const PLACE_SALT = 0x9c0711;
const SHAPE_SALT = 0x9c0712;
const SERVICE_SALT = 0x9c0713;

export const npcDiscoveryRadius = (view = {}) =>
  Math.max(NPC_DISCOVERY_MIN_RADIUS, Math.hypot(view.width ?? 0, view.height ?? 0) * 0.62);

function pickWeighted(items, roll) {
  const total = items.reduce((sum, item) => sum + (item.weight ?? 1), 0);
  let value = roll * total;
  for (const item of items) {
    value -= item.weight ?? 1;
    if (value <= 0) return item;
  }
  return items[items.length - 1];
}

/**
 * Расстановка по образцу станций: детерминированный ранг на чанк, отбор с
 * минимальным зазором, вдали от дома. Одинаковый сид — одинаковая карта NPC.
 */
export function generateNpcs(seed) {
  const normalizedSeed = seed >>> 0;
  const span = NPC_COUNT_MAX - NPC_COUNT_MIN + 1;
  const count = NPC_COUNT_MIN + (hash32(normalizedSeed, 0, COUNT_SALT) % span);

  const candidates = [];
  for (let chunkX = WORLD_MIN_CHUNK; chunkX <= WORLD_MAX_CHUNK; chunkX++) {
    for (let chunkY = WORLD_MIN_CHUNK; chunkY <= WORLD_MAX_CHUNK; chunkY++) {
      if (Math.hypot(chunkX, chunkY) < NPC_MIN_HOME_CHUNKS) continue;
      candidates.push({ chunkX, chunkY, rank: hash32(chunkX, chunkY, normalizedSeed + PLACE_SALT) });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.chunkX - b.chunkX || a.chunkY - b.chunkY);

  const npcs = [];
  for (const candidate of candidates) {
    if (npcs.some((n) => torChunkDistance(
      candidate.chunkX, candidate.chunkY, n.chunkX, n.chunkY,
    ) < NPC_MIN_GAP_CHUNKS)) continue;

    const random = rngAt(candidate.chunkX, candidate.chunkY, normalizedSeed + SHAPE_SALT);
    const x = (candidate.chunkX + 0.5 + (random() - 0.5) * 0.5) * CHUNK;
    const y = (candidate.chunkY + 0.5 + (random() - 0.5) * 0.5) * CHUNK;
    const anchor = stationAnchorAt(x, y, normalizedSeed);
    npcs.push({
      id: `npc:${normalizedSeed.toString(16)}:${npcs.length}`,
      kind: NPC_KINDS[(random() * NPC_KINDS.length) | 0].id,
      chunkX: candidate.chunkX,
      chunkY: candidate.chunkY,
      x,
      y,
      angle: random() * TAU,
      locationId: anchor.locationId,
      recommendedLevel: anchor.recommendedLevel,
      discovered: false,
      promptDismissed: false,
      status: 'idle',        // idle | offered | active | done | failed
      hp: NPC_HP,
      maxHp: NPC_HP,
      service: null,
    });
    if (npcs.length >= count) break;
  }

  // Услуги раздаются вторым проходом: доставке нужен адресат из уже
  // расставленного списка, иначе некуда везти.
  npcs.forEach((npc, index) => {
    npc.service = makeService(npcs, index, normalizedSeed);
  });
  return npcs;
}

function makeService(npcs, index, seed) {
  const random = mulberry(hash32(index, npcs.length, seed + SERVICE_SALT));
  // Доставка требует второго NPC; на карте из одного её быть не может.
  const templates = npcs.length > 1 ? SERVICES : SERVICES.filter((s) => s.kind !== 'deliver');
  const template = pickWeighted(templates, random());
  const service = { kind: template.kind, done: false, failed: false };

  if (template.kind === 'deliver') {
    let target = (random() * npcs.length) | 0;
    if (target === index) target = (target + 1) % npcs.length;
    // адресат называется своим лицом и локацией: по внутреннему id игрок
    // никого на карте не найдёт
    service.targetId = npcs[target].id;
    service.targetName = npcKindById[npcs[target].kind].name;
    service.targetLocation = getLocation(npcs[target].locationId).name;
  } else if (template.kind === 'bounty') {
    service.bossId = BOSS_ORDER[(random() * BOSS_ORDER.length) | 0];
    service.bossName = BOSSES[service.bossId].name;
  } else if (template.kind === 'tribute') {
    service.amount = 120 + ((random() * 5) | 0) * 40;
  }
  return service;
}

/** Текст услуги для интерфейса — данные и подача в одном месте. */
export function describeService(npc) {
  const template = serviceByKind[npc.service?.kind];
  if (!template) return null;
  return {
    name: template.name,
    text: template.desc(npc.service),
    reward: template.reward,
    fail: template.fail,
  };
}

export function initNpcRun(run) {
  run.npcs = generateNpcs(run.seed ?? 0);
  run.npcPromptId = null;
  run.npcTalkingId = null;
  run.reputation = 0;
  run.cargo = null;               // взятый груз доставки: { fromId, toId }
  run.collectorsFrom = null;      // с какого момента забег идёт под давлением
  run.collectorTimer = 0;
  return run.npcs;
}

export const npcById = (run, id) => run.npcs?.find((n) => n.id === id) ?? null;
export const talkingNpc = (run) => npcById(run, run.npcTalkingId);

/** Услуга взята. Для доставки это ещё и погрузка в трюм. */
export function acceptService(game, npcId) {
  const run = game.run;
  const npc = npcById(run, npcId);
  if (!npc || npc.status !== 'idle' || npc.service?.done || npc.service?.failed) return false;
  // Груз в трюме один: иначе доставки складываются в стопку и теряют цену.
  if (npc.service.kind === 'deliver' && run.cargo) return false;

  npc.status = 'active';
  if (npc.service.kind === 'deliver') {
    run.cargo = { fromId: npc.id, toId: npc.service.targetId };
  }
  if (npc.service.kind === 'defend') spawnDefendWave(game, npc);
  if (npc.service.kind === 'tribute') {
    if ((run.scrap ?? 0) < npc.service.amount) {
      npc.status = 'idle';
      return false;
    }
    run.scrap -= npc.service.amount;
    completeService(game, npc);
    return true;
  }
  emit('npc:service', { npc, service: npc.service });
  return true;
}

export function completeService(game, npc) {
  const run = game.run;
  if (!npc || npc.service.done || npc.service.failed) return false;
  npc.service.done = true;
  npc.status = 'done';
  run.reputation = (run.reputation ?? 0) + 1;

  const template = serviceByKind[npc.service.kind];
  if (template?.reward) run.scrap = (run.scrap ?? 0) + template.reward;
  floatText(game.fx, npc.x, npc.y - 40, `РЕПУТАЦИЯ ${run.reputation}/${REPUTATION_GOAL}`, '#5ef0d0');
  emit('npc:done', { npc, reputation: run.reputation });

  if (run.reputation >= REPUTATION_GOAL) openPath(run, 'bonds');
  return true;
}

/**
 * Услуга провалена. Провал ВСЕГДА событийный и всегда виден: игрок должен
 * понимать, что именно он потерял, иначе случайность становится тихой.
 */
export function failService(game, npc, reason = 'lost') {
  const run = game.run;
  if (!npc || npc.service.done || npc.service.failed) return false;
  npc.service.failed = true;
  npc.status = 'failed';
  if (run.cargo?.fromId === npc.id) run.cargo = null;

  const template = serviceByKind[npc.service.kind];
  floatText(game.fx, npc.x, npc.y - 40, template?.fail ?? 'УСЛУГА ПРОВАЛЕНА', '#ff3b6b');
  // Коллекторы приходят один раз за забег и остаются до конца: это долг,
  // а не разовая волна.
  run.collectorsFrom ??= run.time ?? 0;
  emit('npc:failed', { npc, reason, service: npc.service });
  return true;
}

/** Покупка в магазине NPC. Валюта — обломки текущего забега. */
export function buyFromNpc(game, npcId, itemId) {
  const run = game.run;
  const npc = npcById(run, npcId);
  const item = shopItemById[itemId];
  if (!npc || !item || npc.status === 'failed') return false;
  npc.bought ??= [];
  if (npc.bought.includes(itemId)) return false;
  if ((run.scrap ?? 0) < item.price) return false;

  run.scrap -= item.price;
  npc.bought.push(itemId);
  item.apply(game.player, game);
  if (item.reveal) {
    for (const station of run.stations ?? []) station.discovered = true;
    for (const other of run.npcs ?? []) other.discovered = true;
  }
  emit('npc:bought', { npc, item });
  return true;
}

/** Урон по NPC приходит только от врагов — свои снаряды его не задевают. */
export function hurtNpc(game, npc, amount) {
  if (!npc || npc.hp <= 0 || npc.status === 'done') return;
  npc.hp -= amount;
  npc.hitAt = game.run.time ?? 0;
  if (npc.hp > 0) return;
  npc.hp = 0;
  npc.dead = true;
  floatText(game.fx, npc.x, npc.y - 26, 'NPC ПОГИБ', '#ff3b6b');
  emit('npc:dead', { npc });
  if (npc.status === 'active' || npc.status === 'idle') failService(game, npc, 'dead');
}

export function updateNpcs(game, dt) {
  const run = game.run;
  if (!run.npcs?.length || run.over) return;
  const p = game.player;
  const discovery = npcDiscoveryRadius(game.view);

  for (const npc of run.npcs) {
    const distance = torDistance(p.x, p.y, npc.x, npc.y);
    if (!npc.discovered && distance <= discovery) {
      npc.discovered = true;
      emit('npc:discovered', { npc });
    }
    if (distance > NPC_TALK_RADIUS * 1.4) {
      npc.promptDismissed = false;
      if (run.npcPromptId === npc.id) run.npcPromptId = null;
    }
    if (npc.dead || npc.status === 'failed') continue;

    // прикрытие закрывается само: волна кончилась, NPC цел — дело сделано
    if (npc.status === 'active' && npc.service.kind === 'defend'
        && defendEnemies(game, npc.id).length === 0) {
      completeService(game, npc);
      continue;
    }

    // доставка засчитывается на подлёте к адресату, без отдельного разговора
    if (run.cargo?.toId === npc.id && distance <= NPC_TALK_RADIUS) {
      const sender = npcById(run, run.cargo.fromId);
      run.cargo = null;
      if (sender) completeService(game, sender);
    }

    // Разговор предлагается сам, как активация станции, но тихо: подлетел —
    // спросили, отказался — молчим, пока не отлетишь и не вернёшься.
    if (!run.npcPromptId && !run.npcTalkingId && !run.stationEncounter
        && !npc.promptDismissed && distance <= NPC_TALK_RADIUS) {
      run.npcPromptId = npc.id;
      emit('npc:prompt', { npc });
    }
  }

  updateNpcDamage(game, dt);
  updateCollectors(game, dt);
}

const NPC_BODY_RADIUS = 26;

/** Враги, оказавшиеся вплотную к NPC, грызут его — не мгновенно и заметно. */
function updateNpcDamage(game, dt) {
  const run = game.run;
  for (const enemy of game.entities.enemies) {
    if (enemy.boss || enemy.damage <= 0) continue;
    for (const npc of run.npcs) {
      if (npc.dead || npc.status === 'done') continue;
      const reach = NPC_BODY_RADIUS + enemy.r;
      if (torDistance(enemy.x, enemy.y, npc.x, npc.y) > reach) continue;
      hurtNpc(game, npc, enemy.damage * dt * 1.2);
    }
  }
}

/**
 * КОЛЛЕКТОРЫ. Не волна на месте провала, а давление до конца забега: раз в
 * COLLECTOR_INTERVAL в текущей локации появляется пара элитных охотников.
 */
function updateCollectors(game, dt) {
  const run = game.run;
  if (run.collectorsFrom === null || run.collectorsFrom === undefined) return;
  run.collectorTimer = (run.collectorTimer ?? COLLECTOR_INTERVAL * 0.4) - dt;
  if (run.collectorTimer > 0) return;
  run.collectorTimer = COLLECTOR_INTERVAL;
  spawnCollectors(game);
}

export function spawnCollectors(game) {
  const p = game.player;
  for (let i = 0; i < COLLECTOR_COUNT; i++) {
    const angle = (i / COLLECTOR_COUNT) * TAU + (game.run.time ?? 0);
    const e = makeEnemy(
      p.x + Math.cos(angle) * 900,
      p.y + Math.sin(angle) * 900,
      'weaver',
      Math.max(1, game.run.difficulty ?? 1) * 1.2,
    );
    e.elite = true;
    e.collector = true;
    e.color = '#ff3b6b';
    e.fromWave = false;
    e.source = 'collector';
    game.entities.enemies.push(e);
  }
  floatText(game.fx, p.x, p.y - 60, 'КОЛЛЕКТОРЫ', '#ff3b6b');
  emit('npc:collectors', { run: game.run });
}

/** Груз, унесённый в Сингулярность, считается потерянным. */
export function dropCargo(game, reason = 'lost') {
  const run = game.run;
  if (!run.cargo) return false;
  const sender = npcById(run, run.cargo.fromId);
  run.cargo = null;
  if (sender) failService(game, sender, reason);
  return true;
}

/** Босс повержен — если на него был заказ, трофей засчитывается сразу. */
export function noteBossKilled(game, bossId) {
  const run = game.run;
  for (const npc of run.npcs ?? []) {
    if (npc.status !== 'active' || npc.service.kind !== 'bounty') continue;
    if (npc.service.bossId !== bossId) continue;
    npc.service.trophy = true;
    floatText(game.fx, game.player.x, game.player.y - 44, 'ТРОФЕЙ ВЗЯТ', '#ffc14a');
  }
}

/** Трофей есть, игрок вернулся — заказ закрыт. Вызывается из экрана NPC. */
export function deliverBounty(game, npcId) {
  const npc = npcById(game.run, npcId);
  if (!npc || npc.service?.kind !== 'bounty' || !npc.service.trophy) return false;
  return completeService(game, npc);
}

/**
 * ПРИКРЫТИЕ. Волна идёт не на игрока, а на точку NPC: держать позицию
 * приходится рядом с ним, а не там, где удобно. Враги помечены encounterId —
 * так их видно отдельно и они не считаются остатком обычной волны.
 */
const DEFEND_WAVE = 9;

function spawnDefendWave(game, npc) {
  const scale = Math.max(1, game.run.difficulty ?? 1);
  for (let i = 0; i < DEFEND_WAVE; i++) {
    const angle = (i / DEFEND_WAVE) * TAU;
    const e = makeEnemy(
      npc.x + Math.cos(angle) * 700,
      npc.y + Math.sin(angle) * 700,
      i % 3 === 0 ? 'gunner' : 'drone',
      scale,
    );
    e.fromWave = false;
    e.source = 'npc-defend';
    e.encounterId = npc.id;
    game.entities.enemies.push(e);
  }
}

export const defendEnemies = (game, npcId) =>
  game.entities.enemies.filter((e) => e.source === 'npc-defend' && e.encounterId === npcId);

/** Волна прикрытия пережита — NPC цел, услуга закрыта. */
export function finishDefend(game, npcId) {
  const npc = npcById(game.run, npcId);
  if (!npc || npc.service?.kind !== 'defend' || npc.dead) return false;
  return completeService(game, npc);
}

export const reputation = (run) => run.reputation ?? 0;
export const reputationGoal = () => REPUTATION_GOAL;
