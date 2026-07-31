/**
 * Сквозные правила особых локаций. Здесь намеренно нет импорта данных мира:
 * политика должна одинаково работать из gameplay, UI и автономных bench-тестов.
 */

export const currentLocationId = (game) => game?.run?.realm?.id ?? game?.run?.location ?? 'open';

export function acidActive(game) {
  return currentLocationId(game) === 'acid'
    && !game?.run?.locationSpecials?.acidProtection;
}

/**
 * ignorePerkNoHeal нужен только «Кровавому пакту»: его убийства обходят
 * собственное проклятие, но никогда не обходят кислотное облако.
 */
export function healingBlocked(game, { ignorePerkNoHeal = false } = {}) {
  if (acidActive(game)) return true;
  return !ignorePerkNoHeal && !!game?.player?.effects?.flags?.noHeal;
}

export function navigationCapabilities(game) {
  const id = currentLocationId(game);
  const disabled = id === 'dust' || id === 'singularity';
  return {
    map: !disabled,
    minimap: !disabled,
    waypoint: !disabled,
    signals: !disabled,
    // Диссонанс не выключает карту: presentation-слой имеет право лгать,
    // не меняя канонические координаты или сохранённую метку.
    deceived: !!game?.run?.locationSpecials?.hallucination?.active,
  };
}

export const hallucinationActive = (game) =>
  !!game?.run?.locationSpecials?.hallucination?.active;

/** Детерминированная ложь для UI: модель игры остаётся нетронутой. */
export function hallucinatedNumber(game, actual, channel = 'generic') {
  if (!hallucinationActive(game) || !Number.isFinite(actual)) return actual;
  const seed = game.run.locationSpecials.hallucination.seed ?? 0;
  let channelHash = 0;
  for (let i = 0; i < channel.length; i++) channelHash = (channelHash * 31 + channel.charCodeAt(i)) | 0;
  const time = game.time ?? game.run.locationSpecials.hallucination.elapsed ?? 0;
  const wave = Math.sin(time * 0.73 + seed * 0.001 + channelHash * 0.017);
  return Math.max(0, actual * (0.58 + (wave + 1) * 0.46));
}
