import { TAU, clamp, rnd } from '../core/math.js';
import { camera } from '../core/camera.js';
import { drawStarfield } from '../world/starfield.js';
import { CHUNK } from '../world/world.js';
import { getWeapon } from '../data/weapons.js';
import { BOSSES } from '../data/bosses.js';
import { activeBoss } from '../entities/bosses.js';
import { getLocation, paletteFor } from '../data/locations.js';
import { silhouetteFor, shipSilhouetteFor, TRAIL_LENGTH } from './silhouettes.js';
import { formatNavigationDistance } from '../systems/navigation.js';
import { hallucinatedNumber, hallucinationActive, navigationCapabilities } from '../systems/location-policy.js';
import { drawStationArena, drawStationSignal, drawWorldStations } from './stations.js';
import { nearestPointImage, torDelta, torDistance } from '../world/torus.js';

/** Вся отрисовка мира на canvas. UI живёт в DOM и рисуется отдельно. */

/**
 * Свечение (shadowBlur) — самая дорогая операция в canvas.
 * Когда на экране сотни снарядов и лута, оно съедает больше кадров, чем даёт красоты,
 * поэтому при перегрузе временно отключаем: игра остаётся плавной.
 */
let glowEnabled = true;
const GLOW_LIMIT = 220;

const glow = (ctx, color, blur) => {
  if (!glowEnabled) return;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
};

export function renderScene(ctx, game, W, H) {
  const { entities, fx, projectiles, player, world } = game;

  if (game.run.realm?.id === 'singularity') {
    drawSingularityRealm(ctx, game, W, H);
    return;
  }

  const load = projectiles.bullets.length + projectiles.foeBullets.length + entities.pickups.length;
  glowEnabled = load < GLOW_LIMIT;

  // палитра локации: небо и звёзды, а не только цвет тумана (см. data/locations.js)
  const palette = paletteFor(game.run.location);
  ctx.fillStyle = palette.sky;
  ctx.fillRect(0, 0, W, H);
  drawStarfield(ctx, camera, W, H, game.time, palette);

  const shake = camera.offset();
  ctx.save();
  ctx.translate(W / 2 - camera.x + shake.x, H / 2 - camera.y + shake.y);
  if (hallucinationActive(game)) {
    const breathe = Math.sin(game.time * 0.82) * 0.012;
    ctx.translate(camera.x, camera.y);
    ctx.rotate(Math.sin(game.time * 0.31) * 0.006);
    ctx.scale(1 + breathe, 1 - breathe * 0.7);
    ctx.translate(-camera.x, -camera.y);
  }

  // «Туманность» режет обзор — тот же culling-порог, только у'же радиус
  const loc = getLocation(game.run.location);
  const visMul = loc.modifiers?.visibilityMul ?? 1;
  const radarOnly = loc.modifiers?.radarOnly;

  // Отсечение по экрану: далёкие объекты всё равно не видны,
  // а на поздних волнах их сотни — рисовать их значит терять кадры зря.
  const halfW = (W / 2 + 90) * visMul;
  const halfH = (H / 2 + 90) * visMul;
  const visible = (o, pad = 0) =>
    Math.abs(o.x - camera.x) < halfW + pad && Math.abs(o.y - camera.y) < halfH + pad;

  drawBiomeGlow(ctx, world);
  drawLocationDecor(ctx, world, game.time, camera, halfW, halfH);
  drawSectorGrid(ctx, W, H);
  drawStationArena(ctx, game);
  drawWorldStations(ctx, game, visible);
  drawLocationSpecials(ctx, game, visible);

  for (const a of entities.asteroids) if (visible(a, a.r)) drawAsteroid(ctx, a, game.time, game.run.location === 'dissonance');
  drawSingularities(ctx, game);
  drawStrikes(ctx, game);
  drawDecoys(ctx, game);
  drawAnchors(ctx, game);
  drawRifts(ctx, game);
  drawTelegraphs(ctx, game);
  for (const m of game.mirrors) if (visible(m)) drawMirror(ctx, m, game.time);
  for (const m of projectiles.mines) if (visible(m)) drawMine(ctx, m);
  for (const t of game.turrets) if (visible(t, 14)) drawTurret(ctx, t);
  for (const p of entities.pickups) if (visible(p)) drawPickup(ctx, p, game.time);
  for (const e of entities.enemies) {
    if (!visible(e, e.r * 2)) continue;
    // «Туманность»: враги дальше radarOnly видны только на миникарте
    if (radarOnly && !e.boss) {
      const d2 = (e.x - player.x) ** 2 + (e.y - player.y) ** 2;
      if (d2 > radarOnly * radarOnly) continue;
    }
    drawEnemy(ctx, e);
  }
  for (const d of player.drones) drawDrone(ctx, d);
  for (const f of projectiles.foeBullets) if (visible(f)) drawFoeBullet(ctx, f);
  for (const b of projectiles.bullets) if (visible(b)) drawBullet(ctx, b, game.time);
  for (const b of fx.beams) drawBeam(ctx, b);
  for (const b of fx.blasts) drawBlast(ctx, b);
  for (const p of fx.particles) if (visible(p)) drawParticle(ctx, p);

  ctx.globalAlpha = 1;
  drawOrbitals(ctx, player, game.time);
  const navigation = navigationCapabilities(game);
  if (navigation.waypoint && game.run.waypoint) {
    const waypointImage = nearestPointImage(game.run.waypoint, camera);
    if (visible(waypointImage, 50)) drawWorldWaypoint(ctx, waypointImage, game.time);
  }
  drawShip(ctx, player, game.time);
  drawHullSeed(ctx, game);

  ctx.textAlign = 'center';
  ctx.font = '700 15px ui-monospace, monospace';
  for (const f of fx.floaters) {
    ctx.globalAlpha = clamp(f.life / 0.8, 0, 1);
    ctx.fillStyle = f.color;
    ctx.fillText(hallucinatedFloater(game, f.text), f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (navigation.signals) drawBossArrow(ctx, game, W, H);
  if (navigation.waypoint) drawWaypointArrow(ctx, game, W, H);
  if (navigation.signals) drawStationSignal(ctx, game, W, H);
  drawVignette(ctx, W, H, visMul < 1 ? 'rgba(60,40,100,.5)' : 'rgba(0,0,0,.45)');
  if (hallucinationActive(game)) drawHallucinationOverlay(ctx, game, W, H);
}

function hallucinatedFloater(game, text) {
  if (!hallucinationActive(game) || typeof text !== 'string') return text;
  const match = text.match(/^([+×-]?)(\d+)(.*)$/);
  if (!match) return text;
  const fake = Math.max(1, Math.round(hallucinatedNumber(game, Number(match[2]), 'damage-floater')));
  return `${match[1]}${fake}${match[3]}`;
}

function drawHallucinationOverlay(ctx, game, W, H) {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 7; i++) {
    const y = ((i * H / 7 + Math.sin(game.time * (0.4 + i * 0.03) + i) * 42) % (H + 80)) - 40;
    const gradient = ctx.createLinearGradient(0, y, W, y + 55);
    gradient.addColorStop(0, 'rgba(255,40,150,0)');
    gradient.addColorStop(0.5, i % 2 ? 'rgba(30,220,255,.055)' : 'rgba(255,40,150,.045)');
    gradient.addColorStop(1, 'rgba(80,255,100,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, W, 58);
  }
  ctx.restore();
}

function drawSingularityRealm(ctx, game, W, H) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const realm = game.run.realm;
  const shake = camera.offset();
  ctx.save();
  ctx.translate(W / 2 - camera.x + shake.x, H / 2 - camera.y + shake.y);
  for (const exit of realm.exits) {
    const color = getLocation(exit.locationId).color ?? '#b06bff';
    const pulse = 1 + Math.sin(game.time * 1.7 + exit.x * 0.001) * 0.08;
    ctx.save();
    ctx.translate(exit.x, exit.y);
    glow(ctx, color, 28);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.ellipse(0, 0, exit.r * 0.55 * pulse, exit.r * pulse, game.time * 0.15, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
  if (realm.perk) drawSpecialPickup(ctx, realm.perk, '#f4e9ff', game.time);
  drawShip(ctx, game.player, game.time);
  ctx.restore();
  drawVignette(ctx, W, H, 'rgba(0,0,0,.95)');
}

// ─────────────────────────────── фон

function drawBiomeGlow(ctx, world) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const chunk of world.chunks.values()) {
    if (chunk.location.id === 'open') continue;
    const x = chunk.cx * CHUNK + CHUNK / 2;
    const y = chunk.cy * CHUNK + CHUNK / 2;
    const g = ctx.createRadialGradient(x, y, 0, x, y, CHUNK * 0.75);
    g.addColorStop(0, chunk.location.color + '55');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(x - CHUNK * 0.8, y - CHUNK * 0.8, CHUNK * 1.6, CHUNK * 1.6);
  }
  ctx.restore();
}

/**
 * Визуальные черты локаций — без коллизий, только чтобы пояс, туманность,
 * кладбище, ионный шторм, гнездо и разлом читались с одного взгляда, а не
 * только по цвету фонового свечения. Ничего не грузится извне: игра нигде
 * не использует картинки, всё рисуется на canvas, как астероиды и корабли.
 */
function drawLocationDecor(ctx, world, time, camera, halfW, halfH) {
  const onScreen = (x, y, pad = 0) =>
    Math.abs(x - camera.x) < halfW + pad && Math.abs(y - camera.y) < halfH + pad;

  for (const chunk of world.chunks.values()) {
    const decor = chunk.decor;
    if (!decor) continue;
    switch (decor.kind) {
      case 'start': drawWreckage(ctx, decor, time, onScreen, '#7a4c3d'); break;
      case 'belt': drawBeltDust(ctx, decor, onScreen); break;
      case 'nebula': drawNebulaClouds(ctx, decor, time, onScreen); break;
      case 'graveyard': drawWreckage(ctx, decor, time, onScreen); break;
      case 'grove': drawGroveVines(ctx, decor, time, onScreen); break;
      case 'acid': drawAcidClouds(ctx, decor, time, onScreen); break;
      case 'dissonance': drawDissonanceVeins(ctx, decor, time, onScreen); break;
      case 'dust': drawDustStorm(ctx, decor, time, onScreen); break;
      case 'ionstorm': drawIonNodes(ctx, decor, time, onScreen); break;
      case 'nest': drawNestPods(ctx, decor, time, onScreen); break;
      case 'rift': drawRiftSwirl(ctx, decor, time, onScreen); break;
    }
  }
}

function drawBeltDust(ctx, { dust }, onScreen) {
  ctx.save();
  for (const d of dust) {
    if (!onScreen(d.x, d.y, d.r)) continue;
    ctx.fillStyle = d.ore ? '#e0b566' : '#8a7a68';
    ctx.globalAlpha = d.ore ? 0.8 : 0.45;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawNebulaClouds(ctx, { clouds }, time, onScreen) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const c of clouds) {
    if (!onScreen(c.x, c.y, c.r)) continue;
    const drift = Math.sin(time * c.speed + c.phase);
    const r = c.r * (1 + drift * 0.08);
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
    g.addColorStop(0, `rgba(150, 120, 230, ${0.4 + drift * 0.08})`);
    g.addColorStop(0.5, `rgba(110, 90, 190, ${0.22 + drift * 0.05})`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawWreckage(ctx, { wrecks }, time, onScreen, tint = '#4a6a62') {
  for (const w of wrecks) {
    if (!onScreen(w.x, w.y, w.r)) continue;
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.rotate(w.angle);
    ctx.strokeStyle = tint;
    ctx.fillStyle = tint + '44';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const n = w.verts.length;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      // угловатые обломки корпуса — не круглые, как астероиды
      const rr = w.r * w.verts[i] * (i % 2 === 0 ? 1 : 0.7);
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr * 0.6;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // мигающий маячок — читается издалека как «здесь обломки», не астероид
    const blink = Math.sin(time * 2 + w.blink);
    if (blink > 0.6) {
      ctx.fillStyle = '#7effc0';
      ctx.globalAlpha = (blink - 0.6) * 2;
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawGroveVines(ctx, { vines }, time, onScreen) {
  ctx.save();
  ctx.strokeStyle = '#49d89b';
  ctx.lineWidth = 2;
  for (const vine of vines) {
    if (!onScreen(vine.x, vine.y, vine.r)) continue;
    const breathe = 1 + Math.sin(time * 0.8 + vine.phase) * 0.08;
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    for (let i = 0; i <= 12; i++) {
      const a = vine.phase + i * 0.52;
      const r = vine.r * breathe * i / 12;
      const x = vine.x + Math.cos(a) * r;
      const y = vine.y + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawAcidClouds(ctx, { clouds }, time, onScreen) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const cloud of clouds) {
    if (!onScreen(cloud.x, cloud.y, cloud.r)) continue;
    const pulse = 0.92 + Math.sin(time * 0.45 + cloud.phase) * 0.08;
    const g = ctx.createRadialGradient(cloud.x, cloud.y, 0, cloud.x, cloud.y, cloud.r * pulse);
    g.addColorStop(0, 'rgba(126,155,55,.25)');
    g.addColorStop(0.62, 'rgba(68,105,42,.13)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cloud.x, cloud.y, cloud.r * pulse, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawDissonanceVeins(ctx, { veins }, time, onScreen) {
  ctx.save();
  ctx.strokeStyle = '#8c809c';
  for (const vein of veins) {
    if (!onScreen(vein.x, vein.y, vein.r)) continue;
    ctx.globalAlpha = 0.12 + Math.sin(time * 0.67 + vein.phase) * 0.05;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(vein.x, vein.y, vein.r * (1 + Math.sin(time + vein.phase) * 0.08), 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDustStorm(ctx, { particles, angle, ox, oy, size }, time, onScreen) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  ctx.save();
  ctx.lineWidth = 1.5;
  for (const particle of particles) {
    const travel = (time * particle.speed + particle.offset) % size;
    const x = ox + ((particle.x - ox + dx * travel) % size + size) % size;
    const y = oy + ((particle.y - oy + dy * travel) % size + size) % size;
    if (!onScreen(x, y, 20)) continue;
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = `hsl(${particle.hue} 90% 70%)`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - dx * particle.length, y - dy * particle.length);
    ctx.stroke();
  }
  ctx.restore();
}

function drawIonNodes(ctx, { nodes }, time, onScreen) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (!onScreen(a.x, a.y, 60)) continue;
    const pulse = 0.55 + 0.45 * Math.sin(time * 3 + a.phase);

    // мягкое электрическое свечение узла
    const g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, 26 * pulse);
    g.addColorStop(0, `rgba(180, 240, 255, ${0.5 * pulse})`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 26 * pulse, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#dffaff';
    ctx.beginPath();
    ctx.arc(a.x, a.y, 2 + pulse * 2, 0, TAU);
    ctx.fill();

    // постоянная тонкая связь до ближайшего узла — читается сразу, без ожидания
    const b = nodes[(i + 1) % nodes.length];
    if (!b) continue;
    ctx.globalAlpha = 0.22 + 0.1 * pulse;
    ctx.strokeStyle = '#7ee8ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // изредка яркая дуга-разряд поверх линии связи — статический эффект, не геймплей
    if (Math.sin(time * 1.7 + a.phase * 3) > 0.9) {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#e8fbff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      const midx = (a.x + b.x) / 2 + rnd(24, -24);
      const midy = (a.y + b.y) / 2 + rnd(24, -24);
      ctx.lineTo(midx, midy);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawNestPods(ctx, { pods }, time, onScreen) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const pod of pods) {
    if (!onScreen(pod.x, pod.y, pod.r)) continue;
    const breathe = 0.85 + 0.15 * Math.sin(time * pod.speed + pod.phase);
    const r = pod.r * breathe;
    const g = ctx.createRadialGradient(pod.x, pod.y, 0, pod.x, pod.y, r);
    g.addColorStop(0, `rgba(255, 90, 150, ${0.22 * breathe})`);
    g.addColorStop(0.7, 'rgba(180, 40, 110, 0.08)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(pod.x, pod.y, r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawRiftSwirl(ctx, r, time, onScreen) {
  if (!onScreen(r.x, r.y, r.r)) return;
  ctx.save();
  ctx.translate(r.x, r.y);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r.r);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(0.4, 'rgba(60, 20, 100, 0.25)');
  g.addColorStop(1, 'transparent');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r.r, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = '#b06bff';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = 0.35 - i * 0.08;
    ctx.beginPath();
    const spin = time * 0.6 * r.dir + i * 1.2;
    const arms = 3;
    for (let a = 0; a <= TAU * 1.3; a += 0.2) {
      const rr = (a / (TAU * 1.3)) * r.r * (0.5 + i * 0.2);
      const x = Math.cos(a * arms + spin) * rr;
      const y = Math.sin(a * arms + spin) * rr;
      a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawSectorGrid(ctx, W, H) {
  ctx.strokeStyle = 'rgba(74,163,255,.10)';
  ctx.lineWidth = 1;
  const x0 = Math.floor((camera.x - W / 2) / CHUNK);
  const x1 = Math.floor((camera.x + W / 2) / CHUNK);
  const y0 = Math.floor((camera.y - H / 2) / CHUNK);
  const y1 = Math.floor((camera.y + H / 2) / CHUNK);
  ctx.beginPath();
  for (let i = x0; i <= x1 + 1; i++) {
    ctx.moveTo(i * CHUNK, y0 * CHUNK);
    ctx.lineTo(i * CHUNK, (y1 + 2) * CHUNK);
  }
  for (let j = y0; j <= y1 + 1; j++) {
    ctx.moveTo(x0 * CHUNK, j * CHUNK);
    ctx.lineTo((x1 + 2) * CHUNK, j * CHUNK);
  }
  ctx.stroke();
}

// ─────────────────────────────── объекты

function drawSpecialPickup(ctx, item, color, time) {
  const pulse = 1 + Math.sin(time * 4 + item.x * 0.01) * 0.16;
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.rotate(time * 0.35);
  glow(ctx, color, 22);
  ctx.strokeStyle = color;
  ctx.fillStyle = color + '33';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -item.r * pulse);
  ctx.lineTo(item.r * pulse, 0);
  ctx.lineTo(0, item.r * pulse);
  ctx.lineTo(-item.r * pulse, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawSpecialStructure(ctx, structure, color, time, requiredSeconds) {
  ctx.save();
  ctx.translate(structure.x, structure.y);
  glow(ctx, color, 18);
  ctx.strokeStyle = color;
  ctx.fillStyle = color + (structure.cleared ? '22' : '12');
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * TAU / 6;
    const r = structure.r * (0.72 + Math.sin(time * 0.8 + i) * 0.04);
    i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (!structure.cleared && structure.progress > 0) {
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, structure.r + 8, -Math.PI / 2,
      -Math.PI / 2 + TAU * clamp(structure.progress / requiredSeconds, 0, 1));
    ctx.stroke();
  }
  ctx.restore();
}

function drawLocationSpecials(ctx, game, visible) {
  const state = game.run.locationSpecials;
  if (!state) return;
  const imageOf = (object) => nearestPointImage(object, game.player);
  if (game.run.location === 'grove' && state.groveStructure?.biomeId === game.run.biomeId) {
    const image = { ...state.groveStructure, ...imageOf(state.groveStructure) };
    if (visible(image, image.r)) drawSpecialStructure(ctx, image, '#64f0af', game.time, 4);
  }
  if (game.run.location === 'dissonance') {
    const artifact = state.dissonanceArtifact;
    if (artifact && !artifact.collected && artifact.biomeId === game.run.biomeId) {
      const image = { ...artifact, ...imageOf(artifact) };
      if (visible(image, 30)) drawSpecialPickup(ctx, image, '#ff79c6', game.time);
    }
    const structure = state.dissonanceStructure;
    if (structure?.biomeId === game.run.biomeId) {
      const image = { ...structure, ...imageOf(structure) };
      if (visible(image, image.r)) drawSpecialStructure(ctx, image, '#9c8cff', game.time, 6);
    }
  }
  const gateway = state.gateway;
  if (game.run.location === 'rift' && gateway) {
    const image = { ...gateway, ...imageOf(gateway) };
    if (visible(image, 60)) {
      ctx.save();
      ctx.translate(image.x, image.y);
      const active = gateway.phase === 'active';
      ctx.strokeStyle = active ? '#fff' : '#b06bff';
      ctx.fillStyle = active ? '#000' : 'rgba(176,107,255,.12)';
      ctx.globalAlpha = active ? 1 : 0.45;
      ctx.lineWidth = active ? 4 : 1.5;
      glow(ctx, '#b06bff', active ? 32 : 14);
      ctx.beginPath();
      ctx.arc(0, 0, gateway.r * (active ? 1 : 1.35), 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawHullSeed(ctx, game) {
  const seed = game.run.locationSpecials?.seed;
  if (!seed) return;
  const p = game.player;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  glow(ctx, '#64f0af', 12);
  ctx.fillStyle = '#64f0af';
  ctx.strokeStyle = '#1d7d5b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(-p.r * 0.3, p.r * 0.65, seed.size * 0.58, seed.size, -0.45, 0, TAU);
  ctx.fill();
  ctx.stroke();
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-p.r * 0.3, p.r * 0.55);
    ctx.quadraticCurveTo(-p.r - seed.size * i * 0.2, p.r * (0.2 - i * 0.25), -p.r * 0.45, -p.r * 0.7);
    ctx.stroke();
  }
  ctx.restore();
}

function drawAsteroid(ctx, a, time = 0, dissonant = false) {
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(a.angle);
  if (dissonant) {
    const breathe = 1 + Math.sin(time * 0.72 + a.x * 0.002 + a.y * 0.001) * 0.045;
    ctx.scale(breathe, 2 - breathe);
  }
  ctx.beginPath();
  const n = a.verts.length;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU;
    const r = a.r * a.verts[i];
    const px = Math.cos(ang) * r;
    const py = Math.sin(ang) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = a.flash > 0 ? '#ffffff' : '#2c2a33';
  ctx.fill();
  ctx.strokeStyle = a.flash > 0 ? '#ffffff' : '#6b6152';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  if (a.overgrown) {
    ctx.strokeStyle = '#4dd59b';
    ctx.fillStyle = 'rgba(45,170,115,.28)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const angle = i * TAU / 4 + a.angle * 0.3;
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * a.r * 0.45, Math.sin(angle) * a.r * 0.45, a.r * 0.18, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPickup(ctx, d, time) {
  const pulse = 0.7 + 0.3 * Math.sin(time * 7 + d.x);
  const color = d.kind === 'hp' ? '#5ef08a' : d.kind === 'scrap' ? '#ffc14a' : '#e879f9';
  ctx.save();
  glow(ctx, color, 14);
  ctx.fillStyle = color;
  if (d.kind === 'hp') {
    ctx.fillRect(d.x - 6, d.y - 2, 12, 4);
    ctx.fillRect(d.x - 2, d.y - 6, 4, 12);
  } else if (d.kind === 'scrap') {
    ctx.fillRect(d.x - 4, d.y - 4, 8, 8);
  } else {
    ctx.beginPath();
    ctx.moveTo(d.x, d.y - 6 * pulse);
    ctx.lineTo(d.x + 4 * pulse, d.y);
    ctx.lineTo(d.x, d.y + 6 * pulse);
    ctx.lineTo(d.x - 4 * pulse, d.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawMine(ctx, m) {
  ctx.save();
  glow(ctx, '#ffe066', 10);
  ctx.strokeStyle = '#ffe066';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5 + 0.5 * Math.sin(m.age * 6);
  ctx.beginPath();
  ctx.arc(m.x, m.y, m.r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawDrone(ctx, d) {
  ctx.save();
  glow(ctx, '#7ee8ff', 12);
  ctx.fillStyle = '#7ee8ff';
  ctx.fillRect(d.x - 4, d.y - 4, 8, 8);
  ctx.restore();
}

function drawTurret(ctx, t) {
  ctx.save();
  glow(ctx, t.color, 10);
  ctx.translate(t.x, t.y);
  ctx.fillStyle = t.color;
  poly(ctx, 0, 0, 9, 6, 0, t.color, null);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = t.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 13, -Math.PI / 2, -Math.PI / 2 + TAU * (t.life / t.maxLife));
  ctx.stroke();
  ctx.restore();
}

function drawShip(ctx, p, time) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  if (p.iframes > 0 && Math.floor(time * 30) % 2) ctx.globalAlpha = 0.35;
  ctx.shadowColor = p.dashTime > 0 ? '#7ee8ff' : '#4aa3ff';
  ctx.shadowBlur = p.dashTime > 0 ? 30 : 18;
  // корпус — силуэт выбранного корабля, а не общий треугольник на всех
  const shape = shipSilhouetteFor(p.shipId);
  const r = p.r;
  ctx.fillStyle = '#dff0ff';
  const h = shape.hull;
  ctx.beginPath();
  ctx.moveTo(h[0] * r, h[1] * r);
  for (let i = 2; i < h.length; i += 2) ctx.lineTo(h[i] * r, h[i + 1] * r);
  ctx.closePath();
  ctx.fill();

  // внутренние линии корпуса
  ctx.shadowBlur = 0;
  const l = shape.lines;
  if (l.length) {
    ctx.globalAlpha *= 0.45;
    ctx.strokeStyle = '#05060d';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < l.length; i += 4) {
      ctx.moveTo(l[i] * r, l[i + 1] * r);
      ctx.lineTo(l[i + 2] * r, l[i + 3] * r);
    }
    ctx.stroke();
    ctx.globalAlpha /= 0.45;
  }

  // ядро цветом текущего ствола — видно, чем стреляешь, не глядя в HUD
  ctx.fillStyle = getWeapon(p.weapon).color;
  ctx.beginPath();
  ctx.moveTo(r * 0.4, 0);
  ctx.lineTo(-r * 0.47, -r * 0.47);
  ctx.lineTo(-r * 0.47, r * 0.47);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (p.shield > 0) {
    ctx.save();
    ctx.globalAlpha = 0.18 + 0.12 * (p.shield / p.maxShield);
    ctx.strokeStyle = '#7ee8ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r + 11, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

/** Клинки и ауры от перков. */
function drawOrbitals(ctx, player, time) {
  for (const orb of player.effects.orbitals) {
    ctx.save();
    if (orb.type === 'aura') {
      const pulse = 0.9 + 0.1 * Math.sin(time * 3);
      const g = ctx.createRadialGradient(orb.x, orb.y, orb.radius * 0.25, orb.x, orb.y, orb.radius * pulse);
      g.addColorStop(0, orb.color + '22');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.radius * pulse, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = orb.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.radius * pulse, 0, TAU);
      ctx.stroke();
    } else {
      ctx.translate(orb.x, orb.y);
      ctx.rotate(orb.angle * 3);
      ctx.shadowColor = orb.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = orb.color;
      ctx.beginPath();
      ctx.moveTo(orb.radius, 0);
      ctx.lineTo(-orb.radius * 0.35, -orb.radius * 0.45);
      ctx.lineTo(-orb.radius * 0.1, 0);
      ctx.lineTo(-orb.radius * 0.35, orb.radius * 0.45);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawSingularities(ctx, game) {
  for (const s of game.singularities) {
    const k = s.life / s.max;
    ctx.save();
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.radius);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.25, '#2a1040cc');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#c99bff';
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(game.time * 12);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 26 + (1 - k) * 18, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

function drawStrikes(ctx, game) {
  for (const st of game.strikes) {
    const k = 1 - st.delay / 0.85;
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.45 * k;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.radius * (1 - k * 0.35), 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.2 + 0.3 * k;
    ctx.fillStyle = '#ff8a5e';
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.radius * 0.2 * (1 + k), 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

function drawDecoys(ctx, game) {
  for (const d of game.decoys) {
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.35 * Math.sin(game.time * 14);
    ctx.strokeStyle = '#ffd08a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(d.x + 18, d.y);
    ctx.lineTo(d.x - 10, d.y - 11);
    ctx.lineTo(d.x - 5, d.y);
    ctx.lineTo(d.x - 10, d.y + 11);
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(d.x, d.y, 34 + Math.sin(game.time * 6) * 6, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

function drawAnchors(ctx, game) {
  for (const an of game.anchors) {
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.15 * Math.sin(game.time * 5);
    ctx.strokeStyle = '#4ad9ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.arc(an.x, an.y, an.radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawRifts(ctx, game) {
  for (const r of game.rifts) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#c99bff';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r.x1, r.y1);
    ctx.lineTo(r.x2, r.y2);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [x, y] of [[r.x1, r.y1], [r.x2, r.y2]]) {
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(game.time * 10);
      ctx.fillStyle = '#c99bff';
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawMirror(ctx, m, time) {
  ctx.save();
  ctx.translate(m.x, m.y);
  ctx.globalAlpha = 0.55 + 0.15 * Math.sin(time * 8);
  ctx.strokeStyle = '#7ee8ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.lineTo(-8, -8);
  ctx.lineTo(-8, 8);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Телеграфы боссов — все зоны одним проходом, а не фигурой на объект:
 * на третьей фазе их бывает десяток одновременно (см. entities/telegraphs.js).
 * Чем ближе удар, тем ярче и «плотнее» зона — по ней и читается тайминг.
 */
function drawTelegraphs(ctx, game) {
  if (!game.telegraphs.length) return;
  ctx.save();
  for (const t of game.telegraphs) {
    const k = 1 - t.life / t.max;          // 0 в начале замаха, 1 в момент удара
    ctx.globalAlpha = 0.12 + k * 0.4;
    ctx.strokeStyle = t.color;
    ctx.fillStyle = t.color;
    ctx.lineWidth = 1.5 + k * 2;

    if (t.kind === 'circle') {
      ctx.globalAlpha = 0.08 + k * 0.22;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 0.35 + k * 0.45;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r * (0.25 + k * 0.75), 0, TAU);
      ctx.stroke();
    } else if (t.kind === 'cone') {
      ctx.globalAlpha = 0.1 + k * 0.24;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.arc(t.x, t.y, t.r, t.angle - t.arc / 2, t.angle + t.arc / 2);
      ctx.closePath();
      ctx.fill();
    } else if (t.kind === 'line') {
      ctx.globalAlpha = 0.14 + k * 0.3;
      ctx.lineWidth = t.width;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
    } else if (t.kind === 'ring') {
      // кольцо на глазах сжимается от r к r2 — видно и куда бежать, и когда
      const r = t.r + (t.r2 - t.r) * k;
      ctx.globalAlpha = 0.4 + k * 0.4;
      ctx.setLineDash([18, 12]);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r2, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawEnemy(ctx, e) {
  if (e.boss) return drawBoss(ctx, e);

  const r = e.r;
  const shape = silhouetteFor(e.type);

  // след рисуется ДО корпуса и в мировых координатах: он тянется по вектору
  // скорости, а не по развороту корпуса, — иначе стрейфящий враг мажет хвостом
  const trail = TRAIL_LENGTH[e.type] ?? 0;
  if (trail > 0) drawTrail(ctx, e, r * trail);

  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.angle);
  ctx.shadowColor = e.color;
  ctx.shadowBlur = e.elite ? 26 : 12;
  const flash = e.flash > 0;
  ctx.fillStyle = flash ? '#fff' : e.color;

  // «Фантом» подрагивает прозрачностью — он и в бою то есть, то нет
  if (e.special === 'phantom' && !flash) ctx.globalAlpha = 0.55 + 0.35 * Math.sin(e.wobble * 6);

  if (shape) {
    // корпус: один путь по готовым вершинам из Float32Array
    const h = shape.hull;
    ctx.beginPath();
    ctx.moveTo(h[0] * r, h[1] * r);
    for (let i = 2; i < h.length; i += 2) ctx.lineTo(h[i] * r, h[i + 1] * r);
    ctx.closePath();
    ctx.fill();

    // внутренние линии — читаемы на любом размере, темнее корпуса
    const l = shape.lines;
    if (l.length) {
      ctx.shadowBlur = 0;
      ctx.globalAlpha *= 0.5;
      ctx.strokeStyle = '#05060d';
      ctx.lineWidth = Math.max(1, r * 0.09);
      ctx.beginPath();
      for (let i = 0; i < l.length; i += 4) {
        ctx.moveTo(l[i] * r, l[i + 1] * r);
        ctx.lineTo(l[i + 2] * r, l[i + 3] * r);
      }
      ctx.stroke();
      ctx.globalAlpha /= 0.5;
    }

    // акцентная точка ядра — по ней тип опознаётся даже в свалке
    if (shape.core) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = flash ? '#fff' : coreTint(e.color);
      ctx.beginPath();
      ctx.arc(shape.core.x * r, shape.core.y * r, shape.core.r * r, 0, TAU);
      ctx.fill();
    }
  } else {
    // силуэт не задан — прежний правильный шестиугольник
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  ctx.globalAlpha = 1;

  if (e.frontShield) {
    ctx.strokeStyle = flash ? '#fff' : '#4ad9ff';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.85;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, 0, r + 8, -1.1, 1.1);
    ctx.stroke();
    // засечки по краям дуги: видно, где щит кончается и куда облетать
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const s of [-1.1, 1.1]) {
      ctx.moveTo(Math.cos(s) * (r + 3), Math.sin(s) * (r + 3));
      ctx.lineTo(Math.cos(s) * (r + 13), Math.sin(s) * (r + 13));
    }
    ctx.stroke();
  }
  if (e.type === 'mine' && e.fuse > 0) {
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(e.fuse * 30);
    ctx.strokeStyle = '#ff3b6b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r + 7, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();

  if (e.hp < e.maxHp) {
    const w = e.r * 2;
    ctx.fillStyle = '#00000099';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w, 3);
    ctx.fillStyle = e.elite ? '#ffd166' : '#ff6b8a';
    ctx.fillRect(e.x - w / 2, e.y - e.r - 10, w * (e.hp / e.maxHp), 3);
  }
}

/**
 * Сужающийся след по вектору скорости — треугольник, без частиц.
 * Частицы на каждый быстрый враг стоили бы кадров, а нужен только намёк
 * на направление и темп.
 */
function drawTrail(ctx, e, length) {
  const speed = Math.hypot(e.vx, e.vy);
  if (speed < 30) return;
  const ux = -e.vx / speed;
  const uy = -e.vy / speed;
  const w = e.r * 0.45;
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = e.color;
  ctx.beginPath();
  ctx.moveTo(e.x + ux * length, e.y + uy * length);
  ctx.lineTo(e.x - uy * w, e.y + ux * w);
  ctx.lineTo(e.x + uy * w, e.y - ux * w);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Ядро светлее корпуса: тот же цвет фракции, но заметно ярче. */
function coreTint(color) {
  return CORE_TINT[color] ?? '#ffffff';
}
const CORE_TINT = {
  '#ff6b8a': '#ffd0dc', '#ffb14a': '#ffe3b0', '#5ef0d0': '#c8fff2',
  '#b06bff': '#e0ccff', '#ffe066': '#fff6cc', '#ff9f43': '#ffdcb0',
  '#e879f9': '#f8d4ff', '#4ad9ff': '#cdf3ff', '#ff4a4a': '#ffc4c4',
  '#c9955a': '#f0d8bc', '#8a7ad0': '#ddd6f5', '#d4c05a': '#f2ead0',
  '#7ee8ff': '#dffaff', '#ff6ba0': '#ffd2e2',
};

function drawBoss(ctx, b) {
  const def = BOSSES[b.boss];
  const r = b.r;
  const body = b.flash > 0 ? '#fff' : def.color;

  // «Проводник» тянет узлы за собой — рисуются до корпуса, чтобы линии
  // сети уходили под него, а не поверх
  if (b.nodes?.length) drawConduitNodes(ctx, b, def);

  // у босса след длинный: издалека понятно, что на тебя идёт именно он
  if (!b.hidden) drawTrail(ctx, b, r * 3.2);

  ctx.save();
  ctx.translate(b.x, b.y);

  // Ф3 «Ока»: между атаками пропадает — от него остаётся только контур-намёк
  if (b.hidden) {
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    return;
  }

  ctx.shadowColor = def.color;
  ctx.shadowBlur = 34;

  if (b.boss === 'eye') {
    // на второй фазе луч раздваивается — рисуем оба
    for (const off of b.phase >= 2 ? [0, Math.PI] : [0]) {
      ctx.save();
      ctx.rotate((b.beamAngle || 0) + off);
      const g = ctx.createLinearGradient(0, 0, 1200, 0);
      g.addColorStop(0, '#7ee8ffcc');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, -7); ctx.lineTo(1200, -34); ctx.lineTo(1200, 34); ctx.lineTo(0, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // щит «Могильщика» — кольцо обломков вокруг корпуса, пока цел
  if (b.shield > 0 && b.shieldMax) {
    ctx.save();
    ctx.rotate(b.shieldSpin ?? 0);
    const chunks = 9;
    const left = clamp(b.shield / b.shieldMax, 0, 1);
    ctx.fillStyle = '#4a6a62';
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < chunks; i++) {
      if (i / chunks > left) break;
      const a = (i / chunks) * TAU;
      const cx = Math.cos(a) * r * 1.55;
      const cy = Math.sin(a) * r * 1.55;
      poly(ctx, cx, cy, r * 0.3, 5, a * 2, '#4a6a62', def.color);
    }
    ctx.restore();
  }

  ctx.rotate(b.angle);

  if (b.boss === 'dread') {
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(r * 1.15, 0);
    ctx.lineTo(r * 0.1, -r * 0.55);
    ctx.lineTo(-r * 0.55, -r);
    ctx.lineTo(-r, -r * 0.35);
    ctx.lineTo(-r * 0.75, 0);
    ctx.lineTo(-r, r * 0.35);
    ctx.lineTo(-r * 0.55, r);
    ctx.lineTo(r * 0.1, r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-b.angle + b.spin);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    poly(ctx, 0, 0, r * 1.35, 4, 0, null, body);
  } else if (b.boss === 'hive') {
    const pulse = 1 + 0.07 * Math.sin(b.wobble * 4);
    poly(ctx, 0, 0, r * pulse, 7, b.spin * 0.4, body, null);
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    poly(ctx, 0, 0, r * 1.3 * pulse, 7, -b.spin * 0.6, null, body);
    ctx.globalAlpha = 1;
    poly(ctx, 0, 0, r * 0.45, 7, b.spin, '#05060d', null);
  } else if (b.boss === 'eye') {
    ctx.rotate(-b.angle);
    ctx.fillStyle = '#05060d';
    ctx.strokeStyle = body;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.35, b.spin, b.spin + 4.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.6, -b.spin * 0.7, -b.spin * 0.7 + 2.6);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = body;
    ctx.rotate(b.beamAngle || 0);
    ctx.beginPath();
    ctx.arc(r * 0.28, 0, r * 0.42, 0, TAU);
    ctx.fill();
  } else if (b.boss === 'gravedigger') {
    // тяжёлый ковш: широкий тупой корпус, читается как «поднимает обломки»
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(r * 0.95, -r * 0.5);
    ctx.lineTo(r * 1.1, 0);
    ctx.lineTo(r * 0.95, r * 0.5);
    ctx.lineTo(-r * 0.3, r);
    ctx.lineTo(-r, r * 0.6);
    ctx.lineTo(-r, -r * 0.6);
    ctx.lineTo(-r * 0.3, -r);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#05060d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.45); ctx.lineTo(r * 0.6, -r * 0.2);
    ctx.moveTo(-r * 0.5, r * 0.45); ctx.lineTo(r * 0.6, r * 0.2);
    ctx.stroke();
  } else if (b.boss === 'conduit') {
    // ядро в клетке из дуг — «источник разрядов»
    poly(ctx, 0, 0, r, 3, b.spin * 1.4, body, null);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    poly(ctx, 0, 0, r * 1.5, 3, -b.spin * 1.1, null, body);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#dffaff';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3 * (1 + 0.15 * Math.sin(b.wobble * 8)), 0, TAU);
    ctx.fill();
  } else if (b.boss === 'distortion') {
    // силуэт корабля игрока, вывернутый наизнанку: два встречных клина
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(r, 0); ctx.lineTo(-r * 0.4, -r * 0.75); ctx.lineTo(-r * 0.15, 0); ctx.lineTo(-r * 0.4, r * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(-r, 0); ctx.lineTo(r * 0.4, -r * 0.75); ctx.lineTo(r * 0.15, 0); ctx.lineTo(r * 0.4, r * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    poly(ctx, 0, 0, r * 1.45, 6, b.spin * 0.8, null, body);
  } else {
    // ДРОБИЛЬЩИК-ПРАЙМ: раскрытая пасть, перед рывком кольцо вспыхивает
    ctx.fillStyle = body;
    const gape = b.charge > 0 ? 0.55 + 0.5 * Math.sin(b.charge * 22) : 0.25;
    ctx.beginPath();
    ctx.arc(0, 0, r, gape, TAU - gape);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    poly(ctx, 0, 0, r * 1.3, 3, b.spin, null, body);
    if (b.charge > 0) {
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#ff3b6b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r + 14 + Math.sin(b.charge * 20) * 6, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Узлы-ретрансляторы «Проводника» и живая сеть между ними. */
function drawConduitNodes(ctx, b, def) {
  ctx.save();
  const hot = b.gridActive > 0;
  for (let i = 0; i < b.nodes.length; i++) {
    const n = b.nodes[i];
    const fade = clamp(n.life / 3, 0, 1);   // последние секунды узел гаснет
    ctx.globalAlpha = 0.35 * fade + (hot ? 0.3 : 0);
    ctx.strokeStyle = def.color;
    ctx.lineWidth = hot ? 2.5 : 1;
    const nx = b.nodes[(i + 1) % b.nodes.length];
    if (b.nodes.length > 1) {
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.lineTo(nx.x, nx.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.7 * fade;
    ctx.fillStyle = '#dffaff';
    ctx.beginPath();
    ctx.arc(n.x, n.y, 5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function poly(ctx, cx, cy, r, n, rot, fill, stroke) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

// ─────────────────────────────── снаряды и эффекты

function drawBullet(ctx, b, time) {
  ctx.save();
  glow(ctx, b.crit ? '#ffe066' : b.color, 12);

  if (b.kind === 'plasma') {
    ctx.fillStyle = b.crit ? '#ffe066' : b.color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + Math.sin(time * 20) * 1.2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 1.8, 0, TAU);
    ctx.fill();
  } else if (b.kind === 'missile') {
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    ctx.fillStyle = b.crit ? '#ffe066' : b.color;
    ctx.beginPath();
    ctx.moveTo(7, 0); ctx.lineTo(-5, -3.5); ctx.lineTo(-5, 3.5);
    ctx.closePath();
    ctx.fill();
  } else if (b.kind === 'boomerang') {
    ctx.translate(b.x, b.y);
    ctx.rotate(time * 14);
    ctx.fillStyle = b.crit ? '#ffe066' : b.color;
    poly(ctx, 0, 0, 6, 4, 0, ctx.fillStyle, null);
  } else if (b.kind === 'lob') {
    // навесной снаряд не сталкивается по пути — рисуем зону будущего взрыва,
    // чтобы игрок видел, куда он летит, ещё до приземления
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4 + Math.sin(time * 16) * 1.5, 0, TAU);
    ctx.fill();
    if (b.splash) {
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.splash, 0, TAU);
      ctx.stroke();
    }
  } else {
    ctx.lineCap = 'round';
    ctx.strokeStyle = b.crit ? '#ffe066' : b.color;
    ctx.lineWidth = (b.crit ? 4 : 2.5) * (b.charged ? 1 + b.charged * 1.6 : 1);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - Math.cos(b.angle) * (b.charged ? 14 + b.charged * 16 : 14), b.y - Math.sin(b.angle) * 14);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFoeBullet(ctx, f) {
  ctx.save();
  glow(ctx, f.color, 10);
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.arc(f.x, f.y, f.r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawBeam(ctx, bm) {
  const k = bm.life / bm.max;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalAlpha = k;
  ctx.shadowColor = bm.color;
  ctx.shadowBlur = 24;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = bm.width * k;
  ctx.beginPath();
  ctx.moveTo(bm.x1, bm.y1);
  ctx.lineTo(bm.x2, bm.y2);
  ctx.stroke();
  ctx.globalAlpha = k * 0.5;
  ctx.strokeStyle = bm.color;
  ctx.lineWidth = bm.width * 3 * k;
  ctx.beginPath();
  ctx.moveTo(bm.x1, bm.y1);
  ctx.lineTo(bm.x2, bm.y2);
  ctx.stroke();
  ctx.restore();
}

function drawBlast(ctx, bl) {
  const k = 1 - bl.life / bl.max;
  ctx.save();
  ctx.globalAlpha = (1 - k) * 0.9;
  ctx.strokeStyle = bl.color;
  ctx.lineWidth = 3 * (1 - k) + 1;
  ctx.beginPath();
  ctx.arc(bl.x, bl.y, bl.r * (0.3 + k * 0.8), 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawParticle(ctx, q) {
  ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
  ctx.fillStyle = q.color;
  ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
}

// ─────────────────────────────── подсказки поверх сцены

function drawBossArrow(ctx, game, W, H) {
  const boss = activeBoss(game);
  if (!boss) return;
  const dx = boss.x - camera.x;
  const dy = boss.y - camera.y;
  if (Math.abs(dx) <= W / 2 - 70 && Math.abs(dy) <= H / 2 - 70) return;

  const a = Math.atan2(dy, dx);
  const radius = Math.min(W, H) * 0.38;
  ctx.save();
  ctx.translate(W / 2 + Math.cos(a) * radius, H / 2 + Math.sin(a) * radius);
  ctx.rotate(a);
  ctx.globalAlpha = 0.6 + 0.4 * Math.sin(game.time * 8);
  ctx.fillStyle = BOSSES[boss.boss].color;
  ctx.beginPath();
  ctx.moveTo(18, 0); ctx.lineTo(-10, -10); ctx.lineTo(-10, 10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Компас на метку, поставленную на карте (M). Стрелка + дистанция у края экрана. */
function drawWaypointArrow(ctx, game, W, H) {
  const wp = game.run.waypoint;
  if (!wp) return;
  const dx = torDelta(camera.x, wp.x);
  const dy = torDelta(camera.y, wp.y);
  const dist = torDistance(game.player.x, game.player.y, wp.x, wp.y);
  if (Math.abs(dx) <= W / 2 - 70 && Math.abs(dy) <= H / 2 - 70) return;

  const a = Math.atan2(dy, dx);
  const radius = Math.min(W, H) * 0.42;
  ctx.save();
  ctx.translate(W / 2 + Math.cos(a) * radius, H / 2 + Math.sin(a) * radius);
  ctx.rotate(a);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.moveTo(16, 0); ctx.lineTo(-9, -9); ctx.lineTo(-9, 9);
  ctx.closePath();
  ctx.fill();
  ctx.rotate(-a);
  ctx.fillStyle = '#ffd166';
  ctx.font = '600 12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(formatNavigationDistance(dist), 0, 26);
  ctx.restore();
}

/** Физический маяк метки: виден прямо в мире, когда попадает в кадр. */
function drawWorldWaypoint(ctx, waypoint, time) {
  const pulse = 1 + Math.sin(time * 5) * 0.12;
  ctx.save();
  ctx.translate(waypoint.x, waypoint.y);
  ctx.strokeStyle = '#ffd166';
  ctx.fillStyle = 'rgba(255, 209, 102, 0.12)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.arc(0, 0, 24 * pulse, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(-12, 0); ctx.lineTo(0, -12); ctx.lineTo(12, 0); ctx.lineTo(0, 12);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.moveTo(0, -42); ctx.lineTo(0, 42);
  ctx.stroke();
  ctx.restore();
}

function drawVignette(ctx, W, H, color = 'rgba(0,0,0,.45)') {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.5, W / 2, H / 2, Math.max(W, H) * 0.8);
  g.addColorStop(0, 'transparent');
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Живой фон для меню: те же звёзды, медленно плывущие. */
export function renderMenuBackdrop(ctx, W, H, time) {
  ctx.fillStyle = '#05060d';
  ctx.fillRect(0, 0, W, H);
  drawStarfield(ctx, { x: time * 22, y: Math.sin(time * 0.15) * 120 }, W, H, time);
  drawVignette(ctx, W, H);
}
