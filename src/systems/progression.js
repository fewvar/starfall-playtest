import { emit, on } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { camera } from '../core/camera.js';
import { PERKS, WAVE_ONLY, RARITY, cardById } from '../data/perks.js';
import { ABILITIES } from '../data/abilities.js';
import { getShip } from '../data/ships.js';
import { getWeapon } from '../data/weapons.js';
import { BUILD_FEATURE_SET } from '../data/features.js';
import { unlockWeapon, WEAPON_SLOT_MAX } from '../entities/player.js';
import { registerPerk, grantAbility, counters } from './effects.js';
import { addTags, meetsTags, tagAffinity } from './tags.js';
import { meta } from './meta.js';
import { getLocation } from '../data/locations.js';

/**
 * Прогресс внутри забега: опыт → уровни → выбор карточки.
 *
 * Карточки тянутся из общего каталога с учётом редкости, лимитов и условий:
 *   - эволюции показываются, только когда собраны нужные модули
 *   - проклятия появляются не раньше третьей волны
 *   - активка не выпадет, если все три слота заняты
 */

const CURSE_FROM_WAVE = 3;

/**
 * Оружие выдаётся только среди наград за волну, поэтому три таких экрана —
 * достаточно заметная защита от забега без второго ствола. Выброшенная пушка
 * пропускает те же три набора, чтобы не вернуться сразу после замены.
 */
export const WEAPON_PITY_AFTER = 3;
export const WEAPON_REOFFER_COOLDOWN = 3;
const WEAPON_PITY_AFTER_DECLINE = Math.floor(WEAPON_PITY_AFTER / 2);

/**
 * Насколько сильно пул кренится в сторону уже собранных направлений.
 * 0 — раздача полностью случайна, билд не собирается никогда.
 * 1 — карты не по билду почти не выпадают, выбор становится фикцией.
 * 0.35 при потолке ×2.4 — билд собирается сам, но развернуться ещё можно.
 */
const AFFINITY_WEIGHT = 0.35;
const AFFINITY_CAP = 2.4;

/** Сколько удача добавляет к весу редких карт за очко. */
const LUCK_PER_POINT = 0.08;

export function initProgression(game) {
  on('xp:gain', ({ amount }) => gainXp(game, amount));
}

export function gainXp(game, amount) {
  const p = game.player;
  p.xp += amount * p.xpMul * p.locationLootMul;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = Math.round(p.xpNext * 1.32 + 3);
    sfx.levelUp();
    camera.shake(6);
    // рост уникальной характеристики персонажа — см. data/ships.js
    p.shipGrowth?.(p, p.level);
    emit('player:levelup', { level: p.level });
  }
}

const levelOf = (player, id) => player.modules[id] ?? 0;

const addProvidedFeatures = (features, source) => {
  let changed = false;
  for (const feature of source?.provides ?? []) {
    if (BUILD_FEATURE_SET.has(feature) && !features.has(feature)) {
      features.add(feature);
      changed = true;
    }
  }
  return changed;
};

const featureRequirementsMet = (source, features) =>
  !source.requiresFeatures?.some((feature) => !features.has(feature))
  && (!source.requiresAnyFeature?.length || source.requiresAnyFeature.some((feature) => features.has(feature)));

/**
 * Механики, которые реально работают у игрока прямо сейчас.
 *
 * В отличие от affinity-тегов этот набор не накапливает намерения билда:
 * оружие исчезает из набора после замены, а щит и рывок проверяются по живому
 * состоянию. Карточки-провайдеры остаются источниками, пока взяты в забеге.
 */
export function playerFeatures(player) {
  const features = new Set();

  addProvidedFeatures(features, getShip(player.shipId));
  for (const id of player.weapons ?? []) addProvidedFeatures(features, getWeapon(id));
  for (const slot of player.abilities ?? []) addProvidedFeatures(features, slot.def);

  // Живые источники учитывают ангарные улучшения и карты, выраженные статами.
  if (player.dashCooldownMax > 0) features.add('dash');
  if ((player.abilities?.length ?? 0) > 0) features.add('ability');
  if (player.maxShield > 0 && !player.effects?.flags?.noShield) features.add('shield');
  if (player.shieldRegen > 0 && player.maxShield > 0 && !player.effects?.flags?.noShield) features.add('shieldRegen');
  if ((player.drones?.length ?? 0) > 0) features.add('drone');
  if (player.mineDrop > 0) {
    features.add('mine');
    features.add('mineTrail');
    features.add('friendlyBlast');
  }
  for (const orbital of player.effects?.orbitals ?? []) {
    features.add(orbital.type === 'aura' ? 'aura' : 'orbital');
  }

  // Провайдер карты считается работающим только пока выполняется его собственный
  // feature-гейт. Фиксированная точка нужна для цепочек вроде blast → freeze.
  const moduleProviders = Object.entries(player.modules ?? {})
    .filter(([, level]) => level > 0)
    .map(([id]) => cardById[id])
    .filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    for (const card of moduleProviders) {
      if (featureRequirementsMet(card, features)) {
        changed = addProvidedFeatures(features, card) || changed;
      }
    }
  }

  return features;
}

/** Доступна ли карточка прямо сейчас. Экспортирована также для тестов (bench/*.mjs). */
export function isAvailable(game, card, { rewardContext }) {
  const p = game.player;
  // Эксклюзивные находки выдаются своим локационным encounter напрямую и
  // никогда не просачиваются в обычные level-up/wave reward пулы.
  if (card.exclusiveSource) return false;
  // Пассивка/активка исчерпывается по max навсегда, а оружейная карточка
  // снова доступна после того, как соответствующий ствол был выброшен.
  if (!card.weapon && levelOf(p, card.id) >= card.max) return false;
  if (card.rewardOnly && !rewardContext) return false;
  if (card.weapon) {
    if (p.weapons.includes(card.weapon)) return false;
    if ((p.weaponOfferCooldowns?.[card.weapon] ?? 0) > 0) return false;
  }
  if (card.rarity === 'cursed' && game.run.wave < CURSE_FROM_WAVE) return false;
  if ((p.weapons?.length ?? 0) < (card.requiresWeaponCount ?? 0)) return false;

  if (card.ability) {
    if (p.abilities.length >= p.abilitySlots) return false;
    if (p.abilities.some((a) => a.def.id === card.ability)) return false;
  }
  // эволюция: нужны прокачанные модули-предки
  if (card.requires) {
    for (const [id, need] of Object.entries(card.requires)) {
      if (levelOf(p, id) < need) return false;
    }
  }
  // эволюция ствола: конкретный ствол должен быть уже открыт
  if (card.requiresWeapon && !p.weapons.includes(card.requiresWeapon)) return false;
  if (card.requiresFeatures || card.requiresAnyFeature) {
    const features = playerFeatures(p);
    if (card.requiresFeatures?.some((feature) => !features.has(feature))) return false;
    if (card.requiresAnyFeature?.length && !card.requiresAnyFeature.some((feature) => features.has(feature))) return false;
  }
  // активки заперты до разблокировки в ангаре (см. systems/meta.js)
  if (card.hangarLocked && !meta.abilityUnlocked(card.id)) return false;
  // синергия: нужно набрать источников по направлениям, а не конкретные карты
  if (card.requiresTags && !meetsTags(p, card.requiresTags)) return false;
  return true;
}

export const returnedWeaponCards = (player) => Object.entries(player.weaponOfferCooldowns ?? {})
  .filter(([weaponId, offersLeft]) => offersLeft <= 0
    && !player.weapons.includes(weaponId)
    && !cardById[`w_${weaponId}`])
  .map(([weaponId]) => {
    const weapon = getWeapon(weaponId);
    return {
      id: `w_return_${weaponId}`,
      icon: weapon.icon,
      name: weapon.name,
      rarity: 'legendary',
      max: 1,
      rewardOnly: true,
      weapon: weapon.id,
      desc: `Вернуть ранее выброшенный ствол: ${weapon.desc}`,
    };
  });

function poolFor(game, rewardContext) {
  const returns = rewardContext ? returnedWeaponCards(game.player) : [];
  const source = rewardContext ? [...PERKS, ...WAVE_ONLY, ...returns] : PERKS;
  return source.filter((card) => isAvailable(game, card, { rewardContext }));
}

/**
 * Вес карты в раздаче: редкость × собственный вес × уклон в билд × удача
 * × уклон текущей локации (её теги и «Разлом» с его тягой к эпикам).
 *
 * Без уклона 132 карты превращают выбор из трёх в лотерею — билд не собрать.
 * Удача поднимает шансы редких карт, но не трогает обычные, иначе она
 * просто вымывает базовые статы из пула.
 */
export function cardWeight(game, card) {
  const player = game.player;
  let w = (card.weight ?? 1) * (RARITY[card.rarity]?.weight ?? 100);
  w *= Math.min(AFFINITY_CAP, 1 + AFFINITY_WEIGHT * tagAffinity(player, card.tags));
  if (player.luck > 0 && card.rarity !== 'common' && card.rarity !== 'cursed') {
    w *= 1 + LUCK_PER_POINT * player.luck;
  }

  const loc = getLocation(game.run.location);
  if (loc.tags?.length && card.tags?.some((t) => loc.tags.includes(t))) w *= 1.6;
  if (card.rarity === 'epic' && loc.modifiers?.epicWeightMul) w *= loc.modifiers.epicWeightMul;

  return w;
}

/** Взвешенный выбор n различных карточек с учётом редкости. */
function draw(game, pool, n) {
  const bag = pool.slice();
  const picked = [];
  let weaponTaken = false;

  while (picked.length < n && bag.length) {
    const weights = bag.map((c) => cardWeight(game, c));
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = Math.random() * total;
    let index = 0;
    for (let i = 0; i < bag.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { index = i; break; }
    }
    const [card] = bag.splice(index, 1);
    // не больше одного нового ствола в раздаче, иначе выбор превращается в лотерею
    if (card.weapon) {
      if (weaponTaken) continue;
      weaponTaken = true;
    }
    picked.push(card);
  }
  return picked;
}

export const offerLevelUpgrades = (game) => draw(game, poolFor(game, false), 3);

const isEpicOrBetter = (card) => card.rarity === 'epic' || card.rarity === 'legendary';

// Оружейный pity не должен выталкивать легендарку, пока в той же раздаче
// есть карта более низкой редкости. Cursed — отдельная категория, поэтому
// для выбора заменяемого слота она стоит рядом с rare, а не выше legendary.
const REWARD_REPLACEMENT_RANK = Object.freeze({
  common: 0,
  rare: 1,
  cursed: 1,
  epic: 2,
  legendary: 3,
});

const lowestRarityCardIndex = (cards) => {
  let bestIndex = 0;
  let bestRank = Infinity;
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].weapon) continue;
    const rank = REWARD_REPLACEMENT_RANK[cards[i].rarity] ?? 0;
    if (rank < bestRank) {
      bestIndex = i;
      bestRank = rank;
    }
  }
  return bestIndex;
};

/**
 * Выполняет гарантию награды «эпик или лучше», не ухудшая уже выпавшую
 * легендарную карту и не добавляя второй новый ствол в одну раздачу.
 * Экспорт нужен для детерминированной проверки граничных случаев: random
 * задаёт бросок, а weightFn — те же контекстные веса, что использует раздача.
 */
export function ensureEpicOrBetter(
  cards,
  pool,
  random = Math.random,
  weightFn = (card) => (card.weight ?? 1) * (RARITY[card.rarity]?.weight ?? 100),
) {
  if (cards.some(isEpicOrBetter)) return cards;

  const candidates = pool.filter((card) => isEpicOrBetter(card) && !cards.includes(card));
  if (!candidates.length) return cards;

  const weights = candidates.map((card) => Math.max(0, Number(weightFn(card)) || 0));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let replacement = candidates[0];
  if (totalWeight > 0) {
    let roll = random() * totalWeight;
    for (let i = 0; i < candidates.length; i++) {
      if (roll < weights[i]) {
        replacement = candidates[i];
        break;
      }
      roll -= weights[i];
    }
  }
  let replaceIndex = 0;

  // Если гарантия выбрала новый ствол, он занимает место уже предложенного
  // ствола, а не превращает раздачу в выбор из двух новых пушек.
  if (replacement.weapon) {
    const offeredWeaponIndex = cards.findIndex((card) => card.weapon);
    if (offeredWeaponIndex >= 0) replaceIndex = offeredWeaponIndex;
  }

  cards[replaceIndex] = replacement;
  return cards;
}

const advanceWeaponOfferCooldowns = (player) => {
  for (const [weaponId, offersLeft] of Object.entries(player.weaponOfferCooldowns ?? {})) {
    // Нулевую запись сохраняем: для стартового blaster нет постоянной
    // карточки в каталоге, и по ней строится временная карточка возврата.
    if (offersLeft <= 1) player.weaponOfferCooldowns[weaponId] = 0;
    else player.weaponOfferCooldowns[weaponId] = offersLeft - 1;
  }
};

/**
 * Пока есть свободный слот, не даёт общей легендарной массе навсегда
 * спрятать оружие. После трёх наград без пушки один вариант гарантирован.
 * Сам показ оружия оставляет половину pity: если игрок выбрал другую карту,
 * следующего предложения не придётся ждать полный цикл заново.
 */
export function ensureWeaponOffer(game, cards, pool) {
  const player = game.player;
  if (player.weapons.length >= WEAPON_SLOT_MAX) {
    player.weaponPityMisses = 0;
    return cards;
  }

  if (cards.some((card) => card.weapon)) {
    player.weaponPityMisses = WEAPON_PITY_AFTER_DECLINE;
    return cards;
  }

  player.weaponPityMisses = (player.weaponPityMisses ?? 0) + 1;
  if (player.weaponPityMisses < WEAPON_PITY_AFTER) return cards;

  const candidate = draw(game, pool.filter((card) => card.weapon && !cards.includes(card)), 1)[0];
  if (!candidate) return cards;

  cards[lowestRarityCardIndex(cards)] = candidate;
  player.weaponPityMisses = WEAPON_PITY_AFTER_DECLINE;
  return cards;
}

/**
 * Награда за волну. После молниеносного убийства босса (см. data/bosses.js:
 * bossSpeedReward) одна из трёх карт гарантированно эпическая или легендарная —
 * иначе бонус зависел бы от того же броска, что и обычная награда.
 */
export function offerWaveRewards(game) {
  const pool = poolFor(game, true);
  const cards = draw(game, pool, 3);

  if (game.run.guaranteedEpic) {
    game.run.guaranteedEpic = false;
    ensureEpicOrBetter(cards, pool, Math.random, (card) => cardWeight(game, card));
  }
  ensureWeaponOffer(game, cards, pool);
  advanceWeaponOfferCooldowns(game.player);
  return cards;
}

/** Слоты оружия заняты — нужен экран выбора, каким стволом пожертвовать. */
export const needsWeaponSwap = (player, card) =>
  !!card.weapon && !player.weapons.includes(card.weapon) && player.weapons.length >= WEAPON_SLOT_MAX;

/** Применение выбранной карточки. replaceId — какой ствол уступает слот (см. needsWeaponSwap). */
export function applyUpgrade(game, card, replaceId) {
  const p = game.player;

  const first = levelOf(p, card.id) === 0;

  if (card.weapon) {
    let discardedWeapon = null;
    if (needsWeaponSwap(p, card)) {
      // null приходит только от явной UI-кнопки «ОСТАВИТЬ КАК ЕСТЬ».
      if (replaceId === null) return null;
      // Отсутствующий или чужой replaceId — ошибка вызывающего кода, а не отказ
      // игрока. Не позволяем такой ошибке тихо завершить экран награды.
      if (replaceId === undefined || !p.weapons.includes(replaceId)) {
        throw new Error(`Invalid weapon replacement: ${String(replaceId)}`);
      }
      discardedWeapon = replaceId;
    }
    if (!unlockWeapon(p, card.weapon, replaceId)) {
      throw new Error(`Failed to unlock weapon: ${card.weapon}`);
    }
    if (discardedWeapon) {
      p.weaponOfferCooldowns[discardedWeapon] = WEAPON_REOFFER_COOLDOWN;
    }
    p.weaponPityMisses = 0;
  } else if (card.ability) {
    grantAbility(p, ABILITIES[card.ability]);
  } else {
    card.apply?.(p, levelOf(p, card.id) + 1, game);
  }

  // хуки, условные множители и орбиталы вешаются один раз
  if (first) registerPerk(p, card);

  // каждый уровень карты — ещё один источник по её направлениям
  addTags(p, card.tags);

  if (card.scrap) emit('scrap:gain', { amount: card.scrap });

  // Оружие можно вернуть после выбрасывания; его карточка остаётся маркером
  // разблокировки, а не растёт до фиктивных уровней 2, 3, 4…
  p.modules[card.id] = card.weapon ? 1 : levelOf(p, card.id) + 1;
  counters(p).perksTaken++;
  sfx.confirm();
  emit('upgrade:taken', { card });
  return card;
}

/** Чипы взятых модулей для HUD. */
export function moduleChips(player) {
  return Object.entries(player.modules)
    .map(([id, level]) => ({ card: cardById[id], level }))
    .filter(({ card }) => card && !card.weapon && !card.ability)
    .map(({ card, level }) => ({
      icon: card.icon,
      name: card.name,
      level,
      rarity: card.rarity,
    }));
}
