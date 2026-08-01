import { fmt } from '../core/math.js';
import { sfx } from '../core/audio.js';
import { meta } from '../systems/meta.js';
import { HANGAR } from '../data/hangar.js';
import { SHIPS, SHIP_ORDER } from '../data/ships.js';
import { getWeapon } from '../data/weapons.js';
import { RARITY, PERKS } from '../data/perks.js';
import { getLocation } from '../data/locations.js';
import { discoverContent } from '../systems/bestiary.js';
import { decorateTerms, hideTermTooltip, initTermTooltips } from './terms.js';

/** Все карточки-разблокировки активок, в порядке появления в каталоге. */
const ABILITY_CARDS = PERKS.filter((c) => c.hangarLocked);

/**
 * Все полноэкранные окна: меню, ангар, выбор карточек, пауза, итоги.
 * Экран — обычный DOM-оверлей; canvas продолжает рисовать фон под ним.
 */

let root = {};
let actions = {};
let cardHandler = null;
let stationConfirmHandler = null;

export function initScreens(handlers) {
  actions = handlers;
  root = {
    menu: document.getElementById('screen-menu'),
    hangar: document.getElementById('screen-hangar'),
    cards: document.getElementById('screen-cards'),
    station: document.getElementById('screen-station-confirm'),
    swap: document.getElementById('screen-weapon-swap'),
    victory: document.getElementById('screen-victory'),
    pause: document.getElementById('screen-pause'),
    over: document.getElementById('screen-over'),
    toast: document.getElementById('toast'),
    hud: document.getElementById('hud-layer'),
  };

  initTermTooltips(document);

  document.getElementById('btn-play').onclick = () => actions.startRun();
  document.getElementById('btn-hangar').onclick = () => showHangar();
  document.getElementById('btn-hangar-back').onclick = () => showMenu();
  document.getElementById('btn-resume').onclick = () => actions.resume();
  document.getElementById('btn-quit').onclick = () => actions.quitToMenu();
  document.getElementById('btn-again').onclick = () => actions.startRun();
  document.getElementById('btn-over-hangar').onclick = () => showHangar();
  document.getElementById('btn-wipe').onclick = () => {
    if (confirm('Стереть весь прогресс: обломки, улучшения и корабли?')) {
      meta.reset();
      renderHangar();
      renderMenuStats();
      sfx.denied();
    }
  };

  for (const btn of document.querySelectorAll('.hangar-tabs .tab-btn')) {
    btn.onclick = () => { setHangarTab(btn.dataset.tab); sfx.select(); };
  }

  // выбор карточки клавишами 1..3; на экране замены 4 оставляет текущие стволы
  addEventListener('keydown', (e) => {
    if (!root.station.hidden) {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        stationConfirmHandler?.confirm?.();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        stationConfirmHandler?.decline?.();
      }
      return;
    }
    const index = {
      Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3,
      Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3,
    }[e.code];
    if (index === undefined) return;
    if (!root.cards.hidden && index < 3) pickCard(index);
    else if (!root.swap.hidden) index === 3 ? declineSwap() : pickSwap(index);
  });

  renderMenuStats();
  // Статические подсказки управления и объяснение вкладки способностей.
  // Динамические карточки обрабатываются рядом с местом их отрисовки ниже.
  decorateTerms(root.menu);
  decorateTerms(root.hangar);
}

function hideAll() {
  hideTermTooltip(document);
  root.menu.hidden = true;
  root.hangar.hidden = true;
  root.cards.hidden = true;
  root.station.hidden = true;
  root.swap.hidden = true;
  root.victory.hidden = true;
  root.pause.hidden = true;
  root.over.hidden = true;
}

export const anyScreenOpen = () =>
  !(root.menu.hidden && root.hangar.hidden && root.cards.hidden && root.station.hidden && root.swap.hidden
    && root.victory.hidden && root.pause.hidden && root.over.hidden);

export function showMenu() {
  hideAll();
  renderMenuStats();
  root.menu.hidden = false;
  root.hud.classList.add('dimmed');
}

export function showHangar() {
  hideAll();
  setHangarTab('ships');
  renderHangar();
  renderAbilities();
  root.hangar.hidden = false;
  root.hud.classList.add('dimmed');
}

/**
 * Переключение вкладок ангара. Разные разделы магазина (корабли, улучшения,
 * позже — перки и активки) не помещаются на одном экране без прокрутки,
 * поэтому показываем по одному разделу за раз.
 */
function setHangarTab(id) {
  for (const btn of document.querySelectorAll('.hangar-tabs .tab-btn')) {
    btn.classList.toggle('active', btn.dataset.tab === id);
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.hidden = panel.dataset.panel !== id;
  }
}

export function showPause() {
  hideAll();
  root.pause.hidden = false;
}

export function hideScreens() {
  hideAll();
  root.hud.classList.remove('dimmed');
}

/** Явное подтверждение обязательно: после запуска покинуть арену уже нельзя. */
export function showStationConfirm(station, onConfirm, onDecline) {
  hideAll();
  const location = getLocation(station.locationId);
  document.getElementById('station-confirm-location').textContent =
    `${location.name} · РЕКОМЕНДОВАННЫЙ УРОВЕНЬ ${station.recommendedLevel}`;
  stationConfirmHandler = {
    confirm: () => {
      const handler = stationConfirmHandler;
      stationConfirmHandler = null;
      handler?.onConfirm?.();
    },
    decline: () => {
      const handler = stationConfirmHandler;
      stationConfirmHandler = null;
      handler?.onDecline?.();
    },
    onConfirm,
    onDecline,
  };
  document.getElementById('btn-station-activate').onclick = stationConfirmHandler.confirm;
  document.getElementById('btn-station-decline').onclick = stationConfirmHandler.decline;
  root.station.hidden = false;
  root.hud.classList.add('dimmed');
  document.getElementById('btn-station-activate').focus();
}

// ─────────────────────────────── меню

function renderMenuStats() {
  const s = meta.save.stats;
  document.getElementById('menu-stats').innerHTML = `
    <div><span>ЗАБЕГОВ</span><b>${s.runs}</b></div>
    <div><span>ЛУЧШАЯ ВОЛНА</span><b>${s.bestWave}</b></div>
    <div><span>РЕКОРД</span><b>${fmt(s.bestScore)}</b></div>
    <div><span>БОССОВ</span><b>${s.bosses}</b></div>
    <div><span>ОБЛОМКОВ</span><b>${fmt(meta.save.scrap)}</b></div>`;
  const ship = SHIPS[meta.save.ship];
  document.getElementById('menu-ship').innerHTML =
    `КОРАБЛЬ: <b>${ship.icon} ${ship.name}</b> · ${getWeapon(ship.weapon).name}`;
}

// ─────────────────────────────── ангар

function renderHangar() {
  document.getElementById('hangar-scrap').textContent = fmt(meta.save.scrap);

  const ships = document.getElementById('hangar-ships');
  ships.innerHTML = '';
  for (const id of SHIP_ORDER) {
    const ship = SHIPS[id];
    const owned = meta.shipUnlocked(id);
    const active = meta.save.ship === id;
    const node = document.createElement('div');
    node.className = 'ship-card' + (active ? ' active' : '') + (owned ? '' : ' locked');
    node.innerHTML = `
      <div class="ship-icon">${ship.icon}</div>
      <h4>${ship.name}</h4>
      <p class="ship-perk">${ship.perk}</p>
      <div class="ship-stats">
        <span>HP <b>${ship.hp}</b></span>
        <span>ЩИТ <b>${ship.shield}</b></span>
        <span>RAM <b>${ship.ram}</b></span>
        <span>СКОР <b>${ship.maxSpeed}</b></span>
        <span>СТВОЛ <b>${getWeapon(ship.weapon).name}</b></span>
      </div>
      <div class="ship-action">${
        active ? 'ВЫБРАН' : owned ? 'ВЫБРАТЬ' : `ОТКРЫТЬ · ${fmt(ship.cost)}`
      }</div>`;
    decorateTerms(node);
    node.onclick = () => {
      if (owned) {
        if (meta.selectShip(id)) {
          discoverContent('weapons', ship.weapon, true);
          sfx.select();
        }
      } else if (meta.buyShip(id)) {
        discoverContent('weapons', ship.weapon, true);
        sfx.confirm();
      } else {
        sfx.denied();
        flash(node);
      }
      renderHangar();
      renderMenuStats();
    };
    ships.appendChild(node);
  }

  const list = document.getElementById('hangar-upgrades');
  list.innerHTML = '';
  for (const item of HANGAR) {
    const level = meta.upgradeLevel(item.id);
    const cost = meta.costOf(item.id);
    const maxed = level >= item.max;
    const afford = meta.canAfford(item.id);

    const node = document.createElement('div');
    node.className = 'upgrade-row' + (maxed ? ' maxed' : afford ? '' : ' poor');
    node.innerHTML = `
      <div class="up-icon">${item.icon}</div>
      <div class="up-body">
        <h4>${item.name} <span class="up-level">${level}/${item.max}</span></h4>
        <p>${item.desc}</p>
        <div class="up-pips">${
          Array.from({ length: item.max }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('')
        }</div>
      </div>
      <div class="up-cost">${maxed ? 'МАКС' : fmt(cost)}</div>`;
    decorateTerms(node);
    node.onclick = () => {
      if (maxed) return;
      if (meta.buyUpgrade(item.id)) sfx.confirm();
      else { sfx.denied(); flash(node); }
      renderHangar();
      renderMenuStats();
    };
    list.appendChild(node);
  }
}

/** Вкладка «Способности»: разблокировка активок в пул + выбор стартовой (одна). */
function renderAbilities() {
  const list = document.getElementById('hangar-abilities');
  list.innerHTML = '';
  for (const card of ABILITY_CARDS) {
    const unlocked = meta.abilityUnlocked(card.id);
    const isStart = meta.save.startAbility === card.id;

    const node = document.createElement('div');
    node.className = 'upgrade-row ability-row' + (unlocked ? '' : ' locked') + (isStart ? ' active' : '');
    node.innerHTML = `
      <div class="up-icon">${card.icon}</div>
      <div class="up-body">
        <h4>${card.name}</h4>
        <p>${card.desc}</p>
      </div>
      <div class="ability-actions">
        <button class="btn-mini" data-action="unlock">${unlocked ? 'ОТКРЫТО' : `+ ${fmt(meta.abilityUnlockCost)}`}</button>
        <button class="btn-mini" data-action="start">${isStart ? 'НА СТАРТЕ' : `НА СТАРТ · ${fmt(meta.startAbilityCost)}`}</button>
      </div>`;
    decorateTerms(node);

    node.querySelector('[data-action="unlock"]').onclick = () => {
      if (unlocked) return;
      if (meta.buyAbilityUnlock(card.id)) {
        discoverContent('abilities', card.ability, true);
        sfx.confirm();
      }
      else { sfx.denied(); flash(node); }
      renderAbilities();
      renderMenuStats();
    };
    node.querySelector('[data-action="start"]').onclick = () => {
      if (!unlocked) { sfx.denied(); flash(node); return; }
      if (meta.selectStartAbility(card.id)) sfx.confirm();
      else { sfx.denied(); flash(node); }
      renderAbilities();
      renderMenuStats();
    };
    list.appendChild(node);
  }
}

function flash(node) {
  node.classList.remove('shake');
  void node.offsetWidth;
  node.classList.add('shake');
}

// ─────────────────────────────── карточки

/**
 * Показать выбор из трёх. onPick получает выбранный элемент.
 * title/subtitle позволяют переиспользовать окно и для уровня, и для награды.
 */
export function showCards({ title, subtitle, items, onPick, rerolls = 0, onReroll = null }) {
  hideAll();
  cardHandler = onPick;

  document.getElementById('cards-title').textContent = title;
  document.getElementById('cards-subtitle').textContent = subtitle;

  const box = document.getElementById('cards-list');
  box.innerHTML = '';
  items.forEach((item, i) => {
    const owned = item.playerLevel ?? 0;
    const rarity = item.station ? { name: 'СТАНЦИЯ', color: '#7ee8ff' } : RARITY[item.rarity] ?? RARITY.common;
    const tag = item.station ? 'НАГРАДА СТАНЦИИ · ×3'
      : item.weapon ? 'НОВОЕ ОРУЖИЕ'
      : item.ability ? 'АКТИВНАЯ СПОСОБНОСТЬ'
      : item.requires ? 'ЭВОЛЮЦИЯ'
      : `РЕДКОСТЬ · ${rarity.name}`;

    const node = document.createElement('div');
    node.className = `card rarity-${item.rarity ?? 'common'}${item.station ? ' station-reward' : ''}`;
    node.style.setProperty('--rarity', rarity.color);
    node.innerHTML = `
      <div class="card-tag">${tag}</div>
      <div class="card-icon">${item.icon}</div>
      <h3>${item.name}</h3>
      <p>${item.desc}</p>
      <div class="card-foot">
        <kbd>${i + 1}</kbd>
        ${Number.isFinite(item.max) && item.max > 1 ? `<span class="card-level">${owned}/${item.max}</span>` : ''}
      </div>`;
    decorateTerms(node);
    node.onclick = () => pickCard(i);
    box.appendChild(node);
  });

  const rerollBtn = document.getElementById('btn-reroll');
  rerollBtn.hidden = !onReroll || rerolls <= 0;
  rerollBtn.textContent = `ПЕРЕБРОС (${rerolls})`;
  rerollBtn.onclick = () => onReroll?.();

  root.cards.hidden = false;
  root.cards.dataset.items = items.length;
  cardItems = items;
}

let cardItems = [];

function pickCard(index) {
  const item = cardItems[index];
  if (!item || !cardHandler) return;
  const handler = cardHandler;
  cardHandler = null;
  root.cards.hidden = true;
  handler(item);
}

// ─────────────────────────────── замена ствола (слоты заняты)

let swapHandler = null;
let swapIds = [];

/**
 * Все 3 слота заняты, а награда — новый ствол: игрок сам решает, кем
 * пожертвовать. onPick получает id ствола, который уступает место, или null, если игрок
 * решил оставить текущий набор без изменений.
 */
export function showWeaponSwap(player, incoming, onPick) {
  hideAll();
  swapHandler = onPick;
  swapIds = [...player.weapons];

  document.getElementById('swap-incoming').textContent = `${incoming.icon} ${incoming.name}`;

  const box = document.getElementById('swap-list');
  box.innerHTML = '';
  swapIds.forEach((id, i) => {
    const w = getWeapon(id);
    const weaponCard = PERKS.find((card) => card.weapon === id);
    const rarity = RARITY[weaponCard?.rarity] ?? RARITY.common;
    const active = player.weapon === id;
    const node = document.createElement('div');
    node.className = `card rarity-${rarity.id}`;
    node.style.setProperty('--rarity', rarity.color);
    node.innerHTML = `
      <div class="card-tag">${active ? 'ТЕКУЩИЙ' : 'СТВОЛ'}</div>
      <div class="card-icon">${w.icon}</div>
      <h3>${w.name}</h3>
      <p>${w.desc ?? ''}</p>
      <div class="card-foot"><kbd>${i + 1}</kbd></div>`;
    decorateTerms(node);
    node.onclick = () => pickSwap(i);
    box.appendChild(node);
  });

  document.getElementById('btn-keep-weapons').onclick = declineSwap;

  root.swap.hidden = false;
}

function pickSwap(index) {
  const id = swapIds[index];
  if (!id || !swapHandler) return;
  const handler = swapHandler;
  swapHandler = null;
  root.swap.hidden = true;
  handler(id);
}

function declineSwap() {
  if (!swapHandler) return;
  const handler = swapHandler;
  swapHandler = null;
  root.swap.hidden = true;
  handler(null);
}

// ─────────────────────────────── все десять пали: выбор эндгейма

/**
 * Экран после десятого босса. Забег НЕ обрывается: игрок сам решает, забрать
 * победу с бонусом или уйти в бесконечный режим. onPick('hangar'|'endless').
 */
export function showVictoryChoice(summary, onPick) {
  hideAll();
  document.getElementById('victory-summary').innerHTML = `
    <div><span>ВОЛНА</span><b>${summary.wave}</b></div>
    <div><span>СЧЁТ</span><b>${fmt(summary.score)}</b></div>
    <div><span>УБИЙСТВ</span><b>${summary.kills}</b></div>
    <div><span>ВРЕМЯ</span><b>${Math.round(summary.time)}с</b></div>
    <div class="highlight"><span>ОБЛОМКОВ ЗА ЗАБЕГ</span><b>${fmt(summary.scrap)}</b></div>`;

  document.getElementById('btn-victory-hangar').onclick = () => { sfx.confirm(); onPick('hangar'); };
  document.getElementById('btn-victory-endless').onclick = () => { sfx.alarm(); onPick('endless'); };

  root.victory.hidden = false;
  root.hud.classList.add('dimmed');
}

// ─────────────────────────────── итоги забега

export function showGameOver(summary) {
  hideAll();
  document.getElementById('over-title').textContent =
    summary.endless ? 'ГЛУБИНА ЗАБРАЛА КОРАБЛЬ'
    : summary.victory ? 'СЕКТОР ОЧИЩЕН'
    : 'КОРАБЛЬ УНИЧТОЖЕН';

  // в бесконечном режиме главная цифра — сколько волн пережил СВЕРХ победы:
  // именно она и есть повод зайти ещё раз
  const endlessRow = summary.endless
    ? `<div class="highlight"><span>ВОЛН СВЕРХ ПОБЕДЫ</span><b>${summary.endlessWaves}</b></div>`
    : '';

  document.getElementById('over-summary').innerHTML = `
    <div><span>ВОЛНА</span><b>${summary.wave}</b></div>
    <div><span>СЧЁТ</span><b>${fmt(summary.score)}</b></div>
    <div><span>УБИЙСТВ</span><b>${summary.kills}</b></div>
    <div><span>БОССОВ</span><b>${summary.bosses}</b></div>
    <div><span>ВРЕМЯ</span><b>${Math.round(summary.time)}с</b></div>
    <div class="highlight"><span>ОБЛОМКОВ ДОБЫТО</span><b>+${fmt(summary.scrap)}</b></div>
    ${endlessRow}`;
  document.getElementById('over-total').textContent = `В АНГАРЕ: ${fmt(meta.save.scrap)} ОБЛОМКОВ`;
  root.over.hidden = false;
  root.hud.classList.add('dimmed');
}

// ─────────────────────────────── всплывающие сообщения

let toastTimer = null;

export function toast(text, sub = '', ms = 1600) {
  root.toast.innerHTML = `<div class="toast-main">${text}</div>${sub ? `<div class="toast-sub">${sub}</div>` : ''}`;
  decorateTerms(root.toast);
  root.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => root.toast.classList.remove('visible'), ms);
}

/** Убрать тост немедленно — чтобы не лез поверх полноэкранных панелей. */
export function hideToast() {
  clearTimeout(toastTimer);
  root.toast.classList.remove('visible');
}
