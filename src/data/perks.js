import { TAU, clamp } from '../core/math.js';
import {
  addStack, stackBonus, stackCount, clearStack, counters,
  perkBlast, chainLightning, radialVolley, healPlayer,
  reduceAbilityCooldowns, damageFromEffect, effectPower,
  applyBurn, applyPoison, applyFreeze, applyMark,
} from '../systems/effects.js';
import { nearestEnemy, blastFriendly } from '../systems/combat.js';
import { dropMine } from '../entities/projectiles.js';
import { critChance } from '../entities/player.js';
import { emit } from '../core/events.js';
import { WEAPONS } from './weapons.js';
import { ABILITIES } from './abilities.js';
import { weaponUnlockDescription, abilityCardDescription } from './descriptions.js';

/**
 * КАТАЛОГ ПЕРКОВ.
 *
 * Поля:
 *   rarity   — common | rare | epic | legendary | cursed. Влияет на цвет карточки и частоту.
 *   apply    — разовое изменение статов (вызывается на каждом уровне)
 *   hooks    — реакции на события боя (регистрируются один раз)
 *   damageMod— условный множитель урона в момент выстрела
 *   hitMod   — множитель, зависящий от цели, в момент попадания
 *   orbital  — вращающийся клинок или аура
 *   requires — условие появления (для эволюций): { модуль: минимальный уровень }
 *   provides — реальные механики, которые карта добавляет в текущий билд
 *   requiresFeatures — все перечисленные механики уже должны быть в билде
 *   requiresAnyFeature — достаточно одной из перечисленных механик
 *   ability  — id активной способности из data/abilities.js
 *
 * Новый перк = одна запись. Ничего больше трогать не нужно.
 */

export const RARITY = {
  common:    { id: 'common',    name: 'ОБЫЧНЫЙ',     color: '#aeb7c4', weight: 100 },
  rare:      { id: 'rare',      name: 'РЕДКИЙ',      color: '#5aa7ff', weight: 42 },
  epic:      { id: 'epic',      name: 'ЭПИЧЕСКИЙ',   color: '#c99bff', weight: 14 },
  legendary: { id: 'legendary', name: 'ЛЕГЕНДАРНЫЙ', color: '#ffcc4d', weight: 4 },
  cursed: { id: 'cursed', name: 'ПРОКЛЯТЫЙ', color: '#ff3b6b', weight: 20 },
};

export const PERKS = [
  // ═══════════════════════════ ОРУЖИЕ (разблокировки)
  { id: 'w_scatter', icon: '⋔', name: 'ДРОБОВИК', rarity: 'epic', max: 1, weapon: 'scatter', rewardOnly: true,
    desc: weaponUnlockDescription(WEAPONS.scatter) },
  { id: 'w_plasma', icon: '⊙', name: 'ПЛАЗМА', rarity: 'epic', max: 1, weapon: 'plasma', rewardOnly: true,
    desc: weaponUnlockDescription(WEAPONS.plasma) },
  { id: 'w_rail', icon: '⌁', name: 'РЕЛЬСА', rarity: 'legendary', max: 1, weapon: 'rail', rewardOnly: true,
    desc: weaponUnlockDescription(WEAPONS.rail) },
  { id: 'w_swarm', icon: '⇶', name: 'РОЙ РАКЕТ', rarity: 'legendary', max: 1, weapon: 'swarm', rewardOnly: true,
    desc: weaponUnlockDescription(WEAPONS.swarm) },
  { id: 'w_chain', icon: '⇄', name: 'ЦЕПЬ', rarity: 'legendary', max: 1, weapon: 'chain', rewardOnly: true,
    desc: weaponUnlockDescription(WEAPONS.chain) },
  { id: 'w_boomerang', icon: '↩', name: 'ДИСК', rarity: 'legendary', max: 1, weapon: 'boomerang', rewardOnly: true,
    desc: weaponUnlockDescription(WEAPONS.boomerang) },
  { id: 'w_lob', icon: '⌒', name: 'МИНОМЁТ', rarity: 'legendary', max: 1, weapon: 'lob', rewardOnly: true,
    desc: weaponUnlockDescription(WEAPONS.lob) },
  { id: 'w_ricochet', icon: '⋈', name: 'ОСКОЛОЧНИК', rarity: 'legendary', max: 1, weapon: 'ricochet', rewardOnly: true,
    desc: weaponUnlockDescription(WEAPONS.ricochet) },
  { id: 'w_tether', icon: '≈', name: 'ПИЯВКА', rarity: 'legendary', max: 1, weapon: 'tether', rewardOnly: true,
    desc: weaponUnlockDescription(WEAPONS.tether) },
  { id: 'w_spawner', icon: '⊞', name: 'СЕЯЛКА', rarity: 'legendary', max: 1, weapon: 'spawner', rewardOnly: true,
    desc: weaponUnlockDescription(WEAPONS.spawner) },
  { id: 'w_radial', icon: '⊹', name: 'НОВА', rarity: 'legendary', max: 1, weapon: 'radial', rewardOnly: true,
    desc: weaponUnlockDescription(WEAPONS.radial) },
  { id: 'w_split', icon: '◬', name: 'ПРИЗМА', rarity: 'legendary', max: 1, weapon: 'split', rewardOnly: true,
    desc: weaponUnlockDescription(WEAPONS.split) },
  { id: 'w_charge', icon: '◍', name: 'ОСАДНОЕ', rarity: 'legendary', max: 1, weapon: 'charge', rewardOnly: true,
    desc: weaponUnlockDescription(WEAPONS.charge) },

  // ═══════════════════════════ МУЛЬТИСТВОЛ (билд-определяющая пассивка)
  { id: 'multibarrel', icon: '⁘', name: 'МУЛЬТИСТВОЛ', rarity: 'legendary', max: 1, weight: 1, tags: ['burst'],
    requiresWeaponCount: 2,
    desc: 'Все открытые стволы стреляют одновременно, каждый свой темп. Каждый выстрел вдвое слабее (кроме «Осадного» — он не участвует).',
    apply: (p) => { p.multiFire = true; } },

  // ═══════════════════════════ БАЗОВЫЕ СТАТЫ
  { id: 'dmg', icon: '◆', name: 'УСИЛИТЕЛЬ', rarity: 'common', max: 8, weight: 3, tags: ['kinetic'],
    desc: '+26% урона любого оружия', apply: (p) => (p.dmgAdd += 0.26) },
  { id: 'rate', icon: '⇈', name: 'ОХЛАЖДЕНИЕ', rarity: 'common', max: 7, weight: 3, tags: ['speed'],
    desc: '+15% скорости атаки', apply: (p) => (p.attackSpeed += 0.15) },
  { id: 'multi', icon: '⋎', name: 'РАЗВЕТВИТЕЛЬ', rarity: 'rare', max: 4, weight: 2,
    desc: '+1 снаряд в залпе и −6% к сумме бонусов урона за уровень; разброс становится шире',
    apply: (p) => { p.countAdd += 1; p.dmgAdd -= 0.06; } },
  { id: 'pierce', icon: '↣', name: 'БРОНЕБОЙ', rarity: 'rare', max: 3, weight: 2,
    desc: 'Снаряды прошивают +1 цель насквозь', apply: (p) => (p.pierce += 1) },
  { id: 'homing', icon: '⌖', name: 'НАВЕДЕНИЕ', rarity: 'rare', max: 3, weight: 2,
    desc: 'Снаряды доворачивают к целям', apply: (p) => (p.homingAdd += 0.9) },
  { id: 'crit', icon: '⁕', name: 'ФОКУСИРОВКА', rarity: 'common', max: 5, weight: 2,
    desc: '+1 очко крита — шанс растёт с убыванием', apply: (p) => (p.critPoints += 1) },
  { id: 'critdmg', icon: '⁑', name: 'ЗАТОЧКА', rarity: 'rare', max: 4, weight: 2,
    desc: '+60% к урону критов', apply: (p) => (p.critMul += 0.6) },
  { id: 'range', icon: '⇥', name: 'СТАБИЛИЗАТОР', rarity: 'common', max: 4, weight: 2,
    desc: '+22% времени полёта и +12% скорости снаряда за уровень',
    apply: (p) => { p.lifeMul *= 1.22; p.speedMul *= 1.12; } },
  { id: 'caliber', icon: '●', name: 'КАЛИБР', rarity: 'common', max: 4, weight: 2,
    desc: '+35% размер снарядов — легче попадать', apply: (p) => (p.bulletSize *= 1.35) },
  { id: 'boom', icon: '⊛', name: 'ФУГАСЫ', rarity: 'rare', max: 3, weight: 2,
    provides: ['blastRadius', 'friendlyBlast'],
    desc: 'Снаряды взрываются при попадании', apply: (p) => (p.boomShot += 1) },
  { id: 'ric', icon: '⟲', name: 'РИКОШЕТ', rarity: 'rare', max: 2, weight: 1,
    desc: 'Снаряд отскакивает в следующего врага', apply: (p) => (p.ricochet += 1) },

  // ═══════════════════════════ ВЫЖИВАНИЕ
  { id: 'hull', icon: '▣', name: 'КОРПУС', rarity: 'common', max: 6, weight: 3,
    desc: '+30 к максимуму HP и полный ремонт',
    apply: (p) => { p.maxHp += 30; p.hp = p.maxHp; } },
  { id: 'shield', icon: '◎', name: 'ЩИТ', rarity: 'common', max: 5, weight: 2,
    desc: '+35 максимального щита и +7 щита/с за уровень; новый запас заполняется сразу',
    apply: (p) => { p.maxShield += 35; p.shieldRegen += 7; p.shield = p.maxShield; } },
  { id: 'regen', icon: '⊞', name: 'РЕМБОТЫ', rarity: 'common', max: 4, weight: 2,
    desc: '+1.1 HP в секунду постоянно', apply: (p) => (p.regen += 1.1) },
  { id: 'speed', icon: '⇉', name: 'ДВИГАТЕЛИ', rarity: 'common', max: 5, weight: 2,
    desc: '+14% тяга и максимальная скорость',
    apply: (p) => { p.thrust *= 1.14; p.maxSpeed *= 1.14; } },
  { id: 'magnet', icon: '∪', name: 'КОЛЛЕКТОР', rarity: 'common', max: 4, weight: 2,
    desc: '+70% радиус притяжения лута', apply: (p) => (p.magnet *= 1.7) },
  { id: 'dash', icon: '⇢', name: 'РЫВОК', rarity: 'rare', max: 3, weight: 2,
    provides: ['dash'],
    desc: 'ПКМ — рывок с неуязвимостью. Если рывка ещё нет — откат 2.6 с; если уже открыт — откат умножается на ×0.72',
    apply: (p) => { p.dashCooldownMax = p.dashCooldownMax ? p.dashCooldownMax * 0.72 : 2.6; p.dashCooldown = 0; } },
  { id: 'iframes', icon: '◌', name: 'ФАЗОВЫЙ СДВИГ', rarity: 'rare', max: 3, weight: 1,
    desc: '+35% длительности неуязвимости после удара', apply: (p) => (p.iframeMul *= 1.35) },

  // ═══════════════════════════ ТРИГГЕРЫ (Balatro-стиль: условие → эффект)
  { id: 'seventh', icon: '7', name: 'СЕДЬМОЙ ВЫСТРЕЛ', rarity: 'rare', max: 3, weight: 2,
    desc: 'Каждый 7-й выстрел наносит ×4 / ×5 / ×6 урона на I / II / III уровне',
    hooks: {
      onShoot: (game, { level }) => {
        const c = counters(game.player);
        if (c.shots % 7 === 0) {
          game.player.effects.flags.chargedShot = 3 + level;
        }
      },
    },
    damageMod: (game) => {
      const f = game.player.effects.flags;
      if (f.chargedShot) { const v = f.chargedShot; f.chargedShot = 0; return v; }
      return 1;
    } },

  { id: 'firstblood', icon: '◉', name: 'ПЕРВЫЙ КОНТАКТ', rarity: 'rare', max: 3, weight: 2,
    desc: '+45% урона по целям с полным здоровьем',
    hitMod: (game, { enemy, level }) => (enemy.hp >= enemy.maxHp ? 1 + 0.45 * level : 1) },

  { id: 'finisher', icon: '⊗', name: 'ДОБИВАНИЕ', rarity: 'rare', max: 3, weight: 2,
    desc: '+50% урона по целям ниже трети здоровья',
    hitMod: (game, { enemy, level }) => (enemy.hp / enemy.maxHp < 0.34 ? 1 + 0.5 * level : 1) },

  { id: 'adrenaline', icon: '▲', name: 'АДРЕНАЛИН', rarity: 'rare', max: 3, weight: 2,
    desc: 'При HP ниже 35% урон выше на 40%',
    damageMod: (game, { level }) => (game.player.hp / game.player.maxHp < 0.35 ? 1 + 0.4 * level : 1) },

  { id: 'coldblood', icon: '△', name: 'ХЛАДНОКРОВИЕ', rarity: 'rare', max: 3, weight: 2,
    desc: 'При полном здоровье урон выше на 30%',
    damageMod: (game, { level }) => (game.player.hp >= game.player.maxHp ? 1 + 0.3 * level : 1) },

  { id: 'pointblank', icon: '▸', name: 'В УПОР', rarity: 'rare', max: 3, weight: 2,
    desc: '+55% урона по целям ближе 200 единиц',
    hitMod: (game, { enemy, level }) => {
      const d2 = (enemy.x - game.player.x) ** 2 + (enemy.y - game.player.y) ** 2;
      return d2 < 200 ** 2 ? 1 + 0.55 * level : 1;
    } },

  { id: 'sniper', icon: '⊸', name: 'ДАЛЬНОБОЙ', rarity: 'rare', max: 3, weight: 2,
    desc: '+50% урона по целям дальше 600 единиц',
    hitMod: (game, { enemy, level }) => {
      const d2 = (enemy.x - game.player.x) ** 2 + (enemy.y - game.player.y) ** 2;
      return d2 > 600 ** 2 ? 1 + 0.5 * level : 1;
    } },

  { id: 'afterdash', icon: '⇝', name: 'ИМПУЛЬС', rarity: 'rare', max: 3, weight: 2,
    requiresFeatures: ['dash'],
    desc: '1.5 с после рывка: +70% урона за уровень',
    hooks: { onDash: (game) => (game.player.effects.flags.dashWindow = 1.5) },
    damageMod: (game, { level }) => (game.player.effects.flags.dashWindow > 0 ? 1 + 0.7 * level : 1) },

  { id: 'momentum', icon: '⇗', name: 'РАЗГОН', rarity: 'rare', max: 3, weight: 2,
    desc: 'Каждое убийство: +3% темпа стрельбы на 4 с; максимум 5 стаков за уровень',
    hooks: {
      onKill: (game, { level }) => addStack(game.player, 'momentum', { max: 5 * level, duration: 4, value: 0.03 }),
    } },

  { id: 'greedstack', icon: '¤', name: 'АЗАРТ', rarity: 'rare', max: 3, weight: 2,
    desc: 'Каждый подобранный обломок: +2% урона на 5 с; максимум 4 стака за уровень',
    hooks: {
      onPickup: (game, { kind, level }) => {
        if (kind === 'scrap') addStack(game.player, 'greed', { max: 4 * level, duration: 5, value: 0.02 });
      },
    },
    damageMod: (game) => 1 + stackBonus(game.player, 'greed') },

  { id: 'streak', icon: '∞', name: 'СЕРИЯ', rarity: 'epic', max: 2, weight: 1,
    desc: '+1.5% урона за убийство без полученного урона (сброс при попадании)',
    damageMod: (game, { level }) => 1 + clamp(counters(game.player).killStreak * 0.015 * level, 0, 1.5 * level) },

  // ═══════════════════════════ РЕАКЦИИ НА СОБЫТИЯ
  { id: 'chain', icon: '⌇', name: 'ЦЕПНАЯ МОЛНИЯ', rarity: 'rare', max: 3, weight: 2,
    provides: ['chain'],
    desc: 'Крит бьёт молнией по 3 / 4 / 5 ближайшим целям на I / II / III уровне; урон молнии — 35% урона крита',
    hooks: {
      onCrit: (game, { x, y, damage, level }) => chainLightning(game, x, y, 2 + level, damage * 0.35),
    } },

  { id: 'reaction', icon: '⊕', name: 'ЦЕПНАЯ РЕАКЦИЯ', rarity: 'rare', max: 3, weight: 2,
    desc: 'Убитый враг взрывается: радиус 70 + 22 за уровень, базовый урон 12 за уровень',
    hooks: {
      onKill: (game, { enemy, level }) => {
        if (!enemy) return;
        perkBlast(game, enemy.x, enemy.y, 70 + level * 22, 12 * level * effectPower(game.player), '#ff9f43');
      },
    } },

  { id: 'harvest', icon: '⌾', name: 'ЖАТВА', rarity: 'rare', max: 4, weight: 2,
    desc: 'Каждое убийство восстанавливает 2 HP',
    hooks: { onKill: (game, { level }) => healPlayer(game, 2 * level) } },

  { id: 'vamp', icon: '⍟', name: 'ВАМПИР', rarity: 'rare', max: 3, weight: 2,
    desc: '4% нанесённого урона возвращается в HP', apply: (p) => (p.vamp += 0.04) },

  { id: 'nova', icon: '⊚', name: 'ПЕРЕГРУЗКА', rarity: 'rare', max: 3, weight: 2,
    provides: ['friendlyBlast'],
    desc: 'После полученного урона — взрыв: радиус 90 + 40 за уровень, базовый урон 18 за уровень', apply: (p) => (p.nova += 1) },

  { id: 'retaliate', icon: '↩', name: 'ОТДАЧА', rarity: 'rare', max: 3, weight: 1,
    desc: 'После полученного урона — 8 самонаводящихся снарядов во все стороны, по 10 базового урона за уровень',
    hooks: {
      onHurt: (game, { level }) => radialVolley(game, 8, 10 * level * effectPower(game.player)),
    } },

  { id: 'cascade', icon: '⧗', name: 'КАСКАД', rarity: 'epic', max: 3, weight: 1,
    requiresFeatures: ['ability'],
    desc: 'Каждое убийство сокращает откат активок на 0.25с',
    hooks: { onKill: (game, { level }) => reduceAbilityCooldowns(game.player, 0.25 * level) } },

  { id: 'executioner', icon: '⋕', name: 'ПАЛАЧ', rarity: 'epic', max: 2, weight: 1,
    desc: 'Обычный враг ниже 6% / 12% HP уничтожается мгновенно на I / II уровне',
    hooks: {
      onHit: (game, { enemy, level }) => {
        if (!enemy || enemy.boss) return;
        if (enemy.hp > 0 && enemy.hp / enemy.maxHp < 0.06 * level) {
          damageFromEffect(game, enemy, enemy.hp + 1, '#ff3b6b');
        }
      },
    } },

  // ═══════════════════════════ СКЕЙЛИНГ (растут за забег, Balatro-джокеры)
  { id: 'growth', icon: '⇞', name: 'РОСТ', rarity: 'epic', max: 3, weight: 1,
    desc: '+4% урона за каждую зачищенную волну. Навсегда',
    damageMod: (game, { level }) => 1 + counters(game.player).wavesCleared * 0.04 * level },

  { id: 'bosshunter', icon: '⧫', name: 'ОХОТНИК НА БОССОВ', rarity: 'epic', max: 3, weight: 1,
    desc: '+15% урона за каждого убитого босса',
    damageMod: (game, { level }) => 1 + counters(game.player).bossKills * 0.15 * level },

  { id: 'collector', icon: '▦', name: 'КОЛЛЕКЦИОНЕР', rarity: 'epic', max: 2, weight: 1,
    desc: '+1.5% урона за каждые 25 собранных обломков',
    damageMod: (game, { level }) =>
      1 + Math.floor(counters(game.player).scrapCollected / 25) * 0.015 * level },

  { id: 'arsenal', icon: '▥', name: 'АРСЕНАЛ', rarity: 'epic', max: 2, weight: 1,
    desc: '+10% урона за каждый дополнительный открытый ствол и за каждый уровень карты',
    damageMod: (game, { level }) => 1 + (game.player.weapons.length - 1) * 0.1 * level },

  { id: 'library', icon: '▤', name: 'БИБЛИОТЕКА', rarity: 'epic', max: 2, weight: 1,
    desc: '+2% урона за каждый взятый модуль',
    damageMod: (game, { level }) => 1 + counters(game.player).perksTaken * 0.02 * level },

  { id: 'hoarder', icon: '%', name: 'ПРОЦЕНТЫ', rarity: 'rare', max: 3, weight: 2,
    desc: 'В конце волны +12% накопленных обломков за уровень; максимум 60 обломков за уровень',
    hooks: {
      onWaveClear: (game, { level }) => {
        const bonus = Math.min(60 * level, Math.floor(game.run.scrap * 0.12 * level));
        if (bonus > 0) game.run.scrap += bonus;
      },
    } },

  // ═══════════════════════════ ОРБИТАЛЫ И АУРЫ (Vampire Survivors)
  { id: 'drone', icon: '⊹', name: 'ДРОН-ТУРЕЛЬ', rarity: 'rare', max: 4, weight: 2,
    provides: ['drone'],
    desc: 'Орбитальный дрон стреляет сам', apply: (p) => p.addDrone() },

  { id: 'blades', icon: '⨯', name: 'КЛИНКИ', rarity: 'rare', max: 4, weight: 2,
    provides: ['orbital'],
    desc: 'Вращающийся клинок режет всё, чего касается',
    apply: (p) => {
      p.effects.orbitals.push({
        type: 'blade',
        angle: (p.effects.orbitals.length * TAU) / 4,
        dist: 78,
        spin: 2.6,
        radius: 16,
        hitRate: 0.45,
        color: '#dff0ff',
        damage: (pl) => 14 * effectPower(pl),
      });
    } },

  { id: 'aura', icon: '◍', name: 'РЕАКТОРНАЯ АУРА', rarity: 'rare', max: 3, weight: 2,
    provides: ['aura'],
    desc: 'Аура радиусом 108 наносит 9 базового урона каждые 0.5 с; следующий уровень добавляет 34 к радиусу',
    apply: (p) => {
      const existing = p.effects.orbitals.find((o) => o.type === 'aura' && o.tag === 'reactor');
      if (existing) { existing.radius += 34; return; }
      p.effects.orbitals.push({
        type: 'aura', tag: 'reactor',
        angle: 0, dist: 0, spin: 0,
        radius: 108, hitRate: 0.5,
        color: '#5ef08a',
        damage: (pl) => 9 * effectPower(pl),
      });
    } },

  { id: 'frost', icon: '◇', name: 'ЛЕДЯНОЕ ПОЛЕ', rarity: 'rare', max: 3, weight: 2,
    provides: ['aura'],
    desc: 'Аура радиусом 150 замедляет врагов до ×0.5 и наносит 4 базового урона каждые 0.6 с; уровни добавляют радиус и замедление',
    apply: (p) => {
      const existing = p.effects.orbitals.find((o) => o.tag === 'frost');
      if (existing) { existing.radius += 40; existing.slow = Math.max(0.3, existing.slow - 0.1); return; }
      p.effects.orbitals.push({
        type: 'aura', tag: 'frost',
        angle: 0, dist: 0, spin: 0,
        radius: 150, hitRate: 0.6, slow: 0.5,
        color: '#7ee8ff',
        damage: (pl) => 4 * effectPower(pl),
      });
    } },

  { id: 'spikes', icon: '⋀', name: 'ШИПЫ', rarity: 'rare', max: 3, weight: 2,
    desc: '+45 урона врагу при столкновении за уровень',
    apply: (p) => (p.ramDamage += 45) },

  { id: 'mines', icon: '◘', name: 'МИННЫЙ СЛЕД', rarity: 'rare', max: 3, weight: 2,
    provides: ['mine', 'mineTrail', 'friendlyBlast'],
    desc: 'Сбрасывает мины позади корабля', apply: (p) => (p.mineDrop += 1) },

  // ═══════════════════════════ ПРОКЛЯТИЯ (риск ради силы, Megabonk)
  { id: 'glasscannon', icon: '⊘', name: 'ХРУПКИЙ КОРПУС', rarity: 'cursed', max: 2, weight: 2,
    desc: 'ПРОКЛЯТИЕ: −35% максимального HP, но +55% урона',
    apply: (p) => { p.maxHp = Math.max(25, p.maxHp * 0.65); p.hp = Math.min(p.hp, p.maxHp); p.dmgMul *= 1.55; } },

  { id: 'bloodpact', icon: '⊝', name: 'КРОВАВЫЙ ПАКТ', rarity: 'cursed', max: 1, weight: 2,
    desc: 'ПРОКЛЯТИЕ: лечение не работает, зато убийство даёт 6 HP',
    apply: (p) => { p.effects.flags.noHeal = true; },
    hooks: {
      onKill: (game) => {
        // Обходит собственный запрет Кровавого пакта, но не кислотное облако.
        healPlayer(game, 6, { ignorePerkNoHeal: true });
      },
    } },

  { id: 'greedcurse', icon: '⊜', name: 'ЖАДНОСТЬ', rarity: 'cursed', max: 2, weight: 2,
    desc: 'ПРОКЛЯТИЕ: враги на 25% живучее, но обломков вдвое больше',
    apply: (p) => { p.effects.flags.toughEnemies = (p.effects.flags.toughEnemies ?? 0) + 0.25; p.scrapMul *= 2; } },

  { id: 'blindfold', icon: '⊟', name: 'ТУМАН ВОЙНЫ', rarity: 'cursed', max: 1, weight: 2,
    desc: 'ПРОКЛЯТИЕ: радар отключается, но урон выше на 40%',
    apply: (p) => { p.effects.flags.noRadar = true; p.dmgMul *= 1.4; } },

  { id: 'hastecurse', icon: '⋙', name: 'СПЕШКА', rarity: 'cursed', max: 2, weight: 2,
    desc: 'ПРОКЛЯТИЕ: враги на 20% быстрее, зато опыта на 50% больше',
    apply: (p) => { p.effects.flags.fastEnemies = (p.effects.flags.fastEnemies ?? 0) + 0.2; p.xpMul *= 1.5; } },

  { id: 'overload', icon: '⊠', name: 'ПЕРЕГРУЗ РЕАКТОРА', rarity: 'cursed', max: 3, weight: 2,
    desc: 'ПРОКЛЯТИЕ: −12 максимального HP, но +20% урона и +10% скорости',
    apply: (p) => {
      p.maxHp = Math.max(25, p.maxHp - 12);
      p.hp = Math.min(p.hp, p.maxHp);
      p.dmgAdd += 0.2;
      p.maxSpeed *= 1.1;
    } },

  { id: 'onehp', icon: '⊖', name: 'НА ГРАНИ', rarity: 'cursed', max: 1, weight: 1,
    desc: 'ПРОКЛЯТИЕ: щит больше не работает, но криты бьют втрое сильнее',
    apply: (p) => { p.effects.flags.noShield = true; p.maxShield = 0; p.shield = 0; p.critMul += 2; } },

  // ═══════════════════════════ СПАСЕНИЕ
  { id: 'revive', icon: '⧉', name: 'СПАСКАПСУЛА', rarity: 'epic', max: 2, weight: 1,
    desc: 'Один раз за забег возрождает с половиной HP',
    apply: (p) => (p.effects.revives += 1) },

  // ═══════════════════════════ АКТИВНЫЕ СПОСОБНОСТИ
  { id: 'a_emp', icon: '⋇', name: 'ЭМИ-ВОЛНА', rarity: 'legendary', max: 1, ability: 'emp', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.emp) },
  { id: 'a_barrier', icon: '⌸', name: 'БАРЬЕР', rarity: 'legendary', max: 1, ability: 'barrier', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.barrier) },
  { id: 'a_volley', icon: '⁂', name: 'ЗАЛП', rarity: 'legendary', max: 1, ability: 'volley', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.volley) },
  { id: 'a_blackhole', icon: '◯', name: 'СИНГУЛЯРНОСТЬ', rarity: 'legendary', max: 1, ability: 'blackhole', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.blackhole) },
  { id: 'a_stasis', icon: '⧖', name: 'СТАЗИС', rarity: 'legendary', max: 1, ability: 'stasis', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.stasis) },
  { id: 'a_blink', icon: '⇹', name: 'ПРЫЖОК', rarity: 'legendary', max: 1, ability: 'blink', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.blink) },
  { id: 'a_orbital', icon: '⇓', name: 'ОРБИТАЛЬНЫЙ УДАР', rarity: 'legendary', max: 1, ability: 'orbital', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.orbital) },
  { id: 'a_berserk', icon: '⩚', name: 'БЕРСЕРК', rarity: 'legendary', max: 1, ability: 'berserk', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.berserk) },
  { id: 'a_repair', icon: '⊹', name: 'АВАРИЙНЫЙ РЕМОНТ', rarity: 'legendary', max: 1, ability: 'repair', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.repair) },
  { id: 'a_decoy', icon: '◊', name: 'ПРИМАНКА', rarity: 'legendary', max: 1, ability: 'decoy', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.decoy) },
  { id: 'a_rewind', icon: '⟲', name: 'ПЕТЛЯ', rarity: 'legendary', max: 1, ability: 'rewind', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.rewind) },
  { id: 'a_mirror', icon: '⧉', name: 'ЗЕРКАЛО', rarity: 'legendary', max: 1, ability: 'mirror', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.mirror) },
  { id: 'a_anchor', icon: '⌾', name: 'ГРАВИЯКОРЬ', rarity: 'legendary', max: 1, ability: 'anchor', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.anchor) },
  { id: 'a_storm', icon: '≋', name: 'ШТОРМ', rarity: 'legendary', max: 1, ability: 'storm', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.storm) },
  { id: 'a_swarm', icon: '⇶', name: 'ПРИЗЫВ РОЯ', rarity: 'legendary', max: 1, ability: 'swarm', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.swarm) },
  { id: 'a_overload', icon: '⏫', name: 'ПЕРЕГРУЗКА', rarity: 'legendary', max: 1, ability: 'overload', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.overload) },
  { id: 'a_phase', icon: '⇏', name: 'ФАЗА', rarity: 'legendary', max: 1, ability: 'phase', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.phase) },
  { id: 'a_bombardment', icon: '⁘', name: 'БОМБАРДИРОВКА', rarity: 'legendary', max: 1, ability: 'bombardment', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.bombardment) },
  { id: 'a_reflector', icon: '◫', name: 'ОТРАЖАТЕЛЬ', rarity: 'legendary', max: 1, ability: 'reflector', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.reflector) },
  { id: 'a_scythe', icon: '⚱', name: 'ЖАТВА', rarity: 'legendary', max: 1, ability: 'scythe', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.scythe) },
  { id: 'a_deathmark', icon: '⚔', name: 'МЕТКА СМЕРТИ', rarity: 'legendary', max: 1, ability: 'deathmark', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.deathmark) },
  { id: 'a_rift', icon: '◒', name: 'РАЗЛОМ', rarity: 'legendary', max: 1, ability: 'rift', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.rift) },
  { id: 'a_ram', icon: '◭', name: 'ТАРАН', rarity: 'legendary', max: 1, ability: 'ram', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.ram) },
  { id: 'a_stopframe', icon: '⏸', name: 'СТОП-КАДР', rarity: 'legendary', max: 1, ability: 'stopframe', hangarLocked: true,
    desc: abilityCardDescription(ABILITIES.stopframe) },

  // ═══════════════════════════ ЭВОЛЮЦИИ (требуют прокачанных модулей)
  { id: 'evo_annihilator', icon: '⟡', name: 'АННИГИЛЯТОР', rarity: 'legendary', max: 1,
    requires: { dmg: 4, crit: 3 },
    desc: 'ЭВОЛЮЦИЯ: криты взрываются по площади, +30% урона критов',
    apply: (p) => (p.critMul += 0.3),
    hooks: {
      onCrit: (game, { x, y, damage }) => perkBlast(game, x, y, 110, damage * 0.5, '#ffe066'),
    } },

  { id: 'evo_hive', icon: '⁙', name: 'УЛЕЙ', rarity: 'legendary', max: 1,
    requires: { drone: 3, homing: 1 },
    provides: ['drone'],
    desc: 'ЭВОЛЮЦИЯ: +2 дрона, все дроны бьют вдвое сильнее',
    apply: (p) => { p.addDrone(); p.addDrone(); p.droneDamageMul *= 2; } },

  { id: 'evo_stormfront', icon: '≋', name: 'ФРОНТ БУРИ', rarity: 'legendary', max: 1,
    requires: { multi: 3, rate: 3 },
    desc: 'ЭВОЛЮЦИЯ: +2 снаряда в залпе и +25% скорости атаки',
    apply: (p) => { p.countAdd += 2; p.attackSpeed += 0.25; } },

  { id: 'evo_bulwark', icon: '⏣', name: 'РЕАКТИВНАЯ БРОНЯ', rarity: 'legendary', max: 1,
    requires: { shield: 3, nova: 1 },
    provides: ['friendlyBlast'],
    desc: 'ЭВОЛЮЦИЯ: щит вдвое больше, а его пробой вызывает мощный взрыв',
    apply: (p) => { p.maxShield *= 2; p.shield = p.maxShield; p.nova += 2; } },

  { id: 'evo_singularity', icon: '⦿', name: 'КОЛЛАПС', rarity: 'legendary', max: 1,
    requires: { boom: 2, pierce: 2 },
    desc: 'ЭВОЛЮЦИЯ: взрывы вдвое шире и втягивают врагов внутрь',
    apply: (p) => { p.blastRadiusMul *= 2; p.blastPull = true; } },

  // ═══════════════════════════ ЯДРО УРОНА (три слоя)
  { id: 'dmgflat', icon: '◈', name: 'ФЛЭТ-ЭМИТТЕР', rarity: 'common', max: 6, weight: 2, tags: ['kinetic'],
    desc: '+4 плоского урона (первый слой) — сильно на старте, слабеет к финалу',
    apply: (p) => (p.dmgFlat += 4) },
  { id: 'overdrive', icon: '⟴', name: 'ФОРСАЖ ЯДРА', rarity: 'rare', max: 3, weight: 1, tags: ['kinetic'],
    desc: '×1.12 к итоговому урону за уровень (третий, мультипликативный слой)',
    apply: (p) => (p.dmgMul *= 1.12) },

  // ═══════════════════════════ КРИТ
  { id: 'critlow', icon: '⁘', name: 'ХИЩНИК', rarity: 'rare', max: 3, weight: 2, tags: ['crit'],
    desc: 'Крит по цели ниже 50% HP наносит ещё +50% урона',
    hitMod: (game, { enemy, crit, level }) => (crit && enemy.hp / enemy.maxHp < 0.5 ? 1 + 0.5 * level : 1) },
  { id: 'critfar', icon: '⁙', name: 'ТОЧНЫЙ ВЫСТРЕЛ', rarity: 'rare', max: 3, weight: 2, tags: ['crit'],
    desc: 'Крит на дистанции дальше 500 наносит ещё +60% урона',
    hitMod: (game, { enemy, crit, level }) => {
      if (!crit) return 1;
      const d2 = (enemy.x - game.player.x) ** 2 + (enemy.y - game.player.y) ** 2;
      return d2 > 500 ** 2 ? 1 + 0.6 * level : 1;
    } },
  { id: 'critheal', icon: '⁚', name: 'ХОЛОДНЫЙ РАСЧЁТ', rarity: 'rare', max: 3, weight: 2, tags: ['crit', 'sustain'],
    desc: 'Крит лечит 1.5% максимального HP',
    hooks: { onCrit: (game, { level }) => healPlayer(game, game.player.maxHp * 0.015 * level) } },
  { id: 'critshield', icon: '⁛', name: 'РЕЗОНАНС ЩИТА', rarity: 'rare', max: 3, weight: 2, tags: ['crit', 'defense'],
    requiresFeatures: ['shield'],
    desc: 'Крит восстанавливает 3 щита',
    hooks: { onCrit: (game, { level }) => {
      const p = game.player;
      p.shield = Math.min(p.maxShield, p.shield + 3 * level);
    } } },
  { id: 'critfreeze', icon: '❆', name: 'ЛЕДЯНОЙ КРИТ', rarity: 'rare', max: 3, weight: 2, tags: ['crit', 'status'],
    provides: ['freeze'],
    desc: 'Крит замораживает цель на 1.5 + 0.2 с за уровень; скорость цели ×0.4',
    hooks: { onCrit: (game, { enemy, level }) => applyFreeze(enemy, 0.4, 1.5 + level * 0.2) } },
  { id: 'critstacks', icon: '⁝', name: 'НАРАСТАЮЩИЙ КРИТ', rarity: 'epic', max: 2, weight: 1, tags: ['crit'],
    desc: 'Каждый крит: +10% урона следующих критов на 6 с; максимум 5 стаков за уровень',
    hooks: { onCrit: (game, { level }) => addStack(game.player, 'critstack', { max: 5 * level, duration: 6, value: 0.1 }) },
    hitMod: (game, { crit }) => (crit ? 1 + stackBonus(game.player, 'critstack') : 1) },

  // ═══════════════════════════ ПРОБИТИЕ И ГЕОМЕТРИЯ
  { id: 'bigcaliber', icon: '◔', name: 'ТЯЖЁЛЫЙ КАЛИБР', rarity: 'rare', max: 3, weight: 2, tags: ['pierce'],
    desc: '+1 пробитие и +20% размер снаряда', apply: (p) => { p.pierce += 1; p.bulletSize *= 1.2; } },
  { id: 'lockon', icon: '⌗', name: 'ЗАХВАТ ЦЕЛИ', rarity: 'rare', max: 3, weight: 2, tags: ['pierce'],
    desc: '+1.2 силы доворота снарядов к цели — почти не мажут', apply: (p) => (p.homingAdd += 1.2) },
  { id: 'tripleric', icon: '⟳', name: 'ЦЕПЬ ОТСКОКОВ', rarity: 'rare', max: 2, weight: 1, tags: ['pierce'],
    desc: '+2 отскока разом', apply: (p) => (p.ricochet += 2) },
  { id: 'gravlens', icon: '◑', name: 'ГРАВИЛИНЗА', rarity: 'rare', max: 3, weight: 2, tags: ['pierce', 'explosive'],
    desc: '+25% радиус взрыва и +1 пробитие', apply: (p) => { p.blastRadiusMul *= 1.25; p.pierce += 1; } },
  { id: 'widecaliber', icon: '◒', name: 'РАСШИРИТЕЛЬ', rarity: 'common', max: 4, weight: 2, tags: ['pierce'],
    desc: '+45% размер снаряда — легче попадать', apply: (p) => (p.bulletSize *= 1.45) },
  { id: 'twinshot', icon: '⋏', name: 'СПАРЕННЫЙ СТВОЛ', rarity: 'epic', max: 2, weight: 1, tags: ['pierce'],
    desc: '+1 снаряд в очереди без потери урона (в отличие от «Разветвителя»)',
    apply: (p) => (p.countAdd += 1) },

  // ═══════════════════════════ ВЗРЫВЫ
  { id: 'novapower', icon: '◖', name: 'УДАРНАЯ ВОЛНА', rarity: 'rare', max: 3, weight: 2, tags: ['explosive'],
    requiresFeatures: ['blastRadius'],
    desc: '+35% радиус всех взрывов игрока', apply: (p) => (p.blastRadiusMul *= 1.35) },
  { id: 'shockwave', icon: '◗', name: 'УДАРНАЯ ОТДАЧА', rarity: 'epic', max: 2, weight: 1, tags: ['explosive', 'defense'],
    provides: ['friendlyBlast'],
    desc: 'Разовый урон больше 20% максимального HP вызывает взрыв радиусом 140 и базовым уроном 40 за уровень',
    hooks: { onHurt: (game, { damage, level }) => {
      const p = game.player;
      if (damage > p.maxHp * 0.2) blastFriendly(game, p.x, p.y, 140, 40 * level * effectPower(p), '#ff6b8a');
    } } },
  { id: 'implode', icon: '◚', name: 'КОЛЛАПСИРУЮЩИЙ ВЗРЫВ', rarity: 'epic', max: 1, weight: 1, tags: ['explosive'],
    requiresFeatures: ['friendlyBlast'],
    desc: 'Взрывы игрока стягивают выживших врагов к центру', apply: (p) => (p.blastPull = true) },
  { id: 'wavefront', icon: '◛', name: 'ФРОНТ УДАРНОЙ ВОЛНЫ', rarity: 'rare', max: 3, weight: 2, tags: ['explosive'],
    desc: 'Убийство элитного врага вызывает взрыв на 130 радиуса',
    hooks: { onKill: (game, { enemy, level }) => {
      if (!enemy?.elite) return;
      perkBlast(game, enemy.x, enemy.y, 130, 20 * level * effectPower(game.player), '#ffb14a');
    } } },
  { id: 'abilityburst', icon: '◜', name: 'ОТДАЧА АКТИВКИ', rarity: 'epic', max: 2, weight: 1, tags: ['explosive', 'ability'],
    requiresFeatures: ['ability'],
    provides: ['friendlyBlast'],
    desc: 'Использование активной способности вызывает взрыв 110 радиуса вокруг игрока',
    hooks: { onAbility: (game, { level }) => {
      const p = game.player;
      blastFriendly(game, p.x, p.y, 110, 18 * level * effectPower(p), '#c99bff');
    } } },
  { id: 'craterfield', icon: '◝', name: 'ВОРОНКИ', rarity: 'rare', max: 3, weight: 1, tags: ['explosive'],
    desc: 'Разбитый астероид детонирует по площади',
    hooks: { onAsteroidBreak: (game, { asteroid, level }) => {
      perkBlast(game, asteroid.x, asteroid.y, 60 + level * 12, 10 * level * effectPower(game.player), '#a08c6e');
    } } },

  // ═══════════════════════════ ЦЕПИ И МОЛНИИ
  { id: 'staticfield', icon: '⎓', name: 'СТАТИЧЕСКОЕ ПОЛЕ', rarity: 'rare', max: 3, weight: 2, tags: ['chain'],
    provides: ['chain'],
    desc: 'Каждое попадание: 15%×уровень шанс ударить молнией по соседней цели',
    hooks: { onHit: (game, { enemy, damage, level }) => {
      if (Math.random() < 0.15 * level) chainLightning(game, enemy.x, enemy.y, 1, damage * 0.4);
    } } },
  { id: 'deathchain', icon: '⎔', name: 'ПОСМЕРТНАЯ МОЛНИЯ', rarity: 'rare', max: 3, weight: 2, tags: ['chain'],
    provides: ['chain'],
    desc: 'Убийство запускает молнию по ближайшим целям',
    hooks: { onKill: (game, { enemy, level }) => {
      if (!enemy) return;
      chainLightning(game, enemy.x, enemy.y, 1 + level, 14 * level * effectPower(game.player));
    } } },
  { id: 'chainrange', icon: '⎕', name: 'ДАЛЬНОБОЙНАЯ ЦЕПЬ', rarity: 'common', max: 3, weight: 2, tags: ['chain'],
    requiresFeatures: ['chain'],
    desc: '+130 дистанции прыжка для всех цепных молний', apply: (p) => (p.chainRangeAdd += 130) },
  { id: 'chainpower', icon: '⎗', name: 'УСИЛИТЕЛЬ ЦЕПИ', rarity: 'rare', max: 3, weight: 2, tags: ['chain'],
    requiresFeatures: ['chain'],
    desc: '+20% силы всех цепных молний', apply: (p) => (p.chainPowerMul *= 1.2) },
  { id: 'sparkstorm', icon: '⎘', name: 'ГРОЗОВОЙ ФРОНТ', rarity: 'epic', max: 2, weight: 1, tags: ['chain'],
    provides: ['chain'],
    desc: 'Каждые 6 секунд молния сама бьёт по ближайшим врагам',
    hooks: { onTick: (game, { dt, level }) => {
      const fx = game.player.effects;
      fx.sparkTimer = (fx.sparkTimer ?? 0) + dt;
      if (fx.sparkTimer >= 6) {
        fx.sparkTimer = 0;
        const p = game.player;
        chainLightning(game, p.x, p.y, 3 + level, 16 * level * effectPower(p));
      }
    } } },
  { id: 'chainheal', icon: '⎙', name: 'ИСКРОВОЙ КОНТУР', rarity: 'rare', max: 3, weight: 2, tags: ['chain', 'sustain'],
    provides: ['chain'],
    desc: 'Крит запускает молнию, лечащую по 1.5 HP за задетую цель',
    hooks: { onCrit: (game, { x, y, damage, level }) => {
      const hits = chainLightning(game, x, y, 1 + level, damage * 0.25, '#5ef08a');
      if (hits) healPlayer(game, hits * 1.5 * level);
    } } },

  // ═══════════════════════════ СТАТУСЫ (поджог, яд, заморозка, метка)
  { id: 'ignite', icon: '♨', name: 'ПОДЖИГ', rarity: 'rare', max: 3, weight: 2, tags: ['status'],
    provides: ['burn'],
    desc: '30% шанс поджечь цель при попадании — горит 3 сек',
    hooks: { onHit: (game, { enemy, level }) => {
      if (Math.random() < 0.3) applyBurn(enemy, (4 + level * 2) * effectPower(game.player), 3);
    } } },
  { id: 'venom', icon: '☣', name: 'ЯД', rarity: 'rare', max: 3, weight: 2, tags: ['status'],
    provides: ['poison'],
    desc: '25% шанс отравить цель — слабый урон, но долгий (6 сек)',
    hooks: { onHit: (game, { enemy, level }) => {
      if (Math.random() < 0.25) applyPoison(enemy, (2 + level) * effectPower(game.player), 6);
    } } },
  { id: 'cryo', icon: '❄', name: 'КРИООЧЕРЕДЬ', rarity: 'rare', max: 3, weight: 2, tags: ['status'],
    provides: ['freeze'],
    desc: '20% шанс заморозить цель — −60% скорости на пару секунд',
    hooks: { onHit: (game, { enemy, level }) => {
      if (Math.random() < 0.2) applyFreeze(enemy, 0.4, 2 + level * 0.3);
    } } },
  { id: 'brand', icon: '✦', name: 'КЛЕЙМО', rarity: 'epic', max: 2, weight: 1, tags: ['status'],
    provides: ['mark'],
    desc: '15% шанс заклеймить цель при попадании: +30% получаемого урона на 5 сек',
    hooks: { onHit: (game, { enemy, level }) => {
      if (Math.random() < 0.15) applyMark(enemy, 1 + 0.3 * level, 5);
    } } },
  { id: 'plaguebearer', icon: '☠', name: 'ЧУМА', rarity: 'epic', max: 2, weight: 1, tags: ['status'],
    requiresAnyFeature: ['burn', 'poison'],
    desc: 'Попадание по горящей или отравленной цели: 20% шанс за уровень перенести 60% силы статуса на соседа в радиусе 260',
    hooks: { onHit: (game, { enemy, level }) => {
      if (!enemy.burn && !enemy.poison) return;
      if (Math.random() >= 0.2 * level) return;
      const other = nearestEnemy(game, enemy.x, enemy.y, 260, enemy);
      if (!other) return;
      if (enemy.burn) applyBurn(other, enemy.burn.dps * 0.6, enemy.burn.until);
      if (enemy.poison) applyPoison(other, enemy.poison.dps * 0.6, enemy.poison.until);
    } } },
  { id: 'burnaura', icon: '♒', name: 'ТЕПЛОВАЯ АУРА', rarity: 'epic', max: 1, weight: 1, tags: ['status', 'orbital'],
    requiresAnyFeature: ['orbital', 'aura'],
    provides: ['burn'],
    desc: 'Клинки и ауры дополнительно поджигают всё, чего касаются',
    apply: (p) => { p.effects.flags.orbitalBurn = true; } },
  { id: 'coldsnap', icon: '☃', name: 'ХОЛОДНЫЙ СНЕГ', rarity: 'rare', max: 3, weight: 2, tags: ['status'],
    requiresFeatures: ['freeze'],
    desc: 'Убийство замороженного врага лечит 4 HP за уровень и создаёт взрыв радиусом 60 с базовым уроном 8 за уровень',
    hooks: { onKill: (game, { enemy, level }) => {
      if (!enemy || !(enemy.freezeUntil > 0)) return;
      healPlayer(game, 4 * level);
      perkBlast(game, enemy.x, enemy.y, 60, 8 * level * effectPower(game.player), '#7ee8ff');
    } } },
  { id: 'poisonstack', icon: '⚗', name: 'КОНЦЕНТРАТ ЯДА', rarity: 'rare', max: 3, weight: 2, tags: ['status'],
    requiresFeatures: ['poison'],
    desc: 'Попадание по отравленной цели усиливает её яд на 15%',
    hooks: { onHit: (game, { enemy, level }) => {
      if (enemy.poison) enemy.poison.dps *= 1 + 0.15 * level;
    } } },
  { id: 'frostnova', icon: '❅', name: 'ЛЕДЯНАЯ ВОЛНА', rarity: 'epic', max: 1, weight: 1, tags: ['status', 'explosive'],
    requiresFeatures: ['friendlyBlast'],
    provides: ['freeze'],
    desc: 'Взрывы игрока дополнительно замораживают всех в радиусе',
    apply: (p) => { p.effects.flags.blastFreeze = true; } },
  { id: 'toxiccloud', icon: '☁', name: 'ТОКСИЧНОЕ ОБЛАКО', rarity: 'epic', max: 1, weight: 1, tags: ['status'],
    requiresFeatures: ['poison'],
    desc: 'Смерть отравленного врага заражает всех поблизости',
    hooks: { onKill: (game, { enemy }) => {
      if (!enemy?.poison) return;
      for (const e of game.entities.enemies.slice()) {
        if ((e.x - enemy.x) ** 2 + (e.y - enemy.y) ** 2 < 90 ** 2) applyPoison(e, enemy.poison.dps, enemy.poison.until);
      }
    } } },
  { id: 'sentence', icon: '⚖', name: 'ПРИГОВОР', rarity: 'rare', max: 3, weight: 2, tags: ['status'],
    requiresFeatures: ['mark'],
    desc: 'Попадание по помеченной цели наносит ещё +20% урона',
    hitMod: (game, { enemy, level }) => (enemy.marked ? 1 + 0.2 * level : 1) },
  { id: 'frostbite', icon: '☾', name: 'ОБМОРОЖЕНИЕ', rarity: 'rare', max: 3, weight: 2, tags: ['status'],
    requiresFeatures: ['freeze'],
    desc: 'Урон по замороженным целям выше на 35%',
    hitMod: (game, { enemy, level }) => (enemy.freezeUntil > 0 ? 1 + 0.35 * level : 1) },

  // ═══════════════════════════ ОРБИТАЛЫ И АУРЫ
  { id: 'orbitalpoison', icon: '☢', name: 'ТОКСИЧНЫЙ КОНТУР', rarity: 'epic', max: 1, weight: 1, tags: ['orbital', 'status'],
    requiresAnyFeature: ['orbital', 'aura'],
    provides: ['poison'],
    desc: 'Клинки и ауры дополнительно отравляют всё, чего касаются',
    apply: (p) => { p.effects.flags.orbitalPoison = true; } },
  { id: 'auraradius', icon: '◐', name: 'РАСШИРЕНИЕ КОНТУРА', rarity: 'common', max: 4, weight: 2, tags: ['orbital'],
    requiresAnyFeature: ['orbital', 'aura'],
    desc: '+25% радиус всех орбиталов и аур', apply: (p) => (p.orbitalRadiusMul *= 1.25) },
  { id: 'spinup', icon: '◓', name: 'РАЗГОН РОТОРА', rarity: 'rare', max: 3, weight: 2, tags: ['orbital'],
    requiresFeatures: ['orbital'],
    desc: '+40% скорости вращения орбиталов', apply: (p) => (p.orbitalSpinMul *= 1.4) },
  { id: 'orbitalslow', icon: '◔', name: 'ВЯЗКОЕ ПОЛЕ', rarity: 'epic', max: 1, weight: 1, tags: ['orbital', 'status'],
    requiresAnyFeature: ['orbital', 'aura'],
    desc: 'Клинки и ауры дополнительно замедляют цели на 40%',
    apply: (p) => { p.effects.flags.orbitalSlow = true; } },
  { id: 'auraheal', icon: '◕', name: 'ЛЕЧЕБНЫЙ КОНТУР', rarity: 'rare', max: 1, weight: 2, tags: ['orbital', 'sustain'],
    requiresFeatures: ['aura'],
    desc: 'Каждое срабатывание урона ауры по врагу лечит 0.4% максимального HP',
    apply: (p) => { p.effects.flags.auraHeal = true; } },
  { id: 'orbitalpower', icon: '⊚', name: 'УСИЛЕННЫЙ КОНТУР', rarity: 'rare', max: 3, weight: 2, tags: ['orbital'],
    requiresAnyFeature: ['orbital', 'aura'],
    desc: '+20% урона всех орбиталов и аур', apply: (p) => (p.orbitalDamageMul *= 1.2) },

  // ═══════════════════════════ ДРОНЫ И ТУРЕЛИ
  { id: 'dronefire', icon: '⌸', name: 'БЫСТРЫЙ ЗАТВОР', rarity: 'rare', max: 3, weight: 2, tags: ['drone'],
    requiresFeatures: ['drone'],
    desc: '+25% скорострельность дронов', apply: (p) => (p.droneRateMul *= 1.25) },
  { id: 'dronerange', icon: '⌹', name: 'ДАЛЬНИЙ РАДАР', rarity: 'common', max: 3, weight: 2, tags: ['drone'],
    requiresFeatures: ['drone'],
    desc: '+200 дальности обнаружения дронов', apply: (p) => (p.droneRangeAdd += 200) },
  { id: 'dronepower', icon: '⌺', name: 'ТЯЖЁЛЫЕ БОЕГОЛОВКИ', rarity: 'rare', max: 3, weight: 2, tags: ['drone'],
    requiresFeatures: ['drone'],
    desc: '+30% урона дронов', apply: (p) => (p.droneDamageMul *= 1.3) },
  { id: 'dronecrit', icon: '⌻', name: 'ПРИЦЕЛЬНЫЙ МОДУЛЬ', rarity: 'epic', max: 1, weight: 1, tags: ['drone', 'crit'],
    requiresFeatures: ['drone'],
    desc: 'Дроны могут критовать (используют твой шанс крита)',
    apply: (p) => { p.effects.flags.droneCrit = true; } },
  { id: 'droneshield', icon: '⌼', name: 'РЕЗЕРВНЫЙ ЩИТ', rarity: 'rare', max: 2, weight: 1, tags: ['drone', 'defense'],
    requiresFeatures: ['drone'],
    desc: '+15 максимального щита за каждого дрона, уже существующего в момент выбора карты; будущие дроны бонус не дают',
    apply: (p) => { const bonus = 15 * p.drones.length; p.maxShield += bonus; p.shield = Math.min(p.maxShield, p.shield + bonus); } },
  { id: 'turretlife', icon: '⌽', name: 'АВТОНОМНОЕ ПИТАНИЕ', rarity: 'rare', max: 3, weight: 2, tags: ['drone'],
    requiresFeatures: ['spawner'],
    desc: 'Турели «Сеялки» живут на 3 секунды дольше', apply: (p) => (p.turretLifeAdd = (p.turretLifeAdd ?? 0) + 3) },

  // ═══════════════════════════ МИНЫ
  { id: 'minepower', icon: '⏣', name: 'МОЩНЫЙ ЗАРЯД', rarity: 'common', max: 4, weight: 2, tags: ['mine'],
    requiresFeatures: ['mine'],
    desc: '+35% урона мин', apply: (p) => (p.mineDamageMul *= 1.35) },
  { id: 'mineradius', icon: '⏥', name: 'ШИРОКИЙ РАДИУС', rarity: 'rare', max: 3, weight: 2, tags: ['mine'],
    requiresFeatures: ['mine'],
    desc: '+40% радиус взрыва мин', apply: (p) => (p.mineRadiusMul *= 1.4) },
  { id: 'minerush', icon: '⏦', name: 'МИННЫЙ РЫВОК', rarity: 'epic', max: 2, weight: 1, tags: ['mine', 'speed'],
    requiresFeatures: ['dash'],
    provides: ['mine', 'friendlyBlast'],
    desc: 'Рывок сбрасывает мощную мину (×2 урона)',
    hooks: { onDash: (game, { level }) => dropMine(game, { damageMul: 2 * level }) } },
  { id: 'minecluster', icon: '⏧', name: 'КАССЕТНЫЕ МИНЫ', rarity: 'epic', max: 2, weight: 1, tags: ['mine', 'explosive'],
    requiresFeatures: ['mine'],
    desc: 'Взрыв мины создаёт 2 дочерние мины за уровень; урон каждой — 50% базовой мины',
    hooks: { onMineBlast: (game, { x, y, level }) => {
      for (let i = 0; i < 2 * level; i++) dropMine(game, { x: x + rnd(20, -20), y: y + rnd(20, -20), damageMul: 0.5 });
    } } },
  { id: 'minefield', icon: '⏨', name: 'МИННОЕ ПОЛЕ', rarity: 'rare', max: 3, weight: 2, tags: ['mine'],
    requiresFeatures: ['mineTrail'],
    desc: '+50% частоты сброса мин', apply: (p) => (p.mineRateMul *= 1.5) },

  // ═══════════════════════════ ОБОРОНА
  { id: 'armorplate', icon: '▧', name: 'БРОНЕПЛАСТИНЫ', rarity: 'common', max: 5, weight: 2, tags: ['defense'],
    desc: '+1 очко брони — урон по тебе снижается (гипербола, не до 100%)', apply: (p) => (p.armorPoints += 1) },
  { id: 'evasion', icon: '▨', name: 'УКЛОНЕНИЕ', rarity: 'common', max: 5, weight: 2, tags: ['defense'],
    desc: '+1 очко уклонения — шанс полностью избежать удара', apply: (p) => (p.dodgePoints += 1) },
  { id: 'platingheavy', icon: '▩', name: 'ТЯЖЁЛАЯ БРОНЯ', rarity: 'rare', max: 3, weight: 2, tags: ['defense'],
    desc: '+45 максимального HP, но −0.08 скорости атаки',
    apply: (p) => { p.maxHp += 45; p.hp += 45; p.attackSpeed = Math.max(0.15, p.attackSpeed - 0.08); } },
  { id: 'secondwind', icon: '▬', name: 'ВТОРОЕ ДЫХАНИЕ', rarity: 'epic', max: 1, weight: 1, tags: ['defense'],
    desc: 'Раз в 20 секунд смертельный удар оставляет 1 HP вместо гибели',
    apply: (p) => { p.effects.flags.secondWind = true; } },
  { id: 'guardian', icon: '▭', name: 'СТРАЖ', rarity: 'rare', max: 1, weight: 2, tags: ['defense'],
    desc: 'После получения урона следующие 1.5 сек весь урон по тебе вдвое ниже',
    hooks: { onHurt: (game) => (game.player.effects.flags.guardWindow = 1.5) } },
  { id: 'bulkhead', icon: '▮', name: 'ПЕРЕБОРКИ', rarity: 'common', max: 4, weight: 2, tags: ['defense'],
    desc: '+18 щита и +25 HP разом',
    apply: (p) => { p.maxShield += 18; p.shield = Math.min(p.maxShield, p.shield + 18); p.maxHp += 25; p.hp += 25; } },
  { id: 'shockabsorber', icon: '▯', name: 'АМОРТИЗАТОР', rarity: 'epic', max: 1, weight: 1, tags: ['defense'],
    desc: 'Урон больше половины текущего HP разом срезается втрое',
    apply: (p) => { p.effects.flags.dampen = true; } },
  { id: 'reflexes', icon: '▰', name: 'РЕФЛЕКСЫ', rarity: 'rare', max: 3, weight: 2, tags: ['defense'],
    desc: '+1.5 очка уклонения, но −10% максимального щита',
    apply: (p) => { p.dodgePoints += 1.5; p.maxShield *= 0.9; p.shield = Math.min(p.shield, p.maxShield); } },

  // ═══════════════════════════ ЩИТ
  { id: 'shieldregen2', icon: '◫', name: 'РЕГЕНЕРАТОР', rarity: 'common', max: 4, weight: 2, tags: ['defense'],
    requiresFeatures: ['shieldRegen'],
    desc: '+50% скорости восстановления щита', apply: (p) => (p.shieldRegen *= 1.5) },
  { id: 'quickshield', icon: '◪', name: 'БЫСТРЫЙ ЗАПУСК', rarity: 'rare', max: 3, weight: 2, tags: ['defense'],
    requiresFeatures: ['shieldRegen'],
    desc: '−40% паузы перед восстановлением щита после урона за уровень', apply: (p) => (p.shieldDelayMul *= 0.6) },
  { id: 'overshield', icon: '◩', name: 'ОВЕРЩИТ', rarity: 'epic', max: 1, weight: 1, tags: ['defense'],
    requiresFeatures: ['shieldRegen'],
    desc: 'Щит копится сверх максимума на 30%, но избыток тает 5%/сек',
    apply: (p) => { p.effects.flags.overshield = true; } },
  { id: 'shieldnova', icon: '◨', name: 'ПРОБОЙ ЩИТА', rarity: 'rare', max: 3, weight: 2, tags: ['defense', 'explosive'],
    requiresFeatures: ['shield'],
    provides: ['friendlyBlast'],
    desc: 'Полный пробой щита вызывает взрыв вокруг корабля',
    apply: (p) => { p.effects.flags.shieldBreakNova = (p.effects.flags.shieldBreakNova ?? 0) + 1; } },
  { id: 'reactiveplating', icon: '◧', name: 'РЕАКТИВНАЯ ОБШИВКА', rarity: 'rare', max: 1, weight: 2, tags: ['defense'],
    requiresFeatures: ['shield'],
    desc: 'Пока щит полон — броня режет урон ещё на 40%',
    apply: (p) => { p.effects.flags.reactivePlating = true; } },

  // ═══════════════════════════ ВАМПИРИЗМ И РЕГЕН
  { id: 'vamp2', icon: '⍟', name: 'ВТОРОЙ КОНТУР', rarity: 'common', max: 4, weight: 2, tags: ['lifesteal'],
    desc: '+3% вампиризма', apply: (p) => (p.vamp += 0.03) },
  { id: 'regen2', icon: '⍞', name: 'НАНОРЕМБОТЫ', rarity: 'common', max: 4, weight: 2, tags: ['sustain'],
    desc: '+1.5 HP в секунду постоянно', apply: (p) => (p.regen += 1.5) },
  { id: 'vampburst', icon: '⍝', name: 'КРОВАВЫЙ ТРОФЕЙ', rarity: 'rare', max: 3, weight: 2, tags: ['lifesteal'],
    desc: 'Убийство лечит ещё 2% максимального HP',
    hooks: { onKill: (game, { level }) => healPlayer(game, game.player.maxHp * 0.02 * level) } },
  { id: 'wavemend', icon: '⍜', name: 'ПЕРЕДЫШКА', rarity: 'rare', max: 3, weight: 2, tags: ['sustain'],
    desc: 'Зачистка волны лечит 20% максимального HP',
    hooks: { onWaveClear: (game, { level }) => healPlayer(game, game.player.maxHp * 0.2 * level) } },

  // ═══════════════════════════ ДВИЖЕНИЕ И РЫВОК
  { id: 'engines2', icon: '⇊', name: 'ФОРСИРОВАННЫЕ ДВИГАТЕЛИ', rarity: 'common', max: 5, weight: 2, tags: ['speed'],
    desc: '+16% тяга и максимальная скорость', apply: (p) => { p.thrust *= 1.16; p.maxSpeed *= 1.16; } },
  { id: 'dashcooldown2', icon: '⇋', name: 'КОНДЕНСАТОР РЫВКА', rarity: 'rare', max: 3, weight: 2, tags: ['speed'],
    requiresFeatures: ['dash'],
    desc: '−22% отката рывка', apply: (p) => (p.dashCooldownMax *= 0.78) },
  { id: 'slipstream', icon: '⇌', name: 'СКОЛЬЖЕНИЕ', rarity: 'rare', max: 1, weight: 2, tags: ['speed'],
    desc: 'Пока активен форсаж — +20% скорости атаки',
    apply: (p) => { p.effects.flags.slipstream = true; } },
  { id: 'evasivemaneuvers', icon: '⇍', name: 'УКЛОНЯЮЩИЙ МАНЁВР', rarity: 'rare', max: 1, weight: 2, tags: ['speed', 'defense'],
    desc: 'Пока активен форсаж — +1.5 очка уклонения',
    apply: (p) => { p.effects.flags.slipDodge = true; } },
  { id: 'dashrecover', icon: '⇎', name: 'АВАРИЙНЫЙ РЫВОК', rarity: 'rare', max: 3, weight: 2, tags: ['speed', 'sustain'],
    requiresFeatures: ['dash'],
    desc: 'Рывок лечит 3 HP', hooks: { onDash: (game, { level }) => healPlayer(game, 3 * level) } },
  { id: 'speeddemon', icon: '⇏', name: 'ГОНЩИК', rarity: 'epic', max: 2, weight: 1, tags: ['speed'],
    desc: 'Чем выше твоя скорость — тем выше урон (до +25% на максимуме)',
    damageMod: (game, { level }) => {
      const pl = game.player;
      const ratio = Math.min(1, Math.hypot(pl.vx, pl.vy) / pl.maxSpeed);
      return 1 + ratio * 0.25 * level;
    } },

  // ═══════════════════════════ ЛУТ, XP, УДАЧА
  { id: 'luckypilot', icon: '⋆', name: 'ВЕЗУНЧИК', rarity: 'common', max: 5, weight: 2, tags: ['luck'],
    desc: '+1 очко удачи — редкие карты выпадают чаще', apply: (p) => (p.luck += 1) },
  { id: 'xpboost', icon: '⋇', name: 'АНАЛИЗАТОР ОПЫТА', rarity: 'common', max: 4, weight: 2, tags: ['luck'],
    desc: '+18% получаемого опыта', apply: (p) => (p.xpMul *= 1.18) },
  { id: 'scrapboost', icon: '⋈', name: 'СБОРЩИК', rarity: 'common', max: 4, weight: 2, tags: ['luck'],
    desc: '+20% получаемых обломков', apply: (p) => (p.scrapMul *= 1.2) },
  { id: 'luckystreak', icon: '⋉', name: 'СЧАСТЛИВАЯ ЖИЛА', rarity: 'rare', max: 3, weight: 2, tags: ['luck'],
    desc: '5%×уровень шанс удвоить подобранные обломки',
    hooks: { onPickup: (game, { kind, value, level }) => {
      if (kind === 'scrap' && Math.random() < 0.05 * level) emit('scrap:gain', { amount: value });
    } } },
  { id: 'rerollmaster', icon: '⋊', name: 'АНАЛИТИК', rarity: 'rare', max: 1, weight: 2, tags: ['luck'],
    desc: 'Зачистка волны даёт переброс карточек (максимум 3 про запас)',
    hooks: { onWaveClear: (game) => { const pl = game.player; if (pl.rerolls < 3) pl.rerolls++; } } },
  { id: 'treasurehunter', icon: '⋋', name: 'ОХОТНИК ЗА СОКРОВИЩАМИ', rarity: 'epic', max: 1, weight: 1, tags: ['luck'],
    desc: 'Элитные враги роняют вдвое больше обломков',
    apply: (p) => { p.effects.flags.eliteLoot = true; } },

  // ═══════════════════════════ СКЕЙЛЯЩИЕСЯ ДВИЖКИ
  { id: 'timekeeper', icon: '⌚', name: 'ХРОНОМЕТР', rarity: 'epic', max: 2, weight: 1, tags: ['kinetic'],
    desc: '+0.8% урона за каждые 10 секунд забега, без потолка',
    damageMod: (game, { level }) => 1 + Math.floor(game.time / 10) * 0.008 * level },
  { id: 'bloodprice', icon: '⏱', name: 'ЦЕНА КРОВИ', rarity: 'epic', max: 2, weight: 1, tags: ['kinetic'],
    desc: '+0.3% урона за каждый % недостающего HP',
    damageMod: (game, { level }) => {
      const pl = game.player;
      const missing = 100 * (1 - pl.hp / pl.maxHp);
      return 1 + missing * 0.003 * level;
    } },
  { id: 'perfectionist', icon: '⏲', name: 'ПЕРФЕКЦИОНИСТ', rarity: 'epic', max: 2, weight: 1, tags: ['crit'],
    desc: '+0.5% урона за каждый % текущего шанса крита',
    damageMod: (game, { level }) => 1 + critChance(game.player) * 100 * 0.005 * level },
  { id: 'ironwill', icon: '⏳', name: 'НЕСГИБАЕМОСТЬ', rarity: 'epic', max: 2, weight: 1, tags: ['defense'],
    desc: '+2% максимального HP за каждую зачищенную волну',
    hooks: { onWaveClear: (game, { level }) => {
      const pl = game.player;
      const inc = pl.maxHp * 0.02 * level;
      pl.maxHp += inc;
      pl.hp += inc;
    } } },

  // маленькая пассивка-предок для эволюции «Калейдоскоп» (модель Vampire Survivors —
  // нужна конкретная прокачанная карта направления, а не просто тег)
  { id: 'splitpower', icon: '◭', name: 'РАСЩЕПЛЕНИЕ', rarity: 'rare', max: 2, weight: 1, tags: ['pierce'],
    requiresFeatures: ['split'],
    desc: '+1 осколок при распаде «Призмы»', apply: (p) => (p.splitCountAdd = (p.splitCountAdd ?? 0) + 1) },

  // ═══════════════════════════ ЭВОЛЮЦИИ СТВОЛОВ (ствол + прокачанный перк = новое поведение)
  { id: 'evo_lance', icon: '⟒', name: 'КОПЬЁ', rarity: 'legendary', max: 1,
    requiresWeapon: 'scatter', requires: { pierce: 3 },
    desc: 'ЭВОЛЮЦИЯ «Дробовика»: дробины сливаются в один пробивающий гарпун — вместо веера один мощный прошивающий выстрел',
    apply: (p) => { p.effects.flags.evoLance = true; } },
  { id: 'evo_storm', icon: '⟓', name: 'ГРОЗА', rarity: 'legendary', max: 1,
    requiresWeapon: 'chain', requires: { caliber: 3 },
    desc: 'ЭВОЛЮЦИЯ «Цепи»: каждый прыжок молнии бьёт по площади в точке удара',
    apply: (p) => { p.effects.flags.evoStorm = true; } },
  { id: 'evo_carpet', icon: '⟔', name: 'КОВЁР', rarity: 'legendary', max: 1,
    requiresWeapon: 'lob', requires: { boom: 2 },
    desc: 'ЭВОЛЮЦИЯ «Миномёта»: один выстрел кладёт веер из 5 гранат вместо одной',
    apply: (p) => { p.effects.flags.evoCarpet = true; } },
  { id: 'evo_leech', icon: '⟕', name: 'ЖГУТ', rarity: 'legendary', max: 1,
    requiresWeapon: 'tether', requires: { vamp: 3 },
    desc: 'ЭВОЛЮЦИЯ «Пиявки»: канал цепляет сразу 3 цели, лечит с каждой',
    apply: (p) => { p.effects.flags.evoLeech = true; } },
  { id: 'evo_billiard', icon: '⟖', name: 'БИЛЬЯРД', rarity: 'legendary', max: 1,
    requiresWeapon: 'ricochet', requires: { ric: 2 },
    desc: 'ЭВОЛЮЦИЯ «Осколочника»: отскок при крите ничего не стоит — цепь рикошетов не кончается, пока криты продолжаются',
    apply: (p) => { p.effects.flags.evoBilliard = true; } },
  { id: 'evo_hivedrone', icon: '⟗', name: 'УЛЕЙ', rarity: 'legendary', max: 1,
    requiresWeapon: 'spawner', requires: { drone: 2 },
    desc: 'ЭВОЛЮЦИЯ «Сеялки»: турели стреляют самонаводящимися ракетами вместо простых снарядов',
    apply: (p) => { p.effects.flags.evoHiveDrone = true; } },
  { id: 'evo_kaleidoscope', icon: '⟘', name: 'КАЛЕЙДОСКОП', rarity: 'legendary', max: 1,
    requiresWeapon: 'split', requires: { splitpower: 2 },
    desc: 'ЭВОЛЮЦИЯ «Призмы»: осколки при попадании тоже распадаются ещё раз',
    apply: (p) => { p.effects.flags.evoKaleidoscope = true; } },
  { id: 'evo_snipe', icon: '⟙', name: 'СНАЙПЕРСКАЯ РЕЛЬСА', rarity: 'legendary', max: 1,
    requiresWeapon: 'rail', requires: { sniper: 3 },
    desc: 'ЭВОЛЮЦИЯ «Рельсы»: дальность +80%, луч всегда критует',
    apply: (p) => { p.effects.flags.evoSnipe = true; } },
  { id: 'evo_novablast', icon: '⟚', name: 'ГРАНАТОПАД', rarity: 'legendary', max: 1,
    requiresWeapon: 'radial', requires: { boom: 3 },
    desc: 'ЭВОЛЮЦИЯ «Новы»: каждый снаряд залпа взрывается по площади при попадании',
    apply: (p) => { p.effects.flags.evoNovaBoom = true; } },

  // ═══════════════════════════ СИНЕРГИИ ПО ТЕГАМ (модель Hades Legendary — набери источники направления)
  { id: 'syn_overload', icon: '⟛', name: 'ПЕРЕГРУЗКА КОНТУРА', rarity: 'legendary', max: 1,
    requiresTags: { energy: 3 },
    provides: ['chain'],
    desc: 'СИНЕРГИЯ: каждый 5-й выстрел запускает молнию по ближайшим врагам',
    hooks: { onShoot: (game) => {
      const pl = game.player;
      if (counters(pl).shots % 5 === 0) chainLightning(game, pl.x, pl.y, 3, 14 * effectPower(pl));
    } } },
  { id: 'syn_chaindet', icon: '⟜', name: 'ЦЕПНАЯ ДЕТОНАЦИЯ', rarity: 'legendary', max: 1,
    requiresTags: { explosive: 3 },
    provides: ['burn'],
    desc: 'СИНЕРГИЯ: убийство взрывом наносит мощный взрыв и поджигает всех рядом',
    hooks: { onKill: (game, { enemy }) => {
      if (!enemy) return;
      perkBlast(game, enemy.x, enemy.y, 120, 30 * effectPower(game.player), '#ff9f43');
      for (const e of game.entities.enemies.slice()) {
        if ((e.x - enemy.x) ** 2 + (e.y - enemy.y) ** 2 < 120 ** 2) applyBurn(e, 8 * effectPower(game.player), 3);
      }
    } } },
  { id: 'syn_epidemic', icon: '⟝', name: 'ЭПИДЕМИЯ', rarity: 'legendary', max: 1,
    requiresTags: { status: 4 },
    desc: 'СИНЕРГИЯ: каждые 4 секунды яд/поджиг перекидываются с заражённых врагов на соседей',
    hooks: { onTick: (game, { dt }) => {
      const fx = game.player.effects;
      fx.epidemicTimer = (fx.epidemicTimer ?? 0) + dt;
      if (fx.epidemicTimer < 4) return;
      fx.epidemicTimer = 0;
      for (const e of game.entities.enemies.slice()) {
        if (!e.burn && !e.poison) continue;
        for (const other of game.entities.enemies.slice()) {
          if (other === e || ((other.x - e.x) ** 2 + (other.y - e.y) ** 2 > 140 ** 2)) continue;
          if (e.burn) applyBurn(other, e.burn.dps * 0.7, e.burn.until);
          if (e.poison) applyPoison(other, e.poison.dps * 0.7, e.poison.until);
        }
      }
    } } },
  { id: 'syn_saturnring', icon: '⟞', name: 'КОЛЬЦО САТУРНА', rarity: 'legendary', max: 1,
    requiresTags: { orbital: 3 },
    desc: 'СИНЕРГИЯ: массивное дальнее кольцо, медленно жгущее всё на подступах',
    apply: (p) => {
      p.effects.orbitals.push({
        type: 'aura', tag: 'saturn',
        angle: 0, dist: 0, spin: 0,
        radius: 260, hitRate: 0.7,
        color: '#ffd166',
        damage: (pl) => 11 * effectPower(pl),
      });
    } },
  { id: 'syn_perfectangle', icon: '⟟', name: 'ИДЕАЛЬНЫЙ УГОЛ', rarity: 'legendary', max: 1,
    requiresTags: { crit: 4 },
    provides: ['chain'],
    desc: 'СИНЕРГИЯ: крит запускает молнию по соседям и лечит за каждого задетого',
    hooks: { onCrit: (game, { x, y, damage }) => {
      const hits = chainLightning(game, x, y, 2, damage * 0.35, '#ffe066');
      if (hits) healPlayer(game, hits * 2);
    } } },
  { id: 'syn_stormcell', icon: '⟠', name: 'ГРОЗОВАЯ ЯЧЕЙКА', rarity: 'legendary', max: 1,
    requiresTags: { chain: 3 },
    provides: ['chain'],
    desc: 'СИНЕРГИЯ: убийство запускает молнию с точки гибели врага',
    hooks: { onKill: (game, { enemy }) => {
      if (!enemy) return;
      chainLightning(game, enemy.x, enemy.y, 3, 16 * effectPower(game.player));
    } } },
  { id: 'syn_railgun', icon: '⟡', name: 'РЕЛЬСОТРОН', rarity: 'legendary', max: 1,
    requiresTags: { pierce: 3 },
    desc: 'СИНЕРГИЯ: +3 пробития разом, часть пробития превращается в плоский урон',
    apply: (p) => { p.pierce += 3; p.dmgFlat += p.pierce * 1.5; } },
  { id: 'syn_swarmlord', icon: '⟢', name: 'ПОВЕЛИТЕЛЬ РОЯ', rarity: 'legendary', max: 1,
    requiresTags: { swarm: 3 },
    desc: 'СИНЕРГИЯ: 15% шанс на попадание выпустить самонаводящуюся мини-ракету',
    hooks: { onHit: (game, { enemy }) => {
      if (Math.random() >= 0.15) return;
      const pl = game.player;
      const angle = Math.atan2(enemy.y - pl.y, enemy.x - pl.x);
      game.projectiles.bullets.push({
        x: pl.x, y: pl.y, vx: Math.cos(angle) * 560, vy: Math.sin(angle) * 560, angle,
        damage: 10 * effectPower(pl), crit: false, life: 1, pierce: 0, hit: new Set(),
        homing: 0.9, ricochet: 0, splash: 0, kind: 'missile', color: '#ff8a5e', r: 5,
      });
    } } },
  { id: 'syn_fortress', icon: '⟣', name: 'КРЕПОСТЬ', rarity: 'legendary', max: 1,
    requiresTags: { defense: 3 },
    desc: 'СИНЕРГИЯ: пока щит от половины и выше — броня и уклонение вдвое эффективнее',
    apply: (p) => { p.effects.flags.fortress = true; } },
  { id: 'syn_jackpot', icon: '⟤', name: 'ДЖЕКПОТ', rarity: 'legendary', max: 1,
    requiresTags: { luck: 3 },
    desc: 'СИНЕРГИЯ: вся накопленная удача конвертируется в очки крита',
    apply: (p) => { p.critPoints += p.luck * 0.3; } },

];

// Секрет Сингулярности намеренно не входит в PERKS: основной каталог остаётся
// из 212 известных карточек, а эта награда существует только за пределами карты.
export const SINGULARITY_PERK = {
  id: 'singularity_patience', icon: '◉', name: 'ТЕРПЕНИЕ ПУСТОТЫ', rarity: 'legendary', max: 1, weight: 0,
  exclusiveSource: 'singularity', tags: [],
  desc: '+18% урона и +18 прочности корпуса — найдено за пределами карты',
  apply: (p) => { p.dmgMul *= 1.18; p.maxHp += 18; p.hp += 18; },
};

export const perkById = Object.fromEntries([...PERKS, SINGULARITY_PERK].map((p) => [p.id, p]));

/** Награды, которые встречаются только после зачистки волны. */
export const WAVE_ONLY = [
  { id: 'repair', icon: '⊹', name: 'РЕМОНТ', rarity: 'common', max: Infinity, weight: 3,
    desc: 'Восстановить 60% максимального корпуса',
    apply: (p, _level, game) => game
      ? healPlayer(game, p.maxHp * 0.6)
      : (p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.6)) },
  { id: 'scrapPile', icon: '▩', name: 'ТРОФЕИ', rarity: 'common', max: Infinity, weight: 2,
    desc: '+50 обломков сразу в счёт забега', scrap: 50, apply: () => {} },
  { id: 'refill', icon: '⊡', name: 'ЗАРЯДКА', rarity: 'common', max: Infinity, weight: 2,
    desc: 'Полный щит и мгновенная готовность всех активок',
    apply: (p) => {
      p.shield = p.maxShield;
      for (const slot of p.abilities) slot.cd = 0;
    } },
  { id: 'rerollPack', icon: '⟳', name: 'АНАЛИТИКА', rarity: 'rare', max: Infinity, weight: 1,
    desc: '+2 переброса карточек в этом забеге', apply: (p) => (p.rerolls += 2) },
];

export const ALL_CARDS = [...PERKS, ...WAVE_ONLY];
export const cardById = Object.fromEntries([...ALL_CARDS, SINGULARITY_PERK].map((c) => [c.id, c]));
