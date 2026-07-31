/**
 * Ангар: перманентные улучшения между забегами.
 * Стоимость растёт с уровнем: cost(level) = base * (1 + level * growth).
 *
 * apply получает игрока на старте забега — до того, как начнётся первая волна.
 */
export const HANGAR = [
  { id: 'hull', icon: '▣', name: 'УСИЛЕННЫЙ КОРПУС', max: 8, base: 90, growth: 0.55,
    desc: '+12 к стартовому запасу HP за уровень',
    apply: (p, lvl) => { p.maxHp += 12 * lvl; p.hp = p.maxHp; } },
  { id: 'shield', icon: '◎', name: 'ГЕНЕРАТОР ЩИТА', max: 6, base: 140, growth: 0.6,
    desc: '+15 стартового щита и +2 регенерации за уровень',
    apply: (p, lvl) => { p.maxShield += 15 * lvl; p.shield = p.maxShield; p.shieldRegen += 2 * lvl; } },
  { id: 'power', icon: '◆', name: 'БОЕВОЙ РЕАКТОР', max: 6, base: 160, growth: 0.65,
    desc: '+6% урона за уровень',
    apply: (p, lvl) => (p.dmgAdd += 0.06 * lvl) },
  { id: 'cooling', icon: '⇈', name: 'КОНТУР ОХЛАЖДЕНИЯ', max: 5, base: 180, growth: 0.7,
    desc: '+6% скорости атаки за уровень',
    apply: (p, lvl) => (p.attackSpeed += 0.06 * lvl) },
  { id: 'engines', icon: '⇉', name: 'ФОРСИРОВАННАЯ ТЯГА', max: 5, base: 120, growth: 0.6,
    desc: '+5% тяги (ускорения) и максимальной скорости за уровень',
    apply: (p, lvl) => { p.thrust *= Math.pow(1.05, lvl); p.maxSpeed *= Math.pow(1.05, lvl); } },
  { id: 'magnet', icon: '∪', name: 'ГРАВИ-КОЛЛЕКТОР', max: 4, base: 80, growth: 0.5,
    desc: '+25% радиуса сбора лута за уровень',
    apply: (p, lvl) => (p.magnet *= Math.pow(1.25, lvl)) },
  { id: 'drone', icon: '⊹', name: 'ЭСКОРТ-ДРОН', max: 2, base: 320, growth: 0.9,
    desc: '+1 стартовый дрон-турель за уровень',
    apply: (p, lvl) => { for (let i = 0; i < lvl; i++) p.addDrone(); } },
  { id: 'salvage', icon: '▩', name: 'ПЕРЕРАБОТЧИК', max: 5, base: 150, growth: 0.7,
    desc: '×1.12 к получаемым обломкам за уровень',
    apply: (p, lvl) => (p.scrapMul *= Math.pow(1.12, lvl)) },
  { id: 'reroll', icon: '⟳', name: 'ТАКТИЧЕСКИЙ АНАЛИЗ', max: 3, base: 200, growth: 0.8,
    desc: '+1 стартовый переброс карточек за уровень',
    apply: (p, lvl) => (p.rerolls += lvl) },
  { id: 'abilityslot', icon: '⌬', name: 'ЧЕТВЁРТЫЙ СЛОТ', max: 1, base: 3000, growth: 0,
    desc: '+1 слот активных способностей (итого 4 у обычных кораблей)',
    apply: (p) => (p.abilitySlots += 1) },
];

export const hangarById = Object.fromEntries(HANGAR.map((h) => [h.id, h]));

export const upgradeCost = (item, level) =>
  Math.round(item.base * (1 + level * item.growth));
