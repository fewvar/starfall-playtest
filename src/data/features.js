/**
 * Реальные механики билда, на которые могут ссылаться карточки.
 *
 * Это не теги склонности: тег лишь меняет вес карточки, а feature означает,
 * что у текущего игрока уже есть работающий источник соответствующей механики.
 */
export const BUILD_FEATURES = Object.freeze([
  'dash',
  'ability',
  'orbital',
  'aura',
  'drone',
  'spawner',
  'mine',
  'mineTrail',
  'split',
  'chain',
  'burn',
  'poison',
  'freeze',
  'mark',
  'shield',
  'shieldRegen',
  // Радиус меняется только у взрывных снарядов (weapon.splash / «Фугасы»).
  'blastRadius',
  // Общие радиальные пути blastFriendly/perkBlast поддерживают «Ледяную волну».
  'friendlyBlast',
]);

export const BUILD_FEATURE_SET = new Set(BUILD_FEATURES);
