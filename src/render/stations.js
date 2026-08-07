import { TAU, clamp } from '../core/math.js';
import { camera } from '../core/camera.js';
import { STATION_ARENA_RADIUS } from '../data/stations.js';
import { formatNavigationDistance } from '../systems/navigation.js';
import { activeStationImage, stationDiscoveryRadius, stationDistance } from '../systems/stations.js';
import { nearestPointImage } from '../world/torus.js';
import { npcKindById } from '../data/npcs.js';

/** Кольцо сначала ложится под сущностями, чтобы бой оставался читаемым. */
export function drawStationArena(ctx, game) {
  const station = activeStationImage(game);
  if (!station || game.run.stationEncounter?.status !== 'active') return;
  const pulse = 0.5 + Math.sin(game.time * 4.2) * 0.12;

  ctx.save();
  const fill = ctx.createRadialGradient(
    station.x, station.y, STATION_ARENA_RADIUS * 0.7,
    station.x, station.y, STATION_ARENA_RADIUS,
  );
  fill.addColorStop(0, 'rgba(255, 59, 107, 0)');
  fill.addColorStop(1, `rgba(255, 59, 107, ${0.08 + pulse * 0.04})`);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(station.x, station.y, STATION_ARENA_RADIUS, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = `rgba(255, 84, 126, ${pulse})`;
  ctx.lineWidth = 5;
  ctx.setLineDash([22, 14]);
  ctx.lineDashOffset = -game.time * 45;
  ctx.shadowColor = '#ff3b6b';
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(station.x, station.y, STATION_ARENA_RADIUS, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** Гигантский разрушенный шаттл — целиком векторный, без внешних ассетов. */
export function drawWorldStations(ctx, game, visible) {
  for (const station of game.run.stations ?? []) {
    if (!station.discovered) continue;
    const image = nearestPointImage(station, camera);
    if (!visible(image, 280)) continue;
    drawWreck(ctx, image, game.time);
  }
}

function drawWreck(ctx, station, time) {
  const cleared = station.status === 'cleared';
  const active = station.status === 'active' || station.status === 'reward';
  const signal = cleared ? '#5ef08a' : active ? '#ff527d' : '#7ee8ff';
  const flicker = 0.65 + Math.sin(time * 5.5 + station.wreckVariant) * 0.2;

  ctx.save();
  ctx.translate(station.x, station.y);
  ctx.rotate(station.angle);

  ctx.shadowColor = signal;
  ctx.shadowBlur = active ? 28 : 15;
  ctx.globalAlpha = 0.15 + flicker * 0.1;
  ctx.fillStyle = signal;
  ctx.beginPath();
  ctx.ellipse(0, 0, 245, 82, 0, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Разломанный центральный корпус: между половинами намеренно зияет щель.
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#182432';
  ctx.strokeStyle = '#58718a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-226, -31); ctx.lineTo(-76, -54); ctx.lineTo(-30, -27);
  ctx.lineTo(-48, 31); ctx.lineTo(-184, 48); ctx.lineTo(-236, 13);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(18, -28); ctx.lineTo(92, -52); ctx.lineTo(226, -18);
  ctx.lineTo(247, 0); ctx.lineTo(214, 25); ctx.lineTo(68, 48); ctx.lineTo(31, 23);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // Сорванные крылья и внутренние фермы.
  ctx.fillStyle = '#111923';
  ctx.strokeStyle = '#40566e';
  ctx.beginPath();
  ctx.moveTo(-95, -43); ctx.lineTo(-36, -142); ctx.lineTo(28, -132); ctx.lineTo(-4, -33);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(83, 39); ctx.lineTo(128, 124); ctx.lineTo(52, 146); ctx.lineTo(19, 33);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  ctx.strokeStyle = '#8aa0b4';
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const y = -18 + i * 9;
    ctx.beginPath(); ctx.moveTo(-48, y); ctx.lineTo(34, -y * 0.7); ctx.stroke();
  }

  // Пробоины и мёртвые окна.
  ctx.fillStyle = '#03060b';
  for (const [x, y, r] of [[-158, -10, 14], [-104, 17, 9], [91, -12, 12], [169, 7, 10]]) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  // Единственный живой маяк: слабый при обнаружении, тревожный в бою.
  ctx.rotate(-station.angle);
  ctx.fillStyle = signal;
  ctx.globalAlpha = active ? 0.75 + Math.sin(time * 9) * 0.25 : flicker;
  ctx.shadowColor = signal;
  ctx.shadowBlur = active ? 26 : 14;
  ctx.beginPath(); ctx.arc(0, 0, active ? 10 : 7, 0, TAU); ctx.fill();
  ctx.strokeStyle = signal;
  ctx.lineWidth = 2;
  ctx.globalAlpha *= 0.55;
  ctx.beginPath(); ctx.arc(0, 0, 22 + (time * 18) % 32, 0, TAU); ctx.stroke();
  ctx.restore();
}

/** Короткий указатель появляется только рядом с недавно найденной целью. */
export function drawStationSignal(ctx, game, W, H) {
  const signalRadius = stationDiscoveryRadius(game.view) * 1.3;
  const candidates = (game.run.stations ?? [])
    .filter((station) => station.discovered && station.status !== 'cleared')
    .map((station) => ({
      station,
      distance: stationDistance(game.player.x, game.player.y, station.x, station.y),
    }))
    .filter((item) => item.distance < signalRadius)
    .sort((a, b) => a.distance - b.distance);
  if (!candidates.length) return;

  const { station, distance } = candidates[0];
  const image = nearestPointImage(station, camera);
  const sx = image.x - camera.x + W / 2;
  const sy = image.y - camera.y + H / 2;
  const margin = 64;
  if (sx >= margin && sx <= W - margin && sy >= margin && sy <= H - margin) return;

  const dx = sx - W / 2;
  const dy = sy - H / 2;
  const angle = Math.atan2(dy, dx);
  const rx = Math.max(1, W / 2 - margin);
  const ry = Math.max(1, H / 2 - margin);
  const scale = 1 / Math.max(Math.abs(Math.cos(angle)) / rx, Math.abs(Math.sin(angle)) / ry);
  const x = W / 2 + Math.cos(angle) * scale;
  const y = H / 2 + Math.sin(angle) * scale;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = station.status === 'active' ? '#ff527d' : '#7ee8ff';
  ctx.globalAlpha = clamp(0.72 + Math.sin(game.time * 5) * 0.2, 0.4, 1);
  ctx.beginPath();
  ctx.moveTo(13, 0); ctx.lineTo(-8, -8); ctx.lineTo(-4, 0); ctx.lineTo(-8, 8);
  ctx.closePath(); ctx.fill();
  ctx.rotate(-angle);
  ctx.font = '600 11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`СТАНЦИЯ · ${formatNavigationDistance(distance)}`, 0, 24);
  ctx.restore();
}

/**
 * NPC В МИРЕ. Намеренно НЕ похож на станцию: станция — мёртвый обломок с
 * тревожным сигналом, NPC — целый маленький кораблик со спокойным огоньком.
 * Игрок должен различать их с расстояния, не подлетая.
 */
export function drawWorldNpcs(ctx, game, visible) {
  for (const npc of game.run.npcs ?? []) {
    if (!npc.discovered) continue;
    const image = nearestPointImage(npc, camera);
    if (!visible(image, 200)) continue;
    drawNpc(ctx, image, npc, game.time);
  }
}

function drawNpc(ctx, image, npc, time) {
  const kind = npcKindById[npc.kind];
  const color = npc.dead ? '#4a4f5c'
    : npc.status === 'done' ? '#5ef08a'
      : npc.status === 'failed' ? '#ff3b6b'
        : kind.color;
  const pulse = 0.7 + Math.sin(time * 2.4 + npc.angle) * 0.3;

  ctx.save();
  ctx.translate(image.x, image.y);

  ctx.shadowColor = color;
  ctx.shadowBlur = npc.dead ? 0 : 20;
  ctx.globalAlpha = 0.12 + pulse * 0.08;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, 110, 0, TAU);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.rotate(npc.angle + (npc.dead ? 0 : Math.sin(time * 0.6) * 0.12));
  ctx.shadowBlur = npc.dead ? 0 : 12;
  ctx.fillStyle = npc.dead ? '#20232c' : '#1a2432';
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(24, 0); ctx.lineTo(-12, -17); ctx.lineTo(-4, 0); ctx.lineTo(-12, 17);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (!npc.dead) {
    ctx.fillStyle = color;
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(6, 0, 4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // Полоса HP появляется только когда NPC уже бьют: молчаливая потеря пути
  // из-за случайно залетевшей волны — единственное, чего допускать нельзя.
  if (npc.hp < npc.maxHp && !npc.dead) {
    ctx.save();
    ctx.translate(image.x, image.y - 40);
    ctx.fillStyle = 'rgba(6,10,18,.85)';
    ctx.fillRect(-30, -4, 60, 7);
    ctx.fillStyle = npc.hp < npc.maxHp * 0.35 ? '#ff3b6b' : '#ffc14a';
    ctx.fillRect(-29, -3, 58 * (npc.hp / npc.maxHp), 5);
    ctx.restore();
  }
}
