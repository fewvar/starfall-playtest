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
const boundCanvases = new WeakSet();

/** Координаты события мыши в настоящих пикселях canvas, а не в CSS-пикселях. */
function canvasPoint(target, event) {
  const rect = target.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (target.width / rect.width),
    y: (event.clientY - rect.top) * (target.height / rect.height),
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

  bindMapCanvas(canvas);
}

function bindMapCanvas(target) {
  if (boundCanvases.has(target)) return;
  boundCanvases.add(target);
  target.addEventListener('wheel', (e) => {
    e.preventDefault();
    const point = canvasPoint(target, e);
    zoomMapAt(game, view, point.x, point.y, target.width, target.height, e.deltaY < 0 ? 1.12 : 0.89);
    redraw(target);
  }, { passive: false });

  target.addEventListener('click', (e) => {
    if (!navigationCapabilities(game).waypoint) return;
    const point = canvasPoint(target, e);
    const world = mapScreenToWorld(point.x, point.y, target.width, target.height, game, view);
    const current = game.run.waypoint;
    const clickRadius = 18 / (0.02 * view.zoom);
    const clickedCurrent = current && torDistance(current.x, current.y, world.x, world.y) <= clickRadius;
    game.run.waypoint = clickedCurrent ? null : world;
    sfx.select();
    redraw(target);
  });
}

/** Рисует ту же интерактивную карту в полноэкранный или встроенный canvas. */
export function renderMapCanvas(target) {
  bindMapCanvas(target);
  const rect = target.getBoundingClientRect();
  target.width = Math.max(1, Math.round(rect.width || window.innerWidth));
  target.height = Math.max(1, Math.round(rect.height || window.innerHeight));
  redraw(target);
}

export function showMap() {
  if (!navigationCapabilities(game).map) return false;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.hidden = false;
  document.getElementById('map-hint').hidden = false;
  renderMapCanvas(canvas);
  return true;
}

export function hideMap() {
  canvas.hidden = true;
  document.getElementById('map-hint').hidden = true;
}

export const isMapOpen = () => !!canvas && !canvas.hidden;

function redraw(target = canvas) {
  const targetCtx = target === canvas ? ctx : target.getContext('2d');
  drawMap(targetCtx, game, target.width, target.height, view);
}
