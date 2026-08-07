import { getShip } from '../data/ships.js';
import { getWeapon, WEAPON_ORDER } from '../data/weapons.js';
import { hangarById } from '../data/hangar.js';
import { STATION_CHANCE_LIMITS } from '../data/stations.js';
import { clamp, hyper, rnd, TAU } from '../core/math.js';
import {
  DAMAGE_TYPE, normalizeDamageType, normalizePenetration, resistanceFromPoints,
} from '../core/damage.js';
import { createEffectState } from '../systems/effects.js';
import { addTags, createTagState } from '../systems/tags.js';
import { healingBlocked } from '../systems/location-policy.js';

/**
 * Игрок. Апгрейды выражены множителями, поэтому смена ствола ничего не обнуляет.
 *
 * УРОН СЧИТАЕТСЯ ТРЕМЯ ЯВНЫМИ СЛОЯМИ (модель Balatro):
 *
 *   (оружие + dmgFlat) × (1 + dmgAdd) × dmgMul
 *    ────────────────    ───────────    ──────
 *    слой 1: плоский     слой 2:        слой 3: редкие ×-карты
 *    сильный на старте,  сумма всех %   и условные множители
 *    слабеет к финалу
 *
 * Порядок фиксирован и показывается игроку в панели Tab. Без разделения
 * невозможно понять, что сильнее — а это и есть суть билдостроения.
 *
 * ШАНСЫ (крит, броня, уклонение) хранятся в ОЧКАХ и переводятся в проценты
 * гиперболой: десятая карточка крита уже не доводит шанс до гарантии.
 */

/** Коэффициенты гиперболы: сколько даёт одно очко на старте. */
export const CRIT_A = 0.14;
export const ARMOR_A = 0.055;
export const DODGE_A = 0.05;
export function createPlayer(save) {
  const ship = getShip(save.ship);

  const p = {
    shipId: ship.id,
    x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2, r: 15,

    hp: ship.hp, maxHp: ship.hp,
    shield: ship.shield, maxShield: ship.shield,
    shieldRegen: ship.shieldRegen ?? 0, shieldTimer: 0,

    thrust: ship.thrust, maxSpeed: ship.maxSpeed, friction: 0.988,
    boost: 1, boosting: false, iframes: 0,

    level: 1, xp: 0, xpNext: 6,

    weapons: [ship.weapon],
    weapon: ship.weapon,
    fireCooldown: 0,
    lastShotAt: -1,        // время последнего выстрела — зеркалит ИСКАЖЕНИЕ
    chargeTime: 0, charging: false,   // для «Осадного»: копится, пока зажата кнопка
    multiFire: false,                 // «МУЛЬТИСТВОЛ»: стрелять всеми стволами разом
    weaponCooldowns: {},              // персональный откат каждого ствола при мультистволе
    weaponOfferCooldowns: {},         // выброшенный ствол не возвращается несколько наград
    weaponPityMisses: 0,              // награды за волну подряд без предложения оружия

    // урон тремя слоями
    dmgFlat: ship.dmgFlat ?? 0,
    dmgAdd: ship.dmgAdd ?? 0,
    dmgMul: ship.dmgMul ?? 1,
    ram: ship.ram ?? 0,

    // Два очка при RESIST_A = 1/18 дают ровно 10% каждого стартового резиста.
    physicalResistPoints: 2,
    technicalResistPoints: 2,
    physicalPenetration: 0,
    technicalPenetration: 0,
    weaponDamageType: DAMAGE_TYPE.PHYSICAL,

    // темп стрельбы: больше = быстрее, бонусы складываются
    attackSpeed: ship.attackSpeed ?? 1,

    speedMul: ship.speedMul ?? 1,
    lifeMul: 1,
    countAdd: 0,
    pierce: 0,

    // шансы в очках, проценты считаются гиперболой
    critPoints: ship.critPoints ?? 0,
    critMul: 2.5,           // множитель урона крита
    armorPoints: ship.armorPoints ?? 0,
    dodgePoints: ship.dodgePoints ?? 0,
    // Станции дают прямые процентные пункты отдельным слоем: эти бонусы
    // не проходят через гиперболу обычных карточек и потому не убывают.
    stationBonuses: { crit: 0, armor: 0, dodge: 0 },
    stationUpgrades: {},
    luck: ship.luck ?? 0,

    homingAdd: 0,
    magnet: ship.magnet,
    bulletSize: 1,
    iframeMul: 1,
    ramDamage: 0,           // урон врагу при таране (перк «Шипы»)
    droneDamageMul: 1,
    droneRateMul: 1, droneRangeAdd: 0,
    blastRadiusMul: 1,
    blastPull: false,
    xpMul: 1,

    vamp: 0, regen: 0, nova: 0, ricochet: 0, boomShot: 0,
    mineDrop: 0, mineTimer: 0,
    mineDamageMul: 1, mineRadiusMul: 1, mineRateMul: 1,
    chainRangeAdd: 0, chainPowerMul: 1,   // дальность и сила цепных молний (перки)
    orbitalRadiusMul: 1, orbitalSpinMul: 1, orbitalDamageMul: 1,
    shieldDelayMul: 1,   // множитель паузы перед восстановлением щита после урона

    // модификаторы текущей локации (systems/locations.js) — выставляются
    // целиком при смене локации, а не накапливаются умножением: иначе частое
    // пересечение границы кластера накопило бы ошибку округления
    locationRicochetBonus: 0, locationBulletLifeMul: 1, locationLootMul: 1,
    locationBulletSpeedMul: 1,

    dashCooldown: 0, dashCooldownMax: ship.dashFromStart ? 2.6 : 0, dashTime: 0,

    scrapMul: 1,
    rerolls: 0,
    drones: [],
    abilities: [],          // активки на E / R / F
    abilitySlots: ship.abilitySlots ?? save.abilitySlots ?? 3,
    abilityCooldownMul: 1,
    modules: {},            // id модуля → уровень (для UI и лимитов)
    tags: createTagState(), // источники по направлениям, см. systems/tags.js
    effects: createEffectState(),

    // архетип персонажа: то, что прокачивается с уровнем и не выражается
    // готовыми множителями — см. data/ships.js и рост в progression.js
    radiusMul: ship.radiusMul ?? 1,
    passiveDrain: ship.passiveDrain ?? 0,   // HP/сек, постоянный урон (Паразит)
    shipGrowth: ship.growth ?? null,        // (player, level) => void, раз в уровень
    shipLevel: 1,                           // счётчик для «раз в N уровней»

    addDrone() {
      this.drones.push({ angle: rnd(TAU), dist: 62 + this.drones.length * 13, cd: 0, x: 0, y: 0 });
    },
  };

  // разблокированные в ангаре стволы доступны с начала забега
  for (const id of save.weapons ?? []) {
    if (!p.weapons.includes(id)) p.weapons.push(id);
  }
  p.weapons.sort((a, b) => WEAPON_ORDER.indexOf(a) - WEAPON_ORDER.indexOf(b));

  // перманентные улучшения ангара
  for (const [id, level] of Object.entries(save.upgrades ?? {})) {
    if (level > 0) hangarById[id]?.apply(p, level);
  }

  // корабль задаёт стартовое направление билда: пул карт кренится с первого выбора
  addTags(p, ship.tags ?? []);

  // Радиус как единая ручка: магнит, взрывы, турели и зоны орбиталов
  // масштабируются вместе (Сатурн). Дистанция самой орбиты не меняется.
  if (p.radiusMul !== 1) {
    p.magnet *= p.radiusMul;
    p.blastRadiusMul *= p.radiusMul;
    p.orbitalRadiusMul *= p.radiusMul;
  }

  // билд-образующий хук, который не выражается готовым множителем (Молот)
  ship.hook?.(p);

  return p;
}

export const currentWeapon = (player) => getWeapon(player.weapon);

// ─────────────────────────────── производные характеристики
//
// Всё, что считается из статов, живёт здесь одной формулой на стат.
// HUD, панель Tab и боевой код обязаны звать эти функции, а не считать
// на месте — иначе показанные цифры разъезжаются с фактическим уроном.

/** Слои урона в фиксированном порядке; конвертер заменяет dmgFlat на RAM. */
export const weaponDamage = (player, weapon) =>
  weaponDamageType(player) === DAMAGE_TYPE.TECHNICAL
    ? techDamage(player, weapon.dmg)
    : (weapon.dmg + player.dmgFlat) * (1 + player.dmgAdd) * player.dmgMul;

/** Технические источники заменяют плоскую базу оружия характеристикой RAM. */
export const techDamage = (player, base) =>
  (base + player.ram) * (1 + player.dmgAdd) * player.dmgMul;

export const weaponDamageType = (player) => normalizeDamageType(player.weaponDamageType);
export const physicalResistance = (player) => resistanceFromPoints(player.physicalResistPoints);
export const technicalResistance = (player) => resistanceFromPoints(player.technicalResistPoints);
export const penetrationFor = (player, type) => normalizePenetration(
  normalizeDamageType(type) === DAMAGE_TYPE.TECHNICAL
    ? player.technicalPenetration
    : player.physicalPenetration,
);

/** Темп: extra — временные бонусы (стаки «Разгона»), берсерк удваивает. */
export function attackSpeedOf(player, extra = 0) {
  const berserk = player.effects.flags.berserk > 0 ? 2 : 1;
  // «Скольжение»: форсаж (boost > 1.2) на время поднимает темп стрельбы
  const slip = player.effects.flags.slipstream && player.boosting ? 1.2 : 1;
  // «Перегрузка»: сперва ×3 темпа, затем ×0.5 штрафа — фазы взаимоисключающие
  const overload = player.effects.flags.overloadBoost > 0 ? 3 : player.effects.flags.overloadPenalty > 0 ? 0.5 : 1;
  return Math.max(0.15, (player.attackSpeed + extra) * berserk * slip * overload);
}

/** Пауза между выстрелами в секундах. */
export const fireInterval = (player, weapon, extra = 0) =>
  weapon.rate / attackSpeedOf(player, extra);

const withStationChance = (base, bonus, cap) => Math.max(base, Math.min(cap, base + (bonus ?? 0)));

export const critChance = (player) => withStationChance(
  hyper(CRIT_A, player.critPoints), player.stationBonuses?.crit, STATION_CHANCE_LIMITS.crit,
);
export function dodgeChance(player) {
  // «Уклоняющий манёвр»: форсаж на время добавляет очки уклонения
  const slip = player.effects.flags.slipDodge && player.boosting ? 1.5 : 0;
  // синергия «Крепость»: щит от половины и выше — уклонение вдвое эффективнее
  const fortress = player.effects.flags.fortress && player.maxShield > 0 && player.shield >= player.maxShield * 0.5;
  const points = player.dodgePoints + slip;
  const base = hyper(DODGE_A, fortress ? points * 2 : points);
  return withStationChance(base, player.stationBonuses?.dodge, STATION_CHANCE_LIMITS.dodge);
}

/** Во сколько раз урон по игроку режется бронёй: 1 = без брони. */
export function armorFactor(player) {
  const reduction = withStationChance(
    hyper(ARMOR_A, player.armorPoints), player.stationBonuses?.armor, STATION_CHANCE_LIMITS.armor,
  );
  let factor = 1 - reduction;
  // «Реактивная броня»: щит на максимуме — режет ещё сильнее
  if (player.effects.flags.reactivePlating && player.maxShield > 0 && player.shield >= player.maxShield) {
    factor *= 0.6;
  }
  // синергия «Крепость»: щит от половины и выше — броня вдвое эффективнее
  if (player.effects.flags.fortress && player.maxShield > 0 && player.shield >= player.maxShield * 0.5) {
    factor *= 0.5;
  }
  return factor;
}

export function selectWeapon(player, index) {
  const id = player.weapons[index];
  if (!id || id === player.weapon) return false;
  player.weapon = id;
  player.fireCooldown = Math.max(player.fireCooldown, 0.12);
  return true;
}

export function cycleWeapon(player, dir) {
  const i = player.weapons.indexOf(player.weapon);
  return selectWeapon(player, (i + dir + player.weapons.length) % player.weapons.length);
}

/** Не больше трёх стволов одновременно — остальное решает экран замены. */
export const WEAPON_SLOT_MAX = 3;

export function unlockWeapon(player, id, replaceId) {
  if (!player.weapons.includes(id)) {
    if (player.weapons.length >= WEAPON_SLOT_MAX) {
      // Заполненный набор нельзя менять неявно: вызывающий код обязан передать
      // конкретный существующий ствол, который игрок согласился заменить.
      if (!replaceId || !player.weapons.includes(replaceId)) return false;
      player.weapons.splice(player.weapons.indexOf(replaceId), 1);
      delete player.weaponCooldowns[replaceId];
    }
    player.weapons.push(id);
    player.weapons.sort((a, b) => WEAPON_ORDER.indexOf(a) - WEAPON_ORDER.indexOf(b));
  }
  player.weapon = id;
  return true;
}

/** Тяга, инерция, прицел, регенерация. Стрельбу ведёт systems/combat. */
export function updatePlayerMovement(player, input, dt, fx, game = null) {
  let ax = 0;
  let ay = 0;
  if (input.up) ay -= 1;
  if (input.down) ay += 1;
  if (input.left) ax -= 1;
  if (input.right) ax += 1;

  const len = Math.hypot(ax, ay);
  const boosting = input.boost && len > 0;
  player.boosting = boosting;
  player.boost += (boosting ? 1.55 - player.boost : 1 - player.boost) * Math.min(1, dt * 6);

  if (len > 0) {
    ax /= len;
    ay /= len;
    player.vx += ax * player.thrust * player.boost * dt;
    player.vy += ay * player.thrust * player.boost * dt;

    if (Math.random() < 0.8) {
      fx.particles.push({
        x: player.x - ax * 16 + rnd(5, -5),
        y: player.y - ay * 16 + rnd(5, -5),
        vx: -ax * 130 + player.vx * 0.4 + rnd(30, -30),
        vy: -ay * 130 + player.vy * 0.4 + rnd(30, -30),
        life: 0.3, max: 0.3,
        color: boosting ? '#ffd166' : '#4aa3ff',
        size: rnd(3.2, 1.6),
      });
    }
  }

  const speed = Math.hypot(player.vx, player.vy);
  const cap = player.maxSpeed * player.boost * (player.dashTime > 0 ? 2.4 : 1);
  if (speed > cap) {
    player.vx = (player.vx / speed) * cap;
    player.vy = (player.vy / speed) * cap;
  }

  const fr = Math.pow(player.friction, dt * 60);
  player.vx *= fr;
  player.vy *= fr;
  player.x += player.vx * dt;
  player.y += player.vy * dt;

  // прицел тянется к курсору
  const want = Math.atan2(input.aimY - player.y, input.aimX - player.x);
  const diff = Math.atan2(Math.sin(want - player.angle), Math.cos(want - player.angle));
  player.angle += diff * (1 - Math.pow(0.0005, dt));

  player.iframes -= dt;
  player.shieldTimer -= dt;
  player.dashCooldown -= dt;
  player.dashTime -= dt;

  // «Оверщит»: может копиться сверх максимума на 30%, но тает
  const shieldCap = player.maxShield * (player.effects.flags.overshield ? 1.3 : 1);
  if (player.shieldTimer <= 0 && player.shield < shieldCap) {
    player.shield = Math.min(shieldCap, player.shield + player.shieldRegen * dt);
  }
  if (player.shield > player.maxShield) {
    player.shield = Math.max(player.maxShield, player.shield - player.maxShield * 0.05 * dt);
  }
  if (player.regen && player.hp < player.maxHp && !healingBlocked(game ?? { player })) {
    player.hp = Math.min(player.maxHp, player.hp + player.regen * dt);
  }

  for (const d of player.drones) {
    d.angle += dt * 1.5;
    d.x = player.x + Math.cos(d.angle) * d.dist;
    d.y = player.y + Math.sin(d.angle) * d.dist;
    d.cd -= dt;
  }
}

export function tryDash(player, fx) {
  if (!player.dashCooldownMax || player.dashCooldown > 0 || player.dashTime > 0) return false;
  const moving = Math.hypot(player.vx, player.vy) > 40;
  const a = moving ? Math.atan2(player.vy, player.vx) : player.angle;
  player.vx += Math.cos(a) * 620;
  player.vy += Math.sin(a) * 620;
  player.dashTime = 0.3;
  player.dashCooldown = player.dashCooldownMax;
  for (let i = 0; i < 12; i++) {
    const ang = rnd(TAU);
    fx.particles.push({
      x: player.x, y: player.y,
      vx: Math.cos(ang) * 160, vy: Math.sin(ang) * 160,
      life: 0.35, max: 0.35, color: '#7ee8ff', size: 2.4,
    });
  }
  return true;
}

export const xpProgress = (player) => clamp(player.xp / player.xpNext, 0, 1);
