import { TAU, clamp } from '../core/math.js';
import { BOSSES } from '../data/bosses.js';
import { nearestPointImage } from '../world/torus.js';
import { navigationCapabilities } from '../systems/location-policy.js';

/** Радар вокруг игрока. Размер берётся из атрибутов канваса. */
export function drawMinimap(ctx, game, size) {
  const enabled = navigationCapabilities(game).minimap;
  ctx.canvas.style.visibility = enabled ? '' : 'hidden';
  if (!enabled) {
    ctx.clearRect(0, 0, size, size);
    return;
  }
  const R = size / 2;
  const scale = 0.05;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(R, R, R - 1, 0, TAU);
  ctx.clip();
  ctx.fillStyle = 'rgba(6,12,26,.55)';
  ctx.fillRect(0, 0, size, size);

  const put = (o, color, dot) => {
    const x = R + (o.x - game.player.x) * scale;
    const y = R + (o.y - game.player.y) * scale;
    if ((x - R) ** 2 + (y - R) ** 2 > (R - 3) ** 2) return;
    ctx.fillStyle = color;
    ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
  };

  for (const a of game.entities.asteroids) put(a, 'rgba(140,128,104,.75)', clamp(a.r * 0.09, 2, 5));
  for (const p of game.entities.pickups) {
    put(p, p.kind === 'hp' ? '#5ef08a' : p.kind === 'scrap' ? '#ffc14a' : '#e879f9', 3);
  }
  for (const station of game.run.stations ?? []) {
    if (!station.discovered) continue;
    const color = station.status === 'cleared' ? '#5ef08a'
      : station.status === 'active' || station.status === 'reward' ? '#ff527d' : '#7ee8ff';
    put(nearestPointImage(station, game.player), color, station.status === 'active' ? 9 : 7);
  }

  let boss = null;
  for (const e of game.entities.enemies) {
    if (e.boss) { boss = e; continue; }
    put(e, e.elite ? '#ffd166' : e.color, e.elite ? 6 : 4);
  }
  if (boss) {
    put(boss, BOSSES[boss.boss].color, 11);
    // направление на босса стрелкой по краю радара
    const a = Math.atan2(boss.y - game.player.y, boss.x - game.player.x);
    ctx.save();
    ctx.translate(R + Math.cos(a) * (R - 8), R + Math.sin(a) * (R - 8));
    ctx.rotate(a);
    ctx.fillStyle = BOSSES[boss.boss].color;
    ctx.beginPath();
    ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = '#dff0ff';
  ctx.fillRect(R - 3, R - 3, 6, 6);
  ctx.restore();

  ctx.strokeStyle = 'rgba(120,180,255,.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(R, R, R - 1, 0, TAU);
  ctx.stroke();
}
