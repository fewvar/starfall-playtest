/**
 * Сохранение мета-прогресса в localStorage.
 *
 * Формат версионируется. Профиль v2 не выбрасывается молча: meta.js читает
 * его через readLegacySave() и возвращает игроку всё потраченное обломками,
 * потому что система ангара под v3 переехала целиком.
 */
const KEY = 'starfall.save.v4';
const V3_KEY = 'starfall.save.v3';
const LEGACY_KEY = 'starfall.save.v2';
const VERSION = 4;

export const BESTIARY_CATEGORIES = Object.freeze([
  'enemies', 'bosses', 'locations', 'weapons', 'perks', 'abilities',
]);

const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
const nonNegativeInt = (value) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export const defaultBestiaryEntry = () => ({ seen: false, kills: 0, unlocked: false });

/** Preserves unknown fields while normalizing every known progress record. */
export function normalizeBestiary(value) {
  const source = isRecord(value) ? value : {};
  const normalized = { ...source };
  for (const category of BESTIARY_CATEGORIES) {
    const entries = isRecord(source[category]) ? source[category] : {};
    normalized[category] = {};
    for (const [id, entry] of Object.entries(entries)) {
      if (!id) continue;
      const base = isRecord(entry) ? entry : {};
      normalized[category][id] = {
        ...base,
        seen: Boolean(base.seen),
        kills: nonNegativeInt(base.kills),
        unlocked: Boolean(base.unlocked),
      };
    }
  }
  return normalized;
}

export const defaultBestiary = () => normalizeBestiary({});

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

  bestiary: defaultBestiary(),

  stats: {
    runs: 0,
    bestScore: 0,
    bestWave: 0,
    kills: 0,
    bosses: 0,
    totalScrap: 0,
    wins: 0,           // забегов, где пали все десять боссов
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
    return {
      ...base,
      ...data,
      version: VERSION,
      stats: { ...base.stats, ...data.stats },
      bestiary: normalizeBestiary(data.bestiary),
    };
  } catch {
    return null;
  }
}

/** v3 is retained only as an explicit v4 migration source. */
export function readV3Save() {
  try {
    const raw = localStorage.getItem(V3_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data?.version === 3 ? data : null;
  } catch {
    return null;
  }
}

export function dropV3Save() {
  try {
    localStorage.removeItem(V3_KEY);
  } catch {
    /* empty */
  }
}

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
