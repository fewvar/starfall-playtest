/**
 * Крошечная шина событий.
 *
 * Нужна, чтобы системы не импортировали друг друга по кругу:
 * боевая система шлёт 'enemy:killed', прогрессия ловит и начисляет опыт,
 * UI ловит и рисует. Добавляя новую фичу, просто подпишись на событие.
 *
 * Список используемых событий:
 *   run:start        — начался забег
 *   run:over         { score, wave, scrap }
 *   wave:start       { wave, biomeWave, biomeTotal, biomeId, isBoss, mode }
 *   wave:clear       { wave, biomeWave, biomeTotal, biomeId, regularCleared, mode }
 *   wave:abandoned   { wave, biomeWave, biomeId }
 *   biome:regular-cleared — в территории больше не будет обычных врагов
 *   biome:quiet      { biomeId, progress }
 *   enemy:killed     { enemy }
 *   boss:spawn       { boss, def, biomeId? }
 *   boss:killed      { boss }
 *   boss:defeated    { boss, def, reward }
 *   boss:escaped     { biomeId }
 *   player:hurt      { damage }
 *   player:levelup   { level }
 *   reward:offer     { choices }
 *   reward:taken     { reward }
 *   scrap:gain       { amount }
 */
const listeners = new Map();

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => off(type, fn);
}

export function off(type, fn) {
  listeners.get(type)?.delete(fn);
}

export function emit(type, payload) {
  const set = listeners.get(type);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[events] ошибка в обработчике "${type}"`, err);
    }
  }
}

/** Полная очистка — на случай перезапуска игры без перезагрузки страницы. */
export function clearAll() {
  listeners.clear();
}
