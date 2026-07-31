import { emit } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { floatText } from './effects.js';
import { fireHook, counters } from '../systems/effects.js';
import { healingBlocked } from '../systems/location-policy.js';

/**
 * Лут: опыт, аптечки, обломки. Притягивается коллектором игрока.
 * Потолок нужен, потому что несобранный лут в поздних волнах копится сотнями
 * и его отрисовка со свечением съедает кадры.
 */
const MAX_PICKUPS = 320;
const LIFETIME = 45;

export function updatePickups(game, dt) {
  const p = game.player;
  const list = game.entities.pickups;

  // самый старый лут исчезает первым
  if (list.length > MAX_PICKUPS) list.splice(0, list.length - MAX_PICKUPS);

  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i];
    item.age += dt;

    const dx = p.x - item.x;
    const dy = p.y - item.y;
    const d = Math.hypot(dx, dy) || 1;

    if (d < p.magnet) {
      const pull = (1 - d / p.magnet) * 1400;
      item.vx += (dx / d) * pull * dt;
      item.vy += (dy / d) * pull * dt;
    }
    item.vx *= 0.97;
    item.vy *= 0.97;
    item.x += item.vx * dt;
    item.y += item.vy * dt;

    if (d < p.r + item.r + 4) {
      collect(game, item);
      list.splice(i, 1);
      continue;
    }
    if (item.age > LIFETIME) list.splice(i, 1);
  }
}

function collect(game, item) {
  const p = game.player;
  switch (item.kind) {
    case 'xp':
      emit('xp:gain', { amount: item.value });
      game.run.score += item.value;
      sfx.pickup();
      break;
    case 'hp':
      // «Кровавый пакт» запрещает лечение любым источником, кроме убийств
      if (!healingBlocked(game)) {
        p.hp = Math.min(p.maxHp, p.hp + item.value);
        floatText(game.fx, p.x, p.y - 24, '+' + item.value, '#5ef08a');
      }
      sfx.pickup();
      break;
    case 'scrap':
      counters(p).scrapCollected += item.value;
      emit('scrap:gain', { amount: item.value });
      sfx.scrap();
      break;
  }
  fireHook(game, 'onPickup', { kind: item.kind, value: item.value });
}
