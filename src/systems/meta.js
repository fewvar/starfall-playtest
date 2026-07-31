import { on } from '../core/events.js';
import {
  loadSave, writeSave, wipeSave, defaultSave,
  readLegacySave, dropLegacySave,
} from '../core/storage.js';
import { hangarById, upgradeCost } from '../data/hangar.js';
import { SHIPS } from '../data/ships.js';
import { WEAPONS } from '../data/weapons.js';

/**
 * Мета-прогресс между забегами: обломки, покупки в ангаре, разблокировки.
 * Единственное место, которое пишет в localStorage.
 */

/**
 * Профиль v2 → v3. Ангар переехал целиком, поэтому уровни не переносятся,
 * а возвращаются обломками — по полной цене, включая корабли.
 * Игрок ничего не теряет и сразу закупается заново под новую систему.
 */
function migrateLegacy() {
  const old = readLegacySave();
  if (!old) return null;

  const save = defaultSave();
  let refund = old.scrap ?? 0;

  for (const [id, level] of Object.entries(old.upgrades ?? {})) {
    const item = hangarById[id];
    if (!item) continue;
    for (let l = 0; l < level; l++) refund += upgradeCost(item, l);
  }
  for (const id of old.ships ?? []) refund += SHIPS[id]?.cost ?? 0;

  save.scrap = refund;
  save.stats = { ...save.stats, ...old.stats };
  save.migrated = true;
  dropLegacySave();
  writeSave(save);
  return save;
}

const freshSave = () => loadSave() ?? migrateLegacy() ?? defaultSave();

export const meta = {
  save: freshSave(),

  reload() {
    this.save = freshSave();
    return this.save;
  },
  persist() {
    writeSave(this.save);
  },
  reset() {
    this.save = wipeSave();
    this.persist();
    return this.save;
  },

  get scrap() {
    return this.save.scrap;
  },

  upgradeLevel(id) {
    return this.save.upgrades[id] ?? 0;
  },

  costOf(id) {
    const item = hangarById[id];
    if (!item) return Infinity;
    const level = this.upgradeLevel(id);
    return level >= item.max ? Infinity : upgradeCost(item, level);
  },

  canAfford(id) {
    return this.save.scrap >= this.costOf(id);
  },

  buyUpgrade(id) {
    const cost = this.costOf(id);
    if (!Number.isFinite(cost) || this.save.scrap < cost) return false;
    this.save.scrap -= cost;
    this.save.upgrades[id] = this.upgradeLevel(id) + 1;
    this.persist();
    return true;
  },

  /** Сообщение о пересчёте профиля показывается один раз. */
  consumeMigrationNotice() {
    if (!this.save.migrated) return false;
    this.save.migrated = false;
    this.persist();
    return true;
  },

  shipUnlocked(id) {
    return this.save.ships.includes(id);
  },

  buyShip(id) {
    const ship = SHIPS[id];
    if (!ship || this.shipUnlocked(id) || this.save.scrap < ship.cost) return false;
    this.save.scrap -= ship.cost;
    this.save.ships.push(id);
    this.save.ship = id;
    this.persist();
    return true;
  },

  selectShip(id) {
    if (!this.shipUnlocked(id)) return false;
    this.save.ship = id;
    this.persist();
    return true;
  },

  weaponUnlocked(id) {
    return this.save.weapons.includes(id) || SHIPS[this.save.ship]?.weapon === id;
  },

  // ─────────────────────────────── ангар: активные способности
  //
  // save.perks — id карточек-активок (a_emp, ...), разблокированных в пул
  // выпадения забега. save.startAbility — одна из уже разблокированных,
  // с которой начинается забег (максимум 1 слот, см. план — этап 3).

  abilityUnlockCost: 220,
  startAbilityCost: 1400,

  abilityUnlocked(cardId) {
    return this.save.perks.includes(cardId);
  },

  buyAbilityUnlock(cardId) {
    if (this.abilityUnlocked(cardId) || this.save.scrap < this.abilityUnlockCost) return false;
    this.save.scrap -= this.abilityUnlockCost;
    this.save.perks.push(cardId);
    this.persist();
    return true;
  },

  /** Повторный клик по уже выбранной активке снимает её бесплатно. */
  selectStartAbility(cardId) {
    if (!this.abilityUnlocked(cardId)) return false;
    if (this.save.startAbility === cardId) {
      this.save.startAbility = null;
      this.persist();
      return true;
    }
    if (this.save.scrap < this.startAbilityCost) return false;
    this.save.scrap -= this.startAbilityCost;
    this.save.startAbility = cardId;
    this.persist();
    return true;
  },

  unlockAchievement(id) {
    this.save.achievements ??= [];
    if (this.save.achievements.includes(id)) return false;
    this.save.achievements.push(id);
    this.persist();
    return true;
  },

  achievementUnlocked(id) {
    return !!this.save.achievements?.includes(id);
  },

  /** Итоги забега: обломки в копилку, рекорды в статистику. */
  finishRun(run) {
    const s = this.save.stats;
    s.runs++;
    s.kills += run.kills;
    s.bosses += run.bosses;
    s.bestScore = Math.max(s.bestScore, run.score);
    s.bestWave = Math.max(s.bestWave, run.totalWavesCleared ?? run.wave);
    s.totalScrap += run.scrap;
    // рекорд бесконечного режима считается СВЕРХ волны победы: смысл режима
    // именно в том, сколько ты продержался после того, как всё уже выиграл
    if (run.endless) {
      s.bestEndless = Math.max(s.bestEndless, run.endlessWave ?? 0);
    }
    this.save.scrap += run.scrap;
    this.persist();
    return this.save;
  },
};

/** Обломки капают в счётчик забега, а в профиль уходят только по его итогам. */
export function initMeta(game) {
  on('scrap:gain', ({ amount }) => {
    const p = game.player;
    game.run.scrap += Math.round(amount * (p?.scrapMul ?? 1) * (p?.locationLootMul ?? 1));
  });
}

export const weaponName = (id) => WEAPONS[id]?.name ?? id;
