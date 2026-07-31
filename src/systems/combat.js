import { emit } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { camera } from '../core/camera.js';
import { rnd } from '../core/math.js';
import { makeEnemy, makePickup } from '../entities/factory.js';
import { spark, floatText, blastRing } from '../entities/effects.js';
import { fireHook, hitMultiplier, counters, clearStack, effectPower, applyFreeze } from './effects.js';
// Цикл player → effects → combat → player безопасен: эти функции зовутся
// только во время боя, когда все модули уже загружены.
import { armorFactor, dodgeChance } from '../entities/player.js';
import { healingBlocked } from './location-policy.js';

/**
 * Урон, смерть, взрывы. Единственное место, где сущности теряют HP,
 * поэтому любые новые эффекты (щиты, резисты) добавляются тут.
 */

export function damageEnemy(game, enemy, amount, crit = false, opts = {}) {
  const { player, fx } = game;

  // Условные множители по цели («в упор», «добивание», «первый контакт»)
  // применяются только к оружейному урону: иначе перки умножали бы сами себя.
  if (!opts.fromEffect) amount *= hitMultiplier(game, enemy, { crit });
  if (enemy.marked) amount *= enemy.marked.mult;

  // Щит врага гасится первым и только потом корпус («Могильщик» поднимает
  // обломки в щит). Пока щит цел, HP не трогается — его надо сбивать.
  if (enemy.shield > 0) {
    const absorbed = Math.min(enemy.shield, amount);
    enemy.shield -= absorbed;
    amount -= absorbed;
    spark(game.fx, enemy.x, enemy.y, 3, '#5ef0d0', 160, 0.25, 2);
    if (amount <= 0) {
      enemy.flash = 0.12;
      floatText(fx, enemy.x, enemy.y - enemy.r - 6, Math.round(absorbed), '#5ef0d0');
      return;
    }
  }

  enemy.hp -= amount;
  enemy.flash = 0.12;
  floatText(fx, enemy.x, enemy.y - enemy.r - 6, (crit ? '×' : '') + Math.round(amount), crit ? '#ffe066' : '#ffffff');
  sfx.hit();

  if (!opts.fromEffect) {
    fireHook(game, 'onHit', { enemy, damage: amount, crit, x: enemy.x, y: enemy.y });
    if (crit) fireHook(game, 'onCrit', { enemy, damage: amount, x: enemy.x, y: enemy.y });
  }

  if (player.vamp && player.hp < player.maxHp && !healingBlocked(game)) {
    const heal = Math.min(amount, enemy.hp + amount) * player.vamp;
    if (heal > 0.3) {
      player.hp = Math.min(player.maxHp, player.hp + heal);
      if (Math.random() < 0.25) floatText(fx, player.x, player.y - 26, '+' + heal.toFixed(0), '#5ef08a');
    }
  }

  if (enemy.hp <= 0) killEnemy(game, enemy);
}

export function killEnemy(game, enemy) {
  const list = game.entities.enemies;
  const i = list.indexOf(enemy);
  if (i < 0) return;
  list.splice(i, 1);

  const stats = counters(game.player);
  stats.kills++;
  stats.killStreak++;
  stats.bestStreak = Math.max(stats.bestStreak, stats.killStreak);

  if (enemy.boss) {
    stats.bossKills++;
    fireHook(game, 'onBossKill', { enemy });
    fireHook(game, 'onKill', { enemy, boss: true });
    emit('boss:killed', { boss: enemy });
    return;
  }

  spark(game.fx, enemy.x, enemy.y, enemy.elite ? 46 : 20, enemy.color, 300, 0.7, 2.6);
  sfx.boom();
  camera.shake(enemy.elite ? 14 : 5);

  // активка «Метка смерти»: помеченная цель взрывается при гибели
  if (enemy.deathMarkExplode) blastFriendly(game, enemy.x, enemy.y, 130, 45, '#ff3b6b');

  // бомбер и мина рвутся посмертно
  if (enemy.type === 'bomber') blastHostile(game, enemy.x, enemy.y, 92, 24, enemy.color);
  if (enemy.type === 'mine') blastHostile(game, enemy.x, enemy.y, 92, 16, enemy.color);

  // делитель распадается на двух дронов
  if (enemy.type === 'splitter') {
    for (let k = 0; k < 2; k++) {
      const childDifficulty = enemy.source === 'station' ? 1 : game.run.difficulty * 0.8;
      const child = makeEnemy(enemy.x + rnd(24, -24), enemy.y + rnd(24, -24), 'drone', childDifficulty);
      child.fromWave = enemy.fromWave;
      child.source = enemy.source;
      child.encounterId = enemy.encounterId;
      if (enemy.stationScale) {
        child.stationScale = { ...enemy.stationScale };
        child.hp = child.maxHp = Math.max(1, Math.round(child.maxHp * enemy.stationScale.hp));
        child.damage *= enemy.stationScale.damage;
        child.speed *= enemy.stationScale.speed;
      }
      list.push(child);
    }
  }

  const parts = enemy.elite ? 8 : enemy.type === 'brute' ? 4 : 2;
  for (let j = 0; j < parts; j++) {
    game.entities.pickups.push(makePickup(enemy.x, enemy.y, 'xp', Math.max(1, Math.round(enemy.xp / parts))));
  }
  const eliteLoot = enemy.elite && game.player.effects.flags.eliteLoot ? 2 : 1;
  game.entities.pickups.push(makePickup(enemy.x, enemy.y, 'scrap', enemy.scrap * eliteLoot));
  if (Math.random() < (enemy.elite ? 1 : 0.07)) {
    game.entities.pickups.push(makePickup(enemy.x, enemy.y, 'hp', 25));
  }

  fireHook(game, 'onKill', { enemy });
  emit('enemy:killed', { enemy });
}

/** Общий физический импульс «Коллапса» для всех радиальных взрывных путей. */
export function applyBlastPull(game, enemy, x, y, radius, allowPull = true) {
  if (!allowPull || !game.player.blastPull || enemy.hp <= 0) return false;
  const dx = x - enemy.x;
  const dy = y - enemy.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= 0 || distance >= radius + enemy.r) return false;

  const depth = Math.max(0, 1 - distance / radius);
  const mass = enemy.boss || enemy.elite || enemy.r >= 32 ? 0.35 : 1;
  const impulse = (180 + 240 * depth) * mass;
  enemy.vx += (dx / distance) * impulse;
  enemy.vy += (dy / distance) * impulse;
  return true;
}

/** Взрыв игрока: бьёт врагов и астероиды. */
export function blastFriendly(game, x, y, radius, damage, color, { allowPull = true } = {}) {
  blastRing(game.fx, x, y, radius, color);
  const freeze = game.player.effects.flags.blastFreeze;
  for (const e of game.entities.enemies.slice()) {
    const dx = x - e.x;
    const dy = y - e.y;
    const distance = Math.hypot(dx, dy);
    if (distance < radius + e.r) {
      damageEnemy(game, e, damage, false);
      if (freeze) applyFreeze(e, 0.5, 1.5);
      // Импульс идёт после урона и группирует только выживших. Боссы,
      // элиты и крупные цели сохраняют массу и сдвигаются заметно слабее.
      applyBlastPull(game, e, x, y, radius, allowPull);
    }
  }
  for (const a of game.entities.asteroids.slice()) {
    if ((a.x - x) ** 2 + (a.y - y) ** 2 < (radius + a.r) ** 2) {
      a.hp -= damage;
      a.flash = 0.1;
      if (a.hp <= 0) splitAsteroid(game, a);
    }
  }
  spark(game.fx, x, y, 14, color, 260, 0.5, 2.6);
  sfx.boom();
  camera.shake(3);
}

/** Взрыв врага: бьёт игрока. */
export function blastHostile(game, x, y, radius, damage, color) {
  blastRing(game.fx, x, y, radius, color);
  if ((game.player.x - x) ** 2 + (game.player.y - y) ** 2 < (radius + game.player.r) ** 2) {
    hurtPlayer(game, damage);
  }
  spark(game.fx, x, y, 16, color, 280, 0.55, 2.8);
  sfx.boom();
  camera.shake(6);
}

export function splitAsteroid(game, asteroid) {
  const list = game.entities.asteroids;
  const i = list.indexOf(asteroid);
  if (i < 0) return;
  list.splice(i, 1);

  spark(game.fx, asteroid.x, asteroid.y, 14, '#a08c6e', 200, 0.55, 2.2);
  sfx.boom();
  camera.shake(2);
  game.run.score += 5;
  fireHook(game, 'onAsteroidBreak', { asteroid });

  if (Math.random() < 0.35) {
    game.entities.pickups.push(makePickup(asteroid.x, asteroid.y, 'xp', 1));
  }
  if (asteroid.r > 26) {
    for (let k = 0; k < 2; k++) {
      const na = {
        ...asteroid,
        x: asteroid.x + rnd(16, -16),
        y: asteroid.y + rnd(16, -16),
        r: asteroid.r * 0.58,
        hp: asteroid.r * 0.58 * 1.5,
        maxHp: asteroid.r * 0.58 * 1.5,
        vx: asteroid.vx + rnd(90, -90),
        vy: asteroid.vy + rnd(90, -90),
        verts: asteroid.verts.slice(),
      };
      list.push(na);
    }
  }
}

/** continuous — урон в тик (луч босса): без i-frames и без тряски. */
export function hurtPlayer(game, amount, continuousOrOptions = false) {
  const p = game.player;
  const options = typeof continuousOrOptions === 'object'
    ? continuousOrOptions
    : { continuous: continuousOrOptions };
  const continuous = !!options.continuous;
  if (game.run.over) return;
  if (!options.bypassInvulnerability && (p.iframes > 0 || p.dashTime > 0)) return;

  // уклонение отменяет удар целиком, но не тикающий урон — иначе луч босса
  // превращался бы в лотерею вместо позиционной задачи
  const dodge = !continuous ? dodgeChance(p) : 0;
  if (dodge > 0 && Math.random() < dodge) {
    floatText(game.fx, p.x, p.y - 30, 'МИМО', '#7ee8ff');
    p.iframes = 0.2 * p.iframeMul;
    return;
  }
  if (!options.directHull) {
    amount *= armorFactor(p);
    if (p.effects.flags.guardWindow > 0) amount *= 0.5;               // «Страж»: окно после удара
    if (p.effects.flags.dampen && amount > p.hp * 0.5) amount /= 3;    // «Амортизатор»: срезает разовый нокаут
  }

  const shieldBefore = p.shield;
  if (!options.directHull && p.shield > 0 && !p.effects.flags.noShield) {
    const absorbed = Math.min(p.shield, amount);
    p.shield -= absorbed;
    amount -= absorbed;
    spark(game.fx, p.x, p.y, 6, '#7ee8ff', 200, 0.4, 2);
  }
  if (!options.directHull) p.shieldTimer = 3.2 * p.shieldDelayMul;
  if (!options.directHull && shieldBefore > 0 && p.shield <= 0 && p.effects.flags.shieldBreakNova) {
    blastFriendly(game, p.x, p.y, 100, 25 * p.effects.flags.shieldBreakNova * effectPower(p), '#7ee8ff');
  }
  if (amount <= 0) return;

  p.hp -= amount;
  const stats = counters(p);
  stats.damageTaken += amount;
  stats.killStreak = 0;              // серия рвётся любым попаданием
  clearStack(p, 'momentum');
  emit('player:hurt', { damage: amount });

  if (!continuous) {
    p.iframes = 0.6 * p.iframeMul;
    spark(game.fx, p.x, p.y, 12, '#ff6b8a', 240, 0.5, 2.2);
    sfx.hurt();
    camera.shake(9);
    if (p.nova) blastFriendly(game, p.x, p.y, 90 + p.nova * 40, 18 * p.nova * effectPower(p), '#7ee8ff');
    fireHook(game, 'onHurt', { damage: amount });
  } else if (!options.silent && Math.random() < 0.3) {
    sfx.hurt();
  }

  if (p.hp <= 0) {
    // «Второе дыхание»: раз в 20 сек оставляет 1 HP вместо гибели — до спаскапсулы
    if (p.effects.flags.secondWind && (p.effects.secondWindCd ?? 0) <= 0) {
      p.hp = 1;
      p.effects.secondWindCd = 20;
      floatText(game.fx, p.x, p.y - 40, 'ВТОРОЕ ДЫХАНИЕ', '#7ee8ff');
      sfx.levelUp();
      camera.shake(14);
      return;
    }
    // спаскапсула: один раз за забег поднимает с половиной корпуса
    if (p.effects.revives > 0) {
      p.effects.revives--;
      p.hp = p.maxHp * 0.5;
      p.shield = p.maxShield;
      p.iframes = 2.5;
      // Спаскапсула — аварийный одноразовый эффект, а не источник
      // повторяемого взрывного билда: «Коллапс» её не модифицирует.
      blastFriendly(game, p.x, p.y, 320, 60 * effectPower(p), '#5ef08a', { allowPull: false });
      floatText(game.fx, p.x, p.y - 40, 'СПАСКАПСУЛА', '#5ef08a');
      sfx.levelUp();
      camera.shake(18);
      return;
    }
    p.hp = 0;
    emit('run:over', { reason: 'destroyed' });
  }
}

/** Столкновения корабля с астероидами — тоже урон, поэтому живёт здесь. */
export function resolveAsteroidHits(game) {
  const p = game.player;
  for (const a of game.entities.asteroids) {
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const rr = p.r + a.r;
    if (dx * dx + dy * dy >= rr * rr) continue;

    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;
    hurtPlayer(game, 4 + a.r * 0.18);
    p.vx += nx * 240;
    p.vy += ny * 240;
    a.vx -= nx * 120;
    a.vy -= ny * 120;
    p.x = a.x + nx * rr;
    p.y = a.y + ny * rr;
    a.hp -= 18;
    if (a.hp <= 0) splitAsteroid(game, a);
  }
}

export function nearestEnemy(game, x, y, maxDist, except = null) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const e of game.entities.enemies) {
    if (e === except) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}
