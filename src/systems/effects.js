import { TAU, clamp, rnd } from '../core/math.js';
import { sfx } from '../core/audio.js';
import { camera } from '../core/camera.js';
import { spark, floatText, blastRing } from '../entities/effects.js';
// Циклический импорт с combat.js безопасен: обе стороны экспортируют
// function-declaration и вызывают их только во время игры, а не при загрузке модуля.
import { applyBlastPull, damageEnemy } from './combat.js';
import { healingBlocked } from './location-policy.js';

/**
 * ЯДРО ПЕРКОВ.
 *
 * Плоские бонусы («+28% урона») пишутся прямо в apply. Всё интересное —
 * триггеры, скейлинг и условия — вешается сюда:
 *
 *   hooks       — реакции на события боя (onShoot, onKill, onHurt, ...)
 *   damageMods  — условные множители урона, считаются в момент выстрела
 *   hitMods     — множители, зависящие от конкретной цели (в момент попадания)
 *   stacks      — временные накопления («+2% темпа за подбор, до 15 раз»)
 *   counters    — статистика забега, на которой растут скейлинг-перки
 *   flags       — запреты и особые режимы (нельзя лечиться, радар выключен)
 *   orbitals    — вращающиеся клинки и ауры
 */

export const HOOK_NAMES = [
  'onShoot', 'onKill', 'onHurt', 'onCrit', 'onHit',
  'onWaveStart', 'onWaveClear', 'onPickup', 'onDash', 'onTick', 'onBossKill',
  'onAbility', 'onAsteroidBreak',
];

export function createEffectState() {
  const hooks = {};
  for (const name of HOOK_NAMES) hooks[name] = [];
  return {
    hooks,
    damageMods: [],
    hitMods: [],
    stacks: Object.create(null),
    counters: {
      shots: 0,
      kills: 0,
      killStreak: 0,
      bestStreak: 0,
      wavesCleared: 0,
      bossKills: 0,
      scrapCollected: 0,
      perksTaken: 0,
      damageTaken: 0,
    },
    flags: Object.create(null),
    orbitals: [],
    enemyTimeScale: 1,
    slowTimer: 0,
    revives: 0,
    statusTick: 0,   // накопитель для батч-тика статусов (см. tickStatuses)
    secondWindCd: 0, // откат «Второго дыхания»
  };
}

/** Регистрация перка: вызывается один раз, при первом взятии. */
export function registerPerk(player, perk) {
  const fx = player.effects;
  if (perk.hooks) {
    for (const [name, fn] of Object.entries(perk.hooks)) {
      if (!fx.hooks[name]) fx.hooks[name] = [];
      fx.hooks[name].push({ perk, fn });
    }
  }
  if (perk.damageMod) fx.damageMods.push({ perk, fn: perk.damageMod });
  if (perk.hitMod) fx.hitMods.push({ perk, fn: perk.hitMod });
  if (perk.orbital) fx.orbitals.push(perk.orbital(player));
}

/** Вызов события. ctx получают все подписчики; level — уровень перка. */
export function fireHook(game, name, ctx = {}) {
  const fx = game.player?.effects;
  if (!fx) return;
  const list = fx.hooks[name];
  if (!list?.length) return;
  for (const { perk, fn } of list) {
    const level = game.player.modules[perk.id] ?? 1;
    try {
      fn(game, { ...ctx, level, perk });
    } catch (err) {
      console.error(`[perk:${perk.id}] ошибка в ${name}`, err);
    }
  }
}

/** Итоговый множитель урона в момент выстрела. */
export function damageMultiplier(game, ctx = {}) {
  const fx = game.player.effects;
  let mult = 1;
  for (const { perk, fn } of fx.damageMods) {
    const level = game.player.modules[perk.id] ?? 1;
    mult *= fn(game, { ...ctx, level }) ?? 1;
  }
  return mult;
}

/** Множитель, зависящий от конкретной цели (в момент попадания). */
export function hitMultiplier(game, enemy, ctx = {}) {
  const fx = game.player.effects;
  let mult = 1;
  for (const { perk, fn } of fx.hitMods) {
    const level = game.player.modules[perk.id] ?? 1;
    mult *= fn(game, { ...ctx, enemy, level }) ?? 1;
  }
  return mult;
}

// ─────────────────────────────── стаки

export function addStack(player, id, { max = 10, duration = 4, value = 0.02 } = {}) {
  const fx = player.effects;
  const s = fx.stacks[id] ?? (fx.stacks[id] = { count: 0, value, max, expires: 0 });
  s.value = value;
  s.max = max;
  s.count = Math.min(s.max, s.count + 1);
  s.expires = duration > 0 ? duration : Infinity;
}

export const stackCount = (player, id) => player.effects.stacks[id]?.count ?? 0;
export const stackBonus = (player, id) => {
  const s = player.effects.stacks[id];
  return s ? s.count * s.value : 0;
};

export function clearStack(player, id) {
  const s = player.effects.stacks[id];
  if (s) s.count = 0;
}

// ─────────────────────────────── покадровое обновление

export function updateEffectSystems(game, dt) {
  const p = game.player;
  const fx = p.effects;

  // истечение временных стаков
  for (const s of Object.values(fx.stacks)) {
    if (s.count > 0 && Number.isFinite(s.expires)) {
      s.expires -= dt;
      if (s.expires <= 0) s.count = 0;
    }
  }

  if (fx.secondWindCd > 0) fx.secondWindCd -= dt;

  // замедление врагов от активки
  if (fx.slowTimer > 0) {
    fx.slowTimer -= dt;
    if (fx.slowTimer <= 0) fx.enemyTimeScale = 1;
  }

  updateOrbitals(game, dt);
  updateAbilities(game, dt);

  // статусы (поджог/яд/метка) тикают не каждый кадр, а раз в 0.25с батчем
  // по всем врагам — иначе на волне из полусотни горящих целей это дорого
  fx.statusTick += dt;
  if (fx.statusTick >= 0.25) {
    const tickDt = fx.statusTick;
    fx.statusTick = 0;
    tickStatuses(game, tickDt);
  }

  fireHook(game, 'onTick', { dt });
}

/** Поджог и яд наносят урон по расписанию; метка просто истекает. */
function tickStatuses(game, tickDt) {
  for (const e of game.entities.enemies.slice()) {
    if (e.burn) {
      damageFromEffect(game, e, e.burn.dps * tickDt, '#ff7a45');
      e.burn.until -= tickDt;
      if (e.burn.until <= 0) e.burn = null;
    }
    if (e.poison) {
      damageFromEffect(game, e, e.poison.dps * tickDt, '#8aff5e');
      e.poison.until -= tickDt;
      if (e.poison.until <= 0) e.poison = null;
    }
    if (e.marked) {
      e.marked.until -= tickDt;
      if (e.marked.until <= 0) e.marked = null;
    }
  }
}

/** Статусы. Живут прямо на враге — просто и достаточно для одного забега. */
export function applyBurn(enemy, dps, duration) { enemy.burn = { dps, until: duration }; }
export function applyPoison(enemy, dps, duration) { enemy.poison = { dps, until: duration }; }
export function applyFreeze(enemy, factor, duration) {
  // Заморозка — отдельный ледяной статус, а не синоним любого slow.
  // Она одновременно замедляет цель, но ледяные синергии читают только
  // freezeUntil и поэтому не срабатывают от гравитации или вязких полей.
  enemy.freezeUntil = Math.max(enemy.freezeUntil ?? 0, duration);
  enemy.freezeFactor = Math.min(enemy.freezeFactor ?? 1, factor);
}
export function applyMark(enemy, mult, duration) { enemy.marked = { mult, until: duration }; }

/** Клинки и ауры: вращаются вокруг корабля и жгут всё, чего касаются. */
function updateOrbitals(game, dt) {
  const p = game.player;
  for (const orb of p.effects.orbitals) {
    orb.cooldowns ??= new Map();
    orb.angle += orb.spin * (p.orbitalSpinMul ?? 1) * dt;

    if (orb.type === 'aura') {
      orb.x = p.x;
      orb.y = p.y;
    } else {
      orb.x = p.x + Math.cos(orb.angle) * orb.dist;
      orb.y = p.y + Math.sin(orb.angle) * orb.dist;
    }

    for (const [enemy, time] of orb.cooldowns) {
      const left = time - dt;
      if (left <= 0) orb.cooldowns.delete(enemy);
      else orb.cooldowns.set(enemy, left);
    }

    const reach = orb.radius * (p.orbitalRadiusMul ?? 1);
    for (const e of game.entities.enemies.slice()) {
      if (orb.cooldowns.has(e)) continue;
      if ((e.x - orb.x) ** 2 + (e.y - orb.y) ** 2 > (reach + e.r) ** 2) continue;
      orb.cooldowns.set(e, orb.hitRate);
      const dmg = orb.damage(p) * (p.orbitalDamageMul ?? 1);
      damageFromEffect(game, e, dmg, orb.color);
      if (orb.slow) {
        e.slowUntil = 1.2;
        e.slowFactor = orb.slow;
      }
      if (p.effects.flags.orbitalBurn) applyBurn(e, dmg * 0.3, 2);
      if (p.effects.flags.orbitalPoison) applyPoison(e, dmg * 0.25, 3);
      if (p.effects.flags.orbitalSlow) { e.slowUntil = Math.max(e.slowUntil ?? 0, 1); e.slowFactor = Math.min(e.slowFactor ?? 1, 0.6); }
      if (orb.type === 'aura' && p.effects.flags.auraHeal) healPlayer(game, p.maxHp * 0.004);
    }
  }
}

/** Урон от перка/активки — идёт мимо оружейных множителей. */
export function damageFromEffect(game, enemy, amount, color = '#7ee8ff') {
  spark(game.fx, enemy.x, enemy.y, 3, color, 140, 0.25, 2);
  damageEnemy(game, enemy, amount, false, { fromEffect: true });
}

// ─────────────────────────────── активные способности

export function updateAbilities(game, dt) {
  for (const slot of game.player.abilities) {
    if (slot.cd > 0) {
      slot.cd -= dt;
      if (slot.cd < 0) slot.cd = 0;
    }
  }
}

export function useAbility(game, index) {
  const slot = game.player.abilities[index];
  if (!slot) return false;
  if (slot.cd > 0) {
    sfx.denied();
    return false;
  }
  slot.def.use(game, game.player);
  slot.cd = slot.def.cooldown * (game.player.abilityCooldownMul ?? 1);
  fireHook(game, 'onAbility', { ability: slot.def });
  return true;
}

export function grantAbility(player, def) {
  if (player.abilities.some((a) => a.def.id === def.id)) return false;
  player.abilities.push({ def, cd: 0 });
  return true;
}

/** Сокращение кулдаунов — используется перками вроде «Каскад». */
export function reduceAbilityCooldowns(player, seconds) {
  for (const slot of player.abilities) {
    if (slot.cd > 0) slot.cd = Math.max(0, slot.cd - seconds);
  }
}

// ─────────────────────────────── помощники для перков

/** Взрыв без оружейных множителей (цепные реакции, ауры). */
export function perkBlast(game, x, y, radius, damage, color = '#ffd166') {
  blastRing(game.fx, x, y, radius, color);
  spark(game.fx, x, y, 10, color, 240, 0.45, 2.4);
  for (const e of game.entities.enemies.slice()) {
    if ((e.x - x) ** 2 + (e.y - y) ** 2 < (radius + e.r) ** 2) {
      damageFromEffect(game, e, damage, color);
      if (game.player.effects.flags.blastFreeze) applyFreeze(e, 0.5, 1.5);
      applyBlastPull(game, e, x, y, radius);
    }
  }
  sfx.boom();
  camera.shake(2);
}

/** Молния по цепочке ближайших врагов. Возвращает число задетых целей. */
export function chainLightning(game, fromX, fromY, jumps, damage, color = '#7ee8ff') {
  const p = game.player;
  const range = 420 + (p.chainRangeAdd ?? 0);
  const power = damage * (p.chainPowerMul ?? 1);
  let x = fromX;
  let y = fromY;
  const hit = new Set();
  for (let i = 0; i < jumps; i++) {
    let best = null;
    let bd = range ** 2;
    for (const e of game.entities.enemies) {
      if (hit.has(e)) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) break;
    hit.add(best);
    game.fx.beams.push({ x1: x, y1: y, x2: best.x, y2: best.y, color, width: 2.5, life: 0.16, max: 0.16 });
    damageFromEffect(game, best, power, color);
    x = best.x;
    y = best.y;
  }
  if (hit.size) sfx.droneShot();
  return hit.size;
}

/** Залп во все стороны — для «Отдачи», активки «Залп» и «Новы».
 * splash > 0 — ЭВОЛЮЦИЯ «Гранатопад»: каждый снаряд взрывается по площади. */
export function radialVolley(game, count, damage, speed = 620, color = '#cdf3ff', life = 1.1, splash = 0) {
  const p = game.player;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * TAU + rnd(0.1, -0.1);
    game.projectiles.bullets.push({
      x: p.x, y: p.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      damage,
      crit: false,
      life,
      pierce: 1,
      hit: new Set(),
      homing: 0.8,
      ricochet: 0,
      splash,
      kind: 'bullet',
      color,
      r: 3,
    });
  }
  sfx.laser();
}

export function healPlayer(game, amount, options) {
  const p = game.player;
  if (healingBlocked(game, options)) return false;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  if (p.hp > before) floatText(game.fx, p.x, p.y - 26, '+' + Math.round(p.hp - before), '#5ef08a');
  return p.hp > before;
}

/** Замедление врагов на время (активка «Стазис» и ледяная аура). */
export function slowEnemies(game, factor, duration) {
  const fx = game.player.effects;
  fx.enemyTimeScale = factor;
  fx.slowTimer = duration;
}

/**
 * Множитель для урона перков, активок и орбиталов.
 * Берёт слои 2 и 3 (проценты и ×-карты), но НЕ базу оружия — эффекты
 * не должны зависеть от того, какой ствол сейчас в руках.
 */
export const effectPower = (player) => (1 + player.dmgAdd) * player.dmgMul;

export const counters = (player) => player.effects.counters;
export const clampMult = (v, min = 0.1, max = 12) => clamp(v, min, max);
