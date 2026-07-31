/**
 * СТАНЦИИ НА ЗАЧИСТКУ (этап C).
 *
 * Единственные 5–7 станций размещаются на всём торе 55×55 чанков.
 * Координаты постоянны и каноничны; systems/stations.js проецирует ближайшую
 * image-копию только на время discovery, отрисовки и отдельного encounter.
 */

export const STATION_GENERATOR_VERSION = 1;
export const STATION_MIN_HOME_CHUNKS = 5;
export const STATION_MIN_GAP_CHUNKS = 8;

export const STATION_ACTIVATION_RADIUS = 390;
export const STATION_ARENA_RADIUS = 650;
export const STATION_DISCOVERY_MIN_RADIUS = 1700;
export const STATION_ACTIVE_LIMIT = 20;

/** Потолки относятся к слою «обычные очки + станция»; условные перки идут после него. */
export const STATION_CHANCE_LIMITS = {
  crit: 0.60,
  armor: 0.60,
  dodge: 0.35,
};

const threePointChance = (a) => (3 * a) / (1 + 3 * a);

/**
 * Каждая величина равна трём обычным базовым карточкам.
 * Для шансов заранее посчитан эффект трёх первых очков и затем хранится
 * отдельной линейной прибавкой — последующие станции его не уменьшают.
 */
export const STATION_REWARDS = [
  {
    id: 'station-damage', stat: 'damage', icon: '◆', name: 'ТРОЙНОЙ УСИЛИТЕЛЬ',
    desc: '+78% урона любого оружия', value: 0.78,
  },
  {
    id: 'station-rate', stat: 'rate', icon: '⇈', name: 'КРИОКОНТУР',
    desc: '+45% скорости атаки', value: 0.45,
  },
  {
    id: 'station-hull', stat: 'hull', icon: '▣', name: 'ТЯЖЁЛЫЙ КОРПУС',
    desc: '+90 к максимуму HP и полный ремонт', value: 90,
  },
  {
    id: 'station-shield', stat: 'shield', icon: '◎', name: 'БАРЬЕРНЫЙ УЗЕЛ',
    desc: '+105 щита, +21 щита/с и полная зарядка', value: 105, regen: 21,
  },
  {
    id: 'station-regen', stat: 'regen', icon: '⊞', name: 'РЕМРОЙ',
    desc: '+3.3 HP в секунду постоянно', value: 3.3,
  },
  {
    id: 'station-speed', stat: 'speed', icon: '⇉', name: 'ТРИЕДИНЫЙ ДВИГАТЕЛЬ',
    desc: '+48% тяги и максимальной скорости (×1.14³)', value: 1.14 ** 3,
  },
  {
    id: 'station-crit', stat: 'crit', icon: '⁕', name: 'АБСОЛЮТНЫЙ ФОКУС',
    desc: '+29.6 п.п. шанса крита без убывания', value: threePointChance(0.14),
  },
  {
    id: 'station-armor', stat: 'armor', icon: '▧', name: 'МОНОЛИТНАЯ БРОНЯ',
    desc: '+14.2 п.п. снижения урона без убывания', value: threePointChance(0.055),
  },
  {
    id: 'station-dodge', stat: 'dodge', icon: '▨', name: 'ПРОГНОЗ-ТРАЕКТОРИЯ',
    desc: '+13.0 п.п. уклонения без убывания', value: threePointChance(0.05),
  },
].map((reward) => ({ ...reward, station: true, rarity: 'legendary' }));

export const stationRewardById = Object.fromEntries(STATION_REWARDS.map((r) => [r.id, r]));
