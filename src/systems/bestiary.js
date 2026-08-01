import { on } from '../core/events.js';
import { ENEMIES, ENEMY_IDS } from '../data/enemies.js';
import { BOSSES, BOSS_ORDER } from '../data/bosses.js';
import { LOCATIONS, LOCATION_ORDER } from '../data/locations.js';
import { WEAPONS, WEAPON_ORDER } from '../data/weapons.js';
import { SHIPS } from '../data/ships.js';
import { ABILITIES } from '../data/abilities.js';
import { PERKS, SINGULARITY_PERK } from '../data/perks.js';
import { meta } from './meta.js';

export const BESTIARY_THRESHOLDS = Object.freeze({
  enemies: Object.freeze({ unlock: 10, analyse: 50 }),
  bosses: Object.freeze({ unlock: 1, analyse: 3 }),
});

const ENEMY_DESCRIPTIONS = Object.freeze({
  drone: 'Лёгкий перехватчик: быстро сокращает дистанцию и таранит корпус.',
  gunner: 'Держит среднюю дистанцию и ведёт размеренный огонь.',
  weaver: 'Маневренный стрелок, который раскачивает траекторию и мешает прицелиться.',
  sniper: 'Хрупкая дальнобойная цель с редкими, но опасными выстрелами.',
  mine: 'Медленная автономная мина, взрывающаяся рядом с кораблём.',
  bomber: 'Камикадзе с мощным посмертным взрывом.',
  splitter: 'После уничтожения выпускает двух лёгких дронов.',
  warden: 'Тяжёлая цель с лобовым щитом: выгоднее обходить с фланга.',
  brute: 'Медленный бронированный штурмовик с тяжёлым контактным уроном.',
  crusher: 'Астероидный дробильщик, который прокладывает путь прямо через камни.',
  phantom: 'Туманная цель, периодически меняющая позицию коротким скачком.',
  marauder: 'Быстрый охотник за выпавшими ресурсами.',
  conduit: 'Ионный стрелок, устойчивый к техническим воздействиям.',
  larva: 'Маленькая и быстрая особь роя, опасная в большой группе.',
  distortion: 'Нестабильная цель Разлома с непредсказуемыми телепортациями.',
});

const category = (id, label, source, order, icon = '◇') => ({
  id,
  label,
  entries: order.map((entryId) => {
    const def = source[entryId];
    return {
      id: entryId,
      name: def?.name ?? entryId,
      icon: def?.icon ?? icon,
      color: def?.color ?? null,
      rarity: def?.rarity ?? null,
      description: def?.desc ?? def?.hint ?? ENEMY_DESCRIPTIONS[entryId] ?? '',
      physicalResist: def?.physicalResist == null ? null : Math.round(def.physicalResist * 100),
      technicalResist: def?.technicalResist == null ? null : Math.round(def.technicalResist * 100),
      protection: def?.frontShield ? 'Лобовой щит дополнительно поглощает 85% урона в переднем секторе.' : null,
    };
  }),
});

const abilityOrder = Object.keys(ABILITIES);
const allPerks = [...PERKS.filter((perk) => !perk.weapon && !perk.ability), SINGULARITY_PERK];
const perkOrder = allPerks.map((perk) => perk.id);
const perksById = Object.fromEntries(allPerks.map((perk) => [perk.id, perk]));

/** Stable, UI-neutral catalogue. Raw catalogue definitions are never exposed. */
export const BESTIARY_REGISTRY = Object.freeze({
  enemies: category('enemies', 'ВРАГИ', ENEMIES, ENEMY_IDS, '◈'),
  bosses: category('bosses', 'БОССЫ', BOSSES, BOSS_ORDER, '◆'),
  locations: category('locations', 'ЛОКАЦИИ', LOCATIONS, LOCATION_ORDER, '✦'),
  weapons: category('weapons', 'ОРУЖИЕ', WEAPONS, WEAPON_ORDER, '↠'),
  perks: category('perks', 'МОДУЛИ', perksById, perkOrder, '◇'),
  abilities: category('abilities', 'СПОСОБНОСТИ', ABILITIES, abilityOrder, '⌬'),
});

const progressFor = (categoryId, id) => meta.bestiaryEntry(categoryId, id) ?? {
  seen: false, kills: 0, unlocked: false,
};

export function bestiaryEntryView(categoryId, id) {
  const entry = BESTIARY_REGISTRY[categoryId]?.entries.find((item) => item.id === id);
  if (!entry) return null;
  const progress = progressFor(categoryId, id);
  const thresholds = BESTIARY_THRESHOLDS[categoryId] ?? null;
  const unlocked = progress.unlocked || Boolean(thresholds && progress.kills >= thresholds.unlock);
  return {
    ...entry,
    ...progress,
    unlocked,
    analysed: Boolean(thresholds && progress.kills >= thresholds.analyse),
    thresholds,
  };
}

export function bestiaryViewModel() {
  return Object.values(BESTIARY_REGISTRY).map((group) => ({
    id: group.id,
    label: group.label,
    entries: group.entries.map((entry) => bestiaryEntryView(group.id, entry.id)),
  }));
}

export const seeEnemy = (id) => meta.discoverBestiary('enemies', id);
export const seeBoss = (id) => meta.discoverBestiary('bosses', id);
export const discoverContent = (categoryId, id, unlocked = false) =>
  meta.discoverBestiary(categoryId, id, { unlocked });

export function recordEnemyKill(id) {
  return meta.recordBestiaryKill('enemies', id, BESTIARY_THRESHOLDS.enemies.unlock);
}

export function recordBossKill(id) {
  return meta.recordBestiaryKill('bosses', id, BESTIARY_THRESHOLDS.bosses.unlock);
}

let initialized = false;

/**
 * Event-only integration keeps combat, UI, and storage independent. A future
 * enemy-spawn caller can use seeEnemy() without changing this module.
 */
export function initBestiary() {
  if (initialized) return;
  initialized = true;

  // Уже купленный/выбранный контент не должен снова выглядеть неизвестным
  // после миграции старого профиля.
  const shipWeapon = SHIPS[meta.save.ship]?.weapon;
  if (shipWeapon) discoverContent('weapons', shipWeapon, true);
  discoverContent('locations', 'open', true);
  for (const id of meta.save.weapons ?? []) discoverContent('weapons', id, true);
  for (const cardId of meta.save.perks ?? []) {
    const card = PERKS.find((item) => item.id === cardId);
    if (card?.ability) discoverContent('abilities', card.ability, true);
    else if (card && !card.weapon) discoverContent('perks', card.id, true);
  }

  on('enemy:killed', ({ enemy }) => recordEnemyKill(enemy?.type));
  on('enemy:seen', ({ enemy }) => seeEnemy(enemy?.type));
  on('boss:spawn', ({ boss, def }) => seeBoss(def?.id ?? boss?.boss));
  on('boss:killed', ({ boss }) => recordBossKill(boss?.boss));
  on('location:change', ({ to }) => discoverContent('locations', to, true));
  on('upgrade:taken', ({ card }) => {
    if (!card) return;
    if (card.weapon) discoverContent('weapons', card.weapon, true);
    else if (card.ability) discoverContent('abilities', card.ability, true);
    else discoverContent('perks', card.id, true);
  });
}
