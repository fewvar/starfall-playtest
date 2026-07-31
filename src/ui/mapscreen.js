import { drawMap, mapScreenToWorld, mapWorldToScreen } from '../render/mapview.js';
import { sfx } from '../core/audio.js';
import { torDistance } from '../world/torus.js';
import { navigationCapabilities } from '../systems/location-policy.js';

/**
 * Карта сектора (M): полноэкранный canvas поверх игры, мир при этом стоит
 * (game.state === 'map', см. main.js). Перерисовывается по требованию —
 * при открытии, зуме и клике, а не каждый кадр: мир и так не меняется,
 * пока карта открыта.
 */
let canvas;
let ctx;
let game;
const view = { zoom: 1, pan: { x: 0, y: 0 } };

/** Координаты события мыши в настоящих пикселях canvas, а не в CSS-пикселях. */
function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

/**
 * Меняет масштаб, сохраняя мировую точку под курсором на том же месте.
 * Экспорт нужен для точной автоматической проверки математики карты.
 */
export function zoomMapAt(activeGame, activeView, sx, sy, W, H, factor) {
  const anchor = mapScreenToWorld(sx, sy, W, H, activeGame, activeView);
  activeView.zoom = Math.min(3, Math.max(0.4, activeView.zoom * factor));
  const projected = mapWorldToScreen(anchor.x, anchor.y, W, H, activeGame, activeView);
  activeView.pan.x += sx - projected.x;
  activeView.pan.y += sy - projected.y;
}

export function initMapScreen(activeGame) {
  game = activeGame;
  canvas = document.getElementById('map-canvas');
  ctx = canvas.getContext('2d');

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const point = canvasPoint(e);
    zoomMapAt(game, view, point.x, point.y, canvas.width, canvas.height, e.deltaY < 0 ? 1.12 : 0.89);
    redraw();
  }, { passive: false });

  canvas.addEventListener('click', (e) => {
    if (!navigationCapabilities(game).waypoint) return;
    const point = canvasPoint(e);
    const world = mapScreenToWorld(point.x, point.y, canvas.width, canvas.height, game, view);
    const current = game.run.waypoint;
    const clickRadius = 18 / (0.02 * view.zoom);
    const clickedCurrent = current && torDistance(current.x, current.y, world.x, world.y) <= clickRadius;
    game.run.waypoint = clickedCurrent ? null : world;
    sfx.select();
    redraw();
  });
}

export function showMap() {
  if (!navigationCapabilities(game).map) return false;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.hidden = false;
  document.getElementById('map-hint').hidden = false;
  redraw();
  return true;
}

export function hideMap() {
  canvas.hidden = true;
  document.getElementById('map-hint').hidden = true;
}

export const isMapOpen = () => !!canvas && !canvas.hidden;

function redraw() {
  drawMap(ctx, game, canvas.width, canvas.height, view);
}
