/**
 * Пространственная сетка для широкой фазы коллизий.
 *
 * Без неё каждый снаряд проверяется против каждого врага и каждого астероида:
 * 300 снарядов × 180 объектов = 54 000 проверок за кадр. С сеткой снаряд
 * смотрит только в свою клетку и соседние — на порядок меньше работы.
 *
 * Сетка перестраивается каждый кадр: объекты двигаются, и хранить их
 * между кадрами дороже, чем разложить заново.
 */

const CELL = 240;

export function createGrid(cell = CELL) {
  return { cell, buckets: new Map() };
}

const keyOf = (cx, cy) => cx * 73856093 ^ cy * 19349663;

export function rebuildGrid(grid, items) {
  grid.buckets.clear();
  const { cell, buckets } = grid;
  for (const item of items) {
    const cx = Math.floor(item.x / cell);
    const cy = Math.floor(item.y / cell);
    const key = keyOf(cx, cy);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
}

/**
 * Вызывает fn для каждого кандидата рядом с точкой.
 * radius — насколько далеко может дотянуться проверка (радиус снаряда + запас).
 * Возврат true из fn прекращает обход.
 */
export function queryGrid(grid, x, y, radius, fn) {
  const { cell, buckets } = grid;
  const minX = Math.floor((x - radius) / cell);
  const maxX = Math.floor((x + radius) / cell);
  const minY = Math.floor((y - radius) / cell);
  const maxY = Math.floor((y + radius) / cell);

  for (let cx = minX; cx <= maxX; cx++) {
    for (let cy = minY; cy <= maxY; cy++) {
      const bucket = buckets.get(keyOf(cx, cy));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        if (fn(bucket[i]) === true) return;
      }
    }
  }
}
