/**
 * Ввод с клавиатуры и мыши.
 *
 * Клавиши читаются по e.code (физическое положение), а не по e.key:
 * иначе на русской раскладке WASD приезжает как «цфыв» и управление отваливается.
 */

export const keys = Object.create(null);
export const mouse = { x: 0, y: 0, down: false, worldX: 0, worldY: 0 };

/** Подписчики на разовые нажатия: keyName → Set<fn> */
const pressHandlers = new Map();

/** e.code → внутреннее имя клавиши ('KeyW' → 'w', 'Digit3' → '3'). */
export function keyName(e) {
  const c = e.code || '';
  if (c.startsWith('Key')) return c.slice(3).toLowerCase();
  if (c.startsWith('Digit')) return c.slice(5);
  if (c.startsWith('Numpad') && /\d$/.test(c)) return c.slice(-1);
  if (c.startsWith('Arrow')) return c.toLowerCase();
  if (c === 'Space') return ' ';
  if (c.startsWith('Shift')) return 'shift';
  if (c === 'Escape') return 'escape';
  if (c === 'Enter' || c === 'NumpadEnter') return 'enter';
  if (c) return c.toLowerCase();
  // запасной путь для браузеров без e.code: кириллицу переводим по позиции клавиши
  const k = (e.key || '').toLowerCase();
  return { ц: 'w', ф: 'a', ы: 's', в: 'd', й: 'q', з: 'p', ь: 'm', е: 't', н: 'y' }[k] || k;
}

/** Зажата ли хоть одна из перечисленных клавиш. */
export const held = (...names) => names.some((n) => keys[n]);

/** Разовое нажатие: onPress('escape', fn). Возвращает функцию отписки. */
export function onPress(name, fn) {
  if (!pressHandlers.has(name)) pressHandlers.set(name, new Set());
  pressHandlers.get(name).add(fn);
  return () => pressHandlers.get(name)?.delete(fn);
}

// Tab перехватываем, иначе браузер уводит фокус на элементы страницы
const PREVENT = new Set([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab']);

let mouseHandlers = { rightClick: null, wheel: null };

/** Настройки поведения мыши задаются извне (рывок на ПКМ, смена оружия колесом). */
export function configureMouse({ rightClick, wheel }) {
  mouseHandlers = { rightClick, wheel };
}

export function initInput(canvas) {
  addEventListener('keydown', (e) => {
    const k = keyName(e);
    if (PREVENT.has(k)) e.preventDefault();
    const wasDown = keys[k];
    keys[k] = true;
    if (!wasDown || e.repeat === false) {
      const set = pressHandlers.get(k);
      if (set) for (const fn of set) fn(e);
    }
  });

  addEventListener('keyup', (e) => {
    keys[keyName(e)] = false;
  });

  canvas.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) {
      e.preventDefault();
      mouseHandlers.rightClick?.();
    }
  });
  addEventListener('mouseup', () => {
    mouse.down = false;
  });
  addEventListener('wheel', (e) => mouseHandlers.wheel?.(e.deltaY > 0 ? 1 : -1), { passive: true });

  // потеряли фокус — отпускаем всё, иначе корабль улетает сам по себе
  addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });
}

export function releaseAll() {
  mouse.down = false;
  for (const k in keys) keys[k] = false;
}
