/**
 * Сохранение мета-прогресса в localStorage.
 *
 * Формат версионируется. Профиль v2 не выбрасывается молча: meta.js читает
 * его через readLegacySave() и возвращает игроку всё потраченное обломками,
 * потому что система ангара под v3 переехала целиком.
 */
const KEY = 'starfall.save.v3';
const LEGACY_KEY = 'starfall.save.v2';
const VERSION = 3;

export const defaultSave = () => ({
  version: VERSION,
  scrap: 0,
  upgrades: {},        // id перманентного улучшения → уровень
  ships: ['scout'],    // разблокированные корабли
  ship: 'scout',       // выбранный
  weapons: [],         // разблокированные в ангаре стволы (сверх стартового)

  // куплено в ангаре под будущие этапы
  perks: [],           // id перков, добавленных в пул выпадения
  startPerks: [],      // перки, с которыми забег начинается
  startAbility: null,  // активка, с которой забег начинается
  abilitySlots: 3,     // базовое число слотов активок
  achievements: [],    // постоянные id достижений; старые v3-профили дополняются defaultSave

  migrated: false,     // показать разовое сообщение о пересчёте профиля

  stats: {
    runs: 0,
    bestScore: 0,
    bestWave: 0,
    kills: 0,
    bosses: 0,
    totalScrap: 0,
    wins: 0,           // забегов, где пали все семь боссов
    bestEndless: 0,    // лучшая волна в бесконечном режиме
  },
});

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.version !== VERSION) return null;
    const base = defaultSave();
    return { ...base, ...data, stats: { ...base.stats, ...data.stats } };
  } catch {
    return null;
  }
}

/** Профиль предыдущей версии — нужен только для пересчёта в обломки. */
export function readLegacySave() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function dropLegacySave() {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* пусто */
  }
}

export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
    return true;
  } catch {
    return false; // приватный режим — играем без сохранения
  }
}

export function wipeSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* пусто */
  }
  return defaultSave();
}
