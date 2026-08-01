import { emit, on } from '../core/events.js';
import { sfx } from '../core/audio.js';
import { camera } from '../core/camera.js';
import { rnd, TAU, shuffle } from '../core/math.js';
import { availableEnemies, getEnemy } from '../data/enemies.js';
import { bossForWave, bossForLocation, BOSS_ORDER, BOSSES, bossSpeedReward } from '../data/bosses.js?v=818be63';
import { makeEnemy, makeBoss, makePickup } from '../entities/factory.js';
import { fireHook, counters } from './effects.js';
import { getLocation, LOCATION_ORDER } from '../data/locations.js';
import { nearestWorldImage, torDistance } from '../world/torus.js';

/**
 * ГЕЙМ-ЛУП ЗАБЕГА.
 *
 *   локальная волна биома → зачистить всех → награда → свободный перелёт
 *   вернулся в тот же биом → продолжил со следующей незакрытой волны
 *
 * Прогресс принадлежит конкретной территории, а не типу локации и не общему
 * номеру забега. Боссы — отдельные встречи у меток на карте и обычные волны
 * не закрывают. Старый глобальный путь сохранён только для bench и endless.
 * Бюджет считается от recommendedLevel биома + его локальной волны.
 */

export const BOSS_EVERY = 5;
export const BOSS_TRIGGER_RADIUS = 420;

/**
 * КРИВАЯ СЛОЖНОСТИ.
 *
 * Игрок растёт мультипликативно (перки умножают урон), поэтому враги тоже
 * масштабируются экспонентой — иначе к 15-й волне их сносит одним касанием.
 * При этом первые волны нарочно пустые: дать освоиться и собрать первые модули.
 *
 *   волна:      1     3     5    10    15    20    25
 *   HP врага:  1.0   1.3   1.6   2.9   5.2   9.4  16.9
 *   урон:      0.8   1.0   1.1   1.7   2.7   4.1   6.4
 *   врагов:     3     7    13    28    47    69    95
 *
 * HP растёт медленнее урона осознанно: иначе поздние волны превращаются
 * в долгое пиление мешков с HP, а не в борьбу за выживание.
 */
export const enemyHpScale = (wave) => Math.pow(1.125, wave - 1);
export const enemyDamageScale = (wave) => 0.8 * Math.pow(1.09, wave - 1);
export const enemySpeedScale = (wave) => Math.min(1.55, Math.pow(1.022, wave - 1));

/** Сколько «очков опасности» тратится на волну. */
export const waveBudget = (wave) =>
  Math.round(2 + wave * 1.5 + Math.pow(wave, 1.75) * 0.22);

/** Общий множитель для фабрики врагов (совместимость со старым кодом). */
export const waveDifficulty = (wave) => enemyHpScale(wave);

/** Локальная сложность: опасность биома + номер его собственной волны. */
export const biomeDifficultyWave = (recommendedLevelOrLocationId, localWave) => {
  // Numeric input is the instance-level truth. String support keeps older
  // diagnostic callers working while all live runs pass the numeric value.
  const level = Number.isFinite(recommendedLevelOrLocationId)
    ? recommendedLevelOrLocationId
    : getLocation(recommendedLevelOrLocationId).recommendedLevel;
  return Math.max(1, level + Math.max(1, localWave) - 1);
};

/**
 * Одновременно на поле не больше этого числа — остальные ждут в очереди
 * подкреплений и вылетают по мере гибели товарищей.
 * Держит и читаемость боя, и кадры на поздних волнах.
 */
export const ACTIVE_LIMIT = 34;

/**
 * В бесконечном режиме потолок поднимается: там уже не проверка скилла,
 * а проверка билда, и экран, забитый врагами, — это и есть смысл режима.
 */
export const ENDLESS_LIMIT = 60;
export const activeLimit = (run) => (run.endless ? ENDLESS_LIMIT : ACTIVE_LIMIT);

/** Короткая пауза между зачисткой и экраном награды — чтобы выдохнуть. */
const INTERMISSION = 0.8;

/**
 * ПЕРЕДЫШКА — свободный полёт между волнами.
 *
 * Локации бесполезны, если до них нельзя долететь: кластеры стоят на сетке
 * в 11 чанков (≈9900 юнитов), а на форсаже корабль идёт ~500 юнитов в секунду,
 * то есть до соседнего кластера ходу около двадцати секунд. Прежние 1.6 секунды
 * между волнами не давали уйти вообще никуда — весь этап с локациями был виден
 * только по HUD. Отсюда 26 секунд.
 *
 * Ждать их насильно не нужно: волна начинается досрочно по пробелу/Enter, так
 * что режим «хочу плотный бой без прогулок» остаётся полностью доступным.
 */
export const BREATHER = 26;

export function createRun() {
  return {
    wave: 0,
    totalWavesCleared: 0,
    endlessWave: 0,
    waveMode: 'biome',
    localWave: 0,
    waveTotal: null,
    combatWave: 1,
    activeWaveBiomeId: null,
    activeBossBiomeId: null,
    waveLocationId: 'open',
    difficulty: 1,
    seed: (Math.random() * 0xffffffff) >>> 0,   // сид расстановки локаций (world/world.js)
    location: null,                              // текущая локация; null форсирует первый apply (см. systems/locations.js)
    biomeId: null,
    biome: null,
    biomeProgress: {},
    visited: null,                               // Set посещённых клеток кластеров, для карты на M
    waypoint: null,                              // метка на карте: {x,y} в мировых координатах или null
    bossesKilled: [],                            // id побеждённых боссов — чтобы не фармить одного
    victoryOffered: false,                       // отдельный флаг: победа возможна и при 0 обычных волн
    victoryWave: null,
    bossReward: null,                            // итог награды за скорость последнего босса
    guaranteedEpic: false,                       // быстрый убой босса → эпик в следующей награде
    endless: false,                               // бесконечный режим после десятого босса
    endlessLap: 0,                               // круг ротации боссов в бесконечном режиме
    score: 0,
    kills: 0,
    bosses: 0,
    scrap: 0,
    time: 0,
    over: false,
    phase: 'idle',      // idle | fighting | cleared | reward | breather | exhausted
    remaining: 0,
    countdown: 0,
    isBoss: false,
    bossHint: '',
    queue: [],          // подкрепления, ждущие места на поле
    spawnTimer: 0,
    stations: [],       // постоянные объекты текущего забега (systems/stations.js)
    stationEncounter: null,
    stationPromptId: null,
    stationsCleared: 0,
  };
}

/** Единственный источник истины для прогресса конкретной территории. */
export function biomeProgressFor(run, biomeId = run.biomeId, locationId = run.location,
  recommendedLevel = run.biome?.recommendedLevel) {
  if (!biomeId || !locationId) return null;
  run.biomeProgress ??= {};
  if (!run.biomeProgress[biomeId]) {
    const loc = getLocation(locationId);
    run.biomeProgress[biomeId] = {
      biomeId,
      locationId: loc.id,
      recommendedLevel: recommendedLevel ?? loc.recommendedLevel ?? 1,
      wavesCleared: 0,
      waveCount: loc.waveCount,
      regularCleared: false,
      bossTriggered: false,
      bossDefeated: false,
    };
  }
  return run.biomeProgress[biomeId];
}

export const currentBiomeProgress = (run) => biomeProgressFor(run);
export const currentBiomeWave = (run) => {
  const progress = currentBiomeProgress(run);
  return progress ? Math.min(progress.waveCount, progress.wavesCleared + 1) : 0;
};

export function initWaves(game) {
  on('enemy:killed', () => {
    game.run.kills++;
    refreshRemaining(game);
  });
  on('boss:killed', ({ boss }) => onBossKilled(game, boss));
  on('location:change', ({ fromBiomeId, toBiomeId }) => {
    handleBiomeChange(game, fromBiomeId, toBiomeId);
  });
}

function beginWave(game, {
  globalWave,
  localWave,
  combatWave,
  isBoss,
  mode,
  biomeId = null,
  locationId = game.run.location,
}) {
  const run = game.run;
  run.wave = globalWave;
  run.localWave = localWave;
  run.combatWave = combatWave;
  run.waveMode = mode;
  run.activeWaveBiomeId = biomeId;
  run.waveLocationId = locationId;
  run.difficulty = waveDifficulty(combatWave);
  run.phase = 'fighting';
  run.isBoss = isBoss;

  if (mode === 'endless') shuffleEndlessArena(game, localWave);

  if (run.isBoss) {
    spawnBossWave(game, globalWave);
  } else {
    spawnRegularWave(game, combatWave);
  }

  applyEnemyCurses(game);
  refreshRemaining(game);
  const progress = mode === 'biome' ? biomeProgressFor(run, biomeId, locationId) : null;
  run.waveTotal = progress?.waveCount ?? null;
  const payload = {
    wave: globalWave,
    biomeWave: localWave,
    biomeTotal: progress?.waveCount ?? null,
    biomeId,
    isBoss: run.isBoss,
    mode,
  };
  fireHook(game, 'onWaveStart', payload);
  emit('wave:start', payload);
  return true;
}

/**
 * Совместимый тестовый вход: старые bench-сценарии могут по-прежнему запросить
 * конкретную глобальную волну и босса на кратной пяти. Реальная игра идёт
 * через startBiomeWave()/startEndlessWave().
 */
export function startWave(game, wave) {
  return beginWave(game, {
    globalWave: wave,
    localWave: wave,
    combatWave: wave,
    isBoss: wave % BOSS_EVERY === 0,
    mode: 'legacy',
  });
}

export function startBiomeWave(game) {
  const run = game.run;
  const progress = currentBiomeProgress(run);
  if (!progress || progress.regularCleared || run.endless) {
    if (progress?.regularCleared && !run.endless) run.phase = 'exhausted';
    return false;
  }
  const localWave = progress.wavesCleared + 1;
  return beginWave(game, {
    globalWave: run.totalWavesCleared + 1,
    localWave,
    combatWave: biomeDifficultyWave(progress.recommendedLevel, localWave),
    isBoss: false,
    mode: 'biome',
    biomeId: progress.biomeId,
    locationId: progress.locationId,
  });
}

export function startEndlessWave(game) {
  const run = game.run;
  if (!run.endless) return false;
  run.endlessWave = (run.endlessWave ?? 0) + 1;
  const globalWave = (run.victoryWave ?? run.totalWavesCleared) + run.endlessWave;
  return beginWave(game, {
    globalWave,
    localWave: run.endlessWave,
    combatWave: globalWave,
    isBoss: run.endlessWave % BOSS_EVERY === 0,
    mode: 'endless',
    locationId: run.location,
  });
}

/** Проклятие «Жадность» делает врагов живучее — применяем к только что заспавненным. */
function applyEnemyCurses(game) {
  const tough = game.player.effects.flags.toughEnemies ?? 0;
  if (!tough) return;
  for (const e of game.entities.enemies) {
    if (e.cursed) continue;
    e.cursed = true;
    e.maxHp = Math.round(e.maxHp * (1 + tough));
    e.hp = e.maxHp;
  }
}

function spawnRegularWave(game, wave) {
  const locMod = getLocation(game.run.waveLocationId).modifiers ?? {};
  let budget = waveBudget(wave) * (locMod.enemyCountMul ?? 1);
  // Первые две волны — только безоружные дроны: дать освоить управление
  // и собрать первые модули, не отбиваясь от стрелков.
  const pool = wave <= 2 ? ['drone'] : availableEnemies(wave, game.run.waveLocationId);
  const roster = [];

  // закупаем состав в рамках бюджета: дорогие типы разбавляются дешёвыми
  let guard = 400;
  while (budget > 0 && guard-- > 0) {
    const affordable = pool.filter((id) => getEnemy(id).cost <= budget);
    if (!affordable.length) break;
    const id = affordable[(Math.random() * affordable.length) | 0];
    budget -= getEnemy(id).cost;
    roster.push(id);
  }

  // одна элита каждые три волны, начиная с шестой — раньше она душит новичка
  if (wave >= 6 && wave % 3 === 0) roster.push(wave >= 9 ? 'ELITE_brute' : 'ELITE_gunner');

  shuffle(roster);
  game.run.queue = roster;
  game.run.spawnTimer = 0;
  releaseReinforcements(game, true);
}

/** Выпускает столько врагов из очереди, сколько влезает в лимит. */
function releaseReinforcements(game, initial = false) {
  const run = game.run;
  if (!run.queue.length) return;

  const alive = game.entities.enemies.filter((e) => e.fromWave && !e.boss).length;
  let slots = activeLimit(run) - alive;
  if (slots <= 0) return;

  const wave = run.combatWave ?? run.wave;
  const locMod = getLocation(run.waveLocationId ?? run.location).modifiers ?? {};
  const hpScale = enemyHpScale(wave) * (locMod.enemyHpMul ?? 1);
  const dmgScale = enemyDamageScale(wave);
  const spdScale = enemySpeedScale(wave);

  while (slots-- > 0 && run.queue.length) {
    const raw = run.queue.pop();
    const elite = raw.startsWith('ELITE_');
    const id = elite ? raw.slice(6) : raw;

    // подкрепления заходят с края экрана, начальная волна — широким кольцом
    const angle = rnd(TAU);
    const dist = initial ? rnd(1150, 640) : rnd(1500, 1000);
    const e = makeEnemy(
      game.player.x + Math.cos(angle) * dist,
      game.player.y + Math.sin(angle) * dist,
      id,
      1,
    );
    // элита растёт вместе с волной: на ранних она заметная, но не глухая стена
    const eliteScale = elite ? 2.2 + wave * 0.06 : 1;
    e.hp = e.maxHp = Math.round(e.maxHp * hpScale * eliteScale);
    e.damage *= dmgScale * (elite ? 1.3 : 1);
    e.speed *= spdScale;
    if (elite) {
      e.elite = true;
      e.r *= 1.4;
      e.scrap *= 3;
      e.xp *= 2;
      e.score *= 3;
    }
    game.entities.enemies.push(e);
  }
  applyEnemyCurses(game);   // подкрепления тоже попадают под «Жадность»
}

function clearEncounterHazards(game) {
  game.projectiles.foeBullets.length = 0;
  game.telegraphs.length = 0;
}

function abandonRegularWave(game) {
  const run = game.run;
  const owner = run.activeWaveBiomeId;
  game.entities.enemies = game.entities.enemies.filter(
    (enemy) => !(enemy.fromWave && enemy.source === 'wave'),
  );
  run.queue = [];
  run.remaining = 0;
  run.activeWaveBiomeId = null;
  run.isBoss = false;
  clearEncounterHazards(game);
  emit('wave:abandoned', { biomeId: owner, wave: run.wave, biomeWave: run.localWave });
}

function abandonBiomeBoss(game) {
  const run = game.run;
  const owner = run.activeBossBiomeId;
  if (!owner) return false;
  game.entities.enemies = game.entities.enemies.filter(
    (enemy) => !(enemy.source === 'biome-boss' && enemy.encounterId === owner),
  );
  const progress = run.biomeProgress?.[owner];
  if (progress && !progress.bossDefeated) progress.bossTriggered = false;
  run.activeBossBiomeId = null;
  clearEncounterHazards(game);
  emit('boss:escaped', { biomeId: owner });
  return true;
}

function handleBiomeChange(game, fromBiomeId, toBiomeId) {
  const run = game.run;
  if (!toBiomeId || run.endless || fromBiomeId === toBiomeId) return;
  if (run.realm) return; // отдельный realm не создаёт прогресс биома и не запускает таймер волн

  const abandonedWave = run.waveMode === 'biome'
    && run.phase === 'fighting'
    && run.activeWaveBiomeId
    && run.activeWaveBiomeId !== toBiomeId;
  if (abandonedWave) abandonRegularWave(game);
  if (run.activeBossBiomeId && run.activeBossBiomeId !== toBiomeId) abandonBiomeBoss(game);

  const progress = currentBiomeProgress(run);
  if (!progress || run.phase === 'cleared' || run.phase === 'reward') return;
  if (progress.regularCleared) {
    run.phase = 'exhausted';
    run.countdown = 0;
    return;
  }
  if (abandonedWave || run.phase === 'idle' || run.phase === 'exhausted') {
    startBreather(game);
  }
}

/** Босс — отдельный владелец территории и никогда не считается обычной волной. */
export function triggerBiomeBoss(game) {
  const run = game.run;
  if (run.endless || run.over || run.stationEncounter || !run.biomeId || run.activeBossBiomeId) return false;
  // The unique starting sector is deliberately boss-free.
  if (run.location === 'start') return false;
  const progress = currentBiomeProgress(run);
  const bossId = bossForLocation(run.location);
  if (!bossId || !progress || progress.bossDefeated || run.bossesKilled?.includes(bossId)) return false;
  if (game.entities.enemies.some((enemy) => enemy.boss)) return false;

  const anchorX = run.biome?.x ?? 0;
  const anchorY = run.biome?.y ?? 0;
  if (torDistance(game.player.x, game.player.y, anchorX, anchorY) > BOSS_TRIGGER_RADIUS) return false;

  const boss = makeBoss(
    bossId,
    nearestWorldImage(anchorX, game.player.x),
    nearestWorldImage(anchorY, game.player.y),
    1,
  );
  boss.fromWave = false;
  boss.source = 'biome-boss';
  boss.encounterId = run.biomeId;
  boss.hunting = true;
  game.entities.enemies.push(boss);
  run.activeBossBiomeId = run.biomeId;
  run.bossHint = BOSSES[bossId].hint;
  progress.bossTriggered = true;
  sfx.alarm();
  camera.shake(12);
  emit('boss:spawn', { boss, def: BOSSES[bossId], biomeId: run.biomeId });
  return true;
}

/**
 * Боссовая волна. HP босса ФИКСИРОВАННОЕ (см. data/bosses.js) — масштаб идёт
 * только от бесконечного режима (run.endless). Выходит босс той локации, где
 * игрок сейчас находится; в открытом космосе — ДРЕДНОУТ. Если локальный босс
 * уже был убит в этом забеге, берётся следующий по порядку из непобеждённых:
 * иначе, кружа в одном кластере, можно было бы бесконечно фармить одного.
 */
function spawnBossWave(game, wave) {
  const id = pickBoss(game, wave);
  const def = BOSSES[id];
  const scale = game.run.endless ? Math.pow(1.15, game.run.endlessLap ?? 0) : 1;
  const angle = rnd(TAU);
  const boss = makeBoss(
    id,
    game.player.x + Math.cos(angle) * 780,
    game.player.y + Math.sin(angle) * 780,
    scale,
  );
  game.entities.enemies.push(boss);
  game.run.bossHint = def.hint;
  sfx.alarm();
  camera.shake(12);
  emit('boss:spawn', { boss, def });
}

function pickBoss(game, wave) {
  const run = game.run;

  // бесконечный режим: случайный из семи, но не тот же, что в прошлый раз —
  // иначе ротация вырождается в один и тот же бой два раза подряд
  if (run.endless) {
    const pool = BOSS_ORDER.filter((id) => id !== run.lastBoss);
    const id = pool[(Math.random() * pool.length) | 0];
    run.lastBoss = id;
    run.endlessLap = (run.endlessLap ?? 0) + 1;
    return id;
  }

  const killed = run.bossesKilled ?? [];
  const local = bossForLocation(run.location);
  if (local && !killed.includes(local)) return local;
  const next = BOSS_ORDER.find((id) => !killed.includes(id));
  return next ?? bossForWave(wave);
}

/**
 * Бесконечный режим тасует арену: каждые 3 волны модификатор локации меняется
 * на случайный, вне зависимости от того, где игрок физически находится.
 * Это уже не карта, а полоса испытаний — смена правил и есть содержание.
 */
function shuffleEndlessArena(game, wave) {
  const run = game.run;
  if (!run.endless || wave % 3 !== 0) return;
  const ids = LOCATION_ORDER.filter((id) => {
    const location = getLocation(id);
    return id !== run.location && location.combat !== false && location.placement?.kind !== 'start';
  });
  const next = ids[(Math.random() * ids.length) | 0];
  emit('location:change', { from: run.location, to: next });
  run.location = next;
  run.arenaLocked = true;   // world.js больше не перебивает локацию по координатам
}

function onBossKilled(game, boss) {
  const def = BOSSES[boss.boss];
  const run = game.run;
  if (boss.source === 'biome-boss') {
    const progress = run.biomeProgress?.[boss.encounterId];
    if (progress) {
      progress.bossTriggered = true;
      progress.bossDefeated = true;
    }
    if (run.activeBossBiomeId === boss.encounterId) run.activeBossBiomeId = null;
  }
  run.bosses++;
  run.kills++;
  run.score += boss.score;

  // НАГРАДА ЗА СКОРОСТЬ: отсчёт с появления босса. Пришёл сам по таймеру —
  // множитель обычный, убит быстро — бонус и гарантированный эпик в награде
  // за волну (см. systems/progression.js:offerWaveRewards).
  const reward = bossSpeedReward(boss.age ?? 0, boss.cameItself);
  run.bossReward = reward;
  run.guaranteedEpic = reward.epic;

  run.bossesKilled ??= [];
  if (!run.bossesKilled.includes(boss.boss)) run.bossesKilled.push(boss.boss);

  sfx.bigBoom();
  camera.shake(28);

  const scrapTotal = Math.round(boss.scrap * reward.mul);
  for (let i = 0; i < 14; i++) {
    game.entities.pickups.push(makePickup(boss.x, boss.y, 'xp', Math.round(boss.xp / 10) + 1));
  }
  for (let i = 0; i < 3; i++) {
    game.entities.pickups.push(makePickup(boss.x, boss.y, 'hp', 30));
  }
  for (let i = 0; i < 6; i++) {
    game.entities.pickups.push(makePickup(boss.x, boss.y, 'scrap', Math.round(scrapTotal / 6) + 2));
  }

  emit('boss:defeated', { boss, def, reward });

  // все десять пали — забег не обрывается, показывается выбор (эндгейм)
  if (!run.endless && run.bossesKilled.length >= BOSS_ORDER.length) {
    emit('run:allBosses', { run });
  }
  refreshRemaining(game);
}

/** Пересчёт «осталось врагов» и проверка зачистки. */
export function refreshRemaining(game) {
  const run = game.run;
  if (run.phase !== 'fighting') return;

  const onField = game.entities.enemies.filter((e) => e.fromWave).length;
  const left = onField + run.queue.length;
  run.remaining = left;

  // освободилось место — выпускаем подкрепление
  if (run.queue.length && onField < activeLimit(run)) releaseReinforcements(game);

  if (left === 0) {
    let biomeWave = run.localWave;
    let biomeTotal = null;
    const biomeId = run.activeWaveBiomeId;
    let regularCleared = false;
    if (run.waveMode === 'biome' && biomeId) {
      const progress = biomeProgressFor(run, biomeId, run.waveLocationId);
      if (progress && progress.wavesCleared < progress.waveCount) {
        progress.wavesCleared++;
        progress.regularCleared = progress.wavesCleared >= progress.waveCount;
        run.totalWavesCleared++;
        run.wave = run.totalWavesCleared;
        biomeWave = progress.wavesCleared;
        biomeTotal = progress.waveCount;
        regularCleared = progress.regularCleared;
      }
      run.activeWaveBiomeId = null;
    }
    run.phase = 'cleared';
    run.countdown = INTERMISSION;
    counters(game.player).wavesCleared++;
    sfx.waveClear();
    const payload = {
      wave: run.wave,
      biomeWave,
      biomeTotal,
      biomeId,
      regularCleared,
      mode: run.waveMode,
    };
    fireHook(game, 'onWaveClear', payload);
    emit('wave:clear', payload);
    if (regularCleared) emit('biome:regular-cleared', payload);
  }
}

/** Тикает между волнами: пауза → экран награды. */
export function updateWaves(game, dt) {
  const run = game.run;
  run.time += dt;

  // Станция — отдельный encounter: обычная волна и таймер передышки
  // заморожены, но общее время забега продолжает идти.
  if (run.stationEncounter?.status === 'active' || run.stationEncounter?.status === 'reward') return;

  // Босс живёт отдельно от ряда обычных волн и вызывается входом в его метку.
  triggerBiomeBoss(game);

  // подкрепления подтягиваются раз в секунду, даже если никто не умер
  if (run.phase === 'fighting' && run.queue.length) {
    run.spawnTimer -= dt;
    if (run.spawnTimer <= 0) {
      run.spawnTimer = 1;
      releaseReinforcements(game);
      refreshRemaining(game);
    }
  }

  if (run.phase === 'cleared') {
    run.countdown -= dt;
    if (run.countdown <= 0) {
      run.phase = 'reward';
      emit('wave:reward', {
        wave: run.wave,
        biomeWave: run.localWave,
        biomeTotal: run.waveTotal,
        mode: run.waveMode,
      });
    }
  }

  // передышка: свободный полёт, волна стартует сама по истечении времени
  if (run.phase === 'breather') {
    if (!run.endless && run.waveMode === 'biome' && currentBiomeProgress(run)?.regularCleared) {
      run.phase = 'exhausted';
      run.countdown = 0;
      return;
    }
    run.countdown -= dt;
    if (run.countdown <= 0) nextWave(game);
  }
}

/** Забрал награду — начинается передышка, а не сразу следующая волна. */
export function startBreather(game) {
  const run = game.run;
  if (!run.endless && run.waveMode === 'biome' && currentBiomeProgress(run)?.regularCleared) {
    run.phase = 'exhausted';
    run.countdown = 0;
    emit('biome:quiet', { biomeId: run.biomeId, progress: currentBiomeProgress(run) });
    return;
  }
  run.phase = 'breather';
  run.countdown = BREATHER;
  emit('wave:breather', { seconds: BREATHER });
}

/** Досрочный старт волны по кнопке — режим «без прогулок» остаётся доступен. */
export function skipBreather(game) {
  if (game.run.realm || game.run.phase !== 'breather' || game.run.stationEncounter) return false;
  nextWave(game);
  return true;
}

/** Вызывается после того, как игрок забрал награду. */
export function nextWave(game) {
  const run = game.run;
  if (run.endless) return startEndlessWave(game);
  if (run.waveMode === 'legacy') return startWave(game, run.wave + 1);
  return startBiomeWave(game);
}
