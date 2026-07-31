/**
 * Единые форматтеры карточек-обёрток.
 *
 * Канонический текст оружия и активной способности хранится рядом с её
 * механикой. Карточка только добавляет контекст разблокировки и, для активки,
 * фактический откат — отдельную копию описания поддерживать не нужно.
 */

const withPeriod = (text) => {
  const clean = String(text ?? '').trim();
  if (!clean) return '';
  return /[.!?…]$/u.test(clean) ? clean : `${clean}.`;
};

const formatSeconds = (seconds) => {
  const value = Number(seconds);
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
};

export function weaponUnlockDescription(weapon) {
  return `Новый ствол: ${withPeriod(weapon?.desc)}`;
}

export function abilityCardDescription(ability) {
  return `АКТИВНАЯ СПОСОБНОСТЬ: ${withPeriod(ability?.desc)} Откат: ${formatSeconds(ability?.cooldown)} с.`;
}
