import {
  currentWeapon, weaponDamage, attackSpeedOf, fireInterval,
  critChance, dodgeChance, armorFactor, weaponDamageType,
  physicalResistance, technicalResistance, penetrationFor,
} from '../entities/player.js';
import { DAMAGE_TYPE } from '../core/damage.js';
import { cardById, RARITY } from '../data/perks.js';
import { counters, stackBonus } from '../systems/effects.js';
import { topTags } from '../systems/tags.js';
import { fmt } from '../core/math.js';
import { decorateTerms } from './terms.js';
import { currentBiomeProgress } from '../systems/waves.js';

/**
 * Полная сводка характеристик по Tab — как экран статов в подобных рогаликах.
 * Показывает не только цифры, но и вклад перков, чтобы было видно, что билд работает.
 */

const pct = (v) => `${Math.round(v * 100)}%`;
const mult = (v) => `×${v.toFixed(2)}`;
const sec = (v) => `${v.toFixed(2)}с`;

function buildGroups(game) {
  const p = game.player;
  const w = currentWeapon(p);
  const c = counters(p);

  const momentum = stackBonus(p, 'momentum');
  const shotsPerSecond = 1 / fireInterval(p, w, momentum);
  const shots = w.count + (w.kind === 'beam' ? 0 : p.countAdd);
  const dps = weaponDamage(p, w) * shots * shotsPerSecond
    * (1 + critChance(p) * (p.critMul - 1));
  const station = p.stationBonuses ?? {};
  const biomeProgress = currentBiomeProgress(game.run);
  const stationPart = (value) => value > 0 ? ` + ${pct(value)} станция` : '';
  const damageType = weaponDamageType(p);
  const technicalWeapon = damageType === DAMAGE_TYPE.TECHNICAL;

  return [
    {
      // Слои показываются в том же порядке, в каком считаются, —
      // игрок видит, какая карточка сейчас реально усиливает билд.
      title: 'ОРУЖИЕ',
      rows: [
        ['Активный ствол', w.name],
        ['Тип урона', technicalWeapon ? 'ТЕХНИЧЕСКИЙ' : 'ФИЗИЧЕСКИЙ'],
        ['— база ствола', w.dmg],
        ['— плоский бонус', !technicalWeapon && p.dmgFlat ? `+${Math.round(p.dmgFlat)}` : '—'],
        ['— RAM', technicalWeapon ? `+${Math.round(p.ram)}` : Math.round(p.ram)],
        ['— сумма процентов', p.dmgAdd ? `+${Math.round(p.dmgAdd * 100)}%` : '—'],
        ['— множители', p.dmgMul !== 1 ? mult(p.dmgMul) : '—'],
        ['Урон снаряда', Math.round(weaponDamage(p, w))],
        ['Скорость атаки', mult(attackSpeedOf(p, momentum))],
        ['Выстрелов в секунду', shotsPerSecond.toFixed(2)],
        ['Снарядов в залпе', shots],
        ['Урон в секунду', fmt(dps)],
        ['Шанс крита', `${pct(critChance(p))} (${p.critPoints.toFixed(1)} оч.${stationPart(station.crit)})`],
        ['Урон крита', mult(p.critMul)],
        ['Пробитие целей', p.pierce],
        ['Пробитие сопротивления', pct(penetrationFor(p, damageType))],
        ['Наведение', p.homingAdd > 0 ? mult(1 + p.homingAdd) : 'нет'],
        ['Рикошеты', p.ricochet || 'нет'],
        ['Взрывные снаряды', p.boomShot || 'нет'],
        ['Размер снаряда', mult(p.bulletSize)],
        ['Дальность', mult(p.lifeMul)],
      ],
    },
    {
      title: 'КОРПУС',
      rows: [
        ['Здоровье', `${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}`],
        ['Щит', p.maxShield > 0 ? `${Math.ceil(p.shield)} / ${Math.round(p.maxShield)}` : 'нет'],
        ['Восстановление щита', p.shieldRegen > 0 ? `${p.shieldRegen.toFixed(1)}/с` : 'нет'],
        ['Броня', p.armorPoints || station.armor ? `−${pct(1 - armorFactor(p))} урона${stationPart(station.armor)}` : 'нет'],
        ['Физическое сопротивление', `${pct(physicalResistance(p))} (${p.physicalResistPoints.toFixed(1)} оч.)`],
        ['Техническое сопротивление', `${pct(technicalResistance(p))} (${p.technicalResistPoints.toFixed(1)} оч.)`],
        ['Уклонение', p.dodgePoints || station.dodge ? `${pct(dodgeChance(p))}${stationPart(station.dodge)}` : 'нет'],
        ['Регенерация', p.regen > 0 ? `${p.regen.toFixed(1)} HP/с` : 'нет'],
        ['Вампиризм', p.vamp > 0 ? pct(p.vamp) : 'нет'],
        ['Неуязвимость', sec(0.6 * p.iframeMul)],
        ['Спаскапсулы', p.effects.revives || 'нет'],
        ['Урон тараном', p.ramDamage || 'нет'],
      ],
    },
    {
      title: 'ДВИЖЕНИЕ И СБОР',
      rows: [
        ['Максимальная скорость', Math.round(p.maxSpeed)],
        ['Тяга', Math.round(p.thrust)],
        ['Рывок', p.dashCooldownMax ? `откат ${sec(p.dashCooldownMax)}` : 'нет'],
        ['Радиус сбора', Math.round(p.magnet)],
        ['Удача', p.luck ? p.luck.toFixed(1) : 'нет'],
        ['Множитель опыта', mult(p.xpMul)],
        ['Множитель обломков', mult(p.scrapMul)],
        ['Перебросов осталось', p.rerolls],
        ['Дронов', p.drones.length],
        ['Орбиталов и аур', p.effects.orbitals.length],
        ['Слоты активок', `${p.abilities.length} / ${p.abilitySlots}`],
      ],
    },
    {
      title: 'ЗАБЕГ',
      rows: [
        // направления билда: по ним открываются синергии, поэтому их видно
        ...topTags(p, 4).map((t) => [t.name, `${t.count} ист.`]),
        ['Волн за забег', game.run.totalWavesCleared ?? game.run.wave],
        ['Текущий биом', biomeProgress ? `${biomeProgress.wavesCleared} / ${biomeProgress.waveCount}` : '—'],
        ['Уровень', p.level],
        ['Убийств', c.kills],
        ['Серия без урона', `${c.killStreak} (рекорд ${c.bestStreak})`],
        ['Боссов повержено', c.bossKills],
        ['Волн зачищено', c.wavesCleared],
        ['Станций обнаружено', game.run.stations?.filter((item) => item.discovered).length ?? 0],
        ['Станций зачищено', game.run.stationsCleared ?? 0],
        ['Обломков собрано', fmt(c.scrapCollected)],
        ['Модулей взято', c.perksTaken],
        ['Получено урона', fmt(Math.round(c.damageTaken))],
        ['Выстрелов', fmt(c.shots)],
      ],
    },
  ];
}

export function renderStatsInto(game, columns, list) {
  columns.innerHTML = '';

  for (const group of buildGroups(game)) {
    const box = document.createElement('div');
    box.className = 'stat-col';
    box.innerHTML =
      `<h3>${group.title}</h3>` +
      group.rows
        .map(([label, value]) => `<div class="stat-line"><span>${label}</span><b>${value}</b></div>`)
        .join('');
    decorateTerms(box);
    columns.appendChild(box);
  }

  list.innerHTML = '';
  const entries = Object.entries(game.player.modules);
  if (!entries.length) {
    list.innerHTML = '<p class="stats-empty">Пока ничего не собрано — карточки появятся после первого уровня.</p>';
    return;
  }
  for (const [id, level] of entries) {
    const card = cardById[id];
    if (!card) continue;
    const node = document.createElement('div');
    node.className = 'stat-module';
    node.style.setProperty('--rarity', RARITY[card.rarity]?.color ?? RARITY.common.color);
    node.innerHTML =
      `<span class="sm-icon">${card.icon}</span>` +
      `<span class="sm-name">${card.name}</span>` +
      `<span class="sm-level">${level}</span>`;
    list.appendChild(node);
  }
}

export function renderStats(game) {
  renderStatsInto(
    game,
    document.getElementById('stats-columns'),
    document.getElementById('stats-modules-list'),
  );
}
