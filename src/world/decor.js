import { TAU } from '../core/math.js';

function stableAngle(value) {
  const text = String(value ?? 'dust');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return ((hash >>> 0) / 0xffffffff) * TAU;
}

/**
 * Декорации локаций — чисто визуальные, без коллизий и геймплейного веса.
 * Генерируются один раз при рождении чанка (как астероиды) и хранятся в
 * chunk.decor. Рисует их render/renderer.js:drawLocationDecor.
 *
 * Без ассетов: игра нигде не грузит картинки (звук тоже синтезируется на
 * WebAudio, не аудиофайлами) — декорации такие же процедурные фигуры на
 * canvas, как астероиды и корабли.
 */
export function generateDecor(location, cx, cy, ox, oy, CHUNK, random) {
  switch (location.id) {
    case 'start': {
      const wrecks = [];
      const n = 5 + ((random() * 4) | 0);
      for (let i = 0; i < n; i++) {
        const sides = 5 + ((random() * 4) | 0);
        wrecks.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          r: 22 + random() * 38, angle: random() * TAU,
          verts: Array.from({ length: sides }, () => 0.55 + random() * 0.7),
          blink: random() * TAU,
        });
      }
      return { kind: 'start', wrecks };
    }

    case 'belt': {
      // Раньше был только рой точек 1.5-4.5px — на экране это читалось как
      // пустота с шумом. Теперь три плана: далёкие глыбы, рудные искры и
      // длинные пылевые полосы, которые задают направление всему поясу.
      const dust = [];
      const n = 26 + ((random() * 16) | 0);
      for (let i = 0; i < n; i++) {
        dust.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          r: 1.5 + random() * 3,
          ore: random() < 0.22, // редкая рудная искра другого цвета
        });
      }
      const rocks = [];
      const rockCount = 7 + ((random() * 6) | 0);
      for (let i = 0; i < rockCount; i++) {
        const sides = 5 + ((random() * 3) | 0);
        rocks.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          r: 12 + random() * 34,
          angle: random() * TAU,
          spin: (random() - 0.5) * 0.25,
          lit: random() * TAU,
          verts: Array.from({ length: sides }, () => 0.62 + random() * 0.55),
        });
      }
      const bands = [];
      for (let i = 0; i < 2; i++) {
        const a = random() * TAU;
        bands.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          angle: a, length: CHUNK * (0.5 + random() * 0.6), width: 40 + random() * 90,
        });
      }
      return { kind: 'belt', dust, rocks, bands };
    }

    case 'nebula': {
      const clouds = [];
      const n = 5 + ((random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        clouds.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          r: 220 + random() * 260,
          phase: random() * TAU,
          speed: 0.15 + random() * 0.15,
        });
      }
      return { kind: 'nebula', clouds };
    }

    case 'graveyard': {
      const wrecks = [];
      const n = 4 + ((random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const sides = 5 + ((random() * 3) | 0);
        const verts = [];
        for (let k = 0; k < sides; k++) verts.push(0.55 + random() * 0.7);
        wrecks.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          r: 26 + random() * 44,
          angle: random() * TAU,
          verts,
          blink: random() * TAU,
        });
      }
      // Рёбра корпусов — то, чего кладбищу не хватало: обломки читались как
      // случайные камни, а не как то, что когда-то было кораблями.
      const hulls = [];
      const hullCount = 2 + ((random() * 3) | 0);
      for (let i = 0; i < hullCount; i++) {
        hulls.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          angle: random() * TAU,
          length: 120 + random() * 260,
          ribs: 4 + ((random() * 5) | 0),
          width: 16 + random() * 26,
          drift: (random() - 0.5) * 0.06,
        });
      }
      return { kind: 'graveyard', wrecks, hulls };
    }

    case 'grove': {
      const vines = [];
      const n = 7 + ((random() * 5) | 0);
      for (let i = 0; i < n; i++) {
        vines.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          r: 45 + random() * 90, phase: random() * TAU,
        });
      }
      return { kind: 'grove', vines };
    }

    case 'acid': {
      const clouds = [];
      const n = 5 + ((random() * 4) | 0);
      for (let i = 0; i < n; i++) {
        clouds.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          r: 190 + random() * 250, phase: random() * TAU,
        });
      }
      // Пузыри: облако само по себе статично, а кислота должна выглядеть
      // активной — это единственный движущийся элемент биома вне боя.
      const bubbles = [];
      const bubbleCount = 10 + ((random() * 10) | 0);
      for (let i = 0; i < bubbleCount; i++) {
        bubbles.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          r: 4 + random() * 14,
          phase: random() * TAU,
          speed: 0.5 + random() * 1.1,
          rise: 30 + random() * 70,
        });
      }
      return { kind: 'acid', clouds, bubbles };
    }

    case 'dissonance': {
      const veins = [];
      const n = 4 + ((random() * 4) | 0);
      for (let i = 0; i < n; i++) {
        veins.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          r: 80 + random() * 180, phase: random() * TAU,
        });
      }
      return { kind: 'dissonance', veins };
    }

    case 'dust': {
      const particles = [];
      const n = 34 + ((random() * 18) | 0);
      // biomeId даёт одно направление всему кластеру, а не каждому чанку:
      // частицы остаются честным компасом даже на границе и шве тора.
      const angle = stableAngle(location.biomeId ?? `${location.clusterX}:${location.clusterY}:dust`);
      for (let i = 0; i < n; i++) {
        particles.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          speed: 420 + random() * 260, length: 10 + random() * 18,
          hue: (i * 47 + random() * 40) % 360, offset: random() * CHUNK,
        });
      }
      return { kind: 'dust', particles, angle, ox, oy, size: CHUNK };
    }

    case 'ionstorm': {
      // не в каждом чанке кластера — иначе сетка узлов и разрядов покрывает
      // весь экран сразу и выглядит противоестественно
      if (random() < 0.6) return null;
      const nodes = [];
      const n = 6 + ((random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        nodes.push({ x: ox + random() * CHUNK, y: oy + random() * CHUNK, phase: random() * TAU });
      }
      return { kind: 'ionstorm', nodes };
    }

    case 'nest': {
      const pods = [];
      const n = 4 + ((random() * 4) | 0);
      for (let i = 0; i < n; i++) {
        pods.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          r: 30 + random() * 50,
          phase: random() * TAU,
          speed: 1.2 + random() * 1.2,
        });
      }
      // Перепонки между коконами: гнездо должно выглядеть выращенным, а не
      // насыпанным. Провисание задаётся один раз и не пересчитывается в кадре.
      const strands = [];
      for (let i = 0; i < n; i++) {
        if (random() < 0.4) continue;
        const j = (i + 1) % n;
        strands.push({ a: i, b: j, sag: (random() - 0.5) * 120, phase: random() * TAU });
      }
      return { kind: 'nest', pods, strands };
    }

    case 'hollow_moon': {
      // Обломки полой коры: изнутри они тёмные, снаружи по кромке идёт
      // яркий серп. Именно серп и делает локацию узнаваемой с одного взгляда.
      const shards = [];
      const n = 3 + ((random() * 3) | 0);
      for (let i = 0; i < n; i++) {
        shards.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          r: 110 + random() * 210,
          phase: random() * TAU,
          lit: random() * TAU,
          spin: (random() - 0.5) * 0.12,
        });
      }
      return { kind: 'hollow_moon', shards };
    }

    case 'rift': {
      // вихрь не на каждом чанке кластера — сплошные спирали через весь
      // экран выглядят странно, редкие одиночные вихри читаются как «эпицентр»
      if (random() < 0.65) return null;
      return {
        kind: 'rift',
        x: ox + CHUNK / 2 + (random() - 0.5) * CHUNK * 0.4,
        y: oy + CHUNK / 2 + (random() - 0.5) * CHUNK * 0.4,
        r: 140 + random() * 100,
        dir: random() < 0.5 ? 1 : -1,
      };
    }

    case 'open': {
      // У открытого космоса декора не было вообще: он и должен быть самым
      // пустым, но «пусто» и «ничего не нарисовано» — разные вещи. Редкий
      // мусор и одна комета на несколько чанков дают глазу за что зацепиться.
      if (random() < 0.5) return null;
      const debris = [];
      const n = 3 + ((random() * 4) | 0);
      for (let i = 0; i < n; i++) {
        debris.push({
          x: ox + random() * CHUNK, y: oy + random() * CHUNK,
          r: 5 + random() * 13, angle: random() * TAU,
          spin: (random() - 0.5) * 0.5,
        });
      }
      const comet = random() < 0.35 ? {
        x: ox + random() * CHUNK, y: oy + random() * CHUNK,
        angle: random() * TAU, length: 180 + random() * 240,
      } : null;
      return { kind: 'open', debris, comet };
    }

    default:
      return null;
  }
}
