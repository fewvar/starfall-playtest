import { mulberry, hash32 } from '../core/rng.js';
import { emit, on } from '../core/events.js';
import { BOSSES, BOSS_ORDER, finalBossForPath } from '../data/bosses.js';
import { makeBoss } from '../entities/factory.js';
import { SINGULARITY_PERK } from '../data/perks.js';
import { meta } from './meta.js';

/**
 * ТРИ ПУТИ К ФИНАЛУ.
 *
 * Концовка не выбирается в меню — она открывается тем, что игрок успел
 * сделать за забег (см. Notes/PLAYTEST_NOTES_2.md, трек 2). Здесь живёт
 * только «открыт ли путь»; какой финальный босс встретит игрока в Разломе —
 * дело трека 1.6, а экран победы — 2.4.
 *
 *   force  — СИЛА:  собрать все 10 ключей с боссов;
 *   bonds  — СВЯЗИ: донести уникальный предмет NPC (трек 3, ещё не сделан);
 *   secret — ТАЙНА: взять карточку «Терпение пустоты» в обычном забеге,
 *            получив её однажды в Сингулярности.
 *
 * Пути независимы и не делят между собой ресурсы: десять ключей нужны
 * целиком именно для пути СИЛЫ.
 */

export const PATHS = ['force', 'bonds', 'secret'];

/** Ключей всегда ровно десять, сколько бы боссов ни было в игре. */
export const KEY_COUNT = 10;

/** Достижение, которое открывает секретную карточку в будущих забегах. */
export const SECRET_ACHIEVEMENT = 'singularity_patience';

const KEY_SALT = 0x4b3159;

/** Боссы, которые вообще могут нести ключ: финальные — не могут. */
const keyCandidates = () => BOSS_ORDER.filter((id) => !BOSSES[id].final);

/**
 * Какие боссы несут ключ в этом забеге. Детерминированно от сида, как и вся
 * остальная расстановка.
 *
 * Боссов в игре никогда не меньше десяти, поэтому «убил всех = собрал все
 * ключи» — не удача, а свойство построения: ключи всегда подмножество
 * боссов. Когда боссов ровно десять, ключ несёт каждый; когда больше —
 * какие именно, решает сид, но их всё равно ровно десять.
 */
export function keyBossesFor(seed) {
  const ids = keyCandidates();
  const random = mulberry(hash32(seed >>> 0, KEY_COUNT, KEY_SALT));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = (random() * (i + 1)) | 0;
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, Math.min(KEY_COUNT, ids.length)).sort();
}

/** Начальное состояние путей — часть забега, в мета-профиль ничего не течёт. */
export function createEndingState(seed) {
  return {
    keyBosses: keyBossesFor(seed),
    keys: [],
    open: { force: false, bonds: false, secret: false },
    lastOpened: null,   // какой путь открыт последним — он и ведёт к финалу
  };
}

const stateOf = (run) => (run.endings ??= createEndingState(run.seed ?? 0));

/** Открыть путь. Повторный вызов ничего не делает — событие шлётся один раз. */
export function openPath(run, path) {
  const state = stateOf(run);
  if (!PATHS.includes(path) || state.open[path]) return false;
  state.open[path] = true;
  // Экрана выбора концовки нет — значит нужно правило на случай, когда путей
  // открыто несколько. Правило простое и не требует UI: считается ПОСЛЕДНИЙ
  // открытый. Чем игрок закончил, то и есть его ответ.
  state.lastOpened = path;
  emit('ending:open', { run, path });
  return true;
}

export const pathOpen = (run, path) => !!run.endings?.open?.[path];
export const openPaths = (run) => PATHS.filter((path) => pathOpen(run, path));

/**
 * Босс повержен — если он нёс ключ, ключ падает. Возвращает состояние ключей
 * для интерфейса, чтобы вызывающему не пришлось лезть внутрь.
 */
export function collectBossKey(run, bossId) {
  const state = stateOf(run);
  if (!state.keyBosses.includes(bossId) || state.keys.includes(bossId)) return null;
  state.keys.push(bossId);
  const progress = { taken: state.keys.length, total: KEY_COUNT };
  emit('ending:key', { run, bossId, ...progress });
  if (state.keys.length >= KEY_COUNT) openPath(run, 'force');
  return progress;
}

export const keysTaken = (run) => run.endings?.keys?.length ?? 0;
export const bossCarriesKey = (run, bossId) => !!run.endings?.keyBosses?.includes(bossId);

/**
 * РАЗВИЛКА РАЗЛОМА. Разлом перестал быть просто локацией с Искажением:
 * после того как Искажение повержено, а хотя бы один путь открыт, здесь
 * можно вызвать финал СВОЕЙ концовки. Искажение при этом остаётся на месте —
 * оно нужно и ступеням силы, и ключам.
 */
export const finalBossFor = (run) => finalBossForPath(run.endings?.lastOpened);

export function canCallFinal(game) {
  const run = game.run;
  if (run.endless || run.over || run.finalActive || run.finalDefeated) return false;
  if (run.location !== 'rift' || run.stationEncounter) return false;
  if (!run.bossesKilled?.includes('distortion')) return false;
  if (game.entities.enemies.some((e) => e.boss)) return false;
  return !!finalBossFor(run);
}

/** Финал вызван игроком — он всегда приходит по явному согласию, не сам. */
export function startFinal(game) {
  if (!canCallFinal(game)) return false;
  const run = game.run;
  const id = finalBossFor(run);
  const p = game.player;
  const angle = Math.random() * Math.PI * 2;
  const boss = makeBoss(id, p.x + Math.cos(angle) * 700, p.y + Math.sin(angle) * 700, 1);
  boss.fromWave = false;
  boss.source = 'final';
  boss.encounterId = `final:${id}`;
  boss.hunting = true;
  game.entities.enemies.push(boss);
  run.finalActive = id;
  run.bossHint = BOSSES[id].hint;
  emit('final:start', { run, boss, path: run.endings.lastOpened });
  return true;
}

/** Финал повержен — это и есть победа забега, независимо от числа боссов. */
export function noteFinalDefeated(game, bossId) {
  if (!BOSSES[bossId]?.final) return false;
  game.run.finalActive = null;
  game.run.finalDefeated = bossId;
  emit('run:allBosses', { run: game.run, final: bossId });
  return true;
}

/** Карточка «Терпение пустоты» разблокирована навсегда прошлым забегом. */
export const secretCardUnlocked = () => meta.achievementUnlocked(SECRET_ACHIEVEMENT);

/**
 * Секретная карточка, взятая в ОБЫЧНОМ забеге, — это и есть вход в путь
 * ТАЙНЫ. Взятие её в самой Сингулярности не считается: там она награда за
 * терпение, а ключом становится только в следующий раз, уже из общего пула.
 */
export function initEndings(game) {
  on('upgrade:taken', ({ card }) => {
    if (card?.id !== SINGULARITY_PERK.id) return;
    if (game.run.location === 'singularity') return;
    openPath(game.run, 'secret');
  });
}
