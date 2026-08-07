import { hash32 } from '../core/rng.js';
import { TAU } from '../core/math.js';

/**
 * НЕБО. Четыре слоя, все процедурные от координат камеры — ни одного массива
 * объектов и ни одной картинки.
 *
 *   1. градиент — низ темнее верха, чтобы пустота не была плоской заливкой;
 *   2. дымка   — редкие огромные пятна на самом дальнем параллаксе: это они
 *                делают локацию «местом», а не чёрным фоном со звёздами;
 *   3. звёзды  — три слоя с параллаксом, плюс редкие яркие с лучами;
 *   4. пылинки — мелкая крупа у самой камеры, по ней читается скорость.
 *
 * Раньше слой был один (звёзды) и вся разница между биомами сводилась к
 * оттенку точек — отсюда и «палитра скудная». Теперь у каждого биома свой
 * градиент, своя дымка и своя плотность крупы.
 */

const LAYERS = [
  { parallax: 0.18, size: 1.0, alpha: 0.4, cell: 120, salt: 11 },
  { parallax: 0.38, size: 1.6, alpha: 0.6, cell: 180, salt: 22 },
  { parallax: 0.7, size: 2.4, alpha: 0.9, cell: 300, salt: 33 },
];

/** Дымка идёт медленнее всех: она «дальше» самых дальних звёзд. */
const HAZE = { parallax: 0.06, cell: 820, salt: 77 };
const MOTES = { parallax: 1.15, cell: 260, salt: 91 };

let skyCache = { key: '', gradient: null };

function skyGradient(ctx, palette, W, H) {
  const key = `${palette.sky}|${palette.sky2}|${W}x${H}`;
  if (skyCache.key !== key) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, palette.sky);
    g.addColorStop(1, palette.sky2 ?? palette.sky);
    skyCache = { key, gradient: g };
  }
  return skyCache.gradient;
}

/** Заливка неба под звёздами. Вызывается до всего остального. */
export function drawSky(ctx, W, H, palette) {
  ctx.fillStyle = skyGradient(ctx, palette, W, H);
  ctx.fillRect(0, 0, W, H);
}

/**
 * Каждая ячейка сетки либо пуста, либо держит одно пятно дымки. Плотность
 * задаёт биом: у Туманности почти сплошь, у открытого космоса — изредка.
 */
function drawHaze(ctx, camera, W, H, time, palette) {
  const amount = palette.hazeAmount ?? 0;
  if (amount <= 0 || !palette.haze) return;
  const ox = (camera.skyX ?? camera.x) * HAZE.parallax;
  const oy = (camera.skyY ?? camera.y) * HAZE.parallax;
  const x0 = Math.floor((ox - W / 2 - HAZE.cell) / HAZE.cell);
  const x1 = Math.floor((ox + W / 2 + HAZE.cell) / HAZE.cell);
  const y0 = Math.floor((oy - H / 2 - HAZE.cell) / HAZE.cell);
  const y1 = Math.floor((oy + H / 2 + HAZE.cell) / HAZE.cell);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let gx = x0; gx <= x1; gx++) {
    for (let gy = y0; gy <= y1; gy++) {
      const h = hash32(gx, gy, HAZE.salt);
      if ((h % 100) / 100 >= amount) continue;
      const cx = gx * HAZE.cell + (h % HAZE.cell) - ox + W / 2;
      const cy = gy * HAZE.cell + ((h >>> 9) % HAZE.cell) - oy + H / 2;
      const r = 320 + ((h >>> 17) % 520);
      // очень медленное дыхание: пятно не должно «мигать», только жить
      const breathe = 0.82 + 0.18 * Math.sin(time * 0.13 + (h % 63));
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * breathe);
      g.addColorStop(0, palette.haze);
      g.addColorStop(1, 'transparent');
      ctx.globalAlpha = (palette.hazeAlpha ?? 0.1) * breathe;
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  ctx.restore();
}

/** Мелкая крупа у самой камеры: по ней читается собственная скорость. */
function drawMotes(ctx, camera, W, H, palette) {
  const amount = palette.motes ?? 0;
  if (amount <= 0) return;
  const ox = (camera.skyX ?? camera.x) * MOTES.parallax;
  const oy = (camera.skyY ?? camera.y) * MOTES.parallax;
  const x0 = Math.floor((ox - W / 2) / MOTES.cell);
  const x1 = Math.floor((ox + W / 2) / MOTES.cell);
  const y0 = Math.floor((oy - H / 2) / MOTES.cell);
  const y1 = Math.floor((oy + H / 2) / MOTES.cell);

  ctx.fillStyle = palette.star;
  for (let gx = x0; gx <= x1; gx++) {
    for (let gy = y0; gy <= y1; gy++) {
      const h = hash32(gx, gy, MOTES.salt);
      if ((h % 100) / 100 >= amount) continue;
      ctx.globalAlpha = 0.1 + ((h >>> 7) % 18) / 100;
      ctx.fillRect(
        gx * MOTES.cell + (h % MOTES.cell) - ox + W / 2,
        gy * MOTES.cell + ((h >>> 11) % MOTES.cell) - oy + H / 2,
        1.4, 1.4,
      );
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * palette — из data/locations.js:paletteFor. Меняет оттенок и яркость звёзд,
 * плотность дымки и крупы: локация читается даже на пустом небе, без декора.
 */
export function drawStarfield(ctx, camera, W, H, time, palette = null) {
  const p = palette ?? {};
  const tint = p.star ?? '#ffffff';
  const dim = p.dim ?? 1;
  if (dim <= 0) return;   // Сингулярность: буквально ничего

  drawHaze(ctx, camera, W, H, time, p);

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
        const sx = gx * layer.cell + (h % layer.cell) - ox + W / 2;
        const sy = gy * layer.cell + ((h >>> 8) % layer.cell) - oy + H / 2;
        const twinkle = 0.6 + 0.4 * Math.sin(time * 1.6 + (h % 100));
        ctx.globalAlpha = layer.alpha * dim * twinkle;
        // редкие звёзды остаются «своими» тёплой и холодной, остальные красятся
        // в оттенок локации: так небо меняется, но не превращается в один цвет
        ctx.fillStyle = h % 17 === 0 ? '#ffd6a0' : h % 11 === 0 ? '#a0c8ff' : tint;
        ctx.fillRect(sx, sy, layer.size, layer.size);

        // одна звезда из сорока — яркая, с крестом лучей. Их мало намеренно:
        // это опорные точки, по которым глаз цепляется за движение неба
        if (layer.parallax > 0.5 && h % 41 === 0) {
          const flare = 5 + layer.size * 2.4 * twinkle;
          ctx.globalAlpha = layer.alpha * dim * twinkle * 0.6;
          ctx.fillRect(sx - flare, sy + layer.size / 2 - 0.4, flare * 2 + layer.size, 0.8);
          ctx.fillRect(sx + layer.size / 2 - 0.4, sy - flare, 0.8, flare * 2 + layer.size);
        }
      }
    }
  }

  drawMotes(ctx, camera, W, H, p);
  ctx.globalAlpha = 1;
}

/** Кольца планет и прочая крупная форма вдали — см. drawSkyBodies ниже. */
// Шаг сетки соразмерен экрану: при 2600 тело попадало в кадр реже чем раз
// на десять экранов, и слоя как будто не существовало вовсе.
const BODY = { parallax: 0.03, cell: 1400, salt: 55 };

/**
 * ДАЛЬНИЕ ТЕЛА. Одно огромное тело на несколько экранов: планета, кольцо,
 * рваный диск. Двигается почти незаметно и задаёт масштаб — без него любая
 * локация читается как «коробка со звёздами» одного и того же размера.
 */
export function drawSkyBodies(ctx, camera, W, H, time, palette) {
  if (!palette?.body || (palette.dim ?? 1) <= 0) return;
  const ox = (camera.skyX ?? camera.x) * BODY.parallax;
  const oy = (camera.skyY ?? camera.y) * BODY.parallax;
  const x0 = Math.floor((ox - W / 2 - BODY.cell) / BODY.cell);
  const x1 = Math.floor((ox + W / 2 + BODY.cell) / BODY.cell);
  const y0 = Math.floor((oy - H / 2 - BODY.cell) / BODY.cell);
  const y1 = Math.floor((oy + H / 2 + BODY.cell) / BODY.cell);

  ctx.save();
  for (let gx = x0; gx <= x1; gx++) {
    for (let gy = y0; gy <= y1; gy++) {
      const h = hash32(gx, gy, BODY.salt);
      if (h % 100 >= (palette.bodyAmount ?? 34)) continue;
      const cx = gx * BODY.cell + (h % BODY.cell) - ox + W / 2;
      const cy = gy * BODY.cell + ((h >>> 9) % BODY.cell) - oy + H / 2;
      const r = 200 + ((h >>> 15) % 360);
      if (cx + r < -80 || cx - r > W + 80 || cy + r < -80 || cy - r > H + 80) continue;
      const lit = ((h >>> 3) % 628) / 100;

      // тело: тёмный диск с подсвеченным краем — источник света один и тот же
      // для всех тел биома, поэтому сцена не рассыпается на несвязанные пятна
      const shade = ctx.createRadialGradient(
        cx + Math.cos(lit) * r * 0.5, cy + Math.sin(lit) * r * 0.5, r * 0.1, cx, cy, r,
      );
      shade.addColorStop(0, palette.body);
      shade.addColorStop(1, palette.sky2 ?? palette.sky);
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();
      // яркий лимб по освещённому краю — он и делает пятно телом, а не кляксой
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = palette.body;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, lit - 1.15, lit + 1.15);
      ctx.stroke();
      ctx.globalAlpha = 0.14;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 8, lit - 0.9, lit + 0.9);
      ctx.stroke();

      // у каждого третьего — кольцо: силуэт сразу перестаёт быть «ещё одним кругом»
      if (h % 3 === 0) {
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = palette.body;
        ctx.lineWidth = 3;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(((h >>> 21) % 628) / 100);
        ctx.scale(1, 0.26);
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.55, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}
