import { getEnemy } from '../data/enemies.js';
import { BOSSES } from '../data/bosses.js';
import { rnd, TAU } from '../core/math.js';

/**
 * Чистые фабрики сущностей. Модуль ни от чего не зависит,
 * поэтому его можно импортировать откуда угодно без циклов.
 */

export function makeEnemy(x, y, typeId, difficulty = 1, random = Math.random) {
  const def = getEnemy(typeId);
  const hp = Math.round(def.hp * (1 + (difficulty - 1) * 0.55));
  const between = (max, min = 0) => min + random() * (max - min);
  return {
    kind: 'enemy',
    type: def.id,
    ai: def.ai,
    x, y, vx: 0, vy: 0,
    angle: between(TAU),
    r: def.r,
    color: def.color,
    hp, maxHp: hp,
    speed: def.speed * (1 + (difficulty - 1) * 0.06),
    damage: def.melee * (1 + (difficulty - 1) * 0.4),
    want: def.want,
    fire: def.fire,
    cd: between(def.fire || 1),
    xp: def.xp,
    score: def.score,
    scrap: def.scrap,
    frontShield: !!def.frontShield,
    flash: 0,
    wobble: between(TAU),
    freezeUntil: 0,
    freezeFactor: 1,
    slowUntil: 0,
    slowFactor: 1,
    burst: 0,
    fuse: 0,
    elite: false,
    fromWave: true,
    source: 'wave',
    encounterId: null,
    special: def.special ?? null,   // уникальное поведение локационных врагов
    teleportCd: between(3, 1.5),    // «Фантом»/«Искажение»: до первого мигания
  };
}

/**
 * scale — только для бесконечного режима (эндгейм): в обычном забеге HP босса
 * ФИКСИРОВАННОЕ и от волны не зависит, ступень задаётся самим боссом
 * (см. data/bosses.js). Урон растёт вместе с HP: иначе поздние боссы
 * превращались бы в безобидных толстяков.
 */
export function makeBoss(typeId, x, y, scale = 1) {
  const def = BOSSES[typeId];
  const hp = Math.round(def.hp * scale);
  // урон подтягивается к ступени босса, а не к его HP напрямую: рост HP
  // между первым и седьмым боссом сорокакратный, урон так расти не должен
  const damage = Math.round(20 + def.order * 6) * scale;
  return {
    kind: 'enemy',
    boss: def.id,
    type: 'boss',
    x, y, vx: 0, vy: 0,
    angle: 0,
    r: def.r,
    color: def.color,
    hp, maxHp: hp,
    speed: def.speed,
    damage,
    xp: Math.round(def.xp * scale),
    score: Math.round(def.score * scale),
    scrap: Math.round(def.scrap * scale),
    phase: 1,
    cd: 2,
    cd2: 4,
    cd3: 3,
    cd4: 6,
    spin: 0,
    charge: 0,
    ramDash: 0,
    ramAngle: 0,
    ramNx: 0,
    ramNy: 0,
    beamAngle: 0,
    flash: 0,
    wobble: 0,
    freezeUntil: 0,
    freezeFactor: 1,
    slowUntil: 0,
    slowFactor: 1,
    age: 0,
    hunting: false,        // босс проснулся: сам идёт за игроком
    cameItself: false,     // пришёл по таймеру — награда за скорость сгорает
    shield: 0,
    fromWave: true,
    source: 'wave',
    encounterId: null,
  };
}

export function makePickup(x, y, kind, value) {
  return {
    x, y,
    vx: rnd(60, -60),
    vy: rnd(60, -60),
    kind,                       // 'xp' | 'hp' | 'scrap'
    value,
    r: kind === 'hp' ? 8 : 5,
    age: 0,
  };
}
