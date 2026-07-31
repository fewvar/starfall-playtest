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
    asteroids: 6, drops: 0, tags: ['status', 'sustain'], enemy: null,
    desc: 'Живые заросли цепляют к корпусу растущее семя. Рывок срывает его.',
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
  rift: {
    id: 'rift', name: 'РАЗЛОМ', color: '#2a1040', tier: 3, recommendedLevel: 10,
    waveCount: 12,
    asteroids: 2, drops: 0, tags: [], enemy: 'distortion',
    desc: 'Гравитация тянет к центру, изредка вспыхивают случайные порталы. Вес эпических карточек ×2.',
    modifiers: { gravityPull: 420, epicWeightMul: 2 }, placement: { kind: 'wildcardFinal', unique: true },
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
 * ПАЛИТРА ЛОКАЦИИ: цвет космоса за звёздами и оттенок самих звёзд.
 * Локация должна ощущаться другой ещё до того, как игрок разглядит декор, —
 * поэтому меняется фон и звёзды, а не только цвет тумана.
 *
 *   sky   — заливка под звёздным полем
 *   star  — доминирующий оттенок звёзд
 *   dim   — насколько звёзды тусклее обычного (туманность глушит их)
 */
export const PALETTES = {
  start:     { sky: '#100906', star: '#ffd7ad', dim: 0.82 },
  open:      { sky: '#05060d', star: '#ffffff', dim: 1 },
  belt:      { sky: '#0b0806', star: '#ffe6c2', dim: 0.9 },
  grove:     { sky: '#03100c', star: '#8fffd0', dim: 0.82 },
  nebula:    { sky: '#0a0714', star: '#cbb6ff', dim: 0.55 },
  acid:      { sky: '#0a0d03', star: '#d3ef76', dim: 0.68 },
  graveyard: { sky: '#040c0b', star: '#c2fff0', dim: 0.8 },
  ionstorm:  { sky: '#040b12', star: '#cdf3ff', dim: 1.1 },
  nest:      { sky: '#0d0409', star: '#ffc8dd', dim: 0.85 },
  dissonance:{ sky: '#05070b', star: '#d2dcff', dim: 0.92 },
  dust:      { sky: '#0c0811', star: '#ffd6ff', dim: 0.94 },
  rift:      { sky: '#08040f', star: '#e0ccff', dim: 0.7 },
  singularity:{ sky: '#000000', star: '#000000', dim: 0 },
};

export const paletteFor = (id) => PALETTES[id] ?? PALETTES.open;
