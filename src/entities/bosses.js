import { angLerp, angDiff, lerp, rnd, TAU, clamp } from '../core/math.js';
import { hash32, mulberry } from '../core/rng.js';
import { DAMAGE_TYPE } from '../core/damage.js';
import { sfx } from '../core/audio.js';
import { camera } from '../core/camera.js';
import { emit } from '../core/events.js';
import { BOSSES, BOSS_HUNT_AFTER } from '../data/bosses.js';
import { getWeapon } from '../data/weapons.js';
import { makeEnemy } from './factory.js';
import { hurtPlayer, blastHostile } from '../systems/combat.js';
import { spawnFoeBullet } from './projectiles.js';
import { spark, blastRing, floatText } from './effects.js';
import { telegraph } from './telegraphs.js';
import { currentWeapon } from './player.js';

/**
 * ПОВЕДЕНИЕ БОССОВ.
 *
 * У каждого ТРИ фазы по порогам 100% → 60% → 30%. Фаза не множит числа —
 * она ДОБАВЛЯЕТ паттерн: то, что было в первой, продолжает работать.
 * Поэтому ветки атак проверяют `b.phase >= N`, а не `switch (b.phase)`.
 *
 * Каждая опасная атака сначала ставит телеграф (entities/telegraphs.js) на
 * ту же длительность, что и собственный таймер замаха — иначе подсветка
 * разъедется с ударом и сложность станет нечестной.
 *
 * Пока не истёк BOSS_HUNT_AFTER, босс держит дистанцию и не преследует:
 * игрок сам решает, лететь к нему за наградой за скорость или сперва
 * разгрести волну (см. data/bosses.js:bossSpeedReward).
 */

const MINION_LIMIT = 26;
const PRIME_RAM_DISTANCE = 900;
const PRIME_RAM_SPEED_MUL = 3.4;
const ROOT_RAM_DISTANCE = 620;
const ROOT_RAM_SPEED_MUL = 3;
const PHYSICAL_DAMAGE = { type: DAMAGE_TYPE.PHYSICAL, penetration: 0, fromEffect: false };
const TECHNICAL_DAMAGE = { type: DAMAGE_TYPE.TECHNICAL, penetration: 0, fromEffect: false };

/**
 * ЗАМАХИ = ДЛИТЕЛЬНОСТИ ТЕЛЕГРАФОВ. Диапазон, а не константа.
 *
 * Одна и та же атака бьёт то через 0.65с, то через 0.95с: игрок перестаёт
 * считать секунды по метроному и начинает читать саму подсветку. Диапазон
 * честный — он целиком лежит в окне 0.6-1.4с, поэтому времени среагировать
 * хватает в любом случае. Число катится ОДИН раз на конкретный вызов атаки
 * и идёт сразу в оба места (свой таймер + `life` телеграфа), иначе
 * подсветка разъедется с ударом.
 */
const TELE_MIN = 0.6;
const TELE_MAX = 1.4;
const TELE = {
  scout: { min: 0.6, max: 0.75 },        // разведочный залп «Дредноута»
  volley: { min: 0.6, max: 0.85 },       // веер «Дредноута»
  deploy: { min: 0.6, max: 0.8 },        // высадка дронов
  walls: { min: 1.05, max: 1.4 },        // сходящиеся стены
  ram: { min: 0.6, max: 0.95 },          // рывок «Дробильщика»
  rock: { min: 0.75, max: 1.05 },        // брошенный астероид
  ringIn: { min: 1.2, max: 1.4 },        // сжимающееся кольцо обломков
  zap: { min: 0.65, max: 0.95 },         // цепной разряд «Проводника»
  grid: { min: 0.85, max: 1.15 },        // сеть между узлами
  blink: { min: 0.6, max: 0.8 },         // телепорт «Искажения»
  burst: { min: 0.65, max: 0.95 },       // круговой залп «Ока»
  rootRam: { min: 0.65, max: 0.95 },     // рывок «Корнеразума»
  vines: { min: 0.95, max: 1.25 },       // сектора лиан
  seeds: { min: 0.75, max: 1.05 },       // кольцо семян
  grave: { min: 0.6, max: 0.85 },        // веер «Могильщика»
  acidPool: { min: 0.75, max: 1.05 },    // кислотное пятно
  acidSpray: { min: 1.05, max: 1.35 },   // веер кислоты
  acidRing: { min: 0.85, max: 1.15 },    // расширяющееся кольцо
  brood: { min: 0.85, max: 1.15 },       // выводок «Матки»
  moonArc: { min: 0.7, max: 1.0 },       // дуга снарядов «Полой Луны»
  meteor: { min: 0.6, max: 0.85 },       // метеорит-рикошет
  eclipse: { min: 0.9, max: 1.2 },       // затмение
  pulse: { min: 0.6, max: 0.85 },        // импульс «Ложного маяка»
  beaconBlink: { min: 0.65, max: 0.95 }, // скачок маяка
  cross: { min: 1.15, max: 1.4 },        // крестовой залп
};

/**
 * Замах конкретного вызова атаки. Кламп в честное окно — страховка на случай,
 * если диапазон в TELE однажды пропишут за границами: телеграф короче 0.6с
 * нечестен, длиннее 1.4с — уже не напряжение, а ожидание.
 */
export function rollTele(key) {
  const span = TELE[key];
  return clamp(rnd(span.max, span.min), TELE_MIN, TELE_MAX);
}

// ─────────────────────────────── СВЯЗКИ АТАК (общий примитив)

/**
 * СВЯЗКА — 2-4 удара подряд вместо одиночного удара с большой паузой после.
 * Раньше каждый босс вручную городил `cd`/`cd2`/`cd3` и все его атаки шли
 * по независимым часам: между событиями оставались дыры, а совпадали они
 * случайно. Связка делает обратное — плотный кусок боя, а потом честная
 * пауза, в которую игрок бьёт в ответ.
 *
 * ШАГ связки:
 *   {
 *     wind: 'volley',             ключ TELE — замах перед этим ударом
 *     aim(game, b, wind) -> memo  фиксирует геометрию и ставит телеграф
 *                                 ровно на `wind`; всё, что вернёт, придёт
 *                                 в fire и переживёт шов мира (см. world/wrap.js)
 *     fire(game, b, memo)         удар строго по уже показанной геометрии
 *     covered: true               шаг бьёт ВНУТРИ зоны, показанной предыдущим
 *                                 шагом: своего телеграфа и замаха нет, memo
 *                                 берётся от предыдущего. Только так удар
 *                                 может прилететь через 0.24с и остаться
 *                                 честным — зона уже светилась секунду
 *     hold(game, b, memo)         пока true, связка стоит на этом шаге: рывок
 *                                 и луч длятся кадрами, а не бьют мгновенно,
 *                                 и следующий шаг не должен наезжать на них
 *     gap: 0.2                    своя пауза перед шагом вместо общей
 *   }
 *
 * ДВА ЖЁСТКИХ ПРАВИЛА, которые примитив держит сам:
 * 1. Последний шаг — самый медленный и крупный: это читаемый сигнал «сейчас
 *    моя очередь», а не случайная точка остановки. Порядок шагов на совести
 *    вызывающего, но punish-окно после связки ставится всегда.
 * 2. После КАЖДОЙ связки босс не атакует минимум MIN_RECOVERY секунд
 *    (двигаться может). Связка без гарантированного окна для ответа — это
 *    ровно то, за что ругают боссов Shadow of the Erdtree: не сложно, а нечестно.
 */
const STRING_GAP = 0.24;
export const MIN_RECOVERY = 1.2;

/** Босс сейчас в середине связки — новую атаку начинать нельзя. */
export const bossBusy = (b) => !!b.string;

/** Можно начинать новую атаку: связки нет и punish-окно уже отработано. */
export const bossReady = (b) => !b.string && b.age >= (b.recoveryUntil ?? 0);

export function runAttackString(b, steps, { gap = STRING_GAP, recovery = MIN_RECOVERY, force = false } = {}) {
  if (!steps?.length) return false;
  // force — только для ответа на действие игрока (сбитый щит). Босс сам себе
  // punish-окно не сокращает: момент выбрал игрок, и своё окно он получит
  // после контратаки, как после любой другой связки.
  if (!force && !bossReady(b)) return false;
  b.string = {
    steps,
    gap,
    recovery: Math.max(MIN_RECOVERY, recovery),
    index: 0,
    stage: 'gap',   // 'gap' — пауза перед шагом, 'wind' — замах шага
    timer: 0,       // первый шаг стартует в тот же кадр
    memo: null,
    winds: [],
  };
  return true;
}

/**
 * Двигает активную связку. Возвращает true, пока связка идёт — сам босс в это
 * время продолжает жить (двигаться, менять фазы), но новых атак не начинает.
 */
export function updateAttackString(game, b, dt) {
  const s = b.string;
  if (!s) return false;

  // затянувшийся шаг (рывок, луч) держит связку сам, по своему условию
  if (s.stage === 'hold') {
    if (s.steps[s.index].hold(game, b, s.memo)) return true;
    if (finishStep(b, s)) return true;
  }

  s.timer -= dt;
  // за один кадр может закрыться и пауза, и нулевой замах «прикрытого» шага
  for (let guard = 8; s.timer <= 0 && guard > 0; guard--) {
    const step = s.steps[s.index];
    if (s.stage === 'gap') {
      const wind = step.covered ? 0 : rollTele(step.wind);
      if (!step.covered) s.memo = step.aim(game, b, wind) ?? null;
      s.winds.push(wind);
      s.stage = 'wind';
      s.timer = wind;
    } else {
      step.fire(game, b, s.memo);
      if (step.hold) {
        s.stage = 'hold';
        return true;
      }
      if (finishStep(b, s)) return true;
    }
  }
  return true;
}

/** Шаг отработал. true — связка кончилась целиком и punish-окно поставлено. */
function finishStep(b, s) {
  s.index++;
  if (s.index >= s.steps.length) {
    b.recoveryUntil = b.age + s.recovery;
    b.lastString = { winds: s.winds, gap: s.gap, recovery: s.recovery, endedAt: b.age };
    b.string = null;
    return true;
  }
  s.stage = 'gap';
  s.timer = s.steps[s.index].gap ?? s.gap;
  return false;
}

export function updateBoss(game, b, dt) {
  const p = game.player;
  const def = BOSSES[b.boss];

  b.age = (b.age ?? 0) + dt;

  // автовыход: не пришёл сам — босс идёт за игроком, награда за скорость сгорает
  if (!b.hunting && b.age > BOSS_HUNT_AFTER) {
    b.hunting = true;
    b.cameItself = true;
    emit('boss:hunting', { boss: b });
    sfx.alarm();
    camera.shake(12);
  }
  // игрок задел босса — он проснулся и дерётся всерьёз
  if (!b.hunting && b.hp < b.maxHp) b.hunting = true;

  const dx = p.x - b.x;
  const dy = p.y - b.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;
  const toPlayer = Math.atan2(dy, dx);

  advancePhase(game, b);

  b.angle = angLerp(b.angle, toPlayer, dt * 2.4);
  b.spin += dt * (b.boss === 'eye' ? 0.9 + 0.3 * b.phase : 1.1);
  b.wobble += dt;

  // до пробуждения босс патрулирует на месте: не бежит за игроком, но и
  // не стоит статуей — так его видно и можно осознанно решить лететь к нему
  if (!b.hunting) {
    b.vx = lerp(b.vx, Math.cos(b.wobble * 0.5) * b.speed * 0.3, dt);
    b.vy = lerp(b.vy, Math.sin(b.wobble * 0.5) * b.speed * 0.3, dt);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    return;
  }

  const approach = (want, agility = 1.6) => {
    const push = dist < want - 50 ? -1 : dist > want + 50 ? 1 : 0;
    const strafe = Math.sin(b.wobble * 0.6) * 0.5;
    b.vx = lerp(b.vx, (nx * push - ny * strafe) * b.speed, dt * agility);
    b.vy = lerp(b.vy, (ny * push + nx * strafe) * b.speed, dt * agility);
  };

  switch (b.boss) {
    case 'dread':      updateDread(game, b, def, dt, approach, toPlayer); break;
    case 'prime':      updatePrime(game, b, def, dt, nx, ny, dist, toPlayer); break;
    case 'eye':        updateEye(game, b, def, dt, approach, dist, toPlayer); break;
    case 'rootmind':   updateRootmind(game, b, def, dt, approach, toPlayer); break;
    case 'gravedigger':updateGravedigger(game, b, def, dt, approach, toPlayer); break;
    case 'corrosion_core': updateCorrosionCore(game, b, def, dt, approach, toPlayer); break;
    case 'conduit':    updateConduit(game, b, def, dt, approach, toPlayer); break;
    case 'hive':       updateHive(game, b, def, dt, approach); break;
    case 'hollow_moon': updateMoon(game, b, def, dt, approach); break;
    case 'false_beacon': updateFalseBeacon(game, b, def, dt, approach, toPlayer); break;
    case 'distortion': updateDistortion(game, b, def, dt, approach, toPlayer); break;
    case 'legion':     updateLegion(game, b, def, dt, approach, toPlayer); break;
    case 'judgment':   updateJudgment(game, b, def, dt, approach, toPlayer); break;
    case 'voice':      updateVoice(game, b, def, dt, approach, toPlayer); break;
  }

  // Связка двигается после веток: начатая в этом же кадре успевает поставить
  // подсветку сразу, а не через кадр. Всё ещё до интегрирования позиции —
  // удар приходится по той точке, где босс стоит сейчас.
  updateAttackString(game, b, dt);

  b.x += b.vx * dt;
  b.y += b.vy * dt;

  if (dist < b.r + p.r) {
    hurtPlayer(game, b.damage * (b.boss === 'prime' ? 1.5 : 1), PHYSICAL_DAMAGE);
    p.vx += nx * 420;
    p.vy += ny * 420;
    b.vx *= 0.3;
    b.vy *= 0.3;
  }
}

/** Пороги фаз: 100% → 60% → 30%. Каждый переход слышно и видно. */
function advancePhase(game, b) {
  const ratio = b.hp / b.maxHp;
  const want = ratio <= 0.3 ? 3 : ratio <= 0.6 ? 2 : 1;
  if (want <= b.phase) return;
  b.phase = want;
  emit('boss:phase', { boss: b, phase: want });
  sfx.alarm();
  camera.shake(12);
  blastRing(game.fx, b.x, b.y, b.r * 3, BOSSES[b.boss].color);
  onPhaseEnter(game, b, want);
}

/** Разовые эффекты входа в фазу — то, что делается один раз, а не каждый тик. */
function onPhaseEnter(game, b, phase) {
  if (b.boss === 'gravedigger' && phase === 1) return;
  if (b.boss === 'hive' && phase === 3 && !b.didSplit) {
    b.didSplit = true;
    splitHive(game, b);
  }
  if (b.boss === 'distortion' && phase === 3 && !b.didClone) {
    b.didClone = true;
    spawnClone(game, b);
  }
  if (b.boss === 'legion' && phase === 3 && !b.didSplit) {
    b.didSplit = true;
    splitLegion(game, b);
  }
}

// ─────────────────────────────── ДРЕДНОУТ (открытый космос)
// Ф1 связка «пристрелка → веер» · Ф2 + дроны хвостом той же связки
// · Ф3 + стены под меняющимся углом
//
// Пилотный босс нового примитива: все его атаки — связки, никаких
// параллельных часов. Раньше веер, дроны и стены жили по трём независимым
// таймерам и совпадали случайно; теперь дроны заходят с боков ровно в тот
// момент, когда игрок уклоняется от веера, — это одна атака, а не три.

function updateDread(game, b, def, dt, approach, toPlayer) {
  // перед залпом крейсер упирается и перестаёт кружить: поза сама сообщает
  // «сейчас ударю», отдельно от красной зоны на арене
  if (bossBusy(b)) {
    b.vx = lerp(b.vx, 0, dt * 2.5);
    b.vy = lerp(b.vy, 0, dt * 2.5);
  } else {
    approach(360);
  }

  b.cd -= dt;
  b.cd2 -= dt;
  b.cd3 -= dt;
  if (!bossReady(b)) return;

  // Ф3: угол схождения стен гуляет вокруг линии босс↔игрок — безопасный
  // коридор больше не лежит там же, где в прошлый раз, его надо искать заново
  if (b.phase >= 3 && b.cd3 <= 0) {
    b.cd3 = rnd(11, 8);
    runAttackString(b, [dreadWalls(def)], { recovery: 1.6 });
    return;
  }

  if (b.cd <= 0) {
    b.cd = b.phase >= 2 ? rnd(2.1, 1.5) : rnd(3, 2.2);
    const arc = b.phase >= 2 ? 1.9 : 1.2;
    const steps = [dreadScout(def, arc), dreadVolley(def, arc, b.phase >= 2 ? 15 : 9)];
    // дроны остаются на своём редком такте, но выходят не сами по себе,
    // а хвостом связки — самый медленный и крупный шаг в конце
    if (b.phase >= 2 && b.cd2 <= 0) {
      b.cd2 = b.phase >= 3 ? 5 : 7.5;
      steps.push(dreadDrones(def, b.phase >= 3 ? 4 : 3));
    }
    runAttackString(b, steps, { gap: 0.26 });
  }
}

/** Шаг 1: узкая быстрая пристрелка. Подсвечивает сразу ВЕСЬ будущий сектор. */
function dreadScout(def, arc) {
  return {
    wind: 'scout',
    aim: (game, b, wind) => {
      const angle = Math.atan2(game.player.y - b.y, game.player.x - b.x);
      telegraph(game, { kind: 'cone', x: b.x, y: b.y, r: 620, angle, arc, life: wind, color: def.color });
      return { angle, arc };
    },
    fire: (game, b, memo) => {
      const n = 5;
      for (let i = 0; i < n; i++) {
        const off = (i / (n - 1) - 0.5) * memo.arc * 0.4;
        spawnFoeBullet(game, b, memo.angle + off, 440, b.damage * 0.3, def.color, 3, PHYSICAL_DAMAGE);
      }
      sfx.enemyShot();
    },
  };
}

/** Шаг 2: основной веер. covered — бьёт внутри того же сектора, что уже светился. */
function dreadVolley(def, arc, n) {
  return {
    covered: true,
    fire: (game, b, memo) => {
      for (let i = 0; i < n; i++) {
        const off = (i / (n - 1) - 0.5) * memo.arc;
        spawnFoeBullet(game, b, memo.angle + off, 380, b.damage * 0.45, def.color, 4, PHYSICAL_DAMAGE);
      }
      sfx.enemyShot();
    },
  };
}

/** Шаг 3 (Ф2+): высадка. Зона вокруг корпуса вспыхивает заранее. */
function dreadDrones(def, count) {
  return {
    wind: 'deploy',
    aim: (game, b, wind) => {
      telegraph(game, { kind: 'circle', x: b.x, y: b.y, r: b.r * 3.2, life: wind, color: def.color });
      return null;
    },
    fire: (game, b) => {
      for (let i = 0; i < count; i++) spawnMinion(game, b, 'drone');
      sfx.alarm();
    },
  };
}

/**
 * Ф3: две стены снарядов сходятся навстречу друг другу. Точка, из которой
 * они пойдут, фиксируется вместе с подсветкой — крейсер может уплыть за
 * время замаха, но стены всё равно вырастут там, где нарисованы.
 */
function dreadWalls(def) {
  return {
    wind: 'walls',
    aim: (game, b, wind) => {
      const toPlayer = Math.atan2(game.player.y - b.y, game.player.x - b.x);
      const memo = { angle: toPlayer + rnd(0.7, -0.7), x: b.x, y: b.y };
      const side = memo.angle + Math.PI / 2;
      for (const s of [1, -1]) {
        const ox = Math.cos(side) * 420 * s;
        const oy = Math.sin(side) * 420 * s;
        telegraph(game, {
          kind: 'line', width: 46, life: wind, color: '#ff3b6b',
          x1: memo.x + ox - Math.cos(memo.angle) * 500, y1: memo.y + oy - Math.sin(memo.angle) * 500,
          x2: memo.x + ox + Math.cos(memo.angle) * 500, y2: memo.y + oy + Math.sin(memo.angle) * 500,
        });
      }
      return memo;
    },
    fire: (game, b, memo) => {
      const side = memo.angle + Math.PI / 2;
      for (const s of [1, -1]) {
        for (let i = -5; i <= 5; i++) {
          const from = {
            x: memo.x + Math.cos(side) * 420 * s + Math.cos(memo.angle) * i * 90,
            y: memo.y + Math.sin(side) * 420 * s + Math.sin(memo.angle) * i * 90,
            r: 6,
          };
          spawnFoeBullet(game, from, side - Math.PI / 2 * s, 210, b.damage * 0.5, '#ff3b6b', 5, PHYSICAL_DAMAGE);
        }
      }
      sfx.bigBoom();
      camera.shake(9);
    },
  };
}

// ─────────────────────────────── ДРОБИЛЬЩИК-ПРАЙМ (пояс)
// Ф1 таран · Ф2 + второй таран в связке и брошенный астероид
// · Ф3 + сжимающееся кольцо обломков
//
// Один рывок читается с первого раза и уворачивается на автомате. Со второго
// звена связки уклоняться приходится дважды подряд и в разные стороны: угол
// второго рывка выбирается уже после того, как игрок ушёл от первого.

function updatePrime(game, b, def, dt, nx, ny, dist, toPlayer) {
  if (b.charge > 0) b.charge = Math.max(0, b.charge - dt);
  if (b.ramDash > 0) {
    b.ramDash = Math.max(0, b.ramDash - dt);
    b.vx = b.ramNx * b.speed * PRIME_RAM_SPEED_MUL;
    b.vy = b.ramNy * b.speed * PRIME_RAM_SPEED_MUL;
  } else if (bossBusy(b)) {
    // на замахе Прайм упирается: нарисованная линия начинается там же, где
    // он стоит, и уплыть от неё за время подсветки он не имеет права
    b.vx = lerp(b.vx, 0, dt * 6);
    b.vy = lerp(b.vy, 0, dt * 6);
  } else {
    b.vx = lerp(b.vx, nx * b.speed * 0.5, dt * 1.4);
    b.vy = lerp(b.vy, ny * b.speed * 0.5, dt * 1.4);
  }

  // Мины из обломков идут всегда, в том числе в punish-окне: это не атака,
  // а то, во что Прайм превращает арену. Отвечать ему всё равно есть куда —
  // мины медленные и разрушаемые.
  b.cd2 -= dt;
  if (b.cd2 <= 0) {
    b.cd2 = b.phase >= 2 ? 0.55 : 0.9;
    const m = makeEnemy(b.x + rnd(60, -60), b.y + rnd(60, -60), 'mine', 1.6);
    m.hp = m.maxHp = 26;
    m.fromWave = true;
    game.entities.enemies.push(m);
  }

  b.cd -= dt;
  b.cd3 -= dt;
  b.cd4 = (b.cd4 ?? 6) - dt;
  if (!bossReady(b)) return;

  // Ф3: кольцо сжимается — безопасен только центр, к нему и надо идти
  if (b.phase >= 3 && b.cd4 <= 0) {
    b.cd4 = rnd(9.5, 7);
    runAttackString(b, [primeRing()], { recovery: 1.5 });
    return;
  }
  // Ф2: астероид в предсказанную точку — зона прилёта подсвечена
  if (b.phase >= 2 && b.cd3 <= 0) {
    b.cd3 = b.phase >= 3 ? rnd(3.4, 2.2) : rnd(4, 3);
    runAttackString(b, [primeRock()]);
    return;
  }
  if (b.cd <= 0) {
    b.cd = b.phase >= 2 ? rnd(3, 2.2) : rnd(2.6, 1.9);
    const steps = b.phase >= 2 ? [primeRam(def), primeRam(def)] : [primeRam(def)];
    runAttackString(b, steps, { gap: 0.3 });
  }
}

/** Рывок: коридор виден заранее, уходить надо вбок. */
function primeRam(def) {
  return {
    wind: 'ram',
    aim: (game, b, wind) => {
      b.ramAngle = Math.atan2(game.player.y - b.y, game.player.x - b.x);
      b.ramNx = Math.cos(b.ramAngle);
      b.ramNy = Math.sin(b.ramAngle);
      b.charge = wind;   // раскрытая пасть в render/renderer.js — поза замаха
      b.vx *= 0.25;
      b.vy *= 0.25;
      telegraph(game, {
        kind: 'line', width: b.r * 1.8, life: wind, color: def.color,
        x1: b.x, y1: b.y,
        x2: b.x + b.ramNx * PRIME_RAM_DISTANCE, y2: b.y + b.ramNy * PRIME_RAM_DISTANCE,
      });
      return null;
    },
    fire: (game, b) => {
      b.ramDash = PRIME_RAM_DISTANCE / (b.speed * PRIME_RAM_SPEED_MUL);
      b.vx = b.ramNx * b.speed * PRIME_RAM_SPEED_MUL;
      b.vy = b.ramNy * b.speed * PRIME_RAM_SPEED_MUL;
      sfx.boom();
      camera.shake(7);
    },
    hold: (game, b) => b.ramDash > 0,
  };
}

function primeRock() {
  return {
    wind: 'rock',
    aim: (game, b, wind) => {
      const at = { x: game.player.x, y: game.player.y };
      telegraph(game, { kind: 'circle', x: at.x, y: at.y, r: 150, life: wind, color: '#c9955a' });
      return at;
    },
    fire: (game, b, at) => {
      blastHostile(game, at.x, at.y, 150, b.damage * 1.1, '#c9955a', PHYSICAL_DAMAGE);
    },
  };
}

function primeRing() {
  return {
    wind: 'ringIn',
    aim: (game, b, wind) => {
      const at = { x: game.player.x, y: game.player.y };
      telegraph(game, { kind: 'ring', x: at.x, y: at.y, r: 520, r2: 120, life: wind, color: '#ffb14a' });
      return at;
    },
    fire: (game, b, at) => {
      const n = 26;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const from = { x: at.x + Math.cos(a) * 520, y: at.y + Math.sin(a) * 520, r: 6 };
        spawnFoeBullet(game, from, a + Math.PI, 260, b.damage * 0.45, '#ffb14a', 5, PHYSICAL_DAMAGE);
      }
      sfx.bigBoom();
      camera.shake(10);
    },
  };
}

// ─────────────────────────────── ОКО (туманность)
// Ф1 вращающийся луч · Ф2 + луч раздваивается · Ф3 + невидимость между атаками

function updateEye(game, b, def, dt, approach, dist, toPlayer) {
  b.beamAngle = b.spin;
  if (bossBusy(b)) {
    b.vx = lerp(b.vx, 0, dt * 2);
    b.vy = lerp(b.vy, 0, dt * 2);
  } else {
    approach(430, 1.0);
  }

  tickBeam(game, b, def, dt);

  b.cd -= dt;
  b.cd2 -= dt;

  // Ф3: между связками Око пропадает. Это не рандом «повезёт-не повезёт»:
  // за 0.6с до следующей атаки контур начинает разгораться, и по нему
  // заранее видно, откуда Око вернётся.
  if (b.phase >= 3) {
    b.hidden = !bossBusy(b);
    const wait = Math.max(b.cd, b.recoveryUntil - b.age);
    b.reveal = clamp(1 - wait / 0.6, 0, 1);
    if (b.hidden && b.reveal === 0 && !b.wasHidden) spark(game.fx, b.x, b.y, 18, def.color, 260, 0.5, 2.4);
    b.wasHidden = b.hidden;
  } else {
    b.hidden = false;
    b.reveal = 1;
  }

  if (!bossReady(b)) return;

  if (b.phase >= 2 && b.cd2 <= 0) {
    b.cd2 = rnd(6.5, 4.5);
    runAttackString(b, [eyeSnipers(def)]);
    return;
  }
  if (b.cd <= 0) {
    b.cd = b.phase >= 2 ? rnd(2.6, 1.9) : rnd(3.4, 2.6);
    runAttackString(b, [eyeBurst(def), eyeBeam()], { gap: 0.3 });
  }
}

/**
 * Луч больше не горит всегда. Раньше он был фоном, по которому нечего
 * читать, а настоящей атакой был только редкий залп. Теперь это финал
 * связки: кольцо вспыхивает, через треть секунды включается луч и водит
 * пару секунд, после чего Око гаснет и подставляется под ответ.
 *
 * Живёт отдельной функцией, а не внутри updateEye, потому что шаг с `hold`
 * ОБЯЗАН сам двигать свой таймер: ГОЛОС ПУСТОТЫ цитирует этот луч, и без
 * общего тика его связка висела бы вечно, ожидая чужого счётчика.
 */
function tickBeam(game, b, def, dt) {
  if (!(b.beamHot > 0)) return;
  b.beamHot -= dt;
  const p = game.player;
  const toPlayer = Math.atan2(p.y - b.y, p.x - b.x);
  const dist = Math.hypot(p.x - b.x, p.y - b.y);
  const beams = b.phase >= 2 ? [0, Math.PI] : [0];
  for (const off of beams) {
    if (Math.abs(angDiff(b.beamAngle + off, toPlayer)) < 0.13 && dist < 1200) {
      hurtPlayer(game, b.damage * 1.4 * dt * 6, { ...TECHNICAL_DAMAGE, continuous: true });
      spark(game.fx, p.x, p.y, 1, def.color, 120, 0.25, 2);
    }
  }
}

/** Шаг 1: кольцо вокруг Ока вспыхивает и разлетается залпом по кругу. */
function eyeBurst(def) {
  return {
    wind: 'burst',
    aim: (game, b, wind) => {
      telegraph(game, { kind: 'ring', x: b.x, y: b.y, r: 260, r2: b.r, life: wind, color: def.color });
      return null;
    },
    fire: (game, b) => {
      const n = b.phase >= 2 ? 22 : 14;
      for (let i = 0; i < n; i++) {
        spawnFoeBullet(game, b, (i / n) * TAU + b.spin, 260, b.damage * 0.4, def.color, 4, PHYSICAL_DAMAGE);
      }
      sfx.enemyShot();
    },
  };
}

/**
 * Шаг 2: луч. covered — вспышка кольца и была замахом, а сам луч виден всё
 * время, пока водит: он себе и подсветка, стоять на его пути нечестным
 * сюрпризом не станет.
 */
function eyeBeam() {
  return {
    covered: true,
    fire: (game, b) => {
      b.beamHot = b.phase >= 2 ? 2.6 : 2.2;
      sfx.alarm();
    },
    hold: (game, b) => b.beamHot > 0,
  };
}

function eyeSnipers(def) {
  return {
    wind: 'deploy',
    aim: (game, b, wind) => {
      telegraph(game, { kind: 'circle', x: b.x, y: b.y, r: b.r * 3, life: wind, color: def.color });
      return null;
    },
    fire: (game, b) => {
      for (let i = 0; i < 2; i++) spawnMinion(game, b, 'sniper');
    },
  };
}

// ─────────────────────────────── КОРНЕРАЗУМ (заросли)
// Ф1 фиксированный рывок · Ф2 + сектора лиан · Ф3 + кольцо живых семян

function updateRootmind(game, b, def, dt, approach, toPlayer) {
  if (b.rootDash > 0) {
    b.rootDash = Math.max(0, b.rootDash - dt);
    b.vx = b.rootNx * b.speed * ROOT_RAM_SPEED_MUL;
    b.vy = b.rootNy * b.speed * ROOT_RAM_SPEED_MUL;
  } else if (bossBusy(b)) {
    b.vx = lerp(b.vx, 0, dt * 5);
    b.vy = lerp(b.vy, 0, dt * 5);
  } else {
    approach(330, 1.35);
  }

  b.cd -= dt;
  b.cd3 -= dt;
  if (!bossReady(b)) return;

  if (b.phase >= 3 && b.cd3 <= 0) {
    b.cd3 = rnd(10, 7.5);
    runAttackString(b, [rootSeeds(def)], { recovery: 1.4 });
    return;
  }
  if (b.cd <= 0) {
    b.cd = b.phase >= 2 ? rnd(3.6, 2.6) : rnd(4.3, 3.3);
    // Ф2+: лианы идут вторым звеном той же связки, а не по своим часам —
    // сначала рывок сгоняет игрока с места, потом закрывается путь отхода
    const steps = b.phase >= 2 ? [rootRam(def), rootVines(def)] : [rootRam(def)];
    runAttackString(b, steps, { gap: 0.25 });
  }
}

/** Рывок с зафиксированным вектором: подсветка не следит за игроком. */
function rootRam(def) {
  return {
    wind: 'rootRam',
    aim: (game, b, wind) => {
      const toPlayer = Math.atan2(game.player.y - b.y, game.player.x - b.x);
      b.rootNx = Math.cos(toPlayer);
      b.rootNy = Math.sin(toPlayer);
      b.vx *= 0.2;
      b.vy *= 0.2;
      telegraph(game, {
        kind: 'line', width: b.r * 1.35, life: wind, color: def.color,
        x1: b.x, y1: b.y,
        x2: b.x + b.rootNx * ROOT_RAM_DISTANCE,
        y2: b.y + b.rootNy * ROOT_RAM_DISTANCE,
      });
      return null;
    },
    fire: (game, b) => {
      b.rootDash = ROOT_RAM_DISTANCE / (b.speed * ROOT_RAM_SPEED_MUL);
      sfx.dash();
      camera.shake(6);
    },
    hold: (game, b) => b.rootDash > 0,
  };
}

/**
 * Лианы бьют не в игрока, а в два сектора по бокам от него — коридор к
 * Корнеразуму и от него остаётся честно открытым. Прицел берётся по вектору
 * скорости игрока сразу после рывка: закрывается та сторона, в которую он
 * как раз убегает. Точка при этом статичная — наведение фиксируется вместе
 * с подсветкой и дальше за игроком не тянется.
 */
function rootVines(def) {
  return {
    wind: 'vines',
    aim: (game, b, wind) => {
      const p = game.player;
      const angle = Math.atan2(p.y + p.vy * 0.35 - b.y, p.x + p.vx * 0.35 - b.x);
      for (const side of [-1, 1]) {
        telegraph(game, {
          kind: 'cone', x: b.x, y: b.y, r: 620,
          angle: angle + side * 1.08, arc: 0.72,
          life: wind, color: def.color,
        });
      }
      return { angle };
    },
    fire: (game, b, memo) => {
      for (const side of [-1, 1]) {
        const center = memo.angle + side * 1.08;
        for (let i = -3; i <= 3; i++) {
          spawnFoeBullet(game, b, center + i * 0.1, 310, b.damage * 0.42, def.color, 5, PHYSICAL_DAMAGE);
        }
      }
      sfx.enemyShot();
    },
  };
}

/**
 * Кольцо не наносит мгновенный урон: на нём вырастают разрушаемые семена-мины.
 * Центр остаётся свободным, а само кольцо можно пробить и выйти.
 */
function rootSeeds(def) {
  return {
    wind: 'seeds',
    aim: (game, b, wind) => {
      const at = { x: game.player.x, y: game.player.y };
      telegraph(game, {
        kind: 'ring', x: at.x, y: at.y,
        r: 390, r2: 330, life: wind, color: def.color,
      });
      return at;
    },
    fire: (game, b, at) => {
      const count = 10;
      for (let i = 0; i < count; i++) {
        const angle = i * TAU / count;
        const seed = spawnOwnedMinionAt(
          game, b,
          at.x + Math.cos(angle) * 360,
          at.y + Math.sin(angle) * 360,
          'mine',
        );
        if (seed) {
          seed.hp = seed.maxHp = Math.round(34 + b.damage * 0.35);
          seed.color = def.color;
        }
      }
      sfx.alarm();
    },
  };
}

// ─────────────────────────────── МОГИЛЬЩИК (кладбище)
// Ф1 щит из обломков · Ф2 + собирает мёртвых · Ф3 + взрыв щита при потере

const GRAVE_SHIELD = 0.22; // доля maxHp, которую держит щит

function updateGravedigger(game, b, def, dt, approach, toPlayer) {
  if (bossBusy(b)) {
    b.vx = lerp(b.vx, 0, dt * 2);
    b.vy = lerp(b.vy, 0, dt * 2);
  } else {
    approach(330, 1.3);
  }

  // Ф1: поднимает обломки в щит. Щит гасится первым (см. systems/combat.js),
  // поэтому пока он цел, корпус не трогается — надо сбивать щит.
  b.shieldMax ??= b.maxHp * GRAVE_SHIELD;
  b.cd -= dt;
  if (b.cd <= 0) {
    b.cd = b.phase >= 2 ? 7 : 10;
    if ((b.shield ?? 0) <= 0) {
      b.shield = b.shieldMax;
      b.shieldSpin = 0;
      floatText(game.fx, b.x, b.y - b.r - 12, 'ЩИТ ПОДНЯТ', def.color);
      sfx.confirm();
    }
  }
  b.shieldSpin = (b.shieldSpin ?? 0) + dt * 1.6;

  /*
   * Щит сбит — Могильщик огрызается СРАЗУ, не дожидаясь своих часов.
   * Раньше открытое окно было чистым подарком: сбил щит и спокойно бьёшь.
   * Теперь это честный размен — окно ты получишь, но сначала переживёшь
   * ответ, и решать, добивать в упор или отойти, приходится каждый раз.
   */
  if (b.shieldWasUp && (b.shield ?? 0) <= 0) {
    const steps = [];
    // Ф3: обломки щита рвёт по площади. Зона показана — в упор добивать
    // можно, но осознанно, а не по незнанию
    if (b.phase >= 3) steps.push(graveBurst(def));
    steps.push(graveFan(def), graveFanAgain(def));
    if (b.phase >= 2) steps.push(graveRaise(def));
    runAttackString(b, steps, { gap: 0.22, force: true });
    floatText(game.fx, b.x, b.y - b.r - 12, 'ЩИТ СБИТ', def.color);
  }
  b.shieldWasUp = (b.shield ?? 0) > 0;

  b.cd2 -= dt;
  if (!bossReady(b)) return;
  if (b.cd2 <= 0) {
    b.cd2 = rnd(3.6, 2.6);
    runAttackString(b, [graveFan(def)]);
  }
}

/** Веер из трёх: сектор виден заранее, коридоры по бокам открыты. */
function graveFan(def) {
  return {
    wind: 'grave',
    aim: (game, b, wind) => {
      const angle = Math.atan2(game.player.y - b.y, game.player.x - b.x);
      telegraph(game, { kind: 'cone', x: b.x, y: b.y, r: 560, angle, arc: 0.75, life: wind, color: def.color });
      return { angle };
    },
    fire: (game, b, memo) => {
      for (let i = -1; i <= 1; i++) {
        spawnFoeBullet(game, b, memo.angle + i * 0.26, 330, b.damage * 0.5, def.color, 4, PHYSICAL_DAMAGE);
      }
      sfx.enemyShot();
    },
  };
}

/** Второй веер вдогонку — внутри того же сектора, что уже светился. */
function graveFanAgain(def) {
  return {
    covered: true,
    fire: (game, b, memo) => {
      for (let i = -1; i <= 1; i++) {
        spawnFoeBullet(game, b, memo.angle + i * 0.34, 380, b.damage * 0.45, def.color, 4, PHYSICAL_DAMAGE);
      }
      sfx.enemyShot();
    },
  };
}

function graveBurst(def) {
  return {
    wind: 'grave',
    aim: (game, b, wind) => {
      const at = { x: b.x, y: b.y };
      telegraph(game, { kind: 'circle', x: at.x, y: at.y, r: 260, life: wind, color: def.color });
      return at;
    },
    fire: (game, b, at) => {
      blastHostile(game, at.x, at.y, 260, b.damage * 1.6, def.color, PHYSICAL_DAMAGE);
      sfx.bigBoom();
      camera.shake(14);
    },
  };
}

/** Ф2+: потерял защиту — зовёт на помощь. Медленный крупный финал связки. */
function graveRaise(def) {
  return {
    wind: 'deploy',
    aim: (game, b, wind) => {
      telegraph(game, { kind: 'circle', x: b.x, y: b.y, r: b.r * 3.4, life: wind, color: def.color });
      return null;
    },
    fire: (game, b) => {
      for (let i = 0; i < 3; i++) spawnMinion(game, b, Math.random() < 0.5 ? 'drone' : 'gunner');
      floatText(game.fx, b.x, b.y - b.r - 12, 'ПОДЪЁМ', def.color);
    },
  };
}

// ─────────────────────────────── ЯДРО КОРРОЗИИ (кислотное облако)
// Ф1 кислотные пятна · Ф2 + струи, оставляющие лужи · Ф3 + кольцо с брешью

function updateCorrosionCore(game, b, def, dt, approach, toPlayer) {
  if (bossBusy(b)) {
    b.vx = lerp(b.vx, 0, dt * 2);
    b.vy = lerp(b.vy, 0, dt * 2);
  } else {
    approach(380, 1.15);
  }
  b.acidPools ??= [];
  tickAcidPools(game, b, dt, 0.22);

  b.cd -= dt;
  b.cd2 -= dt;
  b.cd3 -= dt;
  if (!bossReady(b)) return;

  // Ф3: кольцо с честной брешью. У Прайма кольцо сжимается и спасает центр —
  // здесь наоборот, оно расходится наружу, а спасает единственная дыра,
  // которая каждый раз в новом месте. Задача другая, финишеры не дублируются.
  if (b.phase >= 3 && b.cd3 <= 0) {
    b.cd3 = rnd(9, 7);
    runAttackString(b, [acidRing(def)], { recovery: 1.5 });
    return;
  }
  // Ф2+: струи и лужи — одна причинно-следственная связка, а не две
  // независимые механики: лужи остаются там, куда только что полил веер
  if (b.phase >= 2 && b.cd2 <= 0) {
    b.cd2 = b.phase >= 3 ? rnd(4.4, 3.2) : rnd(5.4, 4.2);
    runAttackString(b, [acidSpray(def), acidTrail(def)], { gap: 0.3 });
    return;
  }
  if (b.cd <= 0) {
    b.cd = b.phase >= 2 ? rnd(3.4, 2.4) : rnd(4.2, 3.2);
    runAttackString(b, [acidPool(def)]);
  }
}

/**
 * Пятна принадлежат самому боссу: уход из биома удаляет босса и сразу
 * убирает все его временные угрозы, не оставляя невидимого урона позади.
 * Тем же владением пользуется ЛЕГИОН, цитирующий эту механику.
 */
function tickAcidPools(game, b, dt, dps) {
  const pools = b.acidPools;
  if (!pools?.length) return;
  for (let i = pools.length - 1; i >= 0; i--) {
    const pool = pools[i];
    pool.life -= dt;
    if (pool.life <= 0) {
      pools.splice(i, 1);
      continue;
    }
    if (Math.hypot(game.player.x - pool.x, game.player.y - pool.y) < pool.r + game.player.r) {
      hurtPlayer(game, b.damage * dps * dt, { ...TECHNICAL_DAMAGE, continuous: true });
    }
  }
}

const ACID_POOL_LIMIT = 6;
const ACID_RING_GAP = 0.95;   // ширина бреши в кольце Ф3, радиан

function addAcidPool(game, b, x, y, def) {
  b.acidPools.push({ x, y, r: 135, life: 5.5, max: 5.5 });
  if (b.acidPools.length > ACID_POOL_LIMIT) b.acidPools.shift();
  blastRing(game.fx, x, y, 135, def.color);
}

/** Пятно ложится с упреждением по вектору игрока — ровно в показанный круг. */
function acidPool(def) {
  return {
    wind: 'acidPool',
    aim: (game, b, wind) => {
      const at = {
        x: game.player.x + game.player.vx * 0.35,
        y: game.player.y + game.player.vy * 0.35,
      };
      telegraph(game, { kind: 'circle', x: at.x, y: at.y, r: 135, life: wind, color: def.color });
      return at;
    },
    fire: (game, b, at) => {
      addAcidPool(game, b, at.x, at.y, def);
      sfx.confirm();
    },
  };
}

function acidSpray(def) {
  return {
    wind: 'acidSpray',
    aim: (game, b, wind) => {
      const memo = { angle: Math.atan2(game.player.y - b.y, game.player.x - b.x), x: b.x, y: b.y };
      telegraph(game, {
        kind: 'cone', x: memo.x, y: memo.y, r: 680,
        angle: memo.angle, arc: 1.35, life: wind, color: def.color,
      });
      return memo;
    },
    fire: (game, b, memo) => {
      for (let i = -6; i <= 6; i++) {
        spawnFoeBullet(game, b, memo.angle + i * 0.1, 285, b.damage * 0.44, def.color, 5, TECHNICAL_DAMAGE);
      }
      sfx.enemyShot();
    },
  };
}

/** След от струй: лужи внутри того же конуса, который уже светился. */
function acidTrail(def) {
  return {
    covered: true,
    gap: 0.3,
    fire: (game, b, memo) => {
      for (const off of [-0.45, 0, 0.45]) {
        const a = memo.angle + off;
        addAcidPool(game, b, memo.x + Math.cos(a) * 300, memo.y + Math.sin(a) * 300, def);
      }
      sfx.confirm();
    },
  };
}

function acidRing(def) {
  return {
    wind: 'acidRing',
    aim: (game, b, wind) => {
      // брешь каждый раз сдвигается: «беги в дыру» не превращается в
      // «беги всегда туда же»
      b.acidGapAngle = (b.acidGapAngle ?? rnd(TAU)) + 1.37;
      const memo = { x: b.x, y: b.y, spin: b.spin, gapAngle: b.acidGapAngle };
      telegraph(game, {
        kind: 'ring', x: memo.x, y: memo.y, r: 90, r2: 470,
        gapAngle: memo.gapAngle, gapArc: ACID_RING_GAP,
        life: wind, color: def.color,
      });
      return memo;
    },
    fire: (game, b, memo) => {
      const from = { x: memo.x, y: memo.y, r: b.r };
      const count = 26;
      for (let i = 0; i < count; i++) {
        const a = memo.spin + i * TAU / count;
        if (Math.abs(angDiff(a, memo.gapAngle)) < ACID_RING_GAP / 2) continue;
        spawnFoeBullet(game, from, a, 250, b.damage * 0.4, def.color, 5, TECHNICAL_DAMAGE);
      }
      sfx.bigBoom();
      camera.shake(8);
    },
  };
}

// ─────────────────────────────── ПРОВОДНИК (ионный шторм)
// Ф1 цепные разряды · Ф2 + узлы-ретрансляторы · Ф3 + сеть между узлами жжёт

const ZAP_GAP = 0.26;   // пауза между двумя разрядами связки

function updateConduit(game, b, def, dt, approach, toPlayer) {
  if (bossBusy(b)) {
    b.vx = lerp(b.vx, 0, dt * 2);
    b.vy = lerp(b.vy, 0, dt * 2);
  } else {
    approach(400, 1.2);
  }
  b.nodes ??= [];

  // Ф2: узлы по арене. Не атака, а перестройка пространства — идут своим
  // чередом, в том числе в punish-окне
  if (b.phase >= 2) {
    b.cd2 -= dt;
    if (b.cd2 <= 0 && b.nodes.length < 4) {
      b.cd2 = 4;
      const a = rnd(TAU);
      b.nodes.push({ x: b.x + Math.cos(a) * 420, y: b.y + Math.sin(a) * 420, life: 16 });
      sfx.confirm();
    }
    for (let i = b.nodes.length - 1; i >= 0; i--) {
      b.nodes[i].life -= dt;
      if (b.nodes[i].life <= 0) b.nodes.splice(i, 1);
    }
  }

  b.cd -= dt;
  b.cd3 -= dt;
  if (bossReady(b)) {
    // Ф3: сеть между узлами. Тайминг гуляет — паузу нельзя пересидеть по часам
    if (b.phase >= 3 && b.nodes.length >= 2 && b.cd3 <= 0) {
      b.cd3 = rnd(9, 5.5);
      runAttackString(b, [conduitGrid(def)], { recovery: 1.4 });
    } else if (b.cd <= 0) {
      b.cd = b.phase >= 2 ? rnd(3, 2.2) : rnd(3.8, 2.9);
      runAttackString(b, [conduitZap(def), conduitZapLead(def)], { gap: ZAP_GAP });
    }
  }

  if (b.gridActive > 0) {
    b.gridActive -= dt;
    const p = game.player;
    for (let i = 0; i < b.nodes.length; i++) {
      const n1 = b.nodes[i];
      const n2 = b.nodes[(i + 1) % b.nodes.length];
      game.fx.beams.push({ x1: n1.x, y1: n1.y, x2: n2.x, y2: n2.y, color: def.color, width: 2, life: 0.06, max: 0.06 });
      if (distToSegment(p.x, p.y, n1.x, n1.y, n2.x, n2.y) < 26 + p.r) {
        hurtPlayer(game, b.damage * dt * 5, { ...TECHNICAL_DAMAGE, continuous: true });
      }
    }
  }
}

/**
 * Двойной разряд. Первый бьёт туда, где игрок стоит сейчас, второй — туда,
 * куда его унесёт по текущему вектору. Уйти можно от обоих, но не одним и тем
 * же движением: продолжишь ехать — попадёшь под второй, встанешь — под первый.
 * Обе зоны подсвечиваются сразу, ни одна не приходит сюрпризом.
 */
function conduitZap(def) {
  return {
    wind: 'zap',
    aim: (game, b, wind) => {
      const p = game.player;
      const memo = {
        x: p.x, y: p.y,                                  // первый удар
        points: [{ x: p.x + p.vx * 0.5, y: p.y + p.vy * 0.5 }],  // второй
      };
      telegraph(game, { kind: 'circle', x: memo.x, y: memo.y, r: 130, life: wind, color: def.color });
      telegraph(game, {
        kind: 'circle', x: memo.points[0].x, y: memo.points[0].y,
        r: 130, life: wind + ZAP_GAP, color: def.color,
      });
      return memo;
    },
    fire: (game, b, memo) => zapAt(game, b, def, memo.x, memo.y),
  };
}

function conduitZapLead(def) {
  return {
    covered: true,
    fire: (game, b, memo) => zapAt(game, b, def, memo.points[0].x, memo.points[0].y),
  };
}

function zapAt(game, b, def, x, y) {
  blastHostile(game, x, y, 130, b.damage * 1.2, def.color, TECHNICAL_DAMAGE);
  game.fx.beams.push({ x1: b.x, y1: b.y, x2: x, y2: y, color: def.color, width: 3, life: 0.18, max: 0.18 });
}

/** Ф3: линии между узлами становятся живой сетью — стоять на них нельзя. */
function conduitGrid(def) {
  return {
    wind: 'grid',
    aim: (game, b, wind) => {
      for (let i = 0; i < b.nodes.length; i++) {
        const n1 = b.nodes[i];
        const n2 = b.nodes[(i + 1) % b.nodes.length];
        telegraph(game, { kind: 'line', width: 26, life: wind, color: def.color, x1: n1.x, y1: n1.y, x2: n2.x, y2: n2.y });
      }
      return null;
    },
    fire: (game, b) => {
      b.gridActive = 1.6;
      sfx.alarm();
    },
    hold: (game, b) => b.gridActive > 0,
  };
}

/** Расстояние от точки до отрезка — для «сети» Проводника. */
function distToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const len2 = vx * vx + vy * vy || 1;
  const t = clamp(((px - x1) * vx + (py - y1) * vy) / len2, 0, 1);
  return Math.hypot(px - (x1 + vx * t), py - (y1 + vy * t));
}

// ─────────────────────────────── МАТКА РОЯ (гнездо)
// Ф1 спираль · Ф2 + непрерывный спавн · Ф3 + делится на три

const HIVE_SPIRAL_TIME = 1.5;   // сколько секунд крутится спираль

function updateHive(game, b, def, dt, approach) {
  approach(300, bossBusy(b) ? 0.5 : 1.2);

  /*
   * Спираль больше не идёт непрерывным фоном. Раньше это была ровно та
   * «дыра между настоящими атаками», от которой уходим: постоянный слабый
   * чип-урон без начала и конца, читать в нём нечего. Теперь у неё есть
   * замах, полтора секунды работы и пауза после — то есть форма.
   */
  if (b.spiralHot > 0) {
    b.spiralHot -= dt;
    b.cd -= dt;
    if (b.cd <= 0) {
      b.cd = b.phase >= 2 ? 0.12 : 0.18;
      const arms = b.phase >= 2 ? 3 : 2;
      for (let i = 0; i < arms; i++) {
        spawnFoeBullet(game, b, b.spin * 2.2 + (i / arms) * TAU, 300, b.damage * 0.35, def.color, 4, PHYSICAL_DAMAGE);
      }
    }
  }

  b.cd2 -= dt;
  if (!bossReady(b)) return;

  const steps = [hiveSpiral(def)];
  // выводок вылезает хвостом связки, на своём редком такте
  if (b.phase >= 2 && b.cd2 <= 0) {
    b.cd2 = b.phase >= 3 ? rnd(4, 3) : rnd(5.5, 4.5);
    steps.push(hiveBrood(def));
  }
  runAttackString(b, steps, { gap: 0.25 });
}

function hiveSpiral(def) {
  return {
    wind: 'brood',
    aim: (game, b, wind) => {
      telegraph(game, { kind: 'circle', x: b.x, y: b.y, r: 300, life: wind, color: def.color });
      return null;
    },
    fire: (game, b) => {
      b.spiralHot = HIVE_SPIRAL_TIME;
      b.cd = 0;
      sfx.enemyShot();
    },
    hold: (game, b) => b.spiralHot > 0,
  };
}

/** Зона вокруг Матки вспыхивает заранее — в кольце личинок в упор не окажешься. */
function hiveBrood(def) {
  return {
    wind: 'brood',
    aim: (game, b, wind) => {
      telegraph(game, { kind: 'circle', x: b.x, y: b.y, r: b.r * 3, life: wind, color: def.color });
      return null;
    },
    fire: (game, b) => {
      for (let i = 0; i < (b.phase >= 3 ? 5 : 3); i++) {
        spawnMinion(game, b, Math.random() < 0.5 ? 'larva' : 'drone');
      }
      sfx.alarm();
    },
  };
}

/**
 * Ф3 «делится на три»: сама Матка остаётся боссом (её полоса HP и логика
 * смерти забега на ней), а две отделившиеся части выходят элитной свитой
 * с куском её HP. Делать их полноценными боссами нельзя: полоса босса в HUD
 * и событие boss:killed рассчитаны ровно на одного.
 */
function splitHive(game, b) {
  for (const s of [1, -1]) {
    const e = makeEnemy(b.x + s * 90, b.y + rnd(40, -40), 'splitter', 1);
    e.hp = e.maxHp = Math.round(b.maxHp * 0.12);
    e.damage = b.damage * 0.7;
    e.r *= 1.8;
    e.elite = true;
    e.hiveTwin = true;             // своя атака, не копия материнской спирали
    e.color = BOSSES.hive.color;   // читается как отделившаяся часть Матки
    e.scrap *= 4;
    e.xp *= 3;
    e.fromWave = true;
    e.minion = true;
    game.entities.enemies.push(e);
  }
  floatText(game.fx, b.x, b.y - b.r - 14, 'РАЗДЕЛЕНИЕ', BOSSES.hive.color);
  sfx.bigBoom();
  camera.shake(18);
}

// ─────────────────────────────── ПОЛАЯ ЛУНА (полая луна)
// Ф1 растущая: слабое притяжение и дуги · Ф2 полная: метеориты-рикошеты
// · Ф3 убывающая: затмение и залп, накопленный в темноте
//
// Каждая фаза меняет не число, а задачу. В первой притяжение только мешает
// держать дистанцию. Во второй оно уже сносит с траектории уклонения от
// метеоритов. В третьей на пару секунд гаснет свет, притяжение на пике — и
// решать, где ты окажешься к возвращению света, приходится вслепую, заранее.

const MOON_PULL = [0, 150, 280, 400];   // по номеру фазы
const MOON_PULL_RANGE = 1500;
const MOON_ECLIPSE = 1.7;

function updateMoon(game, b, def, dt, approach) {
  approach(440, bossBusy(b) ? 0.5 : 1.0);
  moonPull(game, b, dt);
  if (b.eclipse > 0) b.eclipse = Math.max(0, b.eclipse - dt);

  b.cd -= dt;
  b.cd2 -= dt;
  b.cd3 -= dt;
  if (!bossReady(b)) return;

  if (b.phase >= 3 && b.cd3 <= 0) {
    b.cd3 = rnd(13, 10);
    runAttackString(b, [moonEclipse(def), moonHarvest(def)], { gap: 0.3, recovery: 1.5 });
    return;
  }
  if (b.phase >= 2 && b.cd2 <= 0) {
    b.cd2 = b.phase >= 3 ? rnd(6, 4.4) : rnd(7, 5.4);
    const steps = [];
    for (let i = 0; i < (b.phase >= 3 ? 3 : 2); i++) steps.push(moonMeteor(def));
    runAttackString(b, steps, { gap: 0.22 });
    return;
  }
  if (b.cd <= 0) {
    b.cd = b.phase >= 2 ? rnd(3.4, 2.4) : rnd(4, 3);
    runAttackString(b, [moonArc(def)]);
  }
}

/**
 * Притяжение полого ядра. Тянет и корабль, и ЕГО СНАРЯДЫ — поэтому прямой
 * выстрел мимо Луны перестаёт быть прямым, а привычная дистанция боя
 * держится не сама собой, а усилием.
 */
function moonPull(game, b, dt) {
  const strength = (MOON_PULL[b.phase] ?? 0) * (b.eclipse > 0 ? 1.7 : 1);
  if (!strength) return;
  const drag = (target, mul) => {
    const dx = b.x - target.x;
    const dy = b.y - target.y;
    const d = Math.hypot(dx, dy);
    if (d < 1 || d > MOON_PULL_RANGE) return;
    const force = (1 - d / MOON_PULL_RANGE) * strength * mul * dt;
    target.vx += (dx / d) * force;
    target.vy += (dy / d) * force;
  };
  drag(game.player, 1);
  for (const bullet of game.projectiles.bullets) drag(bullet, 0.55);
}

/** Ф1: широкая дуга снарядов. Базовый ритм, на котором учат гравитацию. */
function moonArc(def) {
  const arc = 1.5;
  return {
    wind: 'moonArc',
    aim: (game, b, wind) => {
      const angle = Math.atan2(game.player.y - b.y, game.player.x - b.x);
      telegraph(game, { kind: 'cone', x: b.x, y: b.y, r: 760, angle, arc, life: wind, color: def.color });
      return { angle };
    },
    fire: (game, b, memo) => {
      const n = b.phase >= 2 ? 13 : 9;
      for (let i = 0; i < n; i++) {
        spawnFoeBullet(game, b, memo.angle + (i / (n - 1) - 0.5) * arc, 300, b.damage * 0.4, def.color, 4, PHYSICAL_DAMAGE);
      }
      sfx.enemyShot();
    },
  };
}

/**
 * Ф2: метеорит падает на кору сбоку и уходит рикошетом. Показаны обе части —
 * и место удара, и линия отскока: угадывать нечего, но уходить надо от линии,
 * а не от Луны, и притяжение как раз мешает это сделать.
 */
function moonMeteor(def) {
  return {
    wind: 'meteor',
    aim: (game, b, wind) => {
      const p = game.player;
      const toPlayer = Math.atan2(p.y - b.y, p.x - b.x);
      const hitAngle = toPlayer + rnd(1.5, -1.5);
      const memo = {
        x: b.x + Math.cos(hitAngle) * b.r * 1.15,
        y: b.y + Math.sin(hitAngle) * b.r * 1.15,
      };
      memo.dir = Math.atan2(p.y + p.vy * 0.25 - memo.y, p.x + p.vx * 0.25 - memo.x);
      telegraph(game, { kind: 'circle', x: memo.x, y: memo.y, r: 70, life: wind, color: def.color });
      telegraph(game, {
        kind: 'line', width: 34, life: wind, color: def.color,
        x1: memo.x, y1: memo.y,
        x2: memo.x + Math.cos(memo.dir) * 900, y2: memo.y + Math.sin(memo.dir) * 900,
      });
      return memo;
    },
    fire: (game, b, memo) => {
      const from = { x: memo.x, y: memo.y, r: 8 };
      for (let i = -1; i <= 1; i++) {
        spawnFoeBullet(game, from, memo.dir + i * 0.07, 520, b.damage * 0.55, def.color, 6, PHYSICAL_DAMAGE);
      }
      blastRing(game.fx, memo.x, memo.y, 70, def.color);
      sfx.boom();
      camera.shake(6);
    },
  };
}

/** Ф3: свет гаснет. Луна не бьёт в темноте — она копит. */
function moonEclipse(def) {
  return {
    wind: 'eclipse',
    aim: (game, b, wind) => {
      telegraph(game, { kind: 'ring', x: b.x, y: b.y, r: b.r * 4.5, r2: b.r, life: wind, color: def.color });
      return null;
    },
    fire: (game, b) => {
      b.eclipse = MOON_ECLIPSE;
      b.eclipseMax = MOON_ECLIPSE;
      sfx.alarm();
      camera.shake(10);
    },
    hold: (game, b) => b.eclipse > 0,
  };
}

/** Свет вернулся — и вместе с ним всё, что накопилось. Подсветка честная. */
function moonHarvest(def) {
  return {
    wind: 'ringIn',
    aim: (game, b, wind) => {
      telegraph(game, { kind: 'ring', x: b.x, y: b.y, r: b.r, r2: 640, life: wind, color: def.color });
      return { x: b.x, y: b.y, spin: b.spin };
    },
    fire: (game, b, memo) => {
      const from = { x: memo.x, y: memo.y, r: b.r };
      const n = 30;
      for (let i = 0; i < n; i++) {
        spawnFoeBullet(game, from, memo.spin + i * TAU / n, 280, b.damage * 0.45, def.color, 5, PHYSICAL_DAMAGE);
      }
      sfx.bigBoom();
      camera.shake(12);
    },
  };
}

// ─────────────────────────────── ЛОЖНЫЙ МАЯК (диссонанс)
// Ф1 импульсная линия · Ф2 + отмеченный скачок · Ф3 + крестовой залп

/**
 * Цвет «дружелюбного» маркера станции. Единственное место в игре, где
 * подсветка врёт презентацией: зона окрашена как безобидная отметка, хотя
 * бьёт по ней всерьёз. Сама ГЕОМЕТРИЯ при этом честна до пикселя — врать
 * про форму и место удара нельзя даже здесь, врать можно только про тон.
 */
const BEACON_FRIENDLY = '#5ef08a';

function updateFalseBeacon(game, b, def, dt, approach, toPlayer) {
  approach(390, bossBusy(b) ? 0.5 : 1.45);

  b.cd -= dt;
  if (!bossReady(b) || b.cd > 0) return;

  b.cd = b.phase >= 2 ? rnd(3.4, 2.6) : rnd(3.4, 2.6);
  // Цепь причинности вместо трёх раздельных механик: маяк скачет, из новой
  // точки бьёт импульсом, и оттуда же замыкает крест.
  const steps = [];
  if (b.phase >= 2) steps.push(beaconBlink(def));
  steps.push(beaconPulse(def));
  if (b.phase >= 3) steps.push(beaconCross(def));
  runAttackString(b, steps, { gap: 0.26 });
}

/** Скачок в отмеченную точку и залп по кругу с места приземления. */
function beaconBlink(def) {
  return {
    wind: 'beaconBlink',
    aim: (game, b, wind) => {
      const angle = rnd(TAU);
      const at = {
        x: game.player.x + Math.cos(angle) * 300,
        y: game.player.y + Math.sin(angle) * 300,
      };
      telegraph(game, {
        kind: 'circle', x: at.x, y: at.y,
        r: b.r * 1.65, life: wind, color: def.color,
      });
      return at;
    },
    fire: (game, b, at) => {
      spark(game.fx, b.x, b.y, 14, def.color, 220, 0.45, 2.2);
      b.x = at.x;
      b.y = at.y;
      for (let i = 0; i < 12; i++) {
        spawnFoeBullet(game, b, b.spin + i * TAU / 12, 290, b.damage * 0.38, def.color, 4, TECHNICAL_DAMAGE);
      }
      spark(game.fx, b.x, b.y, 18, def.color, 260, 0.5, 2.4);
      sfx.dash();
    },
  };
}

/** Импульс по линии. Линия фиксируется один раз, удар идёт строго по ней. */
function beaconPulse(def) {
  return {
    wind: 'pulse',
    aim: (game, b, wind) => {
      const toPlayer = Math.atan2(game.player.y - b.y, game.player.x - b.x);
      const line = {
        x1: b.x, y1: b.y,
        x2: b.x + Math.cos(toPlayer) * 1200,
        y2: b.y + Math.sin(toPlayer) * 1200,
      };
      telegraph(game, { kind: 'line', width: 38, life: wind, color: BEACON_FRIENDLY, ...line });
      return line;
    },
    fire: (game, b, line) => {
      strikeLine(game, b, line, 38, 1.05, def.color);
    },
  };
}

/** Ф3: крест. Две линии, в центре урон не удваивается. */
function beaconCross(def) {
  return {
    wind: 'cross',
    aim: (game, b, wind) => {
      const at = { x: game.player.x, y: game.player.y, angle: b.spin * 0.37 };
      b.crossLines = crossLinesAt(at, 650);
      for (const line of b.crossLines) {
        telegraph(game, { kind: 'line', width: 42, life: wind, color: def.color, ...line });
      }
      return at;
    },
    fire: (game, b) => {
      let hit = false;
      for (const line of b.crossLines) {
        hit = strikeLine(game, b, line, 42, 1.35, def.color, hit) || hit;
      }
      sfx.bigBoom();
      camera.shake(9);
    },
  };
}

function crossLinesAt({ x, y, angle }, halfLength) {
  return [0, Math.PI / 2].map((offset) => {
    const a = angle + offset;
    const dx = Math.cos(a) * halfLength;
    const dy = Math.sin(a) * halfLength;
    return { x1: x - dx, y1: y - dy, x2: x + dx, y2: y + dy };
  });
}

/** Удар по уже показанной линии. suppressDamage не даёт кресту ударить дважды. */
function strikeLine(game, boss, line, width, damageMul, color, suppressDamage = false) {
  game.fx.beams.push({ ...line, color, width: 4, life: 0.2, max: 0.2 });
  const hit = distToSegment(
    game.player.x, game.player.y,
    line.x1, line.y1, line.x2, line.y2,
  ) < width + game.player.r;
  if (hit && !suppressDamage) hurtPlayer(game, boss.damage * damageMul, TECHNICAL_DAMAGE);
  return hit;
}

// ─────────────────────────────── ИСКАЖЕНИЕ (разлом)
// Ф1 зеркалит ствол · Ф2 + телепорты · Ф3 + копия игрока

const MIRROR_LAG = 0.5;   // через сколько прилетает эхо твоего выстрела

function updateDistortion(game, b, def, dt, approach, toPlayer) {
  approach(340, bossBusy(b) ? 0.6 : 1.4);
  const p = game.player;

  /*
   * ЗЕРКАЛО С ЛАГОМ. Раньше Искажение просто брало характеристики твоего
   * ствола и стреляло по своим часам — совпадение было на бумаге. Теперь оно
   * повторяет КОНКРЕТНЫЙ твой выстрел через полсекунды: его атака читается
   * по твоей собственной, и решение «стрелять или уйти» становится частью боя.
   *
   * Это единственная атака в игре, которая может прийтись на punish-окно —
   * но только если игрок сам в это окно стреляет. Молчишь — эха нет.
   */
  if (b.echoIn > 0) {
    b.echoIn -= dt;
    if (b.echoIn <= 0) {
      const w = getWeapon(b.echoWeapon) ?? currentWeapon(p);
      const count = Math.min(5, w.count ?? 1);
      for (let i = 0; i < count; i++) {
        const off = count === 1 ? 0 : (i - (count - 1) / 2) * (w.spread || 0.12) * 2;
        spawnFoeBullet(game, b, toPlayer + off, 400, b.damage * 0.5, def.color, 4, PHYSICAL_DAMAGE);
      }
      sfx.enemyShot();
    }
  } else {
    b.cd -= dt;
    if (b.cd <= 0 && !bossBusy(b) && p.lastShotAt > (b.mirroredAt ?? -1)) {
      const w = currentWeapon(p);
      b.mirroredAt = p.lastShotAt;
      b.echoWeapon = p.weapon;
      b.echoIn = MIRROR_LAG;
      b.cd = Math.max(0.3, (w.rate ?? 0.5) * 1.5);
      spark(game.fx, b.x, b.y, 6, def.color, 140, 0.3, 1.8);
    }
  }

  // Ф2: телепорты по площади — перед прыжком видно, куда именно
  b.cd2 -= dt;
  if (b.phase >= 2 && b.cd2 <= 0 && bossReady(b)) {
    b.cd2 = b.phase >= 3 ? rnd(4.2, 3) : rnd(5.6, 4.4);
    runAttackString(b, [distortionBlink(def)]);
  }
}

function distortionBlink(def) {
  return {
    wind: 'blink',
    aim: (game, b, wind) => {
      const a = rnd(TAU);
      const at = { x: game.player.x + Math.cos(a) * 320, y: game.player.y + Math.sin(a) * 320 };
      telegraph(game, { kind: 'circle', x: at.x, y: at.y, r: b.r * 1.6, life: wind, color: def.color });
      return at;
    },
    fire: (game, b, at) => {
      spark(game.fx, b.x, b.y, 16, def.color, 240, 0.5, 2.4);
      b.x = at.x;
      b.y = at.y;
      spark(game.fx, b.x, b.y, 16, def.color, 240, 0.5, 2.4);
      sfx.dash();
    },
  };
}

/**
 * Ф3 «копия тебя с твоим билдом»: клон берёт текущее оружие игрока и его
 * порядок величины урона. Полноценный дубль игрока (со всеми перками и
 * активками) сделать нельзя — перки живут хуками на самом игроке, а не
 * данными, поэтому копируется то, что читаемо в бою: ствол, темп, скорость.
 */
function spawnClone(game, b) {
  const p = game.player;
  const a = rnd(TAU);
  const e = makeEnemy(p.x + Math.cos(a) * 420, p.y + Math.sin(a) * 420, 'weaver', 1);
  e.clone = true;
  e.cloneWeapon = p.weapon;
  e.hp = e.maxHp = Math.round(b.maxHp * 0.1);
  e.damage = b.damage * 0.8;
  e.speed = p.maxSpeed * 0.85;
  e.r = p.r * 1.3;
  e.color = '#dff0ff';
  e.elite = true;
  e.scrap *= 5;
  e.xp *= 4;
  e.fromWave = b.fromWave;
  e.source = b.source;
  e.encounterId = b.encounterId;
  e.minion = true;
  game.entities.enemies.push(e);
  floatText(game.fx, e.x, e.y - 30, 'ТВОЯ КОПИЯ', '#dff0ff');
  sfx.alarm();
  camera.shake(16);
}

// ═══════════════════════════════ ТРИ ФИНАЛА
//
// Финалам разрешено превышать «не больше 4-5 атак» — но каждая отдельная
// атака всё равно обязана быть честной по тем же пяти правилам. «Синтез» и
// «твист» не оправдание для нечестности (BOSS_REDESIGN.md §4).

// ─────────────────────────────── ЛЕГИОН (путь СИЛЫ)
// Ф1 дальний бой — почерк Дредноута и Проводника
// Ф2 сближение — рывок Прайма, оставляющий за собой лужи Ядра Коррозии
// Ф3 распад — делится на два эха, как Матка Роя
//
// Не «по одной атаке от каждого из одиннадцати»: это была бы кухонная
// раковина ради масштаба. Отобраны самые узнаваемые движения и сгруппированы
// по смыслу фазы — издалека узнаёшь почерк, вблизи он уже другой.

function updateLegion(game, b, def, dt, approach, toPlayer) {
  if (b.ramDash > 0) {
    b.ramDash = Math.max(0, b.ramDash - dt);
    b.vx = b.ramNx * b.speed * 2.6;
    b.vy = b.ramNy * b.speed * 2.6;
    // лужи ложатся следом за рывком — причина видна, а не появляется из ниоткуда
    b.acidTrail = (b.acidTrail ?? 0) - dt;
    if (b.acidTrail <= 0) {
      b.acidTrail = 0.16;
      b.acidPools.push({ x: b.x, y: b.y, r: 120, life: 4.5, max: 4.5 });
      if (b.acidPools.length > 10) b.acidPools.shift();
      blastRing(game.fx, b.x, b.y, 120, '#b8e35b');
    }
  } else if (bossBusy(b)) {
    b.vx = lerp(b.vx, 0, dt * 4);
    b.vy = lerp(b.vy, 0, dt * 4);
  } else {
    approach(b.phase >= 2 ? 320 : 520, 1.5);
  }

  b.acidPools ??= [];
  tickAcidPools(game, b, dt, 0.24);

  b.cd -= dt;
  b.cd2 -= dt;
  if (!bossReady(b)) return;

  if (b.phase >= 2 && b.cd2 <= 0) {
    b.cd2 = b.phase >= 3 ? rnd(5, 3.6) : rnd(6, 4.4);
    runAttackString(b, [legionRam(def)], { recovery: 1.4 });
    return;
  }
  if (b.cd <= 0) {
    b.cd = b.phase >= 2 ? rnd(3, 2.2) : rnd(3.6, 2.8);
    // почерк Дредноута и Проводника в одной связке: сектор, добивание в
    // секторе и сразу два разряда по предсказанным точкам
    runAttackString(b, [
      dreadScout(def, 1.7),
      dreadVolley(def, 1.7, b.phase >= 2 ? 15 : 11),
      conduitZap(def),
      conduitZapLead(def),
    ], { gap: 0.26, recovery: 1.4 });
  }
}

/** Рывок Прайма, но с кислотным следом Ядра Коррозии — уходить некуда дважды. */
function legionRam(def) {
  return {
    wind: 'ram',
    aim: (game, b, wind) => {
      b.ramAngle = Math.atan2(game.player.y - b.y, game.player.x - b.x);
      b.ramNx = Math.cos(b.ramAngle);
      b.ramNy = Math.sin(b.ramAngle);
      b.charge = wind;
      b.vx *= 0.2;
      b.vy *= 0.2;
      telegraph(game, {
        kind: 'line', width: b.r * 1.9, life: wind, color: def.color,
        x1: b.x, y1: b.y,
        x2: b.x + b.ramNx * PRIME_RAM_DISTANCE, y2: b.y + b.ramNy * PRIME_RAM_DISTANCE,
      });
      return null;
    },
    fire: (game, b) => {
      b.ramDash = PRIME_RAM_DISTANCE / (b.speed * 2.6);
      b.acidTrail = 0;
      sfx.boom();
      camera.shake(9);
    },
    hold: (game, b) => b.ramDash > 0,
  };
}

/**
 * Ф3: ЛЕГИОН распадается на два эха — прямая цитата слома Матки Роя. Одно
 * прячется за щитом Могильщика, второе стреляет стволом игрока, как
 * Искажение. Оба паттерна игрок уже проходил поодиночке — но не вдвоём.
 */
function splitLegion(game, b) {
  const p = game.player;
  for (const side of [1, -1]) {
    const e = makeEnemy(b.x + side * 140, b.y + rnd(60, -60), side > 0 ? 'warden' : 'weaver', 1);
    e.hp = e.maxHp = Math.round(b.maxHp * 0.14);
    e.damage = b.damage * 0.62;
    e.r *= 1.6;
    e.elite = true;
    e.minion = true;
    e.fromWave = b.fromWave;
    e.source = b.source;
    e.encounterId = b.encounterId;
    e.scrap *= 5;
    e.xp *= 4;
    if (side > 0) {
      e.shield = e.shieldMax = Math.round(e.maxHp * 0.35);   // эхо Могильщика
      e.color = BOSSES.gravedigger.color;
    } else {
      e.clone = true;                                        // эхо Искажения
      e.cloneWeapon = p.weapon;
      e.color = BOSSES.distortion.color;
    }
    game.entities.enemies.push(e);
  }
  floatText(game.fx, b.x, b.y - b.r - 16, 'РАСПАД', BOSSES.legion.color);
  sfx.bigBoom();
  camera.shake(22);
}

// ─────────────────────────────── СУД (путь СВЯЗЕЙ)
// Ф1 заимствованное доверие · Ф2 фантомы · Ф3 вердикт
//
// Тема не «бой с союзником», а трибунал доверия: игрок прошёл путь, никого
// не подвёл — и именно поэтому его проверяют по-настоящему, а не выдают
// награду в лоб.
//
// Единственный в игре управляемый визуальный твист: до первого удара СУД
// выглядит как силуэт союзника (b.disguised), палитрой NPC. Раскрытие
// происходит один раз, само, через полторы секунды после начала боя —
// не по урону, чтобы игрок увидел его целиком, а не пропустил в перестрелке.

const JUDGMENT_REVEAL = 1.6;

function updateJudgment(game, b, def, dt, approach, toPlayer) {
  b.disguised = b.age < JUDGMENT_REVEAL;
  if (b.disguised) {
    // до раскрытия он просто ждёт — и не бьёт
    b.vx = lerp(b.vx, 0, dt * 3);
    b.vy = lerp(b.vy, 0, dt * 3);
    return;
  }
  if (!b.revealed) {
    b.revealed = true;
    floatText(game.fx, b.x, b.y - b.r - 20, 'ЭТО НЕ ПОМОЩЬ', def.color);
    blastRing(game.fx, b.x, b.y, b.r * 4, def.color);
    sfx.alarm();
    camera.shake(20);
  }

  if (bossBusy(b)) {
    b.vx = lerp(b.vx, 0, dt * 2);
    b.vy = lerp(b.vy, 0, dt * 2);
  } else {
    approach(360, 1.5);
  }

  b.cd -= dt;
  b.cd2 -= dt;
  b.cd3 -= dt;
  if (!bossReady(b)) return;

  // Ф3: вердикт — единственная скриптованная связка в игре. Она не
  // рандомизируется по составу, только по замаху: приговор звучит одинаково.
  if (b.phase >= 3 && b.cd3 <= 0) {
    b.cd3 = rnd(11, 8.5);
    runAttackString(b, [
      judgmentMercy(def),
      judgmentVerdict(def),
      judgmentVerdictAgain(def),
    ], { gap: 0.28, recovery: 1.6 });
    return;
  }
  // Ф2: фантомы NPC. Гибнут с одного попадания и не бьют — это проверка на
  // то, не собьёшься ли ты с паттерна из-за шума, а не второй источник урона.
  if (b.phase >= 2 && b.cd2 <= 0) {
    b.cd2 = rnd(8, 6);
    runAttackString(b, [judgmentPhantoms(def)]);
    return;
  }
  if (b.cd <= 0) {
    b.cd = b.phase >= 2 ? rnd(2.8, 2) : rnd(3.4, 2.6);
    runAttackString(b, [judgmentMercy(def), judgmentMercyAgain(def)], { gap: 0.24 });
  }
}

/**
 * «Импульс поддержки» — вывернутый наизнанку дружелюбный паттерн: кольцо
 * ремонтного импульса, которое лечит не тебя. Врёт только презентация,
 * геометрия честна — тот же приём, что узаконен для Ложного Маяка.
 */
function judgmentMercy(def) {
  return {
    wind: 'burst',
    aim: (game, b, wind) => {
      const at = { x: game.player.x, y: game.player.y };
      telegraph(game, { kind: 'circle', x: at.x, y: at.y, r: 210, life: wind, color: '#5ef08a' });
      return at;
    },
    fire: (game, b, at) => {
      blastHostile(game, at.x, at.y, 210, b.damage * 1.15, '#5ef08a', TECHNICAL_DAMAGE);
      sfx.confirm();
    },
  };
}

/** Второй импульс в ту же точку — она уже светилась, добавка честна. */
function judgmentMercyAgain(def) {
  return {
    covered: true,
    fire: (game, b, at) => {
      blastHostile(game, at.x, at.y, 210, b.damage * 0.9, '#5ef08a', TECHNICAL_DAMAGE);
      for (let i = 0; i < 10; i++) {
        spawnFoeBullet(game, { x: at.x, y: at.y, r: 8 }, i * TAU / 10 + b.spin, 260,
          b.damage * 0.34, def.color, 4, TECHNICAL_DAMAGE);
      }
      sfx.enemyShot();
    },
  };
}

/** Фантомы бывших союзников: шум на экране, а не второй источник урона. */
function judgmentPhantoms(def) {
  return {
    wind: 'deploy',
    aim: (game, b, wind) => {
      telegraph(game, { kind: 'circle', x: b.x, y: b.y, r: b.r * 3.6, life: wind, color: def.color });
      return null;
    },
    fire: (game, b) => {
      for (let i = 0; i < 3; i++) {
        const a = rnd(TAU);
        const e = spawnOwnedMinionAt(
          game, b,
          game.player.x + Math.cos(a) * 260,
          game.player.y + Math.sin(a) * 260,
          'drone',
        );
        if (!e) continue;
        e.hp = e.maxHp = 1;          // одно попадание — и фантома нет
        e.damage = 0;                // они не бьют, они мешают
        e.phantom = true;
        e.color = '#8fe0c0';
        e.speed *= 0.7;
      }
      floatText(game.fx, b.x, b.y - b.r - 14, 'СВИДЕТЕЛИ', def.color);
      sfx.alarm();
    },
  };
}

/** Приговор: тяжёлый крест, который нельзя переспорить — только уйти. */
function judgmentVerdict(def) {
  return {
    wind: 'cross',
    aim: (game, b, wind) => {
      const at = { x: game.player.x, y: game.player.y, angle: b.spin * 0.5 };
      b.crossLines = crossLinesAt(at, 720);
      for (const line of b.crossLines) {
        telegraph(game, { kind: 'line', width: 48, life: wind, color: def.color, ...line });
      }
      return at;
    },
    fire: (game, b) => {
      let hit = false;
      for (const line of b.crossLines) {
        hit = strikeLine(game, b, line, 48, 1.4, def.color, hit) || hit;
      }
      sfx.bigBoom();
      camera.shake(14);
    },
  };
}

/** Добивание по тем же линиям: зона уже показана, окно на отход было. */
function judgmentVerdictAgain(def) {
  return {
    covered: true,
    fire: (game, b) => {
      let hit = false;
      for (const line of b.crossLines) {
        hit = strikeLine(game, b, line, 48, 0.9, def.color, hit) || hit;
      }
      camera.shake(10);
    },
  };
}

// ─────────────────────────────── ГОЛОС ПУСТОТЫ (путь ТАЙНЫ)
//
// РАНДОМ ЖИВЁТ МЕЖДУ ЗАБЕГАМИ, НЕ ВНУТРИ БОЯ. При создании босса сид один
// раз выбирает три атаки — по одной на фазу — из пула цитат остальных
// боссов. Дальше внутри боя всё работает как у любого честного босса:
// атаки телеграфируются и повторяются предсказуемо.
//
// Непредсказуемость здесь — «какая версия ГОЛОСА мне попадётся в этом
// забеге», а не «можно ли среагировать на этот удар». Ровно тем же приёмом
// Hades даёт вариативность оружия, не жертвуя честностью внутри боя.

const VOICE_POOL = [
  { id: 'volley', make: (def) => [dreadScout(def, 1.6), dreadVolley(def, 1.6, 13)] },
  { id: 'zap', make: (def) => [conduitZap(def), conduitZapLead(def)] },
  { id: 'ring', make: (def) => [acidRing(def)] },
  { id: 'seeds', make: (def) => [rootSeeds(def)] },
  { id: 'cross', make: (def) => [beaconCross(def)] },
  { id: 'meteor', make: (def) => [moonMeteor(def), moonMeteor(def)] },
  { id: 'burst', make: (def) => [eyeBurst(def), eyeBeam()] },
  { id: 'vines', make: (def) => [rootVines(def)] },
];

/** Три атаки этого забега. Детерминировано от сида, фиксировано на весь бой. */
export function voiceAttacksFor(seed) {
  const pool = VOICE_POOL.map((entry) => entry.id);
  const random = mulberry(hash32(seed >>> 0, 0x901ce, 0x5eed));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = (random() * (i + 1)) | 0;
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

function updateVoice(game, b, def, dt, approach, toPlayer) {
  b.acidPools ??= [];
  b.beamAngle = b.spin;
  tickAcidPools(game, b, dt, 0.2);
  tickBeam(game, b, def, dt);
  b.voiceAttacks ??= voiceAttacksFor(game.run.seed ?? 0);

  if (bossBusy(b)) {
    b.vx = lerp(b.vx, 0, dt * 2);
    b.vy = lerp(b.vy, 0, dt * 2);
  } else {
    approach(400, 1.2);
  }

  b.cd -= dt;
  if (!bossReady(b) || b.cd > 0) return;
  b.cd = b.phase >= 3 ? rnd(2.6, 1.9) : b.phase >= 2 ? rnd(3.1, 2.3) : rnd(3.8, 2.9);

  // Фаза добавляет паттерн, а не заменяет: к третьей у ГОЛОСА все три,
  // и он тасует их между собой — но каждая из них честна и уже знакома.
  const unlocked = b.voiceAttacks.slice(0, b.phase);
  const id = unlocked[(Math.random() * unlocked.length) | 0];
  const entry = VOICE_POOL.find((e) => e.id === id);
  runAttackString(b, entry.make(def), { gap: 0.26, recovery: 1.3 });
}

function spawnOwnedMinionAt(game, boss, x, y, type) {
  const minions = game.entities.enemies.filter((e) => !e.boss).length;
  if (minions > MINION_LIMIT) return null;
  const e = makeEnemy(x, y, type, game.run.difficulty * 0.9);
  e.fromWave = boss.fromWave;
  e.source = boss.source;
  e.encounterId = boss.encounterId;
  e.minion = true;
  game.entities.enemies.push(e);
  return e;
}

function spawnMinion(game, boss, type) {
  const a = rnd(TAU);
  const e = spawnOwnedMinionAt(
    game,
    boss,
    boss.x + Math.cos(a) * (boss.r + 20),
    boss.y + Math.sin(a) * (boss.r + 20),
    type,
  );
  if (!e) return;
  e.vx = Math.cos(a) * 160;
  e.vy = Math.sin(a) * 160;
}

export const activeBoss = (game) => game.entities.enemies.find((e) => e.boss) || null;
