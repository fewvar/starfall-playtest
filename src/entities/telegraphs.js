/**
 * ТЕЛЕГРАФЫ — подсветка опасной зоны за 0.6-1.4 секунды до удара босса.
 * Без них сложность нечестная: игрок должен видеть, куда НЕ надо лететь,
 * и всегда иметь читаемую безопасную зону.
 *
 * Слой чисто визуальный: телеграф ничего не наносит и ничего не вызывает.
 * Боссы ведут свои таймеры сами и бьют по их истечении, а телеграф ставят
 * с той же длительностью — поэтому расхождения быть не может, пока обе
 * стороны берут число из одного места (см. entities/bosses.js).
 *
 * Все зоны рисуются одним проходом (render/renderer.js:drawTelegraphs),
 * а не фигурой на объект: на третьей фазе их бывает десяток одновременно.
 */
export function createTelegraphState() {
  return { telegraphs: [] };
}

/**
 * spec:
 *   kind: 'circle' | 'cone' | 'line' | 'ring'
 *   life: сколько секунд светится (= сколько осталось до удара)
 *   circle: x, y, r
 *   cone:   x, y, r, angle, arc
 *   line:   x1, y1, x2, y2, width
 *   ring:   x, y, r (внешний), r2 (внутренний, куда кольцо сожмётся)
 */
export function telegraph(game, spec) {
  game.telegraphs.push({ color: '#ff3b6b', ...spec, max: spec.life });
}

export function updateTelegraphs(game, dt) {
  const list = game.telegraphs;
  for (let i = list.length - 1; i >= 0; i--) {
    list[i].life -= dt;
    if (list[i].life <= 0) list.splice(i, 1);
  }
}

export function clearTelegraphs(game) {
  game.telegraphs.length = 0;
}
