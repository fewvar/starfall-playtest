import { TAU, clamp } from '../core/math.js';
import { clustersAround, locationsForSeed, CHUNK, OPEN_BOSS_X, OPEN_BOSS_Y, openBiomeId } from '../world/world.js';
import { getLocation, paletteFor } from '../data/locations.js';
import { BOSSES, bossForLocation } from '../data/bosses.js';
import { hash32 } from '../core/rng.js';
import { formatNavigationDistance } from '../systems/navigation.js';
import { hallucinationActive } from '../systems/location-policy.js';
import {
  WORLD_MIN,
  WORLD_SIZE,
  canonicalWorld,
  nearestWorldImage,
  torDistance,
  worldImages,
} from '../world/torus.js';

/**
 * КАРТА СЕКТОРА (клавиша M).
 *
 * Рисует настоящие кластеры-локации по их центрам и радиусам
 * (world/world.js:clustersAround), а не подкрашивает клетки служебной сетки:
 * от клеток карта выглядела шахматной доской из непонятных квадратов.
 *
 * Карта — ещё и навигация «как в Elden Ring»: идти можно куда угодно, но
 * должно быть ВИДНО, где безопасно, а где нет. Поэтому у каждой области есть
 * подпись, класс угрозы по tier локации и метка босса, а от дома расходятся
 * круги опасности, показывающие, докуда какой tier вообще может встретиться.
 *
 * Мир на открытой карте стоит (game.state === 'map'), поэтому перерисовка
 * идёт по требованию — при открытии, зуме и клике (см. ui/mapscreen.js).
 */

/** Базовый масштаб: сколько пикселей в одном юните мира при зуме 1. */
const BASE_SCALE = 0.02;

/** Класс угрозы по tier локации: римская цифра и цвет. */
const THREAT = [
  { label: 'I', color: '#5ef08a' },
  { label: 'II', color: '#ffd166' },
  { label: 'III', color: '#ff9f43' },
  { label: 'IV', color: '#ff3b6b' },
];

const scaleOf = (view) => BASE_SCALE * view.zoom;

/** Экранные → мировые координаты. Используется и кликом по карте. */
export function mapScreenToWorld(sx, sy, W, H, game, view) {
  const s = scaleOf(view);
  return {
    x: canonicalWorld((sx - W / 2 - view.pan.x) / s + game.player.x),
    y: canonicalWorld((sy - H / 2 - view.pan.y) / s + game.player.y),
  };
}

export function mapWorldToScreen(x, y, W, H, game, view) {
  return mapImageToScreen(
    nearestWorldImage(x, game.player.x),
    nearestWorldImage(y, game.player.y),
    W, H, game, view,
  );
}

function mapImageToScreen(x, y, W, H, game, view) {
  const s = scaleOf(view);
  return {
    x: W / 2 + view.pan.x + (x - game.player.x) * s,
    y: H / 2 + view.pan.y + (y - game.player.y) * s,
  };
}

const toScreen = mapImageToScreen;

export function drawMap(ctx, game, W, H, view) {
  const s = scaleOf(view);
  const seed = game.run.seed ?? 0;
  const pcx = Math.floor(game.player.x / CHUNK);
  const pcy = Math.floor(game.player.y / CHUNK);

  drawBackdrop(ctx, W, H);
  drawWorldTiles(ctx, game, W, H, view);

  const clusters = clustersAround(pcx, pcy, seed, 4);

  // сортируем по удалённости от дома: ближние (безопасные) рисуются первыми,
  // подписи дальних не перекрываются подписями ближних
  clusters.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));

  const labels = [];
  for (const canonical of clusters) {
    const loc = getLocation(canonical.type);
    const visited = game.run.visited?.has(canonical.biomeId);
    for (const cl of worldImages(canonical, game.player)) {
      const p = toScreen(cl.x, cl.y, W, H, game, view);
      // Диссонанс смещает только нарисованные области. Каноническое
      // преобразование карты и waypoint остаются точными внутри модели.
      if (hallucinationActive(game) && cl.type !== 'start') {
        const phase = (game.time ?? 0) * 0.7 + cl.x * 0.00013 + cl.y * 0.00017;
        p.x += Math.sin(phase) * 34;
        p.y += Math.cos(phase * 1.31) * 26;
      }
      const r = cl.radius * s;
      if (p.x + r < -80 || p.x - r > W + 80 || p.y + r < -60 || p.y - r > H + 60) continue;
      drawRegion(ctx, cl, loc, p, r, visited);
      labels.push({ cl, loc, p, r, visited });
    }
  }

  // Подписи — отдельным проходом поверх областей, с отсевом наложений:
  // кластеры стоят плотно, и без отсева названия наезжают друг на друга
  // в неразборчивую кашу. Ближние к дому имеют приоритет (см. сортировку).
  const placed = [];
  for (const item of labels) {
    if (item.cl.type === 'start') continue;       // у старта есть отдельная, более компактная метка ниже
    if (item.r < 26) continue;                    // область слишком мелкая — подпись не влезет
    if (placed.some((q) => Math.abs(q.x - item.p.x) < 190 && Math.abs(q.y - item.p.y) < 88)) continue;
    placed.push(item.p);
    drawRegionLabel(ctx, game, item);
  }

  drawStationMarkers(ctx, game, W, H, view);
  drawOpenBossMarker(ctx, game, W, H, view);
  drawHome(ctx, game, W, H, view);
  drawWaypoint(ctx, game, W, H, view);
  drawPlayer(ctx, game, W, H, view);
  drawLegend(ctx, game, W, H);
}

/** Станция появляется только после дальнего обнаружения и остаётся до конца забега. */
function drawStationMarkers(ctx, game, W, H, view) {
  for (const station of game.run.stations ?? []) {
    if (!station.discovered) continue;
    for (const image of worldImages(station, game.player)) {
      const p = toScreen(image.x, image.y, W, H, game, view);
      if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) continue;
      const cleared = station.status === 'cleared';
      const active = station.status === 'active' || station.status === 'reward';
      const color = cleared ? '#5ef08a' : active ? '#ff527d' : '#7ee8ff';

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.strokeStyle = color;
      ctx.fillStyle = color + '33';
      ctx.lineWidth = active ? 2.5 : 1.8;
      ctx.shadowColor = color;
      ctx.shadowBlur = active ? 16 : 7;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = -Math.PI / 2 + i * TAU / 6;
        const x = Math.cos(angle) * 10;
        const y = Math.sin(angle) * 10;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = color;
      ctx.fillRect(-3, -3, 6, 6);
      ctx.font = '700 10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(cleared ? 'СТАНЦИЯ · ЗАЧИЩЕНА' : `СТАНЦИЯ · УР. ${station.recommendedLevel}`, 0, 27);
      ctx.restore();
    }
  }
}

// ─────────────────────────────── фон и круги опасности

function drawBackdrop(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, '#0a1020');
  g.addColorStop(1, '#04060c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Повторяющиеся рамки показывают реальный размер тора, но не объявляют шов краем. */
function drawWorldTiles(ctx, game, W, H, view) {
  const nearX = nearestWorldImage(WORLD_MIN, game.player.x);
  const nearY = nearestWorldImage(WORLD_MIN, game.player.y);
  ctx.save();
  ctx.strokeStyle = 'rgba(126, 232, 255, .13)';
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 12]);
  for (const ox of [-WORLD_SIZE, 0, WORLD_SIZE]) {
    for (const oy of [-WORLD_SIZE, 0, WORLD_SIZE]) {
      const a = toScreen(nearX + ox, nearY + oy, W, H, game, view);
      const b = toScreen(nearX + ox + WORLD_SIZE, nearY + oy + WORLD_SIZE, W, H, game, view);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
  }
  ctx.restore();
}

// ─────────────────────────────── области

/**
 * Область рисуется неровным пятном, а не кругом и не квадратом: космос
 * не расчерчен по линейке. Форма детерминирована от координат кластера,
 * поэтому при повторном открытии карты она та же.
 */
function drawRegion(ctx, cl, loc, p, r, visited) {
  const palette = paletteFor(cl.type);
  const steps = 22;

  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * TAU;
    const h = hash32(cl.chunkX + i, cl.chunkY - i, 4242) % 1000;
    const wobble = 0.82 + (h / 1000) * 0.3;
    const x = p.x + Math.cos(a) * r * wobble;
    const y = p.y + Math.sin(a) * r * wobble;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();

  // заливка градиентом от центра — область читается как «сгущение», не плашка
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
  g.addColorStop(0, palette.sky === '#05060d' ? loc.color + 'cc' : palette.sky + 'ff');
  g.addColorStop(0.55, loc.color + (visited ? '77' : '3a'));
  g.addColorStop(1, loc.color + '00');
  ctx.fillStyle = g;
  ctx.fill();

  ctx.globalAlpha = visited ? 0.9 : 0.34;
  ctx.strokeStyle = loc.color;
  ctx.lineWidth = visited ? 2 : 1.2;
  if (!visited) ctx.setLineDash([7, 7]);   // неисследованное — пунктиром
  ctx.stroke();
  ctx.restore();
}

function drawRegionLabel(ctx, game, { cl, loc, p, r, visited }) {
  const threat = THREAT[Math.min(Math.floor((cl.recommendedLevel - 1) / 3), THREAT.length - 1)];
  ctx.save();
  ctx.textAlign = 'center';

  // имя области: посещённое — ярко, неисследованное — приглушённо и с «?»
  ctx.font = '700 13px ui-monospace, monospace';
  ctx.fillStyle = visited ? '#eaf6ff' : 'rgba(200, 214, 235, .6)';
  ctx.fillText(visited ? loc.name : '? ' + loc.name, p.x, p.y - 6);

  // класс угрозы — цветом, сразу под названием
  ctx.font = '600 11px ui-monospace, monospace';
  ctx.fillStyle = threat.color;
  ctx.globalAlpha = visited ? 0.95 : 0.55;
  ctx.fillText(`LEVEL ${cl.recommendedLevel}`, p.x, p.y + 42);
  ctx.fillText(`УГРОЗА ${threat.label}`, p.x, p.y + 10);

  const progress = game.run.biomeProgress?.[cl.biomeId];
  const wavesCleared = progress?.wavesCleared ?? 0;
  const regularCleared = progress?.regularCleared ?? false;
  ctx.globalAlpha = visited ? 0.95 : 0.5;
  ctx.fillStyle = regularCleared ? '#5ef08a' : '#9fb2cc';
  ctx.fillText(regularCleared ? 'ВОЛНЫ ЗАЧИЩЕНЫ' : `ВОЛНЫ ${wavesCleared}/${loc.waveCount}`, p.x, p.y + 26);

  // метка живого босса области: ромб, как в мокапе плана
  const bossId = bossForLocation(cl.type);
  const killed = game.run.bossesKilled?.includes(bossId);
  if (cl.type !== 'start' && bossId && !killed) {
    const def = BOSSES[bossId];
    ctx.globalAlpha = 1;
    ctx.translate(p.x, p.y + 46);
    ctx.strokeStyle = def.color;
    ctx.fillStyle = def.color + '55';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(7, 0); ctx.lineTo(0, 7); ctx.lineTo(-7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.fillStyle = def.color;
    ctx.fillText(def.name, 0, 22);
  }
  ctx.restore();
}

/** Временная метка Дредноута, пока отдельная Стартовая локация появится только в этапе E. */
function drawOpenBossMarker(ctx, game, W, H, view) {
  if (game.run.bossesKilled?.includes('dread')) return;
  const def = BOSSES.dread;
  for (const image of worldImages({ x: OPEN_BOSS_X, y: OPEN_BOSS_Y }, game.player)) {
    const p = toScreen(image.x, image.y, W, H, game, view);
    if (p.x < -50 || p.x > W + 50 || p.y < -50 || p.y > H + 50) continue;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = def.color;
    ctx.fillStyle = def.color + '55';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(8, 0); ctx.lineTo(0, 8); ctx.lineTo(-8, 0);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = def.color;
    ctx.fillText(def.name, 0, 24);
    ctx.restore();
  }
}

// ─────────────────────────────── метки

function drawHome(ctx, game, W, H, view) {
  const start = locationsForSeed(game.run.seed ?? 0).find((location) => location.placementKind === 'start');
  const progress = game.run.biomeProgress?.[start?.biomeId ?? openBiomeId(game.run.seed ?? 0)];
  const waveText = progress?.regularCleared
    ? 'ВОЛНЫ ЗАЧИЩЕНЫ'
    : `ВОЛНЫ ${progress?.wavesCleared ?? 0}/${getLocation('start').waveCount}`;
  for (const image of worldImages({ x: 0, y: 0 }, game.player)) {
    const p = toScreen(image.x, image.y, W, H, game, view);
    if (p.x < -50 || p.x > W + 50 || p.y < -50 || p.y > H + 50) continue;
    ctx.save();
    ctx.strokeStyle = '#7ee8ff';
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 9, 0, TAU);
    ctx.moveTo(p.x - 13, p.y); ctx.lineTo(p.x + 13, p.y);
    ctx.moveTo(p.x, p.y - 13); ctx.lineTo(p.x, p.y + 13);
    ctx.stroke();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#7ee8ff';
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('СТАРТ', p.x, p.y + 26);
    ctx.fillStyle = progress?.regularCleared ? '#5ef08a' : '#9fb2cc';
    ctx.fillText(waveText, p.x, p.y + 40);
    ctx.restore();
  }
}

function drawWaypoint(ctx, game, W, H, view) {
  if (!game.run.waypoint) return;
  const dist = formatNavigationDistance(torDistance(
    game.player.x, game.player.y, game.run.waypoint.x, game.run.waypoint.y,
  ));
  for (const image of worldImages(game.run.waypoint, game.player)) {
    const p = toScreen(image.x, image.y, W, H, game, view);
    if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) continue;
    ctx.save();
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 9, p.y); ctx.lineTo(p.x, p.y - 9); ctx.lineTo(p.x + 9, p.y); ctx.lineTo(p.x, p.y + 9);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`МЕТКА · ${dist}`, p.x, p.y + 22);
    ctx.restore();
  }
}

function drawPlayer(ctx, game, W, H, view) {
  const p = toScreen(game.player.x, game.player.y, W, H, game, view);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.shadowColor = '#dff0ff';
  ctx.shadowBlur = 12;
  ctx.rotate(game.player.angle);
  ctx.fillStyle = '#dff0ff';
  ctx.beginPath();
  ctx.moveTo(11, 0); ctx.lineTo(-8, -7); ctx.lineTo(-8, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Легенда: что означают цвета угрозы и ромб. Без неё карта — ребус. */
function drawLegend(ctx, game, W, H) {
  const loc = getLocation(game.run.location);
  const pad = 18;
  const y = pad + 10;

  ctx.save();
  // подложка: без неё легенда сливается с подписями областей под ней
  ctx.fillStyle = 'rgba(6, 10, 22, 0.86)';
  ctx.strokeStyle = 'rgba(120, 180, 255, .22)';
  ctx.lineWidth = 1;
  ctx.fillRect(pad - 10, pad - 10, 500, 128);
  ctx.strokeRect(pad - 10, pad - 10, 500, 128);

  ctx.font = '700 15px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#eaf6ff';
  ctx.fillText('КАРТА СЕКТОРА', pad, y);

  ctx.font = '600 11px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(200, 214, 235, .75)';
  ctx.fillText(`ТЫ ЗДЕСЬ: ${loc.name}`, pad, y + 20);

  // шкала угрозы
  let x = pad;
  const ly = y + 46;
  ctx.font = '600 11px ui-monospace, monospace';
  for (const t of THREAT) {
    ctx.fillStyle = t.color;
    ctx.fillRect(x, ly - 8, 10, 10);
    ctx.fillStyle = 'rgba(200, 214, 235, .8)';
    ctx.fillText(t.label, x + 15, ly);
    x += 42;
  }
  ctx.fillStyle = 'rgba(200, 214, 235, .55)';
  ctx.fillText('— угроза растёт с удалением', x + 4, ly);

  // ромб = живой босс
  const by = ly + 22;
  ctx.strokeStyle = '#ff6b8a';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(pad + 5, by - 10); ctx.lineTo(pad + 12, by - 3);
  ctx.lineTo(pad + 5, by + 4); ctx.lineTo(pad - 2, by - 3);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = 'rgba(200, 214, 235, .55)';
  ctx.fillText('— босс области жив.  Пунктир — не исследовано.', pad + 20, by);

  const sy = by + 22;
  ctx.strokeStyle = '#7ee8ff';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * TAU / 6;
    const x = pad + 5 + Math.cos(a) * 7;
    const y = sy - 3 + Math.sin(a) * 7;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath(); ctx.stroke();
  ctx.fillText('— обнаруженная станция зачистки.', pad + 20, sy);
  ctx.restore();
}
