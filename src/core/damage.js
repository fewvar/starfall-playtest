import { clamp, hyper } from './math.js';

/** Общие обозначения и чистая математика системы типов урона. */
export const DAMAGE_TYPE = Object.freeze({
  PHYSICAL: 'physical',
  TECHNICAL: 'technical',
});

// Два очка дают ровно 10%: hyper(1 / 18, 2) = 0.1.
export const RESIST_A = 1 / 18;
export const RESIST_CAP = 0.75;

export function normalizeDamageType(type, fallback = DAMAGE_TYPE.PHYSICAL) {
  return type === DAMAGE_TYPE.TECHNICAL || type === DAMAGE_TYPE.PHYSICAL ? type : fallback;
}

export const normalizeResistance = (value) => clamp(Number(value) || 0, 0, RESIST_CAP);
export const normalizePenetration = (value) => clamp(Number(value) || 0, 0, RESIST_CAP);

/** Сопротивление игрока хранится очками и набирается гиперболически. */
export const resistanceFromPoints = (points) => normalizeResistance(hyper(RESIST_A, Number(points) || 0));

/** Пробитие вычитается из уже рассчитанного сопротивления цели. */
export const resistanceAfterPenetration = (resistance, penetration = 0) =>
  normalizeResistance(normalizeResistance(resistance) - normalizePenetration(penetration));

export const resistanceFactor = (resistance, penetration = 0) =>
  1 - resistanceAfterPenetration(resistance, penetration);

/** Нормализованный payload копируется от корня урона всем его потомкам. */
export function normalizeDamageSpec(spec = {}) {
  return {
    type: normalizeDamageType(spec.type),
    penetration: normalizePenetration(spec.penetration),
    fromEffect: !!spec.fromEffect,
  };
}
