import { clamp, fmt } from '../core/math.js';
import { currentWeapon, weaponDamage, fireInterval, critChance } from '../entities/player.js';
import { getWeapon } from '../data/weapons.js';
import { RARITY } from '../data/perks.js';
import { locationAt, CHUNK } from '../world/world.js';
import { moduleChips } from '../systems/progression.js';
import { stackCount } from '../systems/effects.js';
import { activeBoss } from '../entities/bosses.js';
import { BOSSES, BOSS_HUNT_AFTER } from '../data/bosses.js';
import { drawMinimap } from './minimap.js';
import { decorateTerms } from '../ui/terms.js';
import { currentBiomeProgress, currentBiomeWave } from '../systems/waves.js';
import { getLocation } from '../data/locations.js';
import { hallucinatedNumber, navigationCapabilities } from '../systems/location-policy.js';

/** HUD живёт в DOM: так текст остаётся чётким и легко масштабируется. */

let el = {};
let lastChips = '';
let lastWeapons = '';
let lastAbilities = '';
let lastQuickStatsLayout = '';

export function initHud() {
  el = {
    hpFill: document.getElementById('hp-fill'),
    hpText: document.getElementById('hp-text'),
    shieldRow: document.getElementById('shield-row'),
    shieldFill: document.getElementById('shield-fill'),
    shieldText: document.getElementById('shield-text'),
    xpFill: document.getElementById('xp-fill'),
    xpText: document.getElementById('xp-text'),
    stats: document.getElementById('hud-stats'),
    score: document.getElementById('score-value'),
    sector: document.getElementById('sector-label'),
    waveCaption: document.getElementById('wave-caption'),
    waveValue: document.getElementById('wave-value'),
    waveState: document.getElementById('wave-state'),
    weapons: document.getElementById('weapon-list'),
    chips: document.getElementById('module-chips'),
    abilities: document.getElementById('ability-bar'),
    bossBar: document.getElementById('boss-bar'),
    bossName: document.getElementById('boss-name'),
    bossPhaseTracks: [...document.querySelectorAll('#boss-phases .boss-phase-track')],
    bossInfo: document.getElementById('boss-info'),
    minimap: document.getElementById('minimap'),
  };
  el.minimapCtx = el.minimap.getContext('2d');
  // Статические подписи вроде «ЩИТ» получают тот же словарь, что карточки.
  decorateTerms(document.getElementById('hud-layer'));
}

export function updateHud(game) {
  const p = game.player;
  const run = game.run;

  // maxHp/maxShield могут быть нулём — деление дало бы NaN, и полоса залипла бы полной
  const ratio = (value, max) => (max > 0 ? clamp(value / max, 0, 1) : 0);

  // Диссонанс врёт только представлению: реальные p.hp/p.maxHp не меняются.
  const shownHp = hallucinatedNumber(game, p.hp, 'hud-hp');
  const shownMaxHp = hallucinatedNumber(game, p.maxHp, 'hud-max-hp');
  el.hpFill.style.transform = `scaleX(${ratio(shownHp, shownMaxHp)})`;
  el.hpText.textContent = `${Math.max(0, Math.ceil(shownHp))} / ${Math.round(shownMaxHp)}`;

  if (p.maxShield > 0) {
    el.shieldRow.hidden = false;
    el.shieldFill.style.transform = `scaleX(${ratio(p.shield, p.maxShield)})`;
    el.shieldText.textContent = `${Math.ceil(p.shield)} / ${Math.round(p.maxShield)}`;
  } else {
    el.shieldRow.hidden = true;
  }

  el.xpFill.style.transform = `scaleX(${ratio(p.xp, p.xpNext)})`;
  el.xpText.textContent = `УР. ${p.level}`;

  el.score.textContent = fmt(run.score);

  const cx = Math.floor(p.x / CHUNK);
  const cy = Math.floor(p.y / CHUNK);
  const location = run.realm?.id ? getLocation(run.realm.id) : locationAt(cx, cy, run.seed ?? 0);
  el.sector.textContent = `${location.name} · LVL ${location.recommendedLevel}`;

  const biomeProgress = currentBiomeProgress(run);
  const inRealm = run.realm?.id === 'singularity';
  el.waveCaption.textContent = inRealm ? 'КАРМАН' : run.endless ? 'ГЛУБИНА' : 'ВОЛНА БИОМА';
  el.waveValue.textContent = inRealm
    ? run.realm.exits.length
    : run.endless
      ? run.endlessWave
      : biomeProgress
        ? `${currentBiomeWave(run)}/${biomeProgress.waveCount}`
        : run.wave;
  el.waveState.textContent = inRealm
    ? 'ВЫХОДА · АБСОЛЮТНАЯ ТИШИНА'
    : run.stationEncounter?.status === 'active'
      ? `СТАНЦИЯ · ОСТАЛОСЬ ${run.stationEncounter.remaining}`
      : run.stationEncounter?.status === 'reward'
        ? 'СТАНЦИЯ ЗАЧИЩЕНА'
    : run.phase === 'fighting'
      ? run.isBoss ? 'БОСС' : `ОСТАЛОСЬ ${run.remaining}`
      : run.activeBossBiomeId ? 'БОСС АКТИВЕН'
      : run.phase === 'cleared' ? 'ЗАЧИЩЕНО'
      // на передышке видно, сколько ещё можно летать и чем её прервать
      : run.phase === 'breather' ? `ПЕРЕДЫШКА ${Math.max(0, Math.ceil(run.countdown))}с · ENTER`
      : run.phase === 'exhausted'
        ? biomeProgress?.bossDefeated ? 'ПОЛНАЯ ЗАЧИСТКА' : 'ВОЛНЫ ЗАЧИЩЕНЫ · БОСС НА КАРТЕ'
      : 'ГОТОВНОСТЬ';
  el.waveState.classList.toggle('danger', !inRealm && ((run.isBoss && run.phase === 'fighting') || !!run.activeBossBiomeId || run.stationEncounter?.status === 'active'));
  el.waveState.classList.toggle('calm', inRealm || ((run.phase === 'breather' || run.phase === 'exhausted') && !run.activeBossBiomeId && !run.stationEncounter));

  const w = currentWeapon(p);
  syncQuickStats(p, run, w);

  syncWeapons(p);
  syncChips(p);
  syncAbilities(p);
  syncBoss(game);

  // «Туман войны» гасит радар — это цена за прибавку к урону
  if (p.effects.flags.noRadar || !navigationCapabilities(game).minimap) {
    el.minimap.classList.add('jammed');
  } else {
    el.minimap.classList.remove('jammed');
    drawMinimap(el.minimapCtx, game, el.minimap.width);
  }
}

const ABILITY_KEYS = ['E', 'R', 'F', 'C', 'V'];

function syncQuickStats(p, run, weapon) {
  const hasDash = Boolean(p.dashCooldownMax);
  const layout = hasDash ? 'dash' : 'plain';
  if (layout !== lastQuickStatsLayout) {
    lastQuickStatsLayout = layout;
    el.stats.innerHTML =
      '<span>УРОН <b data-hud-stat="damage"></b></span>' +
      '<span>ТЕМП <b data-hud-stat="rate"></b></span>' +
      '<span>КРИТ <b data-hud-stat="crit"></b></span>' +
      '<span>ОБЛОМКИ <b data-hud-stat="scrap"></b></span>' +
      (hasDash
        ? '<span data-hud-dash><span>РЫВОК</span> <b data-hud-stat="dash"></b></span>'
        : '');
    decorateTerms(el.stats);
    el.quickStats = Object.fromEntries(
      [...el.stats.querySelectorAll('[data-hud-stat]')].map((node) => [node.dataset.hudStat, node]),
    );
    el.dashStat = el.stats.querySelector('[data-hud-dash]');
  }

  el.quickStats.damage.textContent = Math.round(weaponDamage(p, weapon));
  el.quickStats.rate.textContent = `${(1 / fireInterval(p, weapon)).toFixed(1)}/с`;
  el.quickStats.crit.textContent = `${Math.round(critChance(p) * 100)}%`;
  el.quickStats.scrap.textContent = fmt(run.scrap);
  if (hasDash) {
    const ready = p.dashCooldown <= 0;
    el.quickStats.dash.textContent = ready ? 'ГОТОВ' : `${p.dashCooldown.toFixed(1)}с`;
    el.dashStat.classList.toggle('ready', ready);
  }
}

function syncAbilities(p) {
  // состав меняется редко, а кулдауны — каждый кадр: перестраиваем только при смене состава
  const key = p.abilities.map((a) => a.def.id).join(',');
  if (key !== lastAbilities) {
    lastAbilities = key;
    el.abilities.innerHTML = '';
    p.abilities.forEach((slot, i) => {
      const node = document.createElement('div');
      node.className = 'ability';
      node.dataset.slot = i;
      node.innerHTML =
        `<i class="ability-cd"></i>` +
        `<span class="ability-key">${ABILITY_KEYS[i] ?? ''}</span>` +
        `<span class="ability-icon">${slot.def.icon}</span>` +
        `<span class="ability-name">${slot.def.name}</span>` +
        `<span class="ability-timer"></span>`;
      decorateTerms(node);
      el.abilities.appendChild(node);
    });
  }

  const nodes = el.abilities.children;
  p.abilities.forEach((slot, i) => {
    const node = nodes[i];
    if (!node) return;
    const total = slot.def.cooldown * (p.abilityCooldownMul ?? 1);
    const left = slot.cd;
    const ready = left <= 0;
    node.classList.toggle('ready', ready);
    node.querySelector('.ability-cd').style.transform = `scaleX(${total > 0 ? clamp(left / total, 0, 1) : 0})`;
    node.querySelector('.ability-timer').textContent = ready ? 'ГОТОВО' : left.toFixed(1) + 'с';
  });
}

function syncWeapons(p) {
  const key = p.weapons.join(',') + '|' + p.weapon;
  if (key === lastWeapons) return;
  lastWeapons = key;

  el.weapons.innerHTML = '';
  p.weapons.forEach((id, i) => {
    const w = getWeapon(id);
    const node = document.createElement('div');
    node.className = 'weapon' + (id === p.weapon ? ' active' : '');
    node.innerHTML = `<i>${i + 1}</i><b>${w.icon}</b><span>${w.name}</span>`;
    decorateTerms(node);
    el.weapons.appendChild(node);
  });
}

// К поздней игре модулей набирается три-четыре десятка, и полный ряд плашек
// съедал нижнюю половину экрана. В бою нужен не список, а напоминание, поэтому
// в HUD остаётся только верхушка билда, а полный состав живёт на экране Tab.
const CHIP_LIMIT = 6;
const CHIP_RANK = { cursed: 4, legendary: 3, epic: 2, rare: 1, common: 0 };

/**
 * Верхушка билда: сперва редкость, потом уровень. Проклятые идут первыми
 * намеренно — про их минус игрок обязан помнить, даже если модуль первого
 * уровня. Порядок внутри одной редкости и уровня — порядок взятия.
 */
function visibleChips(chips) {
  if (chips.length <= CHIP_LIMIT) return { shown: chips, hidden: 0 };
  const ranked = chips
    .map((c, index) => ({ c, index }))
    .sort((a, b) =>
      (CHIP_RANK[b.c.rarity] ?? 0) - (CHIP_RANK[a.c.rarity] ?? 0)
      || b.c.level - a.c.level
      || a.index - b.index);
  const shown = ranked.slice(0, CHIP_LIMIT).sort((a, b) => a.index - b.index).map((e) => e.c);
  return { shown, hidden: chips.length - CHIP_LIMIT };
}

function syncChips(p) {
  const { shown, hidden } = visibleChips(moduleChips(p));
  // стаки показываем отдельно: они меняются в бою и должны обновляться
  const momentum = stackCount(p, 'momentum');
  const greed = stackCount(p, 'greed');
  const key = shown.map((c) => c.name + c.level).join(',') + `|${hidden}|${momentum}|${greed}`;
  if (key === lastChips) return;
  lastChips = key;

  el.chips.innerHTML = '';
  // Стаки идут первыми: они единственные меняются посреди боя, и их читают
  // на бегу — значит им нужно постоянное место, а не хвост плавающей длины.
  if (momentum > 0) {
    const node = document.createElement('div');
    node.className = 'chip stack';
    node.innerHTML = `⇗ РАЗГОН <b>×${momentum}</b>`;
    decorateTerms(node);
    el.chips.appendChild(node);
  }
  if (greed > 0) {
    const node = document.createElement('div');
    node.className = 'chip stack';
    node.innerHTML = `¤ АЗАРТ <b>×${greed}</b>`;
    decorateTerms(node);
    el.chips.appendChild(node);
  }
  for (const c of shown) {
    const node = document.createElement('div');
    node.className = 'chip rarity-' + (c.rarity ?? 'common');
    node.style.setProperty('--chip-color', RARITY[c.rarity]?.color ?? RARITY.common.color);
    node.innerHTML = `${c.icon} ${c.name} <b>${c.level}</b>`;
    decorateTerms(node);
    el.chips.appendChild(node);
  }
  if (hidden > 0) {
    const node = document.createElement('div');
    node.className = 'chip more';
    node.innerHTML = `<b>+${hidden}</b> ЕЩЁ <i>TAB</i>`;
    el.chips.appendChild(node);
  }
}

function syncBoss(game) {
  const boss = activeBoss(game);
  if (!boss) {
    el.bossBar.hidden = true;
    return;
  }
  const def = BOSSES[boss.boss];
  el.bossBar.hidden = false;
  el.bossName.textContent = def.name;
  const hpRatio = boss.maxHp > 0 ? clamp(boss.hp / boss.maxHp, 0, 1) : 0;
  const phaseRatios = [
    clamp((hpRatio - 0.6) / 0.4, 0, 1),
    clamp((hpRatio - 0.3) / 0.3, 0, 1),
    clamp(hpRatio / 0.3, 0, 1),
  ];
  el.bossPhaseTracks.forEach((track, index) => {
    track.querySelector('i').style.transform = `scaleX(${phaseRatios[index]})`;
    track.classList.toggle('current', boss.phase === index + 1);
  });

  const parts = [`ФАЗА ${boss.phase}/3`, `${Math.max(0, Math.ceil(boss.hp))} / ${boss.maxHp} HP`];
  if (boss.shield > 0) parts.push(`ЩИТ ${Math.ceil(boss.shield)}`);
  // пока босс не проснулся — виден отсчёт до того, как он придёт сам:
  // это и есть окно для награды за скорость (см. data/bosses.js)
  if (!boss.hunting) {
    parts.push(`ИДЁТ САМ ЧЕРЕЗ ${Math.max(0, Math.ceil(BOSS_HUNT_AFTER - (boss.age ?? 0)))}с`);
  } else if (boss.cameItself) {
    parts.push('ОХОТА');
  }
  el.bossInfo.textContent = parts.join(' · ');
}

/** Сброс кешей, чтобы после нового забега панели перерисовались. */
export function resetHudCache() {
  lastChips = '';
  lastWeapons = '';
  lastAbilities = '';
  lastQuickStatsLayout = '';
}
