/**
 * Корабли. Задают старт забега: статы, стартовый ствол, рост по уровням.
 * Разблокируются за обломки в ангаре.
 *
 * Модель Brotato: у каждого (кроме РАЗВЕДЧИКА) есть штраф вместе с бонусом.
 * Штраф важнее бонуса — именно он вынуждает строить билд вокруг сильной
 * стороны корабля, а не играть его как обычного бойца с другим цветом.
 *
 *   growth(p, level) — вызывается один раз при каждом level-up (см.
 *                       systems/progression.js), задаёт уникальную прокачку
 *   hook(p)          — разовый билд-образующий эффект при старте забега,
 *                       который не выражается готовым множителем (Молот)
 *   tags             — направление билда, кренит пул карт с первого выбора
 *                       (см. systems/tags.js — актуально с этапа перков)
 */
export const SHIPS = {
  scout: {
    id: 'scout', name: 'РАЗВЕДЧИК', icon: '△', cost: 0,
    hp: 100, shield: 0, thrust: 620, maxSpeed: 430, critPoints: 0.4, magnet: 170, ram: 14,
    weapon: 'blaster',
    perk: 'Сбалансирован. +4 HP и +0.02 скорости атаки за уровень, штрафов нет — лучший старт для нового билда.',
    growth: (p) => { p.maxHp += 4; p.hp += 4; p.attackSpeed += 0.02; },
    color: '#dff0ff',
  },

  wasp: {
    id: 'wasp', name: 'ОСА', icon: '≺', cost: 350,
    hp: 70, shield: 0, thrust: 780, maxSpeed: 540, critPoints: 1.3, magnet: 210, ram: 6,
    weapon: 'scatter', dashFromStart: true,
    provides: ['dash'],
    perk: 'На 30% меньше стартового HP, чем у Разведчика; +2.5% тяги и максимальной скорости за уровень. Билд через кайт и уклонение дистанцией.',
    growth: (p) => { p.maxSpeed *= 1.025; p.thrust *= 1.025; },
    tags: ['speed'],
    color: '#ffd08a',
  },

  hammer: {
    id: 'hammer', name: 'МОЛОТ', icon: '▰', cost: 500,
    hp: 170, shield: 40, thrust: 500, maxSpeed: 350, critPoints: 0.2, magnet: 150, ram: 8,
    weapon: 'plasma', attackSpeed: 0.8,
    perk: '−20% скорости атаки, но +9 максимума HP за уровень. Каждые 12 HP максимума — ещё +1% урона: билд через толщину корпуса.',
    growth: (p) => { p.maxHp += 9; p.hp += 9; },
    hook: (p) => {
      p.effects.damageMods.push({
        perk: { id: 'ship_hammer_mass' },
        fn: (game) => 1 + Math.floor(game.player.maxHp / 12) * 0.01,
      });
    },
    tags: ['defense'],
    color: '#ff9f43',
  },

  ghost: {
    id: 'ghost', name: 'ПРИЗРАК', icon: '◇', cost: 700,
    hp: 40, shield: 60, thrust: 700, maxSpeed: 480, critPoints: 0.8, magnet: 260, ram: 20,
    weapon: 'rail', shieldRegen: 12, dashFromStart: true,
    provides: ['dash'],
    perk: 'Стартует с 40 HP и 60 щита. За уровень: +5 максимального щита и +0.4 щита/с; корпус можно улучшать картами.',
    growth: (p) => { p.maxShield += 5; p.shield = Math.min(p.maxShield, p.shield + 5); p.shieldRegen += 0.4; },
    tags: ['defense'],
    color: '#7ee8ff',
  },

  lens: {
    id: 'lens', name: 'ЛИНЗА', icon: '◈', cost: 900,
    hp: 90, shield: 0, thrust: 600, maxSpeed: 420, critPoints: 0.6, magnet: 180, ram: 24,
    weapon: 'blaster', dmgMul: 0.7,
    perk: '−30% итогового урона, но +1.2 к коэффициенту шанса крита за уровень. Билд через шанс и множитель крита.',
    growth: (p) => { p.critPoints += 1.2; },
    tags: ['crit'],
    color: '#e879f9',
  },

  brood: {
    id: 'brood', name: 'РОЙ', icon: '⁘', cost: 1100,
    hp: 85, shield: 0, thrust: 580, maxSpeed: 400, critPoints: 0.3, magnet: 190, ram: 26,
    weapon: 'swarm', dmgMul: 0.6,
    perk: '−40% итогового урона, но +1 снаряд в залпе на каждом 4-м уровне. Билд через мультишот, разброс и рикошет.',
    growth: (p, level) => { if (level % 4 === 0) p.countAdd += 1; },
    tags: ['swarm'],
    color: '#ff6b8a',
  },

  oracle: {
    id: 'oracle', name: 'ОРАКУЛ', icon: '⌾', cost: 1400,
    hp: 95, shield: 0, thrust: 610, maxSpeed: 410, critPoints: 0.4, magnet: 230, ram: 30,
    weapon: 'blaster', dmgMul: 0.85,
    perk: '−15% всего урона, но +0.5 удачи за уровень. Билд через редкость карточек, лут и перебросы.',
    growth: (p) => { p.luck += 0.5; },
    tags: ['luck'],
    color: '#ffe066',
  },

  reactor: {
    id: 'reactor', name: 'РЕАКТОР', icon: '⬡', cost: 1600,
    hp: 100, shield: 20, thrust: 590, maxSpeed: 400, critPoints: 0.3, magnet: 170, ram: 34,
    weapon: 'blaster', dmgMul: 0.75, abilitySlots: 5,
    perk: '−25% итогового урона, но 5 слотов активных способностей вместо 3 и ×0.98 к их откату за уровень.',
    growth: (p) => { p.abilityCooldownMul *= 0.98; },
    tags: ['ability'],
    color: '#b06bff',
  },

  saturn: {
    id: 'saturn', name: 'САТУРН', icon: '⊕', cost: 1900,
    hp: 110, shield: 20, thrust: 560, maxSpeed: 390, critPoints: 0.3, magnet: 200, ram: 22,
    weapon: 'plasma', speedMul: 0.7,
    perk: '−30% скорости снарядов; за уровень +3% к радиусу взрывов, сбору лута, дальности турелей и зоне действия аур/орбиталов.',
    growth: (p) => {
      p.radiusMul *= 1.03;
      p.magnet *= 1.03;
      p.blastRadiusMul *= 1.03;
      p.orbitalRadiusMul *= 1.03;
    },
    tags: ['explosive', 'orbital'],
    color: '#5ef08a',
  },

  parasite: {
    id: 'parasite', name: 'ПАРАЗИТ', icon: '⟁', cost: 2400,
    hp: 120, shield: 0, thrust: 640, maxSpeed: 440, critPoints: 0.3, magnet: 180, ram: 12,
    weapon: 'scatter', passiveDrain: 1,
    perk: 'Теряет 1 HP в секунду постоянно, но +0.15% вампиризма за уровень. Без лайфстила это медленная смерть — билд только через него.',
    growth: (p) => { p.vamp += 0.0015; },
    tags: ['lifesteal'],
    color: '#ff4a6b',
  },
};

export const SHIP_ORDER = [
  'scout', 'wasp', 'hammer', 'ghost', 'lens',
  'brood', 'oracle', 'reactor', 'saturn', 'parasite',
];

export const getShip = (id) => SHIPS[id] || SHIPS.scout;
