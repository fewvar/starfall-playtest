/**
 * Обычные враги. Поведение выбирается полем ai в entities/enemies.js.
 *
 *   hp/r/speed  — база, масштабируется сложностью волны
 *   want        — дистанция, которую враг старается держать (0 = таранит)
 *   fire        — период стрельбы в секундах (0 = не стреляет)
 *   melee       — урон корпусом
 *   cost        — «цена» в бюджете волны: чем опаснее, тем дороже
 *   minWave     — с какой волны может появиться
 *
 * Новый враг: добавь запись сюда, отрисовку в render/renderer.js
 * и, если нужно особое поведение, ветку в updateEnemy.
 */
export const ENEMIES = {
  drone: {
    id: 'drone', name: 'ДРОН', ai: 'chase', color: '#ff6b8a',
    hp: 26, r: 13, speed: 175, want: 0, fire: 0, melee: 14,
    xp: 2, score: 15, scrap: 1, cost: 1, minWave: 1,
  },
  gunner: {
    id: 'gunner', name: 'СТРЕЛОК', ai: 'keepDistance', color: '#ffb14a',
    hp: 44, r: 16, speed: 130, want: 280, fire: 1.5, melee: 10,
    xp: 4, score: 30, scrap: 2, cost: 2, minWave: 1,
  },
  weaver: {
    id: 'weaver', name: 'ТКАЧ', ai: 'weave', color: '#5ef0d0',
    hp: 30, r: 12, speed: 265, want: 180, fire: 1.2, melee: 12,
    xp: 4, score: 35, scrap: 2, cost: 2, minWave: 2,
  },
  sniper: {
    id: 'sniper', name: 'СНАЙПЕР', ai: 'keepDistance', color: '#b06bff',
    hp: 34, r: 15, speed: 105, want: 520, fire: 2.4, melee: 8,
    xp: 5, score: 40, scrap: 3, cost: 3, minWave: 3,
  },
  mine: {
    id: 'mine', name: 'МИНА', ai: 'mine', color: '#ffe066',
    hp: 18, r: 11, speed: 26, want: 0, fire: 0, melee: 0,
    xp: 2, score: 20, scrap: 1, cost: 1, minWave: 2,
  },
  bomber: {
    id: 'bomber', name: 'БОМБЕР', ai: 'kamikaze', color: '#ff9f43',
    hp: 52, r: 19, speed: 150, want: 0, fire: 0, melee: 0,
    xp: 6, score: 45, scrap: 3, cost: 3, minWave: 4,
  },
  splitter: {
    id: 'splitter', name: 'ДЕЛИТЕЛЬ', ai: 'keepDistance', color: '#e879f9',
    hp: 58, r: 20, speed: 128, want: 200, fire: 1.7, melee: 14,
    xp: 6, score: 50, scrap: 3, cost: 3, minWave: 5,
  },
  warden: {
    id: 'warden', name: 'СТРАЖ', ai: 'keepDistance', color: '#4ad9ff',
    hp: 96, r: 22, speed: 118, want: 240, fire: 1.9, melee: 16,
    xp: 9, score: 70, scrap: 5, cost: 4, minWave: 6,
    frontShield: true,
  },
  brute: {
    id: 'brute', name: 'БРУТ', ai: 'chase', color: '#ff4a4a',
    hp: 130, r: 26, speed: 92, want: 60, fire: 1.1, melee: 26,
    xp: 12, score: 90, scrap: 6, cost: 5, minWave: 7,
  },

  // ─────────────────────────────── уникальные враги локаций (этап 4)
  // location — появляются только в своей локации (см. availableEnemies)
  crusher: {
    id: 'crusher', name: 'ДРОБИЛЬЩИК', ai: 'chase', color: '#c9955a',
    hp: 74, r: 25, speed: 138, want: 0, fire: 0, melee: 22,
    xp: 8, score: 60, scrap: 4, cost: 4, minWave: 1, location: 'belt',
    special: 'crusher', // крошит астероиды на пути
  },
  phantom: {
    id: 'phantom', name: 'ФАНТОМ', ai: 'keepDistance', color: '#8a7ad0',
    hp: 34, r: 15, speed: 165, want: 260, fire: 1.6, melee: 10,
    xp: 6, score: 45, scrap: 3, cost: 3, minWave: 1, location: 'nebula',
    special: 'phantom', // мигает — периодически телепортируется
  },
  marauder: {
    id: 'marauder', name: 'МАРОДЁР', ai: 'chase', color: '#d4c05a',
    hp: 46, r: 17, speed: 195, want: 0, fire: 0, melee: 16,
    xp: 5, score: 40, scrap: 6, cost: 3, minWave: 1, location: 'graveyard',
    special: 'marauder', // рвётся к лут-пикапам раньше игрока
  },
  conduit: {
    id: 'conduit', name: 'ПРОВОДНИК', ai: 'keepDistance', color: '#7ee8ff',
    hp: 40, r: 16, speed: 118, want: 320, fire: 1.8, melee: 8,
    xp: 7, score: 50, scrap: 4, cost: 4, minWave: 1, location: 'ionstorm',
  },
  larva: {
    id: 'larva', name: 'ЛИЧИНКА', ai: 'chase', color: '#ff6ba0',
    hp: 12, r: 9, speed: 205, want: 0, fire: 0, melee: 8,
    xp: 1, score: 10, scrap: 1, cost: 1, minWave: 1, location: 'nest',
  },
  distortion: {
    id: 'distortion', name: 'ИСКАЖЕНИЕ', ai: 'weave', color: '#b06bff',
    hp: 44, r: 15, speed: 210, want: 160, fire: 1.3, melee: 12,
    xp: 8, score: 55, scrap: 4, cost: 4, minWave: 1, location: 'rift',
    special: 'distortion', // короткие непредсказуемые телепорты
  },
};

export const ENEMY_IDS = Object.keys(ENEMIES);

export const getEnemy = (id) => ENEMIES[id] || ENEMIES.drone;

/**
 * Кто может появиться на этой волне. Враги с полем location — уникальные
 * для конкретной локации (этап 4) — показываются только в ней, остальные
 * доступны везде, как раньше.
 */
export const availableEnemies = (wave, location = 'open') =>
  ENEMY_IDS.filter((id) => {
    const e = ENEMIES[id];
    return e.minWave <= wave && (!e.location || e.location === location);
  });
