import { camera } from './core/camera.js';
import { initInput, configureMouse, keys, mouse, held, onPress, releaseAll } from './core/input.js';
import { initAudio, resumeAudio, toggleMute, sfx } from './core/audio.js';
import { on, emit } from './core/events.js';
import { profiler } from './core/profiler.js';

import { clamp, fmt } from './core/math.js';
import { createWorld, updateWorld, updateAsteroids } from './world/world.js';
import { wrapActiveSimulation } from './world/wrap.js?v=818be63';
import { createPlayer, updatePlayerMovement, tryDash, selectWeapon, cycleWeapon, currentWeapon, fireInterval } from './entities/player.js';
import { clearWaypointOnArrival } from './systems/navigation.js';
import { getWeapon } from './data/weapons.js';
import { createEffects, updateEffects, clearEffects } from './entities/effects.js';
import { createProjectiles, updateProjectiles, fireWeapon, clearProjectiles } from './entities/projectiles.js';
import { updateEnemies } from './entities/enemies.js?v=818be63';
import { updatePickups } from './entities/pickups.js';
import { createTurretState, updateTurrets, clearTurrets } from './entities/turrets.js';
import { createTelegraphState, updateTelegraphs, clearTelegraphs } from './entities/telegraphs.js';

import { resolveAsteroidHits, hurtPlayer } from './systems/combat.js';
import { createRun, initWaves, startBiomeWave, updateWaves, nextWave, startBreather, skipBreather, refreshRemaining, BOSS_EVERY } from './systems/waves.js?v=818be63';
import { initProgression, offerLevelUpgrades, offerWaveRewards, applyUpgrade, needsWeaponSwap } from './systems/progression.js';
import { meta, initMeta } from './systems/meta.js';
import { discoverContent, initBestiary } from './systems/bestiary.js';
import { clearHullSeed, initLocations, updateLocationEffects } from './systems/locations.js';
import { navigationCapabilities } from './systems/location-policy.js';
import {
  activateStation,
  constrainStationArena,
  declineStationPrompt,
  finishStationReward,
  initStationRun,
  updateStations,
} from './systems/stations.js';
import { initMapScreen, showMap, hideMap, isMapOpen } from './ui/mapscreen.js?v=818be63';
import { hideRunMenu, initRunMenu, isRunMenuOpen, showRunMenu } from './ui/runmenu.js?v=818be63';
import { updateEffectSystems, useAbility, fireHook, stackBonus, grantAbility } from './systems/effects.js';
import { createAbilityEntities, updateAbilityEntities, abilityById } from './data/abilities.js';
import { cardById } from './data/perks.js';

import { renderScene, renderMenuBackdrop } from './render/renderer.js?v=818be63';
import { initHud, updateHud, resetHudCache } from './render/hud.js';
import { initScreens, showMenu, showHangar, showPause, hideScreens, showCards, showStationConfirm, showWeaponSwap, showVictoryChoice, showGameOver, toast, hideToast, anyScreenOpen } from './ui/screens.js';
import { renderStats } from './ui/stats.js?v=818be63';
import { initDevPanel } from './ui/devpanel.js';

/**
 * Точка сборки: состояние игры, машина состояний и главный цикл.
 *
 * Состояния:
 *   menu      — главное меню (под ним плывёт звёздный фон)
 *   hangar    — ангар с покупками
 *   playing   — идёт бой
 *   paused    — пауза
 *   runmenu   — журнал забега / бестиарий (мир заморожен)
 *   choosing  — открыт выбор карточки (мир заморожен)
 *   over      — итоги забега
 */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

export const game = {
  state: 'menu',
  time: 0,
  view: { width: 0, height: 0, dpr: 1 },
  world: createWorld(),
  fx: createEffects(),
  projectiles: createProjectiles(),
  entities: { enemies: [], asteroids: [], pickups: [] },
  aim: { x: 0, y: 0 },              // курсор в мировых координатах
  player: null,
  run: createRun(),
  ...createAbilityEntities(),       // singularities, strikes, decoys
  ...createTurretState(),           // турели ствола «Сеялка»
  ...createTelegraphState(),        // подсветка зон атак боссов
};
initStationRun(game.run);

// ─────────────────────────────── размеры

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  game.view.width = window.innerWidth;
  game.view.height = window.innerHeight;
  game.view.dpr = dpr;
  canvas.width = game.view.width * dpr;
  canvas.height = game.view.height * dpr;
  canvas.style.width = game.view.width + 'px';
  canvas.style.height = game.view.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

// ─────────────────────────────── жизненный цикл забега

function startRun() {
  resumeAudio();
  closeStats();
  hideRunMenu();
  meta.reload();

  game.player = createPlayer(meta.save);

  // стартовая активка из ангара (см. systems/meta.js:selectStartAbility)
  if (meta.save.startAbility) {
    const card = cardById[meta.save.startAbility];
    const def = card && abilityById(card.ability);
    if (def) grantAbility(game.player, def);
  }

  game.entities.enemies.length = 0;
  game.entities.asteroids.length = 0;
  game.entities.pickups.length = 0;
  game.singularities.length = 0;
  game.strikes.length = 0;
  game.decoys.length = 0;
  game.mirrors.length = 0;
  game.anchors.length = 0;
  game.rifts.length = 0;
  clearTurrets(game);
  clearTelegraphs(game);
  clearProjectiles(game.projectiles);
  clearEffects(game.fx);
  game.world.chunks.clear();
  game.run = createRun();
  initStationRun(game.run);
  game.player.iframes = 2.5;

  camera.reset(0, 0);
  resetHudCache();
  hideScreens();
  game.state = 'playing';

  updateWorld(game);
  startBiomeWave(game);
  emit('run:start', {});
  // тост первой волны прилетает из слушателя 'wave:start' (см. ниже)
}

function endRun(victory = false) {
  if (game.run.over) return;
  game.run.over = true;
  hideRunMenu();
  game.state = 'over';
  releaseAll();

  const run = game.run;
  const summary = {
    victory,
    endless: run.endless,
    endlessWaves: run.endlessWave ?? 0,
    wave: run.totalWavesCleared ?? run.wave,
    score: run.score,
    kills: run.kills,
    bosses: run.bosses,
    time: run.time,
    scrap: run.scrap,
  };
  meta.finishRun(run);
  sfx.bigBoom();
  setTimeout(() => showGameOver(summary), 800);
}

/** Бонус к обломкам за победу над всеми десятью. */
const VICTORY_SCRAP_MUL = 1.5;

/**
 * Все десять боссов пали. Забег не обрывается: показываем выбор.
 * «В ангар» — победа с бонусом; «Глубже» — бесконечный режим, причём обломки
 * за победу начисляются СРАЗУ, чтобы риск не наказывал за любопытство.
 */
on('run:allBosses', () => {
  const run = game.run;
  if (run.victoryOffered) return;   // игрок может убить всех боссов и при 0 обычных волн
  run.victoryOffered = true;
  run.victoryWave = run.totalWavesCleared;
  game.state = 'choosing';
  releaseAll();

  const summary = {
    wave: run.totalWavesCleared, score: run.score, kills: run.kills,
    time: run.time, scrap: run.scrap,
  };

  showVictoryChoice(summary, (pick) => {
    if (pick === 'hangar') {
      run.scrap = Math.round(run.scrap * VICTORY_SCRAP_MUL);
      meta.save.stats.wins++;
      endRun(true);
      return;
    }
    // ГЛУБЖЕ: победный бонус зачисляем в профиль немедленно и обнуляем счётчик
    // забега, чтобы дальше копилось заново и смерть не отобрала уже заслуженное
    const earned = Math.round(run.scrap * VICTORY_SCRAP_MUL);
    meta.save.stats.wins++;
    meta.save.scrap += earned;
    meta.save.stats.totalScrap += earned;
    meta.persist();
    run.scrap = 0;
    run.endless = true;
    run.endlessLap = 0;
    hideScreens();
    game.state = 'playing';
    nextWave(game);
    toast('ГЛУБЖЕ', `${fmt(earned)} обломков уже в ангаре`);
  });
});

function quitToMenu() {
  const activeRun = !game.run.over && ['playing', 'paused', 'runmenu', 'stats', 'map'].includes(game.state);
  closeStats();
  hideMap();
  hideRunMenu();
  if (activeRun) {
    meta.finishRun(game.run);   // забег засчитывается, обломки не пропадают
    game.run.over = true;
  }
  game.state = 'menu';
  releaseAll();
  showMenu();
}

function closeStats() {
  const node = document.getElementById('screen-stats');
  if (node && !node.hidden) {
    node.hidden = true;
    if (game.state === 'stats') game.state = 'playing';
  }
}

function togglePause() {
  closeStats();
  if (game.state === 'playing') {
    if (game.run.stationEncounter?.status === 'active') {
      toast('КОЛЬЦО ЗАМКНУТО', 'меню недоступно до конца зачистки', 1400);
      return;
    }
    game.state = 'paused';
    releaseAll();
    showPause();
  } else if (game.state === 'paused') {
    resume();
  }
}

function resume() {
  if (game.state !== 'paused') return;
  game.state = 'playing';
  hideScreens();
}

function openRunMenu() {
  if (game.state !== 'playing') return;
  if (game.run.stationEncounter?.status === 'active') {
    toast('КОЛЬЦО ЗАМКНУТО', 'журнал недоступен до конца зачистки', 1400);
    return;
  }
  hideToast();
  releaseAll();
  game.state = 'runmenu';
  showRunMenu();
}

function closeRunMenu() {
  if (game.state !== 'runmenu' && !isRunMenuOpen()) return;
  hideRunMenu();
  game.state = 'playing';
}

// ─────────────────────────────── карточки

let pendingLevels = 0;

function discoverOffers(items) {
  for (const item of items) {
    if (item.weapon) discoverContent('weapons', item.weapon);
    else if (item.ability) discoverContent('abilities', item.ability);
    else discoverContent('perks', item.id);
  }
}

function openLevelChoice() {
  const items = offerLevelUpgrades(game).map(decorate);
  if (!items.length) return;
  discoverOffers(items);
  game.state = 'choosing';
  releaseAll();
  showCards({
    title: `УРОВЕНЬ ${game.player.level}`,
    subtitle: 'выбери модуль — клик или 1 / 2 / 3',
    items,
    rerolls: game.player.rerolls,
    onReroll: game.player.rerolls > 0 ? () => { game.player.rerolls--; openLevelChoice(); } : null,
    onPick: (item) => resolveUpgrade(item, closeChoice),
  });
}

function openWaveReward() {
  const items = offerWaveRewards(game).map(decorate);
  discoverOffers(items);
  const biomeTitle = game.run.waveMode === 'biome'
    ? `ВОЛНА БИОМА ${game.run.localWave}/${game.run.waveTotal} ЗАЧИЩЕНА`
    : `ВОЛНА ${game.run.wave} ЗАЧИЩЕНА`;
  game.state = 'choosing';
  releaseAll();
  showCards({
    title: biomeTitle,
    subtitle: 'забери трофей и двигайся дальше',
    items,
    rerolls: game.player.rerolls,
    onReroll: game.player.rerolls > 0 ? () => { game.player.rerolls--; openWaveReward(); } : null,
    onPick: (item) => resolveUpgrade(item, () => {
      // не следующая волна сразу, а передышка: время слетать в другую локацию
      startBreather(game);
      closeChoice();
    }),
  });
}

/**
 * Применяет карточку. Если это ствол, а все 3 слота заняты — сперва
 * показывает экран выбора замены и только потом продолжает (см.
 * progression.js:needsWeaponSwap). onDone — что делать дальше (закрыть
 * выбор уровня или продолжить забег после награды за волну).
 */
function resolveUpgrade(item, onDone) {
  if (needsWeaponSwap(game.player, item)) {
    showWeaponSwap(game.player, item, (replaceId) => {
      // null приходит только от явного «ОСТАВИТЬ КАК ЕСТЬ»: закрываем выбор,
      // но не пытаемся выдать ствол. Некорректный id ниже бросит ошибку и не
      // будет замаскирован под осознанный отказ игрока.
      if (replaceId === null) {
        onDone();
        return;
      }
      applyUpgrade(game, item, replaceId);
      onDone();
    });
  } else {
    applyUpgrade(game, item);
    onDone();
  }
}

function decorate(item) {
  return { ...item, playerLevel: game.player.modules[item.id] ?? 0 };
}

function closeChoice() {
  hideScreens();
  game.state = 'playing';
  if (pendingLevels > 0) {
    pendingLevels--;
    openLevelChoice();
  } else if (game.run.phase === 'reward') {
    openWaveReward();
  }
}

/**
 * Объявление волны висит на событии, а не вызывается вручную из трёх мест:
 * волна теперь стартует ещё и сама по истечении передышки (systems/waves.js).
 */
on('wave:start', ({ wave, biomeWave, biomeTotal, isBoss, mode }) => {
  if (isBoss) {
    toast(mode === 'endless' ? `ГЛУБИНА ${biomeWave} · БОСС` : `ВОЛНА ${wave} · БОСС`, game.run.bossHint, 2600);
  } else if (mode === 'biome') {
    toast(`ВОЛНА БИОМА ${biomeWave}/${biomeTotal}`, `общая зачистка · ${game.run.totalWavesCleared} волн`, 1700);
  } else {
    const toBoss = BOSS_EVERY - (wave % BOSS_EVERY);
    toast(`ВОЛНА ${wave}`, toBoss === BOSS_EVERY ? '' : `до босса ${toBoss}`, 1500);
  }
});

on('wave:breather', ({ seconds }) => {
  toast('ПЕРЕДЫШКА', `${seconds}с на перелёт · M — карта · Enter — начать волну`, 2600);
});

on('location:change', ({ to }) => {
  if (to === 'singularity') {
    toast('СИНГУЛЯРНОСТЬ', 'три выхода · музыка и бой замолкают', 2200);
  }
});

on('biome:quiet', ({ progress }) => {
  toast('БИОМ ЗАЧИЩЕН', `${progress.wavesCleared}/${progress.waveCount} волн · остались структуры и босс`, 2600);
});

on('boss:escaped', () => {
  toast('БОСС ОСТАЛСЯ В БИОМЕ', 'вернись к метке, чтобы начать бой заново', 2200);
});

// ─────────────────────────────── события

on('player:levelup', () => {
  if (game.state === 'choosing') pendingLevels++;
  else openLevelChoice();
});

on('wave:reward', () => {
  if (game.state === 'choosing') return;   // доберём после закрытия текущего выбора
  openWaveReward();
});

on('run:over', () => endRun(false));

on('boss:spawn', ({ def }) => toast(def.name, def.title, 2600));
on('boss:defeated', ({ def }) => toast(def.name + ' УНИЧТОЖЕН', 'обломки собраны', 2000));
on('boss:phase', ({ phase }) => toast(`ФАЗА ${phase}`, 'он разозлился', 1200));

on('station:discovered', ({ station }) => {
  sfx.select();
  toast('ОБНАРУЖЕНА СТАНЦИЯ', `аварийный сигнал · уровень ${station.recommendedLevel} · метка сохранена на карте`, 2600);
});

on('station:prompt', ({ station }) => {
  game.state = 'choosing';
  releaseAll();
  hideToast();
  showStationConfirm(
    station,
    () => {
      if (activateStation(game, station.id)) {
        sfx.alarm();
        closeChoice();
        if (game.state === 'playing') {
          toast('СТАНЦИЯ АКТИВИРОВАНА', 'силовое кольцо замкнуто', 1800);
        }
      } else {
        declineStationPrompt(game.run, station.id);
        sfx.denied();
        closeChoice();
      }
    },
    () => {
      declineStationPrompt(game.run, station.id);
      sfx.select();
      closeChoice();
    },
  );
});

on('station:cleared', ({ station, rewards }) => {
  game.state = 'choosing';
  releaseAll();
  hideToast();
  sfx.waveClear();
  showCards({
    title: 'СТАНЦИЯ ЗАЧИЩЕНА',
    subtitle: 'выбери одну базовую характеристику · сила трёх обычных карточек',
    items: rewards,
    onPick: (item) => {
      if (!finishStationReward(game, item.id)) return;
      sfx.confirm();
      closeChoice();
      if (game.state === 'playing') {
        toast(item.name, `${item.desc} · станция отмечена как зачищенная`, 2200);
      }
    },
  });
});

// ─────────────────────────────── ввод

initInput(canvas);
configureMouse({
  rightClick: () => {
    if (game.state === 'playing' && tryDash(game.player, game.fx)) {
      sfx.dash();
      clearHullSeed(game, 'dash');
      fireHook(game, 'onDash', {});
    }
  },
  wheel: (dir) => {
    if (game.state === 'playing' && cycleWeapon(game.player, dir)) sfx.select();
  },
});

onPress('escape', () => {
  if (isMapOpen()) { hideMap(); game.state = 'playing'; return; }
  if (isRunMenuOpen()) { closeRunMenu(); return; }
  if (game.state === 'playing') openRunMenu();
  else if (game.state === 'paused') togglePause();
  else if (game.state === 'menu') showMenu();
});
onPress('p', () => {
  if (game.state === 'playing' || game.state === 'paused') togglePause();
});
onPress('n', () => toast(toggleMute() ? 'ЗВУК ВЫКЛ' : 'ЗВУК ВКЛ', '', 900));
onPress('q', () => {
  if (game.state === 'playing' && cycleWeapon(game.player, 1)) sfx.select();
});
for (const digit of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
  onPress(digit, () => {
    if (game.state === 'playing' && selectWeapon(game.player, Number(digit) - 1)) sfx.select();
  });
}
onPress('enter', () => {
  if (game.state === 'menu' || game.state === 'over') startRun();
  // досрочный старт волны на передышке. Нарочно НЕ на пробеле: пробел стреляет,
  // и передышка обрывалась бы сама у любого, кто держит огонь или бьёт астероиды
  else if (game.state === 'playing' && skipBreather(game)) sfx.confirm();
});

// активные способности: базово 3 слота (E/R/F), у Реактора — 5 (+ C/V)
['e', 'r', 'f', 'c', 'v'].forEach((key, index) => {
  onPress(key, () => {
    if (game.state === 'playing') useAbility(game, index);
  });
});

// полная сводка характеристик по Tab — мир при этом замирает
const statsScreen = () => document.getElementById('screen-stats');
onPress('tab', () => {
  if (game.state === 'playing') {
    if (game.run.stationEncounter?.status === 'active') {
      toast('КОЛЬЦО ЗАМКНУТО', 'характеристики откроются после боя', 1200);
      return;
    }
    renderStats(game);
    hideToast();
    statsScreen().hidden = false;
    game.state = 'stats';
    releaseAll();
  } else if (game.state === 'stats') {
    statsScreen().hidden = true;
    game.state = 'playing';
  } else if (game.state === 'runmenu') {
    showRunMenu('stats');
  }
});

// карта сектора по M — мир так же замирает, как и по Tab
onPress('m', () => {
  if (game.state === 'playing') {
    if (!navigationCapabilities(game).map) {
      toast('НАВИГАЦИЯ НЕДОСТУПНА', 'ориентируйся по направлению частиц', 1400);
      return;
    }
    if (game.run.stationEncounter?.status === 'active') {
      toast('КОЛЬЦО ЗАМКНУТО', 'карта недоступна во время зачистки', 1200);
      return;
    }
    hideToast();
    if (showMap()) {
      game.state = 'map';
      releaseAll();
    }
  } else if (game.state === 'map') {
    hideMap();
    game.state = 'playing';
  } else if (game.state === 'runmenu') {
    showRunMenu('map');
  }
});

// ─────────────────────────────── обновление мира

function updatePlaying(dt) {
  const p = game.player;
  const world = camera.toWorld(mouse.x, mouse.y, game.view.width, game.view.height);
  mouse.worldX = world.x;
  mouse.worldY = world.y;
  game.aim.x = world.x;
  game.aim.y = world.y;

  updatePlayerMovement(
    p,
    {
      up: held('w', 'arrowup'),
      down: held('s', 'arrowdown'),
      left: held('a', 'arrowleft'),
      right: held('d', 'arrowright'),
      boost: held('shift'),
      aimX: world.x,
      aimY: world.y,
    },
    dt,
    game.fx,
    game,
  );
  if (!game.run.realm) {
    const worldShift = wrapActiveSimulation(game, camera);
    if (worldShift.x || worldShift.y) {
      mouse.worldX += worldShift.x;
      mouse.worldY += worldShift.y;
    }
    constrainStationArena(game);
    clearWaypointOnArrival(game);
  }

  // постоянный дренаж HP архетипа «Паразит» — идёт через боевой урон,
  // чтобы щит и броня его смягчали, а лайфстил в бою мог перекрыть
  if (!game.run.realm && p.passiveDrain > 0) hurtPlayer(game, p.passiveDrain * dt, true);

  const held_ = !game.run.realm && (mouse.down || keys[' ']);
  const w = currentWeapon(p);
  if (!game.run.realm && w.kind === 'charge') {
    // «Осадное»: копит заряд, пока зажата кнопка, стреляет по отпусканию
    // (мультиствол его не задевает — заряд несовместим с одновременной стрельбой)
    if (held_) {
      p.chargeTime = Math.min(w.chargeMax ?? 1.2, p.chargeTime + dt);
      p.charging = true;
    } else if (p.charging) {
      fireWeapon(game, clamp(p.chargeTime / (w.chargeMax ?? 1.2), 0, 1));
      p.charging = false;
      p.chargeTime = 0;
    }
  } else if (!game.run.realm) {
    p.charging = false;
    p.chargeTime = 0;
    if (p.multiFire && p.weapons.length > 1) {
      updateMultiFire(dt, held_);
    } else {
      p.fireCooldown -= dt;
      if (held_ && p.fireCooldown <= 0) fireWeapon(game);
    }
  }

  if (!game.run.realm) updateWorld(game);
  updateLocationEffects(game, dt);
  if (game.run.realm) {
    // Сингулярность — отдельный пустой realm: движение и локальные частицы
    // живут, но мир, бой, волны, станции и способности полностью заморожены.
    updateEffects(game.fx, dt);
    camera.follow(p, mouse.x - game.view.width / 2, mouse.y - game.view.height / 2, dt);
    return;
  }
  updateAsteroids(game, dt);
  updateEnemies(game, dt);
  updateProjectiles(game, dt);
  updateTurrets(game, dt);
  updateTelegraphs(game, dt);
  resolveAsteroidHits(game);
  updateEffectSystems(game, dt);      // перки: стаки, орбиталы, кулдауны активок
  updateAbilityEntities(game, dt);    // чёрные дыры, орбитальные удары, приманки
  updateEffects(game.fx, dt);
  updateWaves(game, dt);
  updateStations(game, dt);
  // Станция первой открывает свою награду; одновременный level-up встаёт в очередь.
  updatePickups(game, dt);

  // страховка: если враги волны исчезли не через killEnemy
  if (game.run.phase === 'fighting' && game.entities.enemies.length === 0) refreshRemaining(game);

  camera.follow(p, mouse.x - game.view.width / 2, mouse.y - game.view.height / 2, dt);
}

/** «МУЛЬТИСТВОЛ»: половина урона за каждый выстрел, зато все стволы разом. */
const MULTI_FIRE_DMG_MUL = 0.5;

/** Каждый ствол копит и стреляет по своему темпу — независимо от p.weapon. */
function updateMultiFire(dt, held) {
  const p = game.player;
  for (const id of p.weapons) {
    const w = getWeapon(id);
    if (w.kind === 'charge') continue; // заряд держит кнопку сам по себе, несовместим
    const cd = (p.weaponCooldowns[id] ?? 0) - dt;
    if (held && cd <= 0) {
      p.weaponCooldowns[id] = fireInterval(p, w, stackBonus(p, 'momentum'));
      fireWeapon(game, undefined, id, MULTI_FIRE_DMG_MUL);
    } else {
      p.weaponCooldowns[id] = cd;
    }
  }
}

// ─────────────────────────────── главный цикл

let last = performance.now();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  game.time += dt;

  const t0 = profiler.on ? performance.now() : 0;

  if (game.state === 'playing') updatePlaying(dt);
  else if (game.state === 'choosing' || game.state === 'paused' || game.state === 'stats' || game.state === 'map' || game.state === 'runmenu') {
    updateEffects(game.fx, dt * 0.35);
  }

  const t1 = profiler.on ? performance.now() : 0;
  const { width: W, height: H } = game.view;

  if (game.state === 'menu' || game.state === 'hangar') {
    renderMenuBackdrop(ctx, W, H, game.time);
  } else if (game.player) {
    renderScene(ctx, game, W, H);
    updateHud(game);
  }

  if (profiler.on) profiler.push(t1 - t0, performance.now() - t1);

  requestAnimationFrame(frame);
}

// ─────────────────────────────── запуск

initAudio();
initHud();
initWaves(game);
initProgression(game);
initMeta(game);
initBestiary();
initLocations(game);
initMapScreen(game);
initRunMenu({ game, onResume: closeRunMenu, onQuit: quitToMenu });
initScreens({
  startRun,
  resume,
  quitToMenu,
  showHangar,
  showMenu,
});
initDevPanel(game, { startRun });

showMenu();
requestAnimationFrame(frame);

// для отладки из консоли
window.STARFALL = { game, meta, startRun, endRun, profiler };
