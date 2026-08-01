import { angLerp, angDiff, clamp, dist, lerp, rnd } from '../core/math.js';
import { DAMAGE_TYPE } from '../core/damage.js';
import { sfx } from '../core/audio.js';
import { camera } from '../core/camera.js';
import {
  currentWeapon, critChance, fireInterval, penetrationFor, techDamage,
  weaponDamage, weaponDamageType,
} from './player.js';
import { getWeapon } from '../data/weapons.js';
import { spark, beam, floatText, trail } from './effects.js';
import { damageEnemy, blastFriendly, splitAsteroid, hurtPlayer, nearestEnemy } from '../systems/combat.js';
import { damageMultiplier, fireHook, counters, stackBonus, healPlayer, radialVolley, perkBlast } from '../systems/effects.js';
import { createGrid, rebuildGrid, queryGrid } from '../core/grid.js';
import { placeTurret } from './turrets.js';

/** Потолок снарядов: дальше кадры важнее, чем ещё пара пуль на экране. */
const MAX_BULLETS = 340;
const MAX_FOE_BULLETS = 420;
const PHYSICAL_DAMAGE = { type: DAMAGE_TYPE.PHYSICAL, penetration: 0, fromEffect: false };

// Сетки перестраиваются раз в кадр и переиспользуются всеми снарядами.
const enemyGrid = createGrid();
const asteroidGrid = createGrid();

/** Снаряды игрока, врагов и мины. */

export function createProjectiles() {
  return { bullets: [], foeBullets: [], mines: [] };
}

// ─────────────────────────────── стрельба игрока

/**
 * chargeRatio — только для «Осадного»: 0 в момент нажатия, 1 на полном
 * заряде. Остальные стволы вызывают fireWeapon без второго аргумента.
 *
 * forceId/dmgMul — для «МУЛЬТИСТВОЛА» (см. main.js:updateMultiFire): стреляет
 * конкретным стволом из p.weapons, а не текущим, с собственным штрафом урона.
 * В этом режиме p.fireCooldown не трогаем — откат каждого ствола ведёт
 * отдельно p.weaponCooldowns.
 */
export function fireWeapon(game, chargeRatio, forceId, dmgMul = 1) {
  const p = game.player;
  const w = forceId ? getWeapon(forceId) : currentWeapon(p);

  counters(p).shots++;
  fireHook(game, 'onShoot', { weapon: w });

  // Урон: три слоя прокачки × условные множители перков
  // (адреналин, седьмой выстрел, скейлинг) — см. entities/player.js
  const type = weaponDamageType(p);
  const damageSpec = {
    type,
    penetration: penetrationFor(p, type),
    fromEffect: false,
  };
  let damage = (type === DAMAGE_TYPE.TECHNICAL ? techDamage(p, w.dmg) : weaponDamage(p, w))
    * damageMultiplier(game, { weapon: w, type }) * dmgMul;
  if (w.kind === 'charge') damage *= lerp(w.chargeMinMul ?? 0.25, w.chargeMaxMul ?? 2.5, chargeRatio ?? 1);

  let count = w.count + (w.kind === 'beam' || w.kind === 'tether' || w.kind === 'spawner' ? 0 : p.countAdd);
  let spread = w.spread + p.countAdd * 0.02;
  const speed = w.speed * p.speedMul * p.locationBulletSpeedMul;
  const life = w.life * p.lifeMul * p.locationBulletLifeMul;

  // ЭВОЛЮЦИЯ «Копьё»: дробины сливаются в один пробивающий гарпун
  if (w.id === 'scatter' && p.effects.flags.evoLance) { count = 1; spread = 0; }
  // ЭВОЛЮЦИЯ «Ковёр»: один спуск курка кладёт веер гранат вместо одной
  if (w.id === 'lob' && p.effects.flags.evoCarpet) { count = 5; spread = Math.max(spread, 0.28); }

  // темп: прокачка + временные стаки «Разгона» — только у активного ствола
  if (!forceId) p.fireCooldown = fireInterval(p, w, stackBonus(p, 'momentum'));

  if (w.kind === 'beam') {
    const sniped = w.id === 'rail' && p.effects.flags.evoSnipe;
    fireRail(game, damage, (w.range ?? 1200) * p.lifeMul * (sniped ? 1.8 : 1), w.color, sniped, damageSpec);
    sfx.rail();
    camera.shake(4);
    return;
  }

  if (w.kind === 'tether') {
    const leech = w.id === 'tether' && p.effects.flags.evoLeech ? 3 : 1;
    fireTether(game, damage, (w.range ?? 260) * p.lifeMul, w.vamp ?? 0, w.color, leech, damageSpec);
    return;
  }

  if (w.kind === 'spawner') {
    placeTurret(game, {
      life: (w.turretLife ?? 8) + (p.turretLifeAdd ?? 0), range: (w.turretRange ?? 380) * p.radiusMul,
      damage: damage, rate: (w.turretRate ?? 0.5) / p.attackSpeed, color: w.color,
      homing: w.id === 'spawner' && p.effects.flags.evoHiveDrone ? 0.8 : 0,
      damageSpec,
    });
    return;
  }

  if (w.kind === 'radial') {
    const novaBoom = w.id === 'radial' && p.effects.flags.evoNovaBoom;
    const start = game.projectiles.bullets.length;
    radialVolley(game, count, damage, speed, w.color, life, novaBoom ? 70 * p.blastRadiusMul : 0);
    for (let i = start; i < game.projectiles.bullets.length; i++) {
      game.projectiles.bullets[i].damageSpec = damageSpec;
    }
    sfx.boom();
    camera.shake(3);
    return;
  }

  for (let i = 0; i < count; i++) {
    const offset = count === 1 ? 0 : (i - (count - 1) / 2) * spread * 2;
    const angle = p.angle + offset + rnd(0.02, -0.02);
    const crit = Math.random() < critChance(p);
    const bullet = {
      x: p.x + Math.cos(angle) * 20,
      y: p.y + Math.sin(angle) * 20,
      vx: Math.cos(angle) * speed + p.vx * 0.3,
      vy: Math.sin(angle) * speed + p.vy * 0.3,
      angle,
      damage: damage * (crit ? p.critMul : 1),
      damageSpec,
      crit,
      life,
      pierce: (w.pierce ?? 0) + p.pierce + (w.id === 'scatter' && p.effects.flags.evoLance ? 5 : 0),
      hit: new Set(),
      homing: (w.homing ?? 0) + p.homingAdd,
      ricochet: (w.ricochet ?? 0) + p.ricochet + p.locationRicochetBonus,
      bounceAsteroids: w.kind === 'ricochet',
      evoBilliard: w.kind === 'ricochet' && !!p.effects.flags.evoBilliard,
      splash: ((w.splash ?? 0) + (p.boomShot ? 42 + p.boomShot * 16 : 0)) * p.blastRadiusMul,
      kind: w.kind,
      color: w.color,
      r: (w.kind === 'plasma' ? 9 : w.kind === 'missile' ? 5 : 3) * p.bulletSize * (w.id === 'scatter' && p.effects.flags.evoLance ? 1.8 : 1),
      spawnX: p.x, spawnY: p.y,
      falloff: w.falloff,
    };
    if (w.kind === 'chain') {
      // Усилители цепи работают и для оружия «Цепь», а не только для
      // эффектов из systems/effects.js. Множитель применяется один раз ко
      // всему разряду; стандартное падение урона за прыжок остаётся прежним.
      bullet.damage *= p.chainPowerMul ?? 1;
      bullet.chainJumps = w.chainJumps ?? 0;
      bullet.chainFalloff = w.chainFalloff ?? 0.75;
      bullet.chainRadius = (w.chainRadius ?? 300) + (p.chainRangeAdd ?? 0);
      bullet.evoStorm = !!p.effects.flags.evoStorm;
    }
    if (w.kind === 'boomerang') {
      bullet.outbound = true;
      bullet.turnAt = life / 2;
    }
    if (w.kind === 'lob') {
      bullet.noCollide = true;
    }
    if (w.kind === 'split') {
      bullet.splitCount = (w.splitCount ?? 3) + (p.splitCountAdd ?? 0);
      bullet.splitDamageMul = w.splitDamageMul ?? 0.45;
      bullet.splitSpread = w.splitSpread ?? 0.5;
    }
    if (w.kind === 'charge') {
      bullet.charged = chargeRatio ?? 1;
    }
    game.projectiles.bullets.push(bullet);
  }

  if (w.kind === 'plasma') {
    sfx.plasma();
    p.vx -= Math.cos(p.angle) * 45;
    p.vy -= Math.sin(p.angle) * 45;
  } else if (w.kind === 'missile') sfx.missile();
  else if (w.kind === 'lob') sfx.plasma();
  else if (w.kind === 'boomerang') sfx.dash();
  else if (w.kind === 'chain') sfx.droneShot();
  else if (w.kind === 'charge') sfx.rail();
  else if (w.id === 'scatter') { sfx.shotgun(); camera.shake(2.5); }
  else sfx.laser();

  const back = p.angle + Math.PI;
  spark(game.fx, p.x + Math.cos(back) * 10, p.y + Math.sin(back) * 10, 2, w.color, 90, 0.2, 1.4);
}

/** Пиявка: короткий канал вместо дискретного выстрела — тикает, пока держишь кнопку. */
let tetherTick = 0;
/** targetCount > 1 — ЭВОЛЮЦИЯ «Жгут»: канал цепляет сразу несколько целей. */
function fireTether(game, damage, range, vamp, color, targetCount = 1, damageSpec) {
  const p = game.player;
  const crit = Math.random() < critChance(p);
  const total = damage * (crit ? p.critMul : 1);
  const hit = new Set();
  let anyHit = false;

  for (let i = 0; i < targetCount; i++) {
    const target = nearestUnhit(game, p.x, p.y, range, hit);
    if (!target) break;
    hit.add(target);
    anyHit = true;
    const factor = frontShieldFactor(target, p.x, p.y, game);
    damageEnemy(game, target, total * factor, crit, damageSpec);
    if (vamp > 0) healPlayer(game, total * vamp);
    beam(game.fx, p.x, p.y, target.x, target.y, color, crit ? 5 : 3);
  }

  // тикает часто — озвучиваем через раз, иначе звук сливается в кашу
  if (anyHit && ++tetherTick % 3 === 0) sfx.droneShot();
}

/** forceCrit — ЭВОЛЮЦИЯ «Снайперская рельса»: луч всегда критует. */
function fireRail(game, damage, range, color, forceCrit = false, damageSpec) {
  const p = game.player;
  const crit = forceCrit || Math.random() < critChance(p);
  const total = damage * (crit ? p.critMul : 1);
  const ex = p.x + Math.cos(p.angle) * range;
  const ey = p.y + Math.sin(p.angle) * range;

  const onLine = (o, pad) => {
    const t = (o.x - p.x) * Math.cos(p.angle) + (o.y - p.y) * Math.sin(p.angle);
    if (t < 0 || t > range) return false;
    const px = p.x + Math.cos(p.angle) * t;
    const py = p.y + Math.sin(p.angle) * t;
    return (o.x - px) ** 2 + (o.y - py) ** 2 < (o.r + pad) ** 2;
  };

  for (const e of game.entities.enemies.slice()) {
    if (onLine(e, 6)) {
      damageEnemy(game, e, total * frontShieldFactor(e, p.x, p.y, game), crit, damageSpec);
      spark(game.fx, e.x, e.y, 5, color, 180, 0.3, 2);
    }
  }
  for (const a of game.entities.asteroids.slice()) {
    if (onLine(a, 4)) {
      a.hp -= total;
      a.flash = 0.1;
      if (a.hp <= 0) splitAsteroid(game, a);
    }
  }
  beam(game.fx, p.x, p.y, ex, ey, color, crit ? 7 : 4);
}

/** Страж гасит попадания в лоб — надо облетать. */
function frontShieldFactor(enemy, fromX, fromY, game) {
  if (!enemy.frontShield) return 1;
  const incoming = Math.atan2(fromY - enemy.y, fromX - enemy.x);
  if (Math.abs(angDiff(enemy.angle, incoming)) < 1.1) {
    floatText(game.fx, enemy.x, enemy.y - enemy.r - 6, 'ЩИТ', '#4ad9ff');
    return 0.15;
  }
  return 1;
}

// ─────────────────────────────── снаряды врагов

export function spawnFoeBullet(game, from, angle, speed, damage, color, r = 4, damageSpec = PHYSICAL_DAMAGE) {
  game.projectiles.foeBullets.push({
    x: from.x + Math.cos(angle) * (from.r * 0.8),
    y: from.y + Math.sin(angle) * (from.r * 0.8),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    damage, color, r, life: 4, damageSpec,
  });
}

export function shootAtPlayer(game, enemy, speed, damage, color, damageSpec = PHYSICAL_DAMAGE) {
  const angle = Math.atan2(game.player.y - enemy.y, game.player.x - enemy.x) + rnd(0.09, -0.09);
  spawnFoeBullet(game, enemy, angle, speed, damage, color, 4, damageSpec);
  sfx.enemyShot();
}

// ─────────────────────────────── обновление

export function updateProjectiles(game, dt) {
  // широкая фаза: раскладываем цели по клеткам один раз за кадр
  rebuildGrid(enemyGrid, game.entities.enemies);
  rebuildGrid(asteroidGrid, game.entities.asteroids);

  updatePlayerBullets(game, dt);
  updateFoeBullets(game, dt);
  updateMines(game, dt);
  updateDrones(game, dt);
}

/** Ближайший враг, исключая всех, кого этот снаряд уже поразил (для «Цепи»). */
function nearestUnhit(game, x, y, maxDist, hitSet) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const e of game.entities.enemies) {
    if (hitSet.has(e)) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function nearestAsteroid(game, x, y, maxDist, except = null) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const a of game.entities.asteroids) {
    if (a === except) continue;
    const d = (a.x - x) ** 2 + (a.y - y) ** 2;
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

/** Перенаправляет снаряд на новую цель, сохраняя текущую скорость. */
function redirectTo(b, target) {
  b.angle = Math.atan2(target.y - b.y, target.x - b.x);
  const s = Math.hypot(b.vx, b.vy) || 600;
  b.vx = Math.cos(b.angle) * s;
  b.vy = Math.sin(b.angle) * s;
  b.life = Math.max(b.life, 0.5);
}

/** Расщепляет «Призму» на уменьшенные лучи веером вокруг точки попадания. */
function spawnSplitChildren(game, b, excludeHit) {
  const p = game.player;
  // ЭВОЛЮЦИЯ «Калейдоскоп»: осколки распадаются ещё раз — но только один
  // дополнительный уровень (isSplitChild), иначе снаряды размножатся бесконечно
  const reSplit = p.effects.flags.evoKaleidoscope && !b.isSplitChild;
  const baseAngle = Math.atan2(b.vy, b.vx);
  const speed = Math.hypot(b.vx, b.vy) || 500;
  for (let k = 0; k < b.splitCount; k++) {
    const offset = (k - (b.splitCount - 1) / 2) * b.splitSpread;
    const angle = baseAngle + offset;
    game.projectiles.bullets.push({
      x: b.x, y: b.y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      angle, damage: b.damage * b.splitDamageMul, crit: false,
      damageSpec: b.damageSpec,
      life: 0.45, pierce: 0, hit: new Set(excludeHit ? [excludeHit] : []),
      homing: 0, ricochet: 0, splash: 0,
      kind: reSplit ? 'split' : 'bullet',
      splitCount: reSplit ? Math.max(2, Math.floor(b.splitCount / 2)) : 0,
      splitDamageMul: b.splitDamageMul, splitSpread: b.splitSpread, isSplitChild: true,
      color: b.color, r: 2.4,
    });
  }
}

function updatePlayerBullets(game, dt) {
  const list = game.projectiles.bullets;
  // при переполнении первыми уходят самые старые
  if (list.length > MAX_BULLETS) list.splice(0, list.length - MAX_BULLETS);
  const p = game.player;

  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];

    if (b.homing) {
      const target = nearestEnemy(game, b.x, b.y, b.kind === 'missile' ? 520 : 340);
      if (target) {
        b.angle = angLerp(b.angle, Math.atan2(target.y - b.y, target.x - b.x), clamp(b.homing * dt * 3, 0, 1));
        const s = Math.hypot(b.vx, b.vy);
        b.vx = Math.cos(b.angle) * s;
        b.vy = Math.sin(b.angle) * s;
      }
    }

    if (b.kind === 'missile') {
      const s = Math.hypot(b.vx, b.vy);
      if (s < 720) { b.vx *= 1 + dt * 1.6; b.vy *= 1 + dt * 1.6; }
      if (Math.random() < 0.8) trail(game.fx, b.x, b.y, rnd(20, -20), rnd(20, -20), '#ff8a5e', 0.35, rnd(3, 1.5));
    }

    // «Диск»: на середине пути разворачивается к текущей позиции корабля
    // и снова может задеть уже пройденных врагов — отсюда двойной удар.
    if (b.outbound && b.life <= b.turnAt) {
      b.outbound = false;
      b.hit.clear();
    }
    if (b.kind === 'boomerang' && !b.outbound) {
      const s = Math.hypot(b.vx, b.vy) || 480;
      const angle = Math.atan2(p.y - b.y, p.x - b.x);
      b.vx = Math.cos(angle) * s;
      b.vy = Math.sin(angle) * s;
      if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 < 26 * 26) {
        list.splice(i, 1);
        continue;
      }
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;

    if (b.life <= 0) {
      if (b.splash) blastFriendly(game, b.x, b.y, b.splash, b.damage * 0.6, b.color, { damageSpec: b.damageSpec });
      list.splice(i, 1);
      continue;
    }

    if (b.noCollide) continue;   // «Миномёт»: летит сквозь всё до самого приземления

    // дробовик слабеет с дистанцией: пересчитывается на каждый потенциальный удар,
    // поэтому урон падает по ходу всего полёта, а не только в момент первого касания
    const dmgNow = b.falloff
      ? b.damage * clamp(1 - dist(b.spawnX, b.spawnY, b.x, b.y) / b.falloff, 0.25, 1)
      : b.damage;

    let done = false;
    let hitSomething = false;

    // враги — только из ближайших клеток сетки
    queryGrid(enemyGrid, b.x, b.y, b.r + 40, (e) => {
      if (hitSomething || b.hit.has(e)) return;
      if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 >= (e.r + b.r) ** 2) return;
      hitSomething = true;

      const factor = frontShieldFactor(e, b.x, b.y, game);
      if (factor < 1) spark(game.fx, b.x, b.y, 4, '#4ad9ff', 140, 0.25, 2);
      damageEnemy(game, e, dmgNow * factor, b.crit, b.damageSpec);
      spark(game.fx, b.x, b.y, 4, b.color, 150, 0.25, 1.6);
      b.hit.add(e);

      // «Цепь»: прыгает на следующую цель вместо остановки, урон падает за прыжок
      if (b.kind === 'chain') {
        if (b.chainJumps > 0) {
          // исключаем ВСЕХ уже задетых, а не только текущую цель — иначе
          // при равном расстоянии до соседей цепь может прыгнуть назад
          // на уже поражённого врага и застрять, не находя новых целей
          const next = nearestUnhit(game, b.x, b.y, b.chainRadius, b.hit);
          if (next) {
            b.chainJumps--;
            b.damage *= b.chainFalloff;
            // ЭВОЛЮЦИЯ «Гроза»: каждый прыжок дополнительно бьёт по площади
            if (b.evoStorm) perkBlast(game, next.x, next.y, 55, dmgNow * 0.35, b.color);
            game.fx.beams.push({ x1: b.x, y1: b.y, x2: next.x, y2: next.y, color: b.color, width: 2, life: 0.12, max: 0.12 });
            redirectTo(b, next);
            return true;
          }
        }
        done = true;
        return true;
      }

      // «Призма»: единожды распадается на уменьшенный веер лучей
      if (b.kind === 'split' && b.splitCount) {
        spawnSplitChildren(game, b, e);
        done = true;
        return true;
      }

      if (b.splash) {
        blastFriendly(game, b.x, b.y, b.splash, dmgNow * 0.55, b.color, { damageSpec: b.damageSpec });
        done = true;
        return true;
      }
      if (b.ricochet > 0) {
        // ЭВОЛЮЦИЯ «Бильярд»: отскок при крите ничего не стоит
        const spendsCharge = !(b.crit && b.evoBilliard);
        const nextEnemy = nearestEnemy(game, b.x, b.y, 320, e);
        if (nextEnemy) { if (spendsCharge) b.ricochet--; redirectTo(b, nextEnemy); return true; }
        if (b.bounceAsteroids) {
          const nextRock = nearestAsteroid(game, b.x, b.y, 320);
          if (nextRock) { if (spendsCharge) b.ricochet--; redirectTo(b, nextRock); return true; }
        }
      }
      if (b.pierce-- <= 0) done = true;
      return true;
    });

    if (!hitSomething) {
      queryGrid(asteroidGrid, b.x, b.y, b.r + 70, (a) => {
        if (hitSomething || b.hit.has(a)) return;
        if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 >= (a.r + b.r) ** 2) return;
        hitSomething = true;

        a.hp -= dmgNow;
        a.flash = 0.1;
        spark(game.fx, b.x, b.y, 3, '#c8b28a', 130, 0.25, 1.5);
        b.hit.add(a);
        if (a.hp <= 0) splitAsteroid(game, a);

        if (b.kind === 'chain') { done = true; return true; }

        if (b.splash) {
          blastFriendly(game, b.x, b.y, b.splash, dmgNow * 0.55, b.color, { damageSpec: b.damageSpec });
          done = true;
          return true;
        }
        if (b.ricochet > 0) {
          const spendsCharge = !(b.crit && b.evoBilliard);
          const nextEnemy = nearestEnemy(game, b.x, b.y, 320);
          if (nextEnemy) { if (spendsCharge) b.ricochet--; redirectTo(b, nextEnemy); return true; }
          if (b.bounceAsteroids) {
            const nextRock = nearestAsteroid(game, b.x, b.y, 320, a);
            if (nextRock) { if (spendsCharge) b.ricochet--; redirectTo(b, nextRock); return true; }
          }
        }
        if (b.pierce-- <= 0) done = true;
        return true;
      });
    }

    if (done) list.splice(i, 1);
  }
}

function updateFoeBullets(game, dt) {
  const list = game.projectiles.foeBullets;
  if (list.length > MAX_FOE_BULLETS) list.splice(0, list.length - MAX_FOE_BULLETS);
  const p = game.player;
  const scale = p.effects.enemyTimeScale; // «Стазис»/«Стоп-кадр» тормозят и вражеские снаряды
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    f.x += f.vx * dt * scale;
    f.y += f.vy * dt * scale;
    f.life -= dt;
    if (f.life <= 0) { list.splice(i, 1); continue; }
    if ((p.x - f.x) ** 2 + (p.y - f.y) ** 2 < (p.r + f.r) ** 2) {
      hurtPlayer(game, f.damage, f.damageSpec);
      list.splice(i, 1);
    }
  }
}

/** Ставит мину явно (рывок, «Кассетные мины») — без завязки на таймер mineDrop. */
export function dropMine(game, { x, y, damageMul = 1 } = {}) {
  const p = game.player;
  game.projectiles.mines.push({
    x: x ?? p.x, y: y ?? p.y, age: 0, r: 8,
    damage: techDamage(p, 22 + 14 * Math.max(1, p.mineDrop)) * p.mineDamageMul * damageMul,
    damageSpec: {
      type: DAMAGE_TYPE.TECHNICAL,
      penetration: penetrationFor(p, DAMAGE_TYPE.TECHNICAL),
      fromEffect: true,
    },
  });
}

function updateMines(game, dt) {
  const p = game.player;
  const mines = game.projectiles.mines;

  if (p.mineDrop) {
    p.mineTimer -= dt;
    if (p.mineTimer <= 0) {
      p.mineTimer = 1.6 / (p.mineDrop * p.mineRateMul);
      dropMine(game, { x: p.x - p.vx * 0.12, y: p.y - p.vy * 0.12 });
    }
  }

  for (let i = mines.length - 1; i >= 0; i--) {
    const m = mines[i];
    m.age += dt;
    const near = nearestEnemy(game, m.x, m.y, 74);
    if (near || m.age > 12) {
      if (near) {
        blastFriendly(game, m.x, m.y, 96 * p.mineRadiusMul, m.damage, '#ffe066', { damageSpec: m.damageSpec });
        fireHook(game, 'onMineBlast', { x: m.x, y: m.y });
      }
      mines.splice(i, 1);
    }
  }
}

function updateDrones(game) {
  const p = game.player;
  for (const d of p.drones) {
    if (d.cd > 0) continue;
    const target = nearestEnemy(game, d.x, d.y, 640 + p.droneRangeAdd);
    if (!target) { d.cd = 0.2; continue; }

    const angle = Math.atan2(target.y - d.y, target.x - d.x);
    const droneCrit = !!p.effects.flags.droneCrit && Math.random() < critChance(p);
    game.projectiles.bullets.push({
      x: d.x, y: d.y,
      vx: Math.cos(angle) * 720,
      vy: Math.sin(angle) * 720,
      angle,
      damage: techDamage(p, 6) * p.droneDamageMul * (droneCrit ? p.critMul : 1),
      damageSpec: {
        type: DAMAGE_TYPE.TECHNICAL,
        penetration: penetrationFor(p, DAMAGE_TYPE.TECHNICAL),
        fromEffect: true,
      },
      crit: droneCrit,
      life: 0.85,
      pierce: 0,
      hit: new Set(),
      homing: 0.6 + p.homingAdd,
      ricochet: 0,
      splash: 0,
      kind: 'bullet',
      color: '#7ee8ff',
      r: 3,
    });
    d.cd = 0.55 / p.droneRateMul;
    sfx.droneShot();
  }
}

export function clearProjectiles(pr) {
  pr.bullets.length = 0;
  pr.foeBullets.length = 0;
  pr.mines.length = 0;
}
