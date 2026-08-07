/**
 * ТРИНАДЦАТЬ ЛОКАЦИЙ.
 *
 * Локация — кластер чанков вокруг детерминированного центра (см.
 * world/world.js:locationAt). tier определяет, на каком расстоянии от старта
 * локация вообще может появиться — чем дальше, тем опаснее вариативность.
 *
 * modifiers — то, что system/locations.js применяет при входе и снимает при
 * выходе. Тут только ОПИСАНИЕ модификатора, логика — в systems/locations.js,
 * чтобы данные оставались данными.
 */
export const LOCATIONS = {
  start: {
    id: 'start', name: 'СТАРТОВЫЙ СЕКТОР', color: '#4a3028', tier: 0, recommendedLevel: 1,
    waveCount: 5,
    asteroids: 4, drops: 0, tags: [], enemy: null,
    desc: 'Тёплый безопасный сектор у точки старта. Здесь начинается каждый забег.',
    modifiers: {}, placement: { kind: 'start' },
  },
  open: {
    id: 'open', name: 'ОТКРЫТЫЙ КОСМОС', color: '#22304f', tier: 0, recommendedLevel: 1,
    waveCount: 5,
    asteroids: 8, drops: 0, tags: [], enemy: null,
    desc: 'Нейтральный космос — время полёта снарядов ×1.15.',
    modifiers: { bulletLifeMul: 1.15 }, placement: { kind: 'background' },
  },
  belt: {
    id: 'belt', name: 'ПОЯС АСТЕРОИДОВ', color: '#4a3b2a', tier: 0, recommendedLevel: 2,
    waveCount: 5,
    asteroids: 9, drops: 0, tags: ['kinetic', 'pierce'], enemy: 'crusher',
    desc: 'Астероиды и рудная пыль. Оружейные снаряды получают +2 рикошета.',
    modifiers: { ricochetBonus: 2 }, placement: { kind: 'normal', minLevel: 2, maxLevel: 3, weight: 3 },
  },
  grove: {
    id: 'grove', name: 'ЗАРОСЛИ', color: '#17634f', tier: 1, recommendedLevel: 3,
    waveCount: 7,
    asteroids: 6, vines: 4, drops: 0, tags: ['status', 'sustain'], enemy: null,
    desc: 'Живые заросли цепляют семя к корпусу, а сбитая лоза стреляет семенами вдогонку.',
    modifiers: {}, placement: { kind: 'normal', minLevel: 2, maxLevel: 5, weight: 2 },
  },
  nebula: {
    id: 'nebula', name: 'ТУМАННОСТЬ', color: '#3a2f55', tier: 1, recommendedLevel: 4,
    waveCount: 7,
    asteroids: 4, drops: 0, tags: ['status', 'homing'], enemy: 'phantom',
    desc: 'Обзор −40%, снаряды тормозят, враги видны только на радаре издалека.',
    modifiers: { visibilityMul: 0.6, bulletSpeedMul: 0.8, radarOnly: 420 }, placement: { kind: 'normal', minLevel: 3, maxLevel: 6, weight: 2 },
  },
  acid: {
    id: 'acid', name: 'КИСЛОТНОЕ ОБЛАКО', color: '#556b20', tier: 2, recommendedLevel: 6,
    waveCount: 10,
    asteroids: 3, drops: 0, tags: ['status', 'armor'], enemy: null,
    desc: 'Кислота постоянно разъедает корпус и полностью блокирует лечение без защиты Зарослей.',
    modifiers: {}, placement: { kind: 'normal', minLevel: 5, maxLevel: 9, weight: 2 },
  },
  graveyard: {
    id: 'graveyard', name: 'КЛАДБИЩЕ', color: '#1f4a44', tier: 1, recommendedLevel: 4,
    waveCount: 7,
    asteroids: 5, drops: 4, tags: ['luck', 'drone'], enemy: 'marauder',
    desc: 'Обломки прошлых боёв. Лут ×2.',
    modifiers: { lootMul: 2 }, placement: { kind: 'normal', minLevel: 3, maxLevel: 6, weight: 2 },
  },
  ionstorm: {
    id: 'ionstorm', name: 'ИОННЫЙ ШТОРМ', color: '#2a4a5a', tier: 2, recommendedLevel: 6,
    waveCount: 10,
    asteroids: 3, drops: 0, tags: ['energy', 'chain'], enemy: 'conduit',
    desc: 'Каждые 8 секунд разряд по площади бьёт всех, включая тебя.',
    modifiers: { periodicShock: { interval: 8, damage: 14 } }, placement: { kind: 'normal', minLevel: 5, maxLevel: 10, weight: 2 },
  },
  nest: {
    id: 'nest', name: 'ГНЕЗДО', color: '#4a1f33', tier: 2, recommendedLevel: 6,
    waveCount: 10,
    asteroids: 4, drops: 0, tags: ['swarm', 'explosive'], enemy: 'larva',
    desc: 'Врагов вдвое больше, их HP ×0.5.',
    modifiers: { enemyCountMul: 2, enemyHpMul: 0.5 }, placement: { kind: 'normal', minLevel: 5, maxLevel: 10, weight: 2 },
  },
  dissonance: {
    id: 'dissonance', name: 'ДИССОНАНС', color: '#32445a', tier: 2, recommendedLevel: 7,
    waveCount: 10,
    asteroids: 5, drops: 0, tags: ['status', 'luck'], enemy: null,
    desc: 'Чужой артефакт искажает картинку, звук и показания интерфейса до очистки структуры.',
    modifiers: {}, placement: { kind: 'normal', minLevel: 4, maxLevel: 10, weight: 1.5 },
  },
  dust: {
    id: 'dust', name: 'ПЫЛЕВОЙ ШТОРМ', color: '#5b4a68', tier: 2, recommendedLevel: 7,
    waveCount: 10,
    asteroids: 3, drops: 0, tags: ['speed', 'evasion'], enemy: null,
    desc: 'Навигация отключена. Направление показывают только стремительные радужные частицы.',
    modifiers: {}, placement: { kind: 'normal', minLevel: 4, maxLevel: 10, weight: 1.5 },
  },
  hollow_moon: {
    id: 'hollow_moon', name: 'ПОЛАЯ ЛУНА', color: '#8fa0c0', tier: 3, recommendedLevel: 8,
    waveCount: 10,
    asteroids: 7, drops: 0, tags: ['kinetic', 'evasion'], enemy: null,
    desc: 'Полое ядро тянет к себе всё, что попало в поле. Обломки коры не дают выйти на прямую.',
    modifiers: { gravityPull: 240 }, placement: { kind: 'normal', minLevel: 7, maxLevel: 10, weight: 1.2 },
  },
  rift: {
    id: 'rift', name: 'РАЗЛОМ', color: '#2a1040', tier: 3, recommendedLevel: 10,
    waveCount: 12,
    asteroids: 2, drops: 0, tags: [], enemy: 'distortion',
    desc: 'Гравитация тянет к центру, изредка вспыхивают случайные порталы. Вес эпических карточек ×2.',
    modifiers: { gravityPull: 420, riftPortals: true, epicWeightMul: 2 }, placement: { kind: 'wildcardFinal', unique: true },
  },
  singularity: {
    id: 'singularity', name: 'СИНГУЛЯРНОСТЬ', color: '#010103', tier: 3, recommendedLevel: 10,
    waveCount: 0,
    asteroids: 0, drops: 0, tags: [], enemy: null,
    desc: 'Пять минут абсолютной пустоты. Существует только за кратким проходом в Разломе.',
    modifiers: {}, placement: { kind: 'realm' }, combat: false,
  },
};

export const LOCATION_ORDER = Object.keys(LOCATIONS);
export const getLocation = (id) => LOCATIONS[id] ?? LOCATIONS.open;

/**
 * ПАЛИТРА ЛОКАЦИИ. Локация должна ощущаться другой ещё до того, как игрок
 * разглядит декор, — поэтому у неба четыре независимых слоя, а не один
 * оттенок точек (см. world/starfield.js).
 *
 *   sky/sky2   — вертикальный градиент под звёздным полем
 *   star       — доминирующий оттенок звёзд
 *   dim        — насколько звёзды тусклее обычного
 *   haze       — цвет огромных пятен дымки на дальнем параллаксе
 *   hazeAmount — доля ячеек с дымкой (0 — чистое небо, 1 — сплошь)
 *   hazeAlpha  — насколько дымка плотная
 *   body       — цвет подсветки дальних тел (планет и колец)
 *   bodyAmount — как часто они встречаются, в процентах ячеек
 *   motes      — плотность мелкой крупы у камеры (ощущение скорости)
 *
 * Ключ подхода: чем плотнее ближние слои, тем тусклее должны быть звёзды —
 * иначе биом превращается в кашу, где не видно ни снарядов, ни врагов.
 * Читаемость боя важнее красоты фона, поэтому dim у «густых» биомов низкий.
 */
export const PALETTES = {
  start: {
    sky: '#140b07', sky2: '#050305', star: '#ffd7ad', dim: 0.82,
    haze: '#6b3c22', hazeAmount: 0.38, hazeAlpha: 0.13,
    body: '#c98a5a', bodyAmount: 40, motes: 0.14,
  },
  open: {
    sky: '#05060d', sky2: '#010208', star: '#ffffff', dim: 1,
    haze: '#1d3468', hazeAmount: 0.26, hazeAlpha: 0.11,
    body: '#5a7ac9', bodyAmount: 30, motes: 0.08,
  },
  belt: {
    sky: '#0f0a06', sky2: '#040302', star: '#ffe6c2', dim: 0.88,
    haze: '#7a5a2e', hazeAmount: 0.5, hazeAlpha: 0.14,
    body: '#c9a05a', bodyAmount: 62, motes: 0.42,
  },
  grove: {
    sky: '#04130e', sky2: '#010705', star: '#8fffd0', dim: 0.8,
    haze: '#0f5540', hazeAmount: 0.4, hazeAlpha: 0.08,
    body: '#3fbf8a', bodyAmount: 26, motes: 0.24,
  },
  nebula: {
    sky: '#0c0718', sky2: '#04020c', star: '#cbb6ff', dim: 0.5,
    haze: '#5c34a8', hazeAmount: 0.55, hazeAlpha: 0.085,
    body: '#a07ae0', bodyAmount: 22, motes: 0.3,
  },
  acid: {
    sky: '#0b0f04', sky2: '#040602', star: '#d3ef76', dim: 0.64,
    haze: '#4a6614', hazeAmount: 0.38, hazeAlpha: 0.07,
    body: '#a8cc4a', bodyAmount: 24, motes: 0.36,
  },
  graveyard: {
    sky: '#051110', sky2: '#020707', star: '#c2fff0', dim: 0.78,
    haze: '#1d5c56', hazeAmount: 0.44, hazeAlpha: 0.13,
    body: '#4ac9b8', bodyAmount: 54, motes: 0.3,
  },
  ionstorm: {
    sky: '#04101b', sky2: '#01050b', star: '#cdf3ff', dim: 1.05,
    haze: '#1d5a8c', hazeAmount: 0.44, hazeAlpha: 0.12,
    body: '#5aa8d9', bodyAmount: 28, motes: 0.2,
  },
  nest: {
    sky: '#12050a', sky2: '#060104', star: '#ffc8dd', dim: 0.8,
    haze: '#7a2818', hazeAmount: 0.4, hazeAlpha: 0.08,
    body: '#d9603f', bodyAmount: 34, motes: 0.26,
  },
  dissonance: {
    sky: '#06070d', sky2: '#020308', star: '#d2dcff', dim: 0.9,
    haze: '#3a4a80', hazeAmount: 0.34, hazeAlpha: 0.1,
    body: '#7a8ad9', bodyAmount: 30, motes: 0.16,
  },
  dust: {
    sky: '#0e0913', sky2: '#050308', star: '#ffd6ff', dim: 0.9,
    haze: '#5c3a70', hazeAmount: 0.52, hazeAlpha: 0.1,
    body: '#a06ac0', bodyAmount: 22, motes: 0.5,
  },
  hollow_moon: {
    sky: '#070a12', sky2: '#020308', star: '#e8eef7', dim: 1.1,
    haze: '#38466e', hazeAmount: 0.3, hazeAlpha: 0.09,
    body: '#c9d6ea', bodyAmount: 70, motes: 0.18,
  },
  rift: {
    sky: '#0a0412', sky2: '#030108', star: '#e0ccff', dim: 0.66,
    haze: '#5a1fa8', hazeAmount: 0.5, hazeAlpha: 0.095,
    body: '#9a4ae0', bodyAmount: 26, motes: 0.34,
  },
  // Сингулярность — единственное место, где выключено вообще всё. Это её
  // содержание: пять минут абсолютной пустоты.
  singularity: {
    sky: '#000000', sky2: '#000000', star: '#000000', dim: 0,
    haze: null, hazeAmount: 0, hazeAlpha: 0,
    body: null, bodyAmount: 0, motes: 0,
  },
};

export const paletteFor = (id) => PALETTES[id] ?? PALETTES.open;
