/**
 * ТЕГИ И СИНЕРГИИ.
 *
 * Модель Nova Drift: мощная карта открывается не «после карты X», а после
 * того, как набрано достаточно ИСТОЧНИКОВ нужного типа. При случайной раздаче
 * это единственный способ сделать надёжные условия — конкретная карта может
 * не выпасть за весь забег, а три карты одного направления выпадут почти всегда.
 *
 * Каждый перк, ствол и корабль несёт 1-2 тега. Уровень карты считается
 * за столько же источников: взял «Усилитель» трижды — три источника kinetic.
 */

export const TAGS = {
  kinetic:   'КИНЕТИКА',
  energy:    'ЭНЕРГИЯ',
  explosive: 'ВЗРЫВЫ',
  chain:     'ЦЕПИ',
  homing:    'НАВЕДЕНИЕ',
  pierce:    'ПРОБИТИЕ',
  crit:      'КРИТ',
  swarm:     'РОЙ',
  drone:     'ДРОНЫ',
  orbital:   'ОРБИТА',
  mine:      'МИНЫ',
  status:    'СТАТУСЫ',
  defense:   'ЗАЩИТА',
  speed:     'СКОРОСТЬ',
  lifesteal: 'ВАМПИРИЗМ',
  luck:      'УДАЧА',
  ability:   'АКТИВКИ',
  burst:     'ЗАЛП',
  sustain:   'ВОССТАНОВЛЕНИЕ',
};

export const TAG_IDS = Object.keys(TAGS);

/** Пустой счётчик — лежит в игроке и обновляется при взятии карты. */
export const createTagState = () => Object.create(null);

/** Учесть взятие карты: каждый уровень добавляет по источнику на каждый тег. */
export function addTags(player, tags) {
  if (!tags?.length) return;
  const state = player.tags;
  for (const tag of tags) state[tag] = (state[tag] ?? 0) + 1;
}

export const tagCount = (player, tag) => player.tags[tag] ?? 0;

/** Выполнены ли требования вида { energy: 3, crit: 2 }. */
export function meetsTags(player, requirements) {
  for (const [tag, need] of Object.entries(requirements)) {
    if (tagCount(player, tag) < need) return false;
  }
  return true;
}

/**
 * Насколько карта «по билду»: доля её тегов, которые игрок уже собирает.
 * Используется в progression.js для уклона пула — билд собирается сам,
 * но не превращается в рельсы, потому что множитель ограничен сверху.
 */
export function tagAffinity(player, tags) {
  if (!tags?.length) return 0;
  let matched = 0;
  for (const tag of tags) if (tagCount(player, tag) > 0) matched++;
  return matched / tags.length;
}

/** Самые набранные направления — для панели характеристик. */
export function topTags(player, limit = 5) {
  return Object.entries(player.tags)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => ({ id, name: TAGS[id] ?? id, count }));
}
