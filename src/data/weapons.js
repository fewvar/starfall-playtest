/**
 * Стволы. Каждый — своя механика, а не перекрашенный лазер: разное поведение
 * снаряда, разная форма зоны поражения, разный входной паттерн (удержание,
 * заряд, размещение). Цифровой урон — только часть истории.
 *
 * kind определяет, как снаряд себя ведёт (реализация в entities/projectiles.js):
 *   bullet    — обычный снаряд
 *   plasma    — медленный шар со взрывом по площади
 *   beam      — мгновенный луч (хитскан) насквозь
 *   missile   — самонаводящаяся ракета со взрывом
 *   chain     — прыгает на ближайшего необстрелянного врага, урон падает за прыжок
 *   boomerang — летит вперёд и возвращается к текущей позиции корабля
 *   lob       — навесом, не задевает по пути, взрывается по прибытии
 *   ricochet  — отскакивает от врагов И астероидов заданное число раз
 *   tether    — канал: тикает, пока зажата кнопка, часть урона лечит игрока
 *   spawner   — вместо снаряда ставит турель с автонаведением на время
 *   radial    — залп по кругу, короткая дальность
 *   split     — при попадании распадается на несколько уменьшенных снарядов
 *   charge    — урон растёт при удержании кнопки, выстрел — по отпусканию
 *
 * Здесь лежит только база ствола. Прокачка игрока (слои урона, скорость
 * атаки, снаряды) применяется поверх в entities/player.js, поэтому смена
 * ствола ничего не обнуляет.
 *
 * Чтобы добавить ствол: опиши его здесь, добавь id в ORDER,
 * и при желании карточку разблокировки в data/perks.js.
 */
export const WEAPONS = {
  blaster: {
    id: 'blaster', name: 'БЛАСТЕР', icon: '↠', kind: 'bullet', color: '#cdf3ff',
    dmg: 10, rate: 0.18, speed: 800, count: 1, spread: 0.1, life: 0.95,
    desc: '1 импульс: 10 базового урона. Базовая пауза между выстрелами — 0.18 с.',
  },
  scatter: {
    id: 'scatter', name: 'ДРОБОВИК', icon: '⋔', kind: 'bullet', color: '#ffd08a',
    dmg: 7.5, rate: 0.58, speed: 700, count: 6, spread: 0.2, life: 0.38, falloff: 700,
    desc: '6 дробин по 7.5 базового урона; к дистанции 700 урон падает до 25%. Базовая пауза — 0.58 с.',
  },
  plasma: {
    id: 'plasma', name: 'ПЛАЗМА', icon: '⊙', kind: 'plasma', color: '#c99bff',
    provides: ['blastRadius', 'friendlyBlast'],
    dmg: 26, rate: 0.66, speed: 430, count: 1, spread: 0.03, life: 1.6, splash: 78,
    desc: '26 базового урона при попадании и взрыв радиусом 78. Базовая пауза — 0.66 с; отдача толкает корабль назад.',
  },
  rail: {
    id: 'rail', name: 'РЕЛЬСА', icon: '⌁', kind: 'beam', color: '#7ee8ff',
    dmg: 52, rate: 1.05, speed: 0, count: 1, spread: 0, life: 0.1, range: 1500,
    desc: 'Мгновенный луч дальностью 1500: 52 базового урона всем целям на линии. Базовая пауза — 1.05 с.',
  },
  swarm: {
    id: 'swarm', name: 'РОЙ РАКЕТ', icon: '⇶', kind: 'missile', color: '#ff8a5e',
    provides: ['blastRadius', 'friendlyBlast'],
    dmg: 17, rate: 0.8, speed: 330, count: 3, spread: 0.5, life: 2.6,
    splash: 62, homing: 3.2,
    desc: '3 самонаводящиеся ракеты по 17 базового урона, каждая взрывается в радиусе 62. Базовая пауза — 0.8 с.',
  },

  chain: {
    id: 'chain', name: 'ЦЕПЬ', icon: '⇄', kind: 'chain', color: '#5ef0d0',
    provides: ['chain'],
    dmg: 14, rate: 0.5, speed: 620, count: 1, spread: 0.05, life: 1.0,
    chainJumps: 4, chainFalloff: 0.75, chainRadius: 300,
    desc: '14 базового урона первой цели и до 4 прыжков на новые цели; после каждого прыжка остаётся 75% урона. Базовая пауза — 0.5 с.',
  },
  boomerang: {
    id: 'boomerang', name: 'ДИСК', icon: '↩', kind: 'boomerang', color: '#ffe066',
    dmg: 16, rate: 0.7, speed: 480, count: 1, spread: 0.05, life: 1.4, pierce: 2,
    desc: '16 базового урона; на середине полёта возвращается к кораблю и может повторно задеть прежнюю цель. Базовая пауза — 0.7 с.',
  },
  lob: {
    id: 'lob', name: 'МИНОМЁТ', icon: '⌒', kind: 'lob', color: '#ff7a45',
    provides: ['blastRadius', 'friendlyBlast'],
    dmg: 70, rate: 1.1, speed: 260, count: 1, spread: 0.06, life: 0.95, splash: 115,
    desc: 'Летит сквозь цели и по прибытии взрывается в радиусе 115 с 42 базового урона. Базовая пауза — 1.1 с.',
  },
  ricochet: {
    id: 'ricochet', name: 'ОСКОЛОЧНИК', icon: '⋈', kind: 'ricochet', color: '#cbe86b',
    dmg: 11, rate: 0.4, speed: 560, count: 1, spread: 0.08, life: 1.6, ricochet: 5,
    desc: '11 базового урона и до 5 отскоков от врагов или астероидов. Базовая пауза — 0.4 с.',
  },
  tether: {
    id: 'tether', name: 'ПИЯВКА', icon: '≈', kind: 'tether', color: '#ff4a6b',
    dmg: 5, rate: 0.06, range: 260, vamp: 0.2,
    desc: 'Канал дальностью 260: 5 базового урона каждые 0.06 с, 20% нанесённого урона возвращается в HP.',
  },
  spawner: {
    id: 'spawner', name: 'СЕЯЛКА', icon: '⊞', kind: 'spawner', color: '#5ef08a',
    provides: ['spawner'],
    dmg: 9, rate: 1.4, turretLife: 9, turretRange: 380, turretRate: 0.5,
    desc: 'Каждые 1.4 с ставит турель на 9 с: дальность 380, 9 базового урона каждые 0.5 с. Одновременно — до 3 турелей.',
  },
  radial: {
    id: 'radial', name: 'НОВА', icon: '⊹', kind: 'radial', color: '#b06bff',
    dmg: 13, rate: 0.55, speed: 520, count: 10, life: 0.32,
    desc: '10 снарядов по кругу, по 13 базового урона; базовая дальность полёта 166.4. Базовая пауза — 0.55 с.',
  },
  split: {
    id: 'split', name: 'ПРИЗМА', icon: '◬', kind: 'split', color: '#e879f9',
    provides: ['split'],
    dmg: 15, rate: 0.5, speed: 640, count: 1, spread: 0.05, life: 0.9,
    splitCount: 3, splitDamageMul: 0.45, splitSpread: 0.55,
    desc: '15 базового урона; первое попадание создаёт 3 осколка по 45% урона. Базовая пауза — 0.5 с.',
  },
  charge: {
    id: 'charge', name: 'ОСАДНОЕ', icon: '◍', kind: 'charge', color: '#ffcf5e',
    // rate здесь не используется для гейтинга выстрела (см. main.js — там
    // отдельная ветка на удержание/отпускание), но нужен конечным числом,
    // иначе fireInterval() даст NaN и застрянет в p.fireCooldown после смены ствола.
    dmg: 20, rate: 0.5, speed: 900, count: 1, spread: 0, life: 1.0, pierce: 1,
    chargeMax: 1.2, chargeMinMul: 0.25, chargeMaxMul: 2.5,
    desc: 'Держи ЛКМ до 1.2 с: базовый урон растёт с 5 до 50; выстрел по отпусканию пробивает 1 дополнительную цель.',
  },
};

/** Порядок в панели оружия и в слотах выбора. */
export const WEAPON_ORDER = [
  'blaster', 'scatter', 'plasma', 'rail', 'swarm',
  'chain', 'boomerang', 'lob', 'ricochet', 'tether',
  'spawner', 'radial', 'split', 'charge',
];

export const getWeapon = (id) => WEAPONS[id] || WEAPONS.blaster;
