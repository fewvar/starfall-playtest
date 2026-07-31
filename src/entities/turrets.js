import { nearestEnemy } from '../systems/combat.js';
import { sfx } from '../core/audio.js';

/**
 * Турели ствола «Сеялка»: стационарные, автонаводящиеся, живут ограниченное
 * время. Не разрушаются вражеским огнём — враги в этой игре целятся только
 * в игрока, поэтому HP у турели не было бы смысла (как и у мин на рывке).
 */
const MAX_TURRETS = 3;

export function createTurretState() {
  return { turrets: [] };
}

/** Разместить турель на месте игрока. Лишняя старая уступает место новой.
 * homing > 0 — ЭВОЛЮЦИЯ «Улей»: турели стреляют самонаводящимися ракетами. */
export function placeTurret(game, { life, range, damage, rate, color, homing = 0 }) {
  const list = game.turrets;
  if (list.length >= MAX_TURRETS) list.shift();
  const p = game.player;
  list.push({ x: p.x, y: p.y, life, maxLife: life, range, damage, rate, cd: 0, color, homing });
  sfx.confirm();
}

export function updateTurrets(game, dt) {
  const list = game.turrets;
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    t.life -= dt;
    if (t.life <= 0) { list.splice(i, 1); continue; }

    t.cd -= dt;
    if (t.cd > 0) continue;

    const target = nearestEnemy(game, t.x, t.y, t.range);
    if (!target) { t.cd = 0.2; continue; }

    t.cd = t.rate;
    const angle = Math.atan2(target.y - t.y, target.x - t.x);
    game.projectiles.bullets.push({
      x: t.x, y: t.y,
      vx: Math.cos(angle) * 640, vy: Math.sin(angle) * 640,
      angle, damage: t.damage, crit: false, life: 0.9,
      pierce: 0, hit: new Set(), homing: t.homing, ricochet: 0, splash: 0,
      kind: t.homing > 0 ? 'missile' : 'bullet', color: t.color, r: t.homing > 0 ? 5 : 3,
    });
    sfx.droneShot();
  }
}

export function clearTurrets(game) {
  game.turrets.length = 0;
}
