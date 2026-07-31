/**
 * Замер собственного времени работы игры.
 *
 * Частота кадров в браузере зависит от монитора, компоновщика, фокуса окна и
 * посторонней нагрузки — по ней невозможно понять, потяжелел ли КОД. Поэтому
 * бенчмарк смотрит на чистое время JS-работы: сколько миллисекунд заняли
 * обновление мира и отрисовка. Эта величина воспроизводима от прогона к прогону.
 *
 * Выключен по умолчанию и в этом состоянии стоит одну проверку булева поля.
 */
export const profiler = {
  on: false,
  update: [],
  render: [],

  start() {
    this.update.length = 0;
    this.render.length = 0;
    this.on = true;
  },

  stop() {
    this.on = false;
  },

  push(updateMs, renderMs) {
    this.update.push(updateMs);
    this.render.push(renderMs);
  },

  /** Сводка в миллисекундах: среднее и хвосты распределения. */
  report() {
    const stat = (arr) => {
      if (!arr.length) return { avg: 0, p50: 0, p99: 0, max: 0 };
      const sorted = [...arr].sort((a, b) => a - b);
      const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
      return {
        avg: arr.reduce((s, x) => s + x, 0) / arr.length,
        p50: at(0.5),
        p99: at(0.99),
        max: sorted[sorted.length - 1],
      };
    };
    const total = this.update.map((u, i) => u + (this.render[i] ?? 0));
    return {
      frames: this.update.length,
      update: stat(this.update),
      render: stat(this.render),
      total: stat(total),
    };
  },
};
