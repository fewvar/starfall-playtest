import { angLerp, lerp, rnd, TAU } from '../core/math.js';
import { hurtPlayer, killEnemy, splitAsteroid } from '../systems/combat.js';
import { shootAtPlayer, spawnFoeBullet } from './projectiles.js';
import { updateBoss } from './bosses.js';
import { getWeapon } from '../data/weapons.js';

/**
 * Поведение обычных врагов. Тип поведения берётся из поля ai (data/enemies.js):
 *   chase        — прёт в лоб
 *   keepDistance — держит дистанцию want и стрейфит
 *   weave        — резкий зигзаг, стреляет очередями
 *   kamikaze     — разгоняется в игрока и детонирует
 *   mine         — ползёт, вблизи заводится и рвётся
 *
 * special (data/enemies.js) — уникальное поведение локационных врагов
 * (этап 4), накладывается поверх обычного ai, а не вместо него:
 *   crusher     — крошит астероиды, в которые упирается
 *   phantom     — периодически мигает — телепорт рядом с игроком
 *   marauder    — рвётся к ближайшему лут-пикапу раньше игрока
 *   distortion  — короткие непредсказуемые телепорты чаще «Фантома»
 */

/** Ближайший пикап — используется «Мародёром», чтобы красть лут раньше игрока. */
function nearestPickup(game, x, y, maxDist) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const item of game.entities.pickups) {
    const d = (item.x - x) ** 2 + (item.y - y) ** 2;
    if (d < bestD) { bestD = d; best = item; }
  }
  return best;
}

export function updateEnemies(game, baseDt) {
  const p = game.player;
  const fx = p.effects;

  // Стазис и ледяное поле замедляют врагов, «Спешка» — ускоряет.
  const globalScale = fx.enemyTimeScale * (1 + (fx.flags.fastEnemies ?? 0));

  for (const e of game.entities.enemies.slice()) {
    let dt = baseDt * globalScale;
    let statusScale = 1;
    if (e.freezeUntil > 0) {
      statusScale = Math.min(statusScale, e.freezeFactor ?? 1);
      e.freezeUntil = Math.max(0, e.freezeUntil - baseDt);
      if (e.freezeUntil === 0) e.freezeFactor = 1;
    }
    if (e.slowUntil > 0) {
      statusScale = Math.min(statusScale, e.slowFactor ?? 1);
      e.slowUntil = Math.max(0, e.slowUntil - baseDt);
      if (e.slowUntil === 0) e.slowFactor = 1;
    }
    dt *= statusScale;
    if (e.distracted > 0) {
      // приманка перехватила внимание — враг не преследует игрока этот тик
      e.distracted -= baseDt;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.flash -= baseDt;
      continue;
    }

    e.flash -= dt;
    e.wobble += dt;

    if (e.boss) {
      updateBoss(game, e, dt);
      continue;
    }

    // «Дробильщик»: грызёт астероид, в который упёрся
    if (e.special === 'crusher') {
      for (const a of game.entities.asteroids) {
        if ((a.x - e.x) ** 2 + (a.y - e.y) ** 2 < (a.r + e.r) ** 2) {
          a.hp -= 70 * dt;
          a.flash = 0.1;
          if (a.hp <= 0) splitAsteroid(game, a);
          break;
        }
      }
    }

    // «Фантом»/«Искажение»: короткие непредсказуемые телепорты рядом с игроком
    if (e.special === 'phantom' || e.special === 'distortion') {
      e.teleportCd -= dt;
      if (e.teleportCd <= 0) {
        const short = e.special === 'distortion';
        e.teleportCd = short ? rnd(3, 1.5) : rnd(5, 3);
        const range = short ? 220 : 380;
        const a = rnd(TAU);
        e.x = p.x + Math.cos(a) * range;
        e.y = p.y + Math.sin(a) * range;
        e.flash = 0.3;
      }
    }

    // «Мародёр»: цель — ближайший лут, а не корабль игрока, пока лут ближе
    let tx = p.x;
    let ty = p.y;
    if (e.special === 'marauder') {
      const loot = nearestPickup(game, e.x, e.y, 460);
      if (loot) { tx = loot.x; ty = loot.y; }
    }

    const dx = tx - e.x;
    const dy = ty - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;

    if (e.ai === 'mine') {
      // Мина ползёт со скоростью 26 — если она заспавнилась в 1500 юнитах,
      // добираться ей почти минуту, и всю эту минуту волна не считается
      // зачищенной, а игрок не может никуда улететь. Поэтому вдалеке мина
      // подтягивается заметно быстрее и тормозит только у самой цели.
      const chase = d > 700 ? 7 : d > 350 ? 3 : 1;
      e.vx = lerp(e.vx, nx * e.speed * chase, dt * 0.8);
      e.vy = lerp(e.vy, ny * e.speed * chase, dt * 0.8);
      e.angle += dt * 1.4;
      if (d < 130) {
        e.fuse += dt;
        if (Math.floor(e.fuse * 9) % 2 === 0) e.flash = 0.05;
        if (e.fuse > 0.9) { killEnemy(game, e); continue; }
      } else {
        e.fuse = Math.max(0, e.fuse - dt);
      }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      continue;
    }

    if (e.ai === 'kamikaze') {
      e.vx = lerp(e.vx, nx * e.speed * 1.3, dt * 1.3);
      e.vy = lerp(e.vy, ny * e.speed * 1.3, dt * 1.3);
      e.angle = Math.atan2(e.vy, e.vx);
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (d < p.r + e.r + 6) killEnemy(game, e);
      continue;
    }

    const aggro = e.type === 'sniper' ? 900 : 780;

    if (d < aggro) {
      const push = d < e.want - 40 ? -1 : d > e.want + 40 ? 1 : 0;
      const strafe = e.ai === 'weave'
        ? Math.sin(e.wobble * 4.5) * 1.25
        : Math.sin(e.wobble * 0.8) * (e.want ? 0.55 : 0.15);
      const agility = e.ai === 'weave' ? 5.5 : 2.6;

      e.vx = lerp(e.vx, (nx * push - ny * strafe) * e.speed, dt * agility);
      e.vy = lerp(e.vy, (ny * push + nx * strafe) * e.speed, dt * agility);
      e.angle = angLerp(e.angle, Math.atan2(dy, dx), dt * (e.frontShield ? 2.2 : 5));

      if (e.fire > 0) {
        e.cd -= dt;
        if (e.cd <= 0 && d < aggro * 0.85) fireEnemyWeapon(game, e, dx, dy);
      }
    } else {
      // Вне радиуса агро враг не разбредается, а медленно сходится к игроку:
      // иначе последний недобитый улетает в пустоту и волну невозможно дозачистить.
      const closeIn = d > 1600 ? 0.9 : 0.45;
      const drift = Math.sin(e.wobble * 0.5) * 0.15;
      e.vx = lerp(e.vx, (nx * closeIn - ny * drift) * e.speed, dt * 1.2);
      e.vy = lerp(e.vy, (ny * closeIn + nx * drift) * e.speed, dt * 1.2);
      e.angle = angLerp(e.angle, Math.atan2(dy, dx), dt * 2);
    }

    e.x += e.vx * dt;
    e.y += e.vy * dt;

    // таран корпусом
    if (e.damage > 0 && (p.x - e.x) ** 2 + (p.y - e.y) ** 2 < (p.r + e.r) ** 2) {
      hurtPlayer(game, e.damage);
      e.vx = -nx * 190;
      e.vy = -ny * 190;
      p.vx += nx * 130;
      p.vy += ny * 130;
      // «Шипы»: столкновение калечит уже врага
      const ram = p.ramDamage + (e.type === 'drone' || e.type === 'weaver' ? 14 : 0);
      if (ram > 0) {
        e.hp -= ram;
        e.flash = 0.12;
        if (e.hp <= 0) killEnemy(game, e);
      }
    }
  }
}

function fireEnemyWeapon(game, e, dx, dy) {
  // «Твоя копия» (третья фаза ИСКАЖЕНИЯ) стреляет тем стволом, который был
  // у игрока в момент её появления — узнаваемо и читается как дуэль с собой
  if (e.clone && e.cloneWeapon) {
    const w = getWeapon(e.cloneWeapon);
    e.cd = Math.max(0.18, (w.rate ?? 0.5) * 1.3);
    const base = Math.atan2(dy, dx);
    const count = Math.min(5, w.count ?? 1);
    for (let i = 0; i < count; i++) {
      const off = count === 1 ? 0 : (i - (count - 1) / 2) * (w.spread || 0.12) * 2;
      spawnFoeBullet(game, e, base + off, 460, e.damage * 0.5, w.color);
    }
    return;
  }

  switch (e.type) {
    case 'weaver': {
      // короткая очередь из трёх
      e.burst = e.burst > 0 ? e.burst - 1 : 2;
      e.cd = e.burst > 0 ? 0.11 : e.fire;
      shootAtPlayer(game, e, 480, e.damage * 0.55, e.color);
      break;
    }
    case 'sniper':
      e.cd = e.fire;
      shootAtPlayer(game, e, 620, e.damage * 1.4, '#c99bff');
      break;
    case 'brute':
      e.cd = e.fire;
      for (let k = 0; k < 3; k++) shootAtPlayer(game, e, 330, e.damage * 0.6, '#ff8a8a');
      break;
    case 'warden': {
      e.cd = e.fire;
      const base = Math.atan2(dy, dx);
      for (let k = -1; k <= 1; k++) spawnFoeBullet(game, e, base + k * 0.22, 360, e.damage * 0.5, e.color);
      break;
    }
    case 'splitter':
      e.cd = e.fire;
      shootAtPlayer(game, e, 380, e.damage * 0.7, e.color);
      break;
    default:
      e.cd = e.fire;
      shootAtPlayer(game, e, 400, e.damage, '#ffd08a');
  }
}
