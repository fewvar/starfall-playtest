import { damp, rnd } from './math.js';

/** Камера с мягким следованием, упреждением по скорости и тряской. */
export const camera = {
  x: 0,
  y: 0,
  skyX: 0,
  skyY: 0,
  shakeAmount: 0,

  reset(x = 0, y = 0) {
    this.x = x;
    this.y = y;
    this.skyX = x;
    this.skyY = y;
    this.shakeAmount = 0;
  },

  /** target — игрок, aim — смещение прицела в пикселях экрана. */
  follow(target, aimX, aimY, dt) {
    const wantX = target.x + target.vx * 0.16 + aimX * 0.12;
    const wantY = target.y + target.vy * 0.16 + aimY * 0.12;
    const beforeX = this.x;
    const beforeY = this.y;
    this.x = damp(this.x, wantX, 0.001, dt);
    this.y = damp(this.y, wantY, 0.001, dt);
    // sky остаётся в непрерывном image space и потому не прыгает на шве тора.
    this.skyX += this.x - beforeX;
    this.skyY += this.y - beforeY;
    this.shakeAmount *= Math.pow(0.02, dt);
  },

  shake(power) {
    this.shakeAmount = Math.min(this.shakeAmount + power, 30);
  },

  offset() {
    const s = this.shakeAmount;
    return s > 0.05 ? { x: rnd(s, -s), y: rnd(s, -s) } : { x: 0, y: 0 };
  },

  /** Экранные координаты → мировые. */
  toWorld(sx, sy, W, H) {
    return { x: sx - W / 2 + this.x, y: sy - H / 2 + this.y };
  },
};
