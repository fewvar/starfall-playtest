/**
 * СЕМЬ БОССОВ. Поведение — в entities/bosses.js (updateBoss, ветка по id).
 *
 * HP ФИКСИРОВАННОЕ и от волны не зависит вообще (в отличие от обычных врагов,
 * см. systems/waves.js:enemyHpScale). В основном режиме каждый босс живёт у
 * отдельной метки своей локации. Порядок нужен для ступеней силы, эндгейма и
 * ротации endless; кратность пяти осталась только в endless и старых bench.
 * Так каждый бой остаётся проверкой скилла на своей ступени, а не пилением
 * мешка, отмасштабированного вслепую (цифры выверены bench/bosses_check.mjs:
 * у среднего билда своей ступени каждый босс живёт 45-120 секунд).
 *
 * ТРИ ФАЗЫ по порогам 100% → 60% → 30%. Каждая ДОБАВЛЯЕТ паттерн, а не
 * умножает числа: phase — это набор атак, а не множитель сложности.
 *
 * location — где живёт этот босс (см. data/locations.js). В «Открытом
 * космосе» до отдельной стартовой локации временно живёт ДРЕДНОУТ.
 */
export const BOSSES = {
  dread: {
    id: 'dread', name: 'ДРЕДНОУТ', title: 'ТЯЖЁЛЫЙ КРЕЙСЕР НА ПЕРЕХВАТЕ',
    location: 'open', order: 1,
    hp: 6500, r: 62, speed: 86, color: '#ff6b8a', physicalResist: 0.12, technicalResist: 0.06,
    score: 1400, xp: 55, scrap: 45,
    hint: 'Веера снарядов, потом высадка дронов, в конце — сходящиеся стены.',
  },
  prime: {
    id: 'prime', name: 'ДРОБИЛЬЩИК-ПРАЙМ', title: 'ПОЯС ВЫПУСТИЛ СВОЁ ОРУДИЕ',
    location: 'belt', order: 2,
    hp: 11200, r: 56, speed: 210, color: '#ffb14a', physicalResist: 0.22, technicalResist: 0.08,
    score: 1600, xp: 60, scrap: 50,
    hint: 'Перед рывком вспыхивает кольцом. Потом метает астероиды и сжимает кольцо обломков.',
  },
  eye: {
    id: 'eye', name: 'ОКО', title: 'СТАНЦИЯ НАВЕЛА ЛУЧ',
    location: 'nebula', order: 3,
    hp: 15500, r: 54, speed: 58, color: '#7ee8ff', physicalResist: 0.08, technicalResist: 0.26,
    score: 1700, xp: 65, scrap: 55,
    hint: 'Водит лучом по кругу. Луч раздваивается, а в конце Око пропадает между атаками.',
  },
  gravedigger: {
    id: 'gravedigger', name: 'МОГИЛЬЩИК', title: 'КЛАДБИЩЕ ПОДНЯЛО СВОИ ОБЛОМКИ',
    location: 'graveyard', order: 4,
    hp: 25000, r: 60, speed: 92, color: '#5ef0d0', physicalResist: 0.3, technicalResist: 0.12,
    score: 2000, xp: 75, scrap: 65,
    hint: 'Прячется за щитом из обломков. Сбей щит — он взорвётся, но откроет корпус.',
  },
  conduit: {
    id: 'conduit', name: 'ПРОВОДНИК', title: 'ШТОРМ ОБРЁЛ ФОРМУ',
    location: 'ionstorm', order: 5,
    hp: 34000, r: 52, speed: 104, color: '#7ee8ff', physicalResist: 0.1, technicalResist: 0.34,
    score: 2300, xp: 85, scrap: 75,
    hint: 'Бьёт цепными разрядами и ставит узлы. Не стой на линии между узлами.',
  },
  hive: {
    id: 'hive', name: 'МАТКА РОЯ', title: 'ИНКУБАТОР ПРОСНУЛСЯ',
    location: 'nest', order: 6,
    hp: 47000, r: 58, speed: 70, color: '#e879f9', physicalResist: 0.16, technicalResist: 0.3,
    score: 2600, xp: 95, scrap: 85,
    hint: 'Спираль снарядов и непрерывный выводок. На последней фазе делится на три.',
  },
  distortion: {
    id: 'distortion', name: 'ИСКАЖЕНИЕ', title: 'РАЗЛОМ СМОТРИТ ТВОИМ ЛИЦОМ',
    location: 'rift', order: 7,
    hp: 70000, r: 50, speed: 150, color: '#b06bff', physicalResist: 0.18, technicalResist: 0.38,
    score: 3200, xp: 120, scrap: 110,
    hint: 'Стреляет твоим же стволом. Телепортируется, а в конце выпускает твою копию.',
  },
};

/** Порядок ступеней силы, победного набора и endless-ротации. */
export const BOSS_ORDER = Object.values(BOSSES)
  .sort((a, b) => a.order - b.order)
  .map((b) => b.id);

/** Босс, живущий у отдельной метки этой локации. */
export const bossForLocation = (locationId) =>
  BOSS_ORDER.find((id) => BOSSES[id].location === locationId) ?? null;

/** Совместимый выбор для endless и старых bench-волн 5, 10, 15, ... */
export const bossForWave = (wave) => {
  const index = Math.floor(wave / 5) - 1;
  return BOSS_ORDER[Math.max(0, index) % BOSS_ORDER.length];
};

/**
 * НАГРАДА ЗА СКОРОСТЬ. Отсчёт идёт с появления босса: пришёл и убил быстро —
 * бонус, тянул до автовыхода (см. BOSS_HUNT_AFTER) — обычная награда.
 */
export const BOSS_HUNT_AFTER = 240;   // через сколько секунд босс сам идёт за игроком

export function bossSpeedReward(seconds, cameItself) {
  if (cameItself) return { mul: 1, epic: false, label: 'ПРИШЁЛ САМ' };
  if (seconds < 60) return { mul: 2, epic: true, label: 'МОЛНИЕНОСНО' };
  if (seconds < 150) return { mul: 1.5, epic: false, label: 'БЫСТРО' };
  return { mul: 1, epic: false, label: '' };
}
