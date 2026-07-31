import { emit } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { unlockWeapon, WEAPON_SLOT_MAX } from '../entities/player.js';
import { WEAPON_ORDER, getWeapon } from '../data/weapons.js';
import { SHIP_ORDER, SHIPS } from '../data/ships.js';
import { startWave, BOSS_EVERY } from '../systems/waves.js';
import { meta } from '../systems/meta.js';
import { onPress } from '../core/input.js';

/**
 * ТЕСТОВЫЙ РЕЖИМ.
 *
 * Не игровая механика — инструмент разработки. Раздача карточек случайна
 * (см. systems/progression.js: конкретный ствол — это ~2% шанс на одну
 * карточку из трёх при зачистке волны), поэтому ждать нужный ствол через
 * обычную игру можно очень долго. Здесь любой ствол/корабль выдаётся
 * по клику, мир при этом не останавливается — сразу видно, как оно стреляет.
 *
 * Открывается клавишей ` (backtick). Никак не влияет на баланс и сохранение,
 * кроме прямых действий кнопок (обломки/опыт/ремонт — то, что нажали).
 */

let panel;
let startRun;

export function initDevPanel(game, handlers) {
  panel = document.getElementById('dev-panel');
  startRun = handlers.startRun;

  buildWeaponButtons(game);
  buildShipButtons(game);
  wireUtilityButtons(game);

  onPress('backquote', () => {
    if (panel.hidden) {
      refreshActiveStates(game);
      panel.hidden = false;
    } else {
      panel.hidden = true;
    }
  });
}

function buildWeaponButtons(game) {
  const box = document.getElementById('dev-weapons');
  box.innerHTML = '';
  for (const id of WEAPON_ORDER) {
    const w = getWeapon(id);
    const btn = document.createElement('button');
    btn.className = 'dev-btn';
    btn.dataset.weapon = id;
    btn.textContent = `${w.icon} ${w.name}`;
    btn.onclick = () => {
      if (!game.player) return;
      const p = game.player;
      const replaceId = !p.weapons.includes(id) && p.weapons.length >= WEAPON_SLOT_MAX
        ? (p.weapons.includes(p.weapon) ? p.weapon : p.weapons[0])
        : undefined;
      const granted = unlockWeapon(p, id, replaceId);
      if (granted) sfx.confirm();
      refreshActiveStates(game);
    };
    box.appendChild(btn);
  }
}

function buildShipButtons(game) {
  const box = document.getElementById('dev-ships');
  box.innerHTML = '';
  for (const id of SHIP_ORDER) {
    const ship = SHIPS[id];
    const btn = document.createElement('button');
    btn.className = 'dev-btn';
    btn.dataset.ship = id;
    btn.textContent = `${ship.icon} ${ship.name}`;
    btn.onclick = () => {
      // тестовый режим: корабль выдаётся и выбирается без учёта цены/владения
      if (!meta.save.ships.includes(id)) meta.save.ships.push(id);
      meta.selectShip(id);
      sfx.confirm();
      startRun();
      refreshActiveStates(game);
    };
    box.appendChild(btn);
  }
}

function wireUtilityButtons(game) {
  document.querySelectorAll('.dev-btn[data-action]').forEach((btn) => {
    btn.onclick = () => {
      const p = game.player;
      if (!p) return;
      switch (btn.dataset.action) {
        case 'scrap':
          meta.save.scrap += 5000;
          meta.persist();
          break;
        case 'xp':
          emit('xp:gain', { amount: 1000 });
          break;
        case 'boss': {
          const next = (Math.floor(game.run.wave / BOSS_EVERY) + 1) * BOSS_EVERY;
          startWave(game, next);
          break;
        }
        case 'heal':
          p.hp = p.maxHp;
          p.shield = p.maxShield;
          break;
      }
      sfx.confirm();
    };
  });
}

/** Подсвечивает уже открытые стволы/текущий корабль — видно, что уже пробовано. */
function refreshActiveStates(game) {
  const p = game.player;
  for (const btn of document.querySelectorAll('#dev-weapons .dev-btn')) {
    const id = btn.dataset.weapon;
    btn.classList.toggle('active', p?.weapon === id);
    btn.classList.toggle('owned', !!p?.weapons.includes(id) && p.weapon !== id);
  }
  for (const btn of document.querySelectorAll('#dev-ships .dev-btn')) {
    btn.classList.toggle('active', meta.save.ship === btn.dataset.ship);
  }
}
