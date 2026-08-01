import { TAU, rnd } from '../core/math.js';
import { DAMAGE_TYPE } from '../core/damage.js';
import { sfx } from '../core/audio.js';
import { camera } from '../core/camera.js';
import { spark, blastRing, beam, floatText } from '../entities/effects.js';
import {
  perkBlast, radialVolley, healPlayer, slowEnemies, damageFromEffect,
  chainLightning, applyBurn, applyMark,
} from '../systems/effects.js';
import { damageEnemy, nearestEnemy } from '../systems/combat.js';
import { currentWeapon, techDamage, fireInterval } from '../entities/player.js';

/**
 * Активные способности: ручной кулдаун, вешаются на клавиши E / R / F
 * по порядку получения. Выдаются карточками легендарной редкости.
 *
 * Новая активка = запись здесь + карточка с полем ability в data/perks.js.
 */
export const ABILITIES = {
  emp: {
    id: 'emp', icon: '⋇', name: 'ЭМИ-ВОЛНА', cooldown: 9,
    desc: 'Радиус 340: 45 базового урона, отталкивание врагов и уничтожение вражеских снарядов',
    use(game, p) {
      const radius = 340;
      blastRing(game.fx, p.x, p.y, radius, '#7ee8ff');
      spark(game.fx, p.x, p.y, 40, '#7ee8ff', 420, 0.7, 3);
      for (const e of game.entities.enemies.slice()) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d > radius + e.r) continue;
        const push = (1 - d / radius) * 900;
        e.vx += (dx / d) * push;
        e.vy += (dy / d) * push;
        damageFromEffect(game, e, techDamage(p, 45), '#7ee8ff');
      }
      // сбиваем вражеские снаряды
      game.projectiles.foeBullets = game.projectiles.foeBullets.filter(
        (f) => (f.x - p.x) ** 2 + (f.y - p.y) ** 2 > radius ** 2,
      );
      sfx.bigBoom();
      camera.shake(16);
    },
  },

  barrier: {
    id: 'barrier', icon: '⌸', name: 'БАРЬЕР', cooldown: 16,
    desc: 'Три секунды полной неуязвимости',
    use(game, p) {
      p.iframes = Math.max(p.iframes, 3);
      floatText(game.fx, p.x, p.y - 30, 'БАРЬЕР', '#7ee8ff');
      spark(game.fx, p.x, p.y, 26, '#7ee8ff', 220, 0.8, 2.6);
      sfx.confirm();
    },
  },

  volley: {
    id: 'volley', icon: '⁂', name: 'ЗАЛП', cooldown: 8,
    desc: '16 самонаводящихся снарядов во все стороны',
    use(game, p) {
      radialVolley(game, 16, techDamage(p, 26), 680, '#ffd08a');
      camera.shake(5);
    },
  },

  blackhole: {
    id: 'blackhole', icon: '◯', name: 'СИНГУЛЯРНОСТЬ', cooldown: 18,
    desc: 'Чёрная дыра стягивает врагов и лут, потом схлопывается',
    use(game, p) {
      const x = p.x + Math.cos(p.angle) * 220;
      const y = p.y + Math.sin(p.angle) * 220;
      game.singularities.push({ x, y, life: 2.4, max: 2.4, radius: 420, damage: techDamage(p, 70) });
      sfx.alarm();
      camera.shake(6);
    },
  },

  stasis: {
    id: 'stasis', icon: '⧖', name: 'СТАЗИС', cooldown: 20,
    desc: 'Враги замедляются втрое на четыре секунды',
    use(game, p) {
      slowEnemies(game, 0.34, 4);
      blastRing(game.fx, p.x, p.y, 600, '#c99bff');
      floatText(game.fx, p.x, p.y - 30, 'СТАЗИС', '#c99bff');
      sfx.confirm();
    },
  },

  blink: {
    id: 'blink', icon: '⇹', name: 'ПРЫЖОК', cooldown: 6,
    desc: 'Телепорт к курсору на расстояние до 620; на входе и выходе — взрыв',
    use(game, p) {
      const fromX = p.x;
      const fromY = p.y;
      const tx = game.aim.x;
      const ty = game.aim.y;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const range = Math.min(d, 620);
      p.x += (dx / d) * range;
      p.y += (dy / d) * range;
      p.iframes = Math.max(p.iframes, 0.4);
      beam(game.fx, fromX, fromY, p.x, p.y, '#c99bff', 4);
      perkBlast(game, fromX, fromY, 120, techDamage(p, 30), '#c99bff');
      perkBlast(game, p.x, p.y, 120, techDamage(p, 30), '#c99bff');
      sfx.dash();
    },
  },

  orbital: {
    id: 'orbital', icon: '⇓', name: 'ОРБИТАЛЬНЫЙ УДАР', cooldown: 14,
    desc: 'Колонна огня падает в точку курсора',
    use(game, p) {
      game.strikes.push({ x: game.aim.x, y: game.aim.y, delay: 0.85, radius: 220, damage: techDamage(p, 260) });
      sfx.alarm();
    },
  },

  berserk: {
    id: 'berserk', icon: '⩚', name: 'БЕРСЕРК', cooldown: 22,
    desc: 'Шесть секунд двойной скорострельности',
    use(game, p) {
      p.effects.flags.berserk = 6;
      floatText(game.fx, p.x, p.y - 30, 'БЕРСЕРК', '#ff3b6b');
      sfx.alarm();
      camera.shake(4);
    },
  },

  repair: {
    id: 'repair', icon: '⊹', name: 'АВАРИЙНЫЙ РЕМОНТ', cooldown: 26,
    desc: 'Мгновенно восстановить 40% корпуса',
    use(game, p) {
      healPlayer(game, p.maxHp * 0.4);
      spark(game.fx, p.x, p.y, 20, '#5ef08a', 200, 0.7, 2.4);
      sfx.pickup();
    },
  },

  decoy: {
    id: 'decoy', icon: '◊', name: 'ПРИМАНКА', cooldown: 15,
    desc: 'Голограмма стягивает врагов и взрывается',
    use(game, p) {
      game.decoys.push({
        x: p.x + rnd(60, -60),
        y: p.y + rnd(60, -60),
        life: 4,
        radius: 520,
        damage: techDamage(p, 120),
      });
      sfx.select();
    },
  },

  rewind: {
    id: 'rewind', icon: '⟲', name: 'ПЕТЛЯ', cooldown: 24,
    desc: 'Откат: возврат на позицию и HP трёхсекундной давности',
    use(game, p) {
      const buf = p.effects.rewindBuffer;
      if (!buf || !buf.length) return;
      const targetT = game.time - 3;
      let snap = buf[0];
      for (const s of buf) if (s.t <= targetT) snap = s;
      p.x = snap.x;
      p.y = snap.y;
      p.hp = Math.max(p.hp, snap.hp);
      p.iframes = Math.max(p.iframes, 0.6);
      spark(game.fx, p.x, p.y, 20, '#7ee8ff', 240, 0.6, 2.6);
      floatText(game.fx, p.x, p.y - 30, 'ПЕТЛЯ', '#7ee8ff');
      sfx.dash();
    },
  },

  mirror: {
    id: 'mirror', icon: '⧉', name: 'ЗЕРКАЛО', cooldown: 24,
    desc: 'Двойник 6 секунд стреляет по ближайшей цели в радиусе 500 с темпом выбранного оружия, но не чаще раза в 0.18 с, и наносит 60% его урона',
    use(game, p) {
      game.mirrors.push({ x: p.x, y: p.y, life: 6, cd: 0 });
      floatText(game.fx, p.x, p.y - 30, 'ЗЕРКАЛО', '#7ee8ff');
      sfx.select();
    },
  },

  anchor: {
    id: 'anchor', icon: '⌾', name: 'ГРАВИЯКОРЬ', cooldown: 20,
    desc: 'Зона, в которой враги и их снаряды почти не двигаются',
    use(game, p) {
      game.anchors.push({ x: game.aim.x, y: game.aim.y, life: 5, radius: 260 });
      blastRing(game.fx, game.aim.x, game.aim.y, 260, '#4ad9ff');
      sfx.alarm();
    },
  },

  storm: {
    id: 'storm', icon: '≋', name: 'ШТОРМ', cooldown: 24,
    provides: ['chain'],
    desc: '12 секунд молнии сами бьют по врагам вокруг',
    use(game, p) {
      p.effects.flags.stormTime = 12;
      p.effects.stormTick = 0;
      floatText(game.fx, p.x, p.y - 30, 'ШТОРМ', '#7ee8ff');
      sfx.alarm();
    },
  },

  swarm: {
    id: 'swarm', icon: '⇶', name: 'ПРИЗЫВ РОЯ', cooldown: 20,
    provides: ['friendlyBlast'],
    desc: '8 дронов-камикадзе наводятся на ближайших врагов',
    use(game, p) {
      radialVolley(game, 8, techDamage(p, 30), 480, '#ff8a5e', 1.6, 55);
      camera.shake(4);
    },
  },

  overload: {
    id: 'overload', icon: '⏫', name: 'ПЕРЕГРУЗКА', cooldown: 26,
    desc: '4 секунды тройного темпа стрельбы, затем 4 секунды −50%',
    use(game, p) {
      p.effects.flags.overloadBoost = 4;
      p.effects.flags.overloadPenalty = 0;
      floatText(game.fx, p.x, p.y - 30, 'ПЕРЕГРУЗКА', '#ffd166');
      sfx.alarm();
    },
  },

  phase: {
    id: 'phase', icon: '⇏', name: 'ФАЗА', cooldown: 18,
    provides: ['burn'],
    desc: '2 секунды сквозь врагов и снаряды, оставляя огненный след',
    use(game, p) {
      p.iframes = Math.max(p.iframes, 2);
      p.effects.flags.phaseTrail = 2;
      floatText(game.fx, p.x, p.y - 30, 'ФАЗА', '#ff9f43');
      sfx.dash();
    },
  },

  bombardment: {
    id: 'bombardment', icon: '⁘', name: 'БОМБАРДИРОВКА', cooldown: 22,
    desc: '9 ударов по площади вдоль направления прицела',
    use(game, p) {
      for (let i = 0; i < 9; i++) {
        const d = 120 + i * 90;
        game.strikes.push({
          x: p.x + Math.cos(p.angle) * d,
          y: p.y + Math.sin(p.angle) * d,
          delay: 0.15 + i * 0.12,
          radius: 100,
          damage: techDamage(p, 45),
        });
      }
      sfx.alarm();
    },
  },

  reflector: {
    id: 'reflector', icon: '◫', name: 'ОТРАЖАТЕЛЬ', cooldown: 22,
    desc: '4 секунды вражеские снаряды в радиусе 260 разворачиваются обратно',
    use(game, p) {
      p.effects.flags.reflector = 4;
      blastRing(game.fx, p.x, p.y, 200, '#7ee8ff');
      sfx.confirm();
    },
  },

  scythe: {
    id: 'scythe', icon: '⚱', name: 'ЖАТВА', cooldown: 22,
    desc: 'Мгновенно убивает всех врагов, кроме боссов, ниже 15% HP и лечит 6 HP за каждого',
    use(game, p) {
      let kills = 0;
      for (const e of game.entities.enemies.slice()) {
        if (!e.boss && e.hp / e.maxHp < 0.15) {
          damageEnemy(game, e, e.hp + 1, false, {
            fromEffect: true,
            type: DAMAGE_TYPE.TECHNICAL,
            penetration: p.technicalPenetration ?? 0,
            bypassResistance: true,
          });
          kills++;
        }
      }
      if (kills) healPlayer(game, kills * 6);
      floatText(game.fx, p.x, p.y - 30, `ЖАТВА ×${kills}`, '#5ef08a');
      sfx.levelUp();
    },
  },

  deathmark: {
    id: 'deathmark', icon: '⚔', name: 'МЕТКА СМЕРТИ', cooldown: 16,
    provides: ['mark', 'friendlyBlast'],
    desc: 'На 8 секунд цель получает +100% урона; при смерти она взрывается даже после окончания усиления',
    use(game, p) {
      const target = nearestEnemy(game, game.aim.x, game.aim.y, 700);
      if (!target) return;
      applyMark(target, 2, 8);
      target.deathMarkExplode = true;
      floatText(game.fx, target.x, target.y - target.r - 10, 'МЕТКА', '#ff3b6b');
      spark(game.fx, target.x, target.y, 14, '#ff3b6b', 200, 0.5, 2.4);
      sfx.select();
    },
  },

  rift: {
    id: 'rift', icon: '◒', name: 'РАЗЛОМ', cooldown: 26,
    desc: 'Портал: вход и выход, враги затягиваются внутрь и телепортируются',
    use(game, p) {
      const outX = p.x + Math.cos(p.angle) * 480;
      const outY = p.y + Math.sin(p.angle) * 480;
      game.rifts.push({ x1: p.x, y1: p.y, x2: outX, y2: outY, life: 6 });
      beam(game.fx, p.x, p.y, outX, outY, '#c99bff', 3);
      sfx.alarm();
    },
  },

  ram: {
    id: 'ram', icon: '◭', name: 'ТАРАН', cooldown: 14,
    desc: 'Рывок насквозь: урон всем на пути, неуязвимость в полёте',
    use(game, p) {
      p.iframes = Math.max(p.iframes, 0.5);
      const range = 260;
      const dmg = techDamage(p, 55);
      for (const e of game.entities.enemies.slice()) {
        const t = (e.x - p.x) * Math.cos(p.angle) + (e.y - p.y) * Math.sin(p.angle);
        if (t < 0 || t > range) continue;
        const px = p.x + Math.cos(p.angle) * t;
        const py = p.y + Math.sin(p.angle) * t;
        if ((e.x - px) ** 2 + (e.y - py) ** 2 < (e.r + 34) ** 2) damageFromEffect(game, e, dmg, '#ffb14a');
      }
      p.vx += Math.cos(p.angle) * 700;
      p.vy += Math.sin(p.angle) * 700;
      spark(game.fx, p.x, p.y, 16, '#ffb14a', 260, 0.4, 2.4);
      sfx.dash();
      camera.shake(8);
    },
  },

  stopframe: {
    id: 'stopframe', icon: '⏸', name: 'СТОП-КАДР', cooldown: 32,
    desc: '2.5 секунды враги и их снаряды почти замирают; игрок действует нормально',
    use(game, p) {
      slowEnemies(game, 0.02, 2.5);
      blastRing(game.fx, p.x, p.y, 700, '#ffffff');
      floatText(game.fx, p.x, p.y - 30, 'СТОП-КАДР', '#ffffff');
      sfx.confirm();
    },
  },
};

export const abilityById = (id) => ABILITIES[id];

/**
 * Обновление отложенных эффектов активок: сингулярности, удары, приманки.
 * Живут в game, а не в игроке, потому что остаются в мире после каста.
 */
export function updateAbilityEntities(game, dt) {
  const p = game.player;

  // берсерк
  if (p.effects.flags.berserk > 0) {
    p.effects.flags.berserk -= dt;
    if (p.effects.flags.berserk <= 0) p.effects.flags.berserk = 0;
  }
  if (p.effects.flags.dashWindow > 0) {
    p.effects.flags.dashWindow -= dt;
    if (p.effects.flags.dashWindow <= 0) p.effects.flags.dashWindow = 0;
  }
  if (p.effects.flags.guardWindow > 0) {
    p.effects.flags.guardWindow -= dt;
    if (p.effects.flags.guardWindow <= 0) p.effects.flags.guardWindow = 0;
  }

  // «Перегрузка»: сперва тройной темп, затем штраф — фазы не пересекаются
  if (p.effects.flags.overloadBoost > 0) {
    p.effects.flags.overloadBoost -= dt;
    if (p.effects.flags.overloadBoost <= 0) {
      p.effects.flags.overloadBoost = 0;
      p.effects.flags.overloadPenalty = 4;
    }
  } else if (p.effects.flags.overloadPenalty > 0) {
    p.effects.flags.overloadPenalty -= dt;
    if (p.effects.flags.overloadPenalty <= 0) p.effects.flags.overloadPenalty = 0;
  }

  // «Фаза»: горящий след под кораблём, пока действует неуязвимость
  if (p.effects.flags.phaseTrail > 0) {
    p.effects.flags.phaseTrail -= dt;
    for (const e of game.entities.enemies) {
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < 50 ** 2) applyBurn(e, techDamage(p, 14), 2);
    }
    if (Math.random() < 0.6) spark(game.fx, p.x, p.y, 2, '#ff9f43', 120, 0.3, 2);
    if (p.effects.flags.phaseTrail <= 0) p.effects.flags.phaseTrail = 0;
  }

  // «Отражатель»: вражеские снаряды рядом разворачиваются и становятся дружественными
  if (p.effects.flags.reflector > 0) {
    p.effects.flags.reflector -= dt;
    const foes = game.projectiles.foeBullets;
    for (let i = foes.length - 1; i >= 0; i--) {
      const f = foes[i];
      if ((f.x - p.x) ** 2 + (f.y - p.y) ** 2 > 260 ** 2) continue;
      foes.splice(i, 1);
      const angle = Math.atan2(-f.vy, -f.vx);
      game.projectiles.bullets.push({
        x: f.x, y: f.y, vx: -f.vx * 1.2, vy: -f.vy * 1.2, angle,
        damage: techDamage(p, 20), crit: false, life: 1.2, pierce: 1, hit: new Set(),
        damageSpec: {
          type: DAMAGE_TYPE.TECHNICAL,
          penetration: p.technicalPenetration ?? 0,
          fromEffect: true,
        },
        homing: 0.6, ricochet: 0, splash: 0, kind: 'bullet', color: '#7ee8ff', r: 4,
      });
    }
    if (p.effects.flags.reflector <= 0) p.effects.flags.reflector = 0;
  }

  // «Шторм»: молнии по случайным ближайшим врагам каждые 0.5с, пока активен
  if (p.effects.flags.stormTime > 0) {
    p.effects.flags.stormTime -= dt;
    p.effects.stormTick = (p.effects.stormTick ?? 0) + dt;
    if (p.effects.stormTick >= 0.5) {
      p.effects.stormTick = 0;
      chainLightning(game, p.x, p.y, 1, techDamage(p, 20));
    }
    if (p.effects.flags.stormTime <= 0) p.effects.flags.stormTime = 0;
  }

  // «Петля»: рабочий буфер снимков позиции/HP — только если способность реально открыта
  if (p.abilities.some((a) => a.def.id === 'rewind')) {
    p.effects.rewindTick = (p.effects.rewindTick ?? 0) + dt;
    if (p.effects.rewindTick >= 0.1) {
      p.effects.rewindTick = 0;
      p.effects.rewindBuffer ??= [];
      p.effects.rewindBuffer.push({ x: p.x, y: p.y, hp: p.hp, t: game.time });
      while (p.effects.rewindBuffer.length && game.time - p.effects.rewindBuffer[0].t > 3.5) {
        p.effects.rewindBuffer.shift();
      }
    }
  }

  // «Зеркало»: двойник держится за спиной и стреляет по ближайшим врагам
  for (let i = game.mirrors.length - 1; i >= 0; i--) {
    const m = game.mirrors[i];
    m.life -= dt;
    m.x = p.x - Math.cos(p.angle) * 70;
    m.y = p.y - Math.sin(p.angle) * 70;
    m.cd -= dt;
    if (m.cd <= 0) {
      const w = currentWeapon(p);
      const target = nearestEnemy(game, m.x, m.y, 500);
      if (target) {
        const angle = Math.atan2(target.y - m.y, target.x - m.x);
        game.projectiles.bullets.push({
          x: m.x, y: m.y, vx: Math.cos(angle) * 600, vy: Math.sin(angle) * 600, angle,
          damage: techDamage(p, w.dmg) * 0.6, crit: false, life: 1, pierce: 0, hit: new Set(),
          damageSpec: {
            type: DAMAGE_TYPE.TECHNICAL,
            penetration: p.technicalPenetration ?? 0,
            fromEffect: true,
          },
          homing: 0.7, ricochet: 0, splash: 0, kind: 'bullet', color: '#7ee8ff', r: 3,
        });
        sfx.droneShot();
      }
      m.cd = Math.max(0.18, fireInterval(p, w));
    }
    if (m.life <= 0) game.mirrors.splice(i, 1);
  }

  // «Гравиякорь»: враги и вражеские снаряды в зоне почти не двигаются
  for (let i = game.anchors.length - 1; i >= 0; i--) {
    const an = game.anchors[i];
    an.life -= dt;
    for (const e of game.entities.enemies) {
      if ((e.x - an.x) ** 2 + (e.y - an.y) ** 2 > an.radius ** 2) continue;
      e.vx *= 0.85;
      e.vy *= 0.85;
      e.slowUntil = Math.max(e.slowUntil ?? 0, 0.3);
      e.slowFactor = Math.min(e.slowFactor ?? 1, 0.08);
    }
    for (const f of game.projectiles.foeBullets) {
      if ((f.x - an.x) ** 2 + (f.y - an.y) ** 2 > an.radius ** 2) continue;
      f.vx *= 0.85;
      f.vy *= 0.85;
    }
    if (an.life <= 0) game.anchors.splice(i, 1);
  }

  // «Разлом»: враги затягиваются в точку входа и телепортируются к выходу
  for (let i = game.rifts.length - 1; i >= 0; i--) {
    const r = game.rifts[i];
    r.life -= dt;
    for (const e of game.entities.enemies) {
      if (e.boss) continue;
      const d2 = (e.x - r.x1) ** 2 + (e.y - r.y1) ** 2;
      if (d2 >= 340 ** 2) continue;
      const d = Math.sqrt(d2) || 1;
      e.vx += ((r.x1 - e.x) / d) * 500 * dt;
      e.vy += ((r.y1 - e.y) / d) * 500 * dt;
      if (e.riftCd > 0) e.riftCd -= dt;
      if (d < 30 && !(e.riftCd > 0)) {
        e.x = r.x2 + rnd(20, -20);
        e.y = r.y2 + rnd(20, -20);
        e.riftCd = 1.5;
      }
    }
    if (r.life <= 0) game.rifts.splice(i, 1);
  }

  // чёрные дыры
  for (let i = game.singularities.length - 1; i >= 0; i--) {
    const s = game.singularities[i];
    s.life -= dt;
    for (const e of game.entities.enemies) {
      const dx = s.x - e.x;
      const dy = s.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > s.radius) continue;
      const pull = (1 - d / s.radius) * 900;
      e.vx += (dx / d) * pull * dt;
      e.vy += (dy / d) * pull * dt;
    }
    for (const item of game.entities.pickups) {
      const dx = s.x - item.x;
      const dy = s.y - item.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > s.radius) continue;
      item.vx += (dx / d) * 260 * dt;
      item.vy += (dy / d) * 260 * dt;
    }
    if (Math.random() < 0.5) {
      const a = rnd(TAU);
      spark(game.fx, s.x + Math.cos(a) * s.radius * 0.6, s.y + Math.sin(a) * s.radius * 0.6, 1, '#c99bff', 40, 0.4, 2);
    }
    if (s.life <= 0) {
      perkBlast(game, s.x, s.y, 300, s.damage, '#c99bff');
      camera.shake(12);
      game.singularities.splice(i, 1);
    }
  }

  // орбитальные удары
  for (let i = game.strikes.length - 1; i >= 0; i--) {
    const st = game.strikes[i];
    st.delay -= dt;
    if (st.delay <= 0) {
      perkBlast(game, st.x, st.y, st.radius, st.damage, '#ff8a5e');
      beam(game.fx, st.x, st.y - 900, st.x, st.y, '#ffd166', 14);
      camera.shake(14);
      sfx.bigBoom();
      game.strikes.splice(i, 1);
    }
  }

  // приманки: враги в радиусе переключаются на голограмму
  for (let i = game.decoys.length - 1; i >= 0; i--) {
    const d = game.decoys[i];
    d.life -= dt;
    for (const e of game.entities.enemies) {
      if (e.boss) continue;
      const dx = d.x - e.x;
      const dy = d.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > d.radius) continue;
      e.vx += (dx / dist) * e.speed * 2.2 * dt;
      e.vy += (dy / dist) * e.speed * 2.2 * dt;
      e.distracted = 0.2;
    }
    if (d.life <= 0) {
      perkBlast(game, d.x, d.y, 260, d.damage, '#ffd08a');
      game.decoys.splice(i, 1);
    }
  }
}

export function createAbilityEntities() {
  return { singularities: [], strikes: [], decoys: [], mirrors: [], anchors: [], rifts: [] };
}
