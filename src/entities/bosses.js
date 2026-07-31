import { angLerp, angDiff, lerp, rnd, TAU, clamp } from '../core/math.js';
import { sfx } from '../core/audio.js';
import { camera } from '../core/camera.js';
import { emit } from '../core/events.js';
import { BOSSES, BOSS_HUNT_AFTER } from '../data/bosses.js';
import { makeEnemy } from './factory.js';
import { hurtPlayer, blastHostile } from '../systems/combat.js';
import { spawnFoeBullet } from './projectiles.js';
import { spark, blastRing, floatText } from './effects.js';
import { telegraph } from './telegraphs.js';
import { currentWeapon } from './player.js';

/**
 * ПОВЕДЕНИЕ БОССОВ.
 *
 * У каждого ТРИ фазы по порогам 100% → 60% → 30%. Фаза не множит числа —
 * она ДОБАВЛЯЕТ паттерн: то, что было в первой, продолжает работать.
 * Поэтому ветки атак проверяют `b.phase >= N`, а не `switch (b.phase)`.
 *
 * Каждая опасная атака сначала ставит телеграф (entities/telegraphs.js) на
 * ту же длительность, что и собственный таймер замаха — иначе подсветка
 * разъедется с ударом и сложность станет нечестной.
 *
 * Пока не истёк BOSS_HUNT_AFTER, босс держит дистанцию и не преследует:
 * игрок сам решает, лететь к нему за наградой за скорость или сперва
 * разгрести волну (см. data/bosses.js:bossSpeedReward).
 */

const MINION_LIMIT = 26;
const PRIME_RAM_DISTANCE = 900;
const PRIME_RAM_SPEED_MUL = 3.4;

/** Длительности замахов = длительности телеграфов. Одно число на обе стороны. */
const TELE = {
  volley: 0.7,      // веер «Дредноута»
  walls: 1.2,       // сходящиеся стены
  ram: 0.75,        // рывок «Дробильщика»
  rock: 0.9,        // брошенный астероид
  ringIn: 1.4,      // сжимающееся кольцо обломков
  zap: 0.8,         // цепной разряд «Проводника»
  grid: 1.0,        // сеть между узлами
  blink: 0.6,       // телепорт «Искажения»
  burst: 0.8,       // круговой залп «Ока»
  grave: 0.7,       // веер «Могильщика»
  brood: 1.0,       // выводок «Матки»
};

export function updateBoss(game, b, dt) {
  const p = game.player;
  const def = BOSSES[b.boss];

  b.age = (b.age ?? 0) + dt;

  // автовыход: не пришёл сам — босс идёт за игроком, награда за скорость сгорает
  if (!b.hunting && b.age > BOSS_HUNT_AFTER) {
    b.hunting = true;
    b.cameItself = true;
    emit('boss:hunting', { boss: b });
    sfx.alarm();
    camera.shake(12);
  }
  // игрок задел босса — он проснулся и дерётся всерьёз
  if (!b.hunting && b.hp < b.maxHp) b.hunting = true;

  const dx = p.x - b.x;
  const dy = p.y - b.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;
  const toPlayer = Math.atan2(dy, dx);

  advancePhase(game, b);

  b.angle = angLerp(b.angle, toPlayer, dt * 2.4);
  b.spin += dt * (b.boss === 'eye' ? 0.9 + 0.3 * b.phase : 1.1);
  b.wobble += dt;

  // до пробуждения босс патрулирует на месте: не бежит за игроком, но и
  // не стоит статуей — так его видно и можно осознанно решить лететь к нему
  if (!b.hunting) {
    b.vx = lerp(b.vx, Math.cos(b.wobble * 0.5) * b.speed * 0.3, dt);
    b.vy = lerp(b.vy, Math.sin(b.wobble * 0.5) * b.speed * 0.3, dt);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    return;
  }

  const approach = (want, agility = 1.6) => {
    const push = dist < want - 50 ? -1 : dist > want + 50 ? 1 : 0;
    const strafe = Math.sin(b.wobble * 0.6) * 0.5;
    b.vx = lerp(b.vx, (nx * push - ny * strafe) * b.speed, dt * agility);
    b.vy = lerp(b.vy, (ny * push + nx * strafe) * b.speed, dt * agility);
  };

  switch (b.boss) {
    case 'dread':      updateDread(game, b, def, dt, approach, toPlayer); break;
    case 'prime':      updatePrime(game, b, def, dt, nx, ny, dist, toPlayer); break;
    case 'eye':        updateEye(game, b, def, dt, approach, dist, toPlayer); break;
    case 'gravedigger':updateGravedigger(game, b, def, dt, approach, toPlayer); break;
    case 'conduit':    updateConduit(game, b, def, dt, approach, toPlayer); break;
    case 'hive':       updateHive(game, b, def, dt, approach); break;
    case 'distortion': updateDistortion(game, b, def, dt, approach, toPlayer); break;
  }

  b.x += b.vx * dt;
  b.y += b.vy * dt;

  if (dist < b.r + p.r) {
    hurtPlayer(game, b.damage * (b.boss === 'prime' ? 1.5 : 1));
    p.vx += nx * 420;
    p.vy += ny * 420;
    b.vx *= 0.3;
    b.vy *= 0.3;
  }
}

/** Пороги фаз: 100% → 60% → 30%. Каждый переход слышно и видно. */
function advancePhase(game, b) {
  const ratio = b.hp / b.maxHp;
  const want = ratio <= 0.3 ? 3 : ratio <= 0.6 ? 2 : 1;
  if (want <= b.phase) return;
  b.phase = want;
  emit('boss:phase', { boss: b, phase: want });
  sfx.alarm();
  camera.shake(12);
  blastRing(game.fx, b.x, b.y, b.r * 3, BOSSES[b.boss].color);
  onPhaseEnter(game, b, want);
}

/** Разовые эффекты входа в фазу — то, что делается один раз, а не каждый тик. */
function onPhaseEnter(game, b, phase) {
  if (b.boss === 'gravedigger' && phase === 1) return;
  if (b.boss === 'hive' && phase === 3 && !b.didSplit) {
    b.didSplit = true;
    splitHive(game, b);
  }
  if (b.boss === 'distortion' && phase === 3 && !b.didClone) {
    b.didClone = true;
    spawnClone(game, b);
  }
}

// ─────────────────────────────── ДРЕДНОУТ (открытый космос)
// Ф1 веера · Ф2 + высадка дронов · Ф3 + сходящиеся стены

function updateDread(game, b, def, dt, approach, toPlayer) {
  approach(360);

  b.cd -= dt;
  if (b.cd <= 0 && !b.charging) {
    b.charging = true;
    b.cd = TELE.volley;
    const arc = b.phase >= 2 ? 1.9 : 1.2;
    telegraph(game, { kind: 'cone', x: b.x, y: b.y, r: 620, angle: toPlayer, arc, life: TELE.volley, color: def.color });
  } else if (b.charging && b.cd <= 0) {
    b.charging = false;
    b.cd = b.phase >= 2 ? 1.5 : 2.2;
    const n = b.phase >= 2 ? 15 : 9;
    const arc = b.phase >= 2 ? 1.9 : 1.2;
    for (let i = 0; i < n; i++) {
      spawnFoeBullet(game, b, toPlayer + (i / (n - 1) - 0.5) * arc, 380, b.damage * 0.45, def.color);
    }
    sfx.enemyShot();
  }

  if (b.phase >= 2) {
    b.cd2 -= dt;
    if (b.cd2 <= 0) {
      b.cd2 = b.phase >= 3 ? 5 : 7.5;
      for (let i = 0; i < (b.phase >= 3 ? 4 : 3); i++) spawnMinion(game, b, 'drone');
    }
  }

  // Ф3: две стены снарядов сходятся к игроку с боков — безопасный коридор
  // остаётся вдоль линии босс↔игрок, поэтому уходить надо вперёд/назад
  if (b.phase >= 3) {
    b.cd3 -= dt;
    if (b.cd3 <= 0 && !b.wallCharge) {
      b.wallCharge = true;
      b.cd3 = TELE.walls;
      b.wallAngle = toPlayer;
      const side = b.wallAngle + Math.PI / 2;
      for (const s of [1, -1]) {
        const ox = Math.cos(side) * 420 * s;
        const oy = Math.sin(side) * 420 * s;
        telegraph(game, {
          kind: 'line', width: 46, life: TELE.walls, color: '#ff3b6b',
          x1: b.x + ox - Math.cos(b.wallAngle) * 500, y1: b.y + oy - Math.sin(b.wallAngle) * 500,
          x2: b.x + ox + Math.cos(b.wallAngle) * 500, y2: b.y + oy + Math.sin(b.wallAngle) * 500,
        });
      }
    } else if (b.wallCharge && b.cd3 <= 0) {
      b.wallCharge = false;
      b.cd3 = 9;
      const side = b.wallAngle + Math.PI / 2;
      for (const s of [1, -1]) {
        for (let i = -5; i <= 5; i++) {
          const from = {
            x: b.x + Math.cos(side) * 420 * s + Math.cos(b.wallAngle) * i * 90,
            y: b.y + Math.sin(side) * 420 * s + Math.sin(b.wallAngle) * i * 90,
            r: 6,
          };
          spawnFoeBullet(game, from, side - Math.PI / 2 * s, 210, b.damage * 0.5, '#ff3b6b', 5);
        }
      }
      sfx.bigBoom();
      camera.shake(9);
    }
  }
}

// ─────────────────────────────── ДРОБИЛЬЩИК-ПРАЙМ (пояс)
// Ф1 таран с телеграфом · Ф2 + метает астероиды · Ф3 + кольцо обломков

function updatePrime(game, b, def, dt, nx, ny, dist, toPlayer) {
  b.cd -= dt;
  if (b.ramDash > 0) {
    b.ramDash = Math.max(0, b.ramDash - dt);
    b.vx = b.ramNx * b.speed * PRIME_RAM_SPEED_MUL;
    b.vy = b.ramNy * b.speed * PRIME_RAM_SPEED_MUL;
  } else if (b.charge > 0) {
    b.charge -= dt;
    b.vx *= 0.995;
    b.vy *= 0.995;
    if (b.charge <= 0) {
      b.ramDash = PRIME_RAM_DISTANCE / (b.speed * PRIME_RAM_SPEED_MUL);
      b.vx = b.ramNx * b.speed * PRIME_RAM_SPEED_MUL;
      b.vy = b.ramNy * b.speed * PRIME_RAM_SPEED_MUL;
      sfx.boom();
      camera.shake(7);
    }
  } else if (b.cd <= 0) {
    b.cd = b.phase >= 2 ? 2.1 : 2.9;
    b.charge = TELE.ram;
    b.ramAngle = toPlayer;
    b.ramNx = Math.cos(b.ramAngle);
    b.ramNy = Math.sin(b.ramAngle);
    b.vx *= 0.25;
    b.vy *= 0.25;
    // коридор рывка виден заранее — уходить надо вбок
    telegraph(game, {
      kind: 'line', width: b.r * 1.8, life: TELE.ram, color: def.color,
      x1: b.x, y1: b.y,
      x2: b.x + b.ramNx * PRIME_RAM_DISTANCE, y2: b.y + b.ramNy * PRIME_RAM_DISTANCE,
    });
  } else {
    b.vx = lerp(b.vx, nx * b.speed * 0.5, dt * 1.4);
    b.vy = lerp(b.vy, ny * b.speed * 0.5, dt * 1.4);
  }

  // мины из обломков — были у него всегда, остаются фоном
  b.cd2 -= dt;
  if (b.cd2 <= 0) {
    b.cd2 = b.phase >= 2 ? 0.55 : 0.9;
    const m = makeEnemy(b.x + rnd(60, -60), b.y + rnd(60, -60), 'mine', 1.6);
    m.hp = m.maxHp = 26;
    m.fromWave = true;
    game.entities.enemies.push(m);
  }

  // Ф2: швыряет астероид в предсказанную точку — зона прилёта подсвечена
  if (b.phase >= 2) {
    b.cd3 -= dt;
    if (b.cd3 <= 0 && !b.rockAt) {
      b.cd3 = TELE.rock;
      b.rockAt = { x: game.player.x, y: game.player.y };
      telegraph(game, { kind: 'circle', x: b.rockAt.x, y: b.rockAt.y, r: 150, life: TELE.rock, color: '#c9955a' });
    } else if (b.rockAt && b.cd3 <= 0) {
      blastHostile(game, b.rockAt.x, b.rockAt.y, 150, b.damage * 1.1, '#c9955a');
      b.rockAt = null;
      b.cd3 = b.phase >= 3 ? 3.4 : 4.6;
    }
  }

  // Ф3: кольцо обломков сжимается — безопасен только центр, к нему и надо идти
  if (b.phase >= 3) {
    b.cd4 = (b.cd4 ?? 6) - dt;
    if (b.cd4 <= 0 && !b.ringCharge) {
      b.ringCharge = true;
      b.cd4 = TELE.ringIn;
      b.ringAt = { x: game.player.x, y: game.player.y };
      telegraph(game, { kind: 'ring', x: b.ringAt.x, y: b.ringAt.y, r: 520, r2: 120, life: TELE.ringIn, color: '#ffb14a' });
    } else if (b.ringCharge && b.cd4 <= 0) {
      b.ringCharge = false;
      b.cd4 = 11;
      const n = 26;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const from = { x: b.ringAt.x + Math.cos(a) * 520, y: b.ringAt.y + Math.sin(a) * 520, r: 6 };
        spawnFoeBullet(game, from, a + Math.PI, 260, b.damage * 0.45, '#ffb14a', 5);
      }
      sfx.bigBoom();
      camera.shake(10);
    }
  }
}

// ─────────────────────────────── ОКО (туманность)
// Ф1 вращающийся луч · Ф2 + луч раздваивается · Ф3 + невидимость между атаками

function updateEye(game, b, def, dt, approach, dist, toPlayer) {
  approach(430, 1.0);
  b.beamAngle = b.spin;

  // Ф3: между залпами Око пропадает — луча нет, но и попасть в него нельзя
  if (b.phase >= 3) {
    b.hideTimer = (b.hideTimer ?? 0) - dt;
    if (b.hideTimer <= 0) {
      b.hidden = !b.hidden;
      b.hideTimer = b.hidden ? 1.6 : 3.2;
      if (b.hidden) spark(game.fx, b.x, b.y, 18, def.color, 260, 0.5, 2.4);
    }
  } else {
    b.hidden = false;
  }

  if (!b.hidden) {
    // луч жжёт всё в узком секторе — урон идёт в тик
    const beams = b.phase >= 2 ? [0, Math.PI] : [0];
    for (const off of beams) {
      if (Math.abs(angDiff(b.beamAngle + off, toPlayer)) < 0.13 && dist < 1200) {
        hurtPlayer(game, b.damage * 1.4 * dt * 6, true);
        spark(game.fx, game.player.x, game.player.y, 1, def.color, 120, 0.25, 2);
      }
    }

    // круговой залп: сам луч виден заранее, но всплеск по кругу — нет,
    // поэтому перед ним кольцо вокруг Ока успевает вспыхнуть
    b.cd -= dt;
    if (b.cd <= 0 && !b.bursting) {
      b.bursting = true;
      b.cd = TELE.burst;
      telegraph(game, { kind: 'ring', x: b.x, y: b.y, r: 260, r2: b.r, life: TELE.burst, color: def.color });
    } else if (b.bursting && b.cd <= 0) {
      b.bursting = false;
      b.cd = b.phase >= 2 ? 2.2 : 3.2;
      const n = b.phase >= 2 ? 22 : 14;
      for (let i = 0; i < n; i++) {
        spawnFoeBullet(game, b, (i / n) * TAU + b.spin, 260, b.damage * 0.4, def.color);
      }
    }
  }

  if (b.phase >= 2) {
    b.cd2 -= dt;
    if (b.cd2 <= 0) {
      b.cd2 = 5;
      for (let i = 0; i < 2; i++) spawnMinion(game, b, 'sniper');
    }
  }
}

// ─────────────────────────────── МОГИЛЬЩИК (кладбище)
// Ф1 щит из обломков · Ф2 + собирает мёртвых · Ф3 + взрыв щита при потере

const GRAVE_SHIELD = 0.22; // доля maxHp, которую держит щит

function updateGravedigger(game, b, def, dt, approach, toPlayer) {
  approach(330, 1.3);

  // Ф1: поднимает обломки в щит. Щит гасится первым (см. systems/combat.js),
  // поэтому пока он цел, корпус не трогается — надо сбивать щит.
  b.shieldMax ??= b.maxHp * GRAVE_SHIELD;
  b.cd -= dt;
  if (b.cd <= 0) {
    b.cd = b.phase >= 2 ? 7 : 10;
    if ((b.shield ?? 0) <= 0) {
      b.shield = b.shieldMax;
      b.shieldSpin = 0;
      floatText(game.fx, b.x, b.y - b.r - 12, 'ЩИТ ПОДНЯТ', def.color);
      sfx.confirm();
    }
  }
  b.shieldSpin = (b.shieldSpin ?? 0) + dt * 1.6;

  // Ф3: потеря щита рвёт обломки по площади — не стой в упор, когда добиваешь
  if (b.phase >= 3 && b.shieldWasUp && (b.shield ?? 0) <= 0) {
    blastHostile(game, b.x, b.y, 260, b.damage * 1.6, def.color);
    sfx.bigBoom();
    camera.shake(14);
  }
  b.shieldWasUp = (b.shield ?? 0) > 0;

  b.cd2 -= dt;
  if (b.cd2 <= 0 && !b.graveCharge) {
    b.graveCharge = true;
    b.cd2 = TELE.grave;
    b.graveAngle = toPlayer;
    telegraph(game, { kind: 'cone', x: b.x, y: b.y, r: 560, angle: toPlayer, arc: 0.75, life: TELE.grave, color: def.color });
  } else if (b.graveCharge && b.cd2 <= 0) {
    b.graveCharge = false;
    b.cd2 = 2.6;
    for (let i = -1; i <= 1; i++) {
      spawnFoeBullet(game, b, b.graveAngle + i * 0.26, 330, b.damage * 0.5, def.color);
    }
    sfx.enemyShot();
  }

  // Ф2: собирает павших — поднимает свиту из обломков
  if (b.phase >= 2) {
    b.cd3 -= dt;
    if (b.cd3 <= 0) {
      b.cd3 = 6;
      for (let i = 0; i < 3; i++) spawnMinion(game, b, Math.random() < 0.5 ? 'drone' : 'gunner');
      floatText(game.fx, b.x, b.y - b.r - 12, 'ПОДЪЁМ', def.color);
    }
  }
}

// ─────────────────────────────── ПРОВОДНИК (ионный шторм)
// Ф1 цепные разряды · Ф2 + узлы-ретрансляторы · Ф3 + сеть между узлами жжёт

function updateConduit(game, b, def, dt, approach, toPlayer) {
  approach(400, 1.2);
  b.nodes ??= [];

  // Ф1: разряд бьёт в точку, где игрок был секунду назад
  b.cd -= dt;
  if (b.cd <= 0 && !b.zapAt) {
    b.cd = TELE.zap;
    b.zapAt = { x: game.player.x, y: game.player.y };
    telegraph(game, { kind: 'circle', x: b.zapAt.x, y: b.zapAt.y, r: 130, life: TELE.zap, color: def.color });
  } else if (b.zapAt && b.cd <= 0) {
    blastHostile(game, b.zapAt.x, b.zapAt.y, 130, b.damage * 1.2, def.color);
    game.fx.beams.push({ x1: b.x, y1: b.y, x2: b.zapAt.x, y2: b.zapAt.y, color: def.color, width: 3, life: 0.18, max: 0.18 });
    b.zapAt = null;
    b.cd = b.phase >= 2 ? 2.2 : 3;
  }

  // Ф2: ставит узлы по арене
  if (b.phase >= 2) {
    b.cd2 -= dt;
    if (b.cd2 <= 0 && b.nodes.length < 4) {
      b.cd2 = 4;
      const a = rnd(TAU);
      b.nodes.push({ x: b.x + Math.cos(a) * 420, y: b.y + Math.sin(a) * 420, life: 16 });
      sfx.confirm();
    }
    for (let i = b.nodes.length - 1; i >= 0; i--) {
      b.nodes[i].life -= dt;
      if (b.nodes[i].life <= 0) b.nodes.splice(i, 1);
    }
  }

  // Ф3: линии между узлами превращаются в живую сеть — стоять на них нельзя
  if (b.phase >= 3 && b.nodes.length >= 2) {
    b.cd3 -= dt;
    if (b.cd3 <= 0 && !b.gridHot) {
      b.gridHot = true;
      b.cd3 = TELE.grid;
      for (let i = 0; i < b.nodes.length; i++) {
        const n1 = b.nodes[i];
        const n2 = b.nodes[(i + 1) % b.nodes.length];
        telegraph(game, { kind: 'line', width: 26, life: TELE.grid, color: def.color, x1: n1.x, y1: n1.y, x2: n2.x, y2: n2.y });
      }
    } else if (b.gridHot && b.cd3 <= 0) {
      b.gridActive = 1.6;
      b.gridHot = false;
      b.cd3 = 7;
    }
  }
  if (b.gridActive > 0) {
    b.gridActive -= dt;
    const p = game.player;
    for (let i = 0; i < b.nodes.length; i++) {
      const n1 = b.nodes[i];
      const n2 = b.nodes[(i + 1) % b.nodes.length];
      game.fx.beams.push({ x1: n1.x, y1: n1.y, x2: n2.x, y2: n2.y, color: def.color, width: 2, life: 0.06, max: 0.06 });
      if (distToSegment(p.x, p.y, n1.x, n1.y, n2.x, n2.y) < 26 + p.r) {
        hurtPlayer(game, b.damage * dt * 5, true);
      }
    }
  }
}

/** Расстояние от точки до отрезка — для «сети» Проводника. */
function distToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy || 1;
  const t = clamp(((px - x1) * vx + (py - y1) * vy) / len2, 0, 1);
  return Math.hypot(px - (x1 + vx * t), py - (y1 + vy * t));
}

// ─────────────────────────────── МАТКА РОЯ (гнездо)
// Ф1 спираль · Ф2 + непрерывный спавн · Ф3 + делится на три

function updateHive(game, b, def, dt, approach) {
  approach(300, 1.2);

  b.cd -= dt;
  if (b.cd <= 0) {
    b.cd = b.phase >= 2 ? 0.12 : 0.18;
    const arms = b.phase >= 2 ? 3 : 2;
    for (let i = 0; i < arms; i++) {
      spawnFoeBullet(game, b, b.spin * 2.2 + (i / arms) * TAU, 300, b.damage * 0.35, def.color);
    }
  }

  // выводок вылезает не молча: зона вокруг Матки вспыхивает заранее,
  // чтобы игрок успел отойти и не оказаться в кольце личинок в упор
  if (b.phase >= 2) {
    b.cd2 -= dt;
    if (b.cd2 <= 0 && !b.brooding) {
      b.brooding = true;
      b.cd2 = TELE.brood;
      telegraph(game, { kind: 'circle', x: b.x, y: b.y, r: b.r * 3, life: TELE.brood, color: def.color });
    } else if (b.brooding && b.cd2 <= 0) {
      b.brooding = false;
      b.cd2 = b.phase >= 3 ? 3 : 4.5;
      for (let i = 0; i < (b.phase >= 3 ? 5 : 3); i++) {
        spawnMinion(game, b, Math.random() < 0.5 ? 'larva' : 'drone');
      }
      sfx.alarm();
    }
  }
}

/**
 * Ф3 «делится на три»: сама Матка остаётся боссом (её полоса HP и логика
 * смерти забега на ней), а две отделившиеся части выходят элитной свитой
 * с куском её HP. Делать их полноценными боссами нельзя: полоса босса в HUD
 * и событие boss:killed рассчитаны ровно на одного.
 */
function splitHive(game, b) {
  for (const s of [1, -1]) {
    const e = makeEnemy(b.x + s * 90, b.y + rnd(40, -40), 'splitter', 1);
    e.hp = e.maxHp = Math.round(b.maxHp * 0.12);
    e.damage = b.damage * 0.7;
    e.r *= 1.8;
    e.elite = true;
    e.scrap *= 4;
    e.xp *= 3;
    e.fromWave = true;
    e.minion = true;
    game.entities.enemies.push(e);
  }
  floatText(game.fx, b.x, b.y - b.r - 14, 'РАЗДЕЛЕНИЕ', BOSSES.hive.color);
  sfx.bigBoom();
  camera.shake(18);
}

// ─────────────────────────────── ИСКАЖЕНИЕ (разлом)
// Ф1 зеркалит ствол · Ф2 + телепорты · Ф3 + копия игрока

function updateDistortion(game, b, def, dt, approach, toPlayer) {
  approach(340, 1.4);

  // Ф1: стреляет тем же стволом, что держит игрок — темп и калибр берутся
  // из его оружия, поэтому бой ощущается как дуэль с собственным билдом
  b.cd -= dt;
  if (b.cd <= 0) {
    const w = currentWeapon(game.player);
    b.cd = Math.max(0.22, (w.rate ?? 0.5) * 1.6);
    const count = Math.min(5, w.count ?? 1);
    for (let i = 0; i < count; i++) {
      const off = count === 1 ? 0 : (i - (count - 1) / 2) * (w.spread || 0.12) * 2;
      spawnFoeBullet(game, b, toPlayer + off, 400, b.damage * 0.5, def.color);
    }
    sfx.enemyShot();
  }

  // Ф2: телепорты по площади — перед прыжком видно, куда именно
  if (b.phase >= 2) {
    b.cd2 -= dt;
    if (b.cd2 <= 0 && !b.blinkTo) {
      b.cd2 = TELE.blink;
      const a = rnd(TAU);
      b.blinkTo = { x: game.player.x + Math.cos(a) * 320, y: game.player.y + Math.sin(a) * 320 };
      telegraph(game, { kind: 'circle', x: b.blinkTo.x, y: b.blinkTo.y, r: b.r * 1.6, life: TELE.blink, color: def.color });
    } else if (b.blinkTo && b.cd2 <= 0) {
      spark(game.fx, b.x, b.y, 16, def.color, 240, 0.5, 2.4);
      b.x = b.blinkTo.x;
      b.y = b.blinkTo.y;
      b.blinkTo = null;
      b.cd2 = b.phase >= 3 ? 3.4 : 5;
      spark(game.fx, b.x, b.y, 16, def.color, 240, 0.5, 2.4);
      sfx.dash();
    }
  }
}

/**
 * Ф3 «копия тебя с твоим билдом»: клон берёт текущее оружие игрока и его
 * порядок величины урона. Полноценный дубль игрока (со всеми перками и
 * активками) сделать нельзя — перки живут хуками на самом игроке, а не
 * данными, поэтому копируется то, что читаемо в бою: ствол, темп, скорость.
 */
function spawnClone(game, b) {
  const p = game.player;
  const a = rnd(TAU);
  const e = makeEnemy(p.x + Math.cos(a) * 420, p.y + Math.sin(a) * 420, 'weaver', 1);
  e.clone = true;
  e.cloneWeapon = p.weapon;
  e.hp = e.maxHp = Math.round(b.maxHp * 0.1);
  e.damage = b.damage * 0.8;
  e.speed = p.maxSpeed * 0.85;
  e.r = p.r * 1.3;
  e.color = '#dff0ff';
  e.elite = true;
  e.scrap *= 5;
  e.xp *= 4;
  e.fromWave = b.fromWave;
  e.source = b.source;
  e.encounterId = b.encounterId;
  e.minion = true;
  game.entities.enemies.push(e);
  floatText(game.fx, e.x, e.y - 30, 'ТВОЯ КОПИЯ', '#dff0ff');
  sfx.alarm();
  camera.shake(16);
}

function spawnMinion(game, boss, type) {
  const minions = game.entities.enemies.filter((e) => !e.boss).length;
  if (minions > MINION_LIMIT) return;
  const a = rnd(TAU);
  const e = makeEnemy(
    boss.x + Math.cos(a) * (boss.r + 20),
    boss.y + Math.sin(a) * (boss.r + 20),
    type,
    game.run.difficulty * 0.9,
  );
  e.vx = Math.cos(a) * 160;
  e.vy = Math.sin(a) * 160;
  e.fromWave = boss.fromWave;
  e.source = boss.source;
  e.encounterId = boss.encounterId;
  e.minion = true;
  game.entities.enemies.push(e);
}

export const activeBoss = (game) => game.entities.enemies.find((e) => e.boss) || null;
