import { hash32 } from '../core/rng.js';

/**
 * Три слоя звёзд рисуются процедурно от координат камеры —
 * параллакс без единого массива объектов.
 */
const LAYERS = [
  { parallax: 0.18, size: 1.0, alpha: 0.4, cell: 120, salt: 11 },
  { parallax: 0.38, size: 1.6, alpha: 0.6, cell: 180, salt: 22 },
  { parallax: 0.7,  size: 2.4, alpha: 0.9, cell: 300, salt: 33 },
];

/**
 * palette — из data/locations.js:paletteFor. Меняет оттенок и яркость звёзд,
 * чтобы локация читалась даже на пустом небе, без декора и тумана.
 */
export function drawStarfield(ctx, camera, W, H, time, palette = null) {
  const tint = palette?.star ?? '#ffffff';
  const dim = palette?.dim ?? 1;
  for (const layer of LAYERS) {
    const ox = (camera.skyX ?? camera.x) * layer.parallax;
    const oy = (camera.skyY ?? camera.y) * layer.parallax;
    const x0 = Math.floor((ox - W / 2) / layer.cell);
    const x1 = Math.floor((ox + W / 2) / layer.cell);
    const y0 = Math.floor((oy - H / 2) / layer.cell);
    const y1 = Math.floor((oy + H / 2) / layer.cell);

    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const h = hash32(gx, gy, layer.salt);
        const sx = gx * layer.cell + (h % layer.cell);
        const sy = gy * layer.cell + ((h >>> 8) % layer.cell);
        ctx.globalAlpha = layer.alpha * dim * (0.6 + 0.4 * Math.sin(time * 1.6 + (h % 100)));
        // редкие звёзды остаются «своими» тёплой и холодной, остальные красятся
        // в оттенок локации: так небо меняется, но не превращается в один цвет
        ctx.fillStyle = h % 17 === 0 ? '#ffd6a0' : h % 11 === 0 ? '#a0c8ff' : tint;
        ctx.fillRect(sx - ox + W / 2, sy - oy + H / 2, layer.size, layer.size);
      }
    }
  }
  ctx.globalAlpha = 1;
}
