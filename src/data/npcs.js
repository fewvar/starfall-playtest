/**
 * NPC И ИХ УСЛУГИ — путь СВЯЗЕЙ к третьей концовке (Notes/PLAYTEST_NOTES_2.md §3).
 *
 * Тут только данные: кто такие, что просят, чем торгуют. Вся логика —
 * в systems/npcs.js, размещение сделано по образцу systems/stations.js.
 *
 * Услуга — это гибрид: шаблон из этого файла задаёт СТРУКТУРУ (что делать,
 * как проваливается, сколько репутации), а конкретика (какой NPC, какой
 * груз, какой босс, сколько обломков) выбирается на забег от run.seed.
 */

/** Сколько услуг открывают путь СВЯЗЕЙ. Порог фиксированный, не доля. */
export const REPUTATION_GOAL = 5;

/** Столько NPC расставляется по тору, по образцу станций. */
export const NPC_COUNT_MIN = 5;
export const NPC_COUNT_MAX = 14;

/** Ближе этого к дому NPC не появляются — там стартовая зона. */
export const NPC_MIN_HOME_CHUNKS = 3;
export const NPC_MIN_GAP_CHUNKS = 3;

/** Радиусы: разговор — вплотную, обнаружение — как у станций, издалека. */
export const NPC_TALK_RADIUS = 190;
export const NPC_DISCOVERY_MIN_RADIUS = 1500;

/** NPC не бессмертны, но и не картонные: волна должна успеть быть замеченной. */
export const NPC_HP = 420;

/** Коллекторы за провал: как часто и сколько. */
export const COLLECTOR_INTERVAL = 90;
export const COLLECTOR_COUNT = 2;

/**
 * ЛИЦА. Отличаются только подачей — механически все NPC одинаковы: любой
 * даёт услугу и торгует. Разные архетипы нужны, чтобы карта не выглядела
 * как пять клонов, и чтобы у реплик был характер.
 */
export const NPC_KINDS = [
  {
    id: 'courier', name: 'КУРЬЕР', icon: '⊳', color: '#7ee8ff',
    line: 'Маршрут забит, а груз ждать не будет. Возьмёшь?',
  },
  {
    id: 'mechanic', name: 'МЕХАНИК', icon: '⊕', color: '#5ef0d0',
    line: 'Руки заняты, а дело стоит. Поможешь — сочтёмся.',
  },
  {
    id: 'trader', name: 'ТОРГОВЕЦ', icon: '◈', color: '#ffc14a',
    line: 'Товар редкий, цена честная. И услуга есть, если интересно.',
  },
  {
    id: 'archivist', name: 'АРХИВАРИУС', icon: '⌘', color: '#c99bff',
    line: 'Я собираю то, что остальные теряют. Принесёшь — запишу за тобой.',
  },
];

export const npcKindById = Object.fromEntries(NPC_KINDS.map((k) => [k.id, k]));

/**
 * ШАБЛОНЫ УСЛУГ.
 *
 *   kind      — какая логика ведёт услугу (systems/npcs.js)
 *   weight    — насколько часто шаблон достаётся NPC при генерации
 *   reward    — обломки за выполнение сверх репутации
 *
 * Провала по таймеру нет ни у одного шаблона: часы конфликтовали бы
 * с исследованием карты. Провал всегда событийный.
 */
export const SERVICES = [
  {
    kind: 'deliver', weight: 3, reward: 90,
    name: 'ДОСТАВКА',
    /** Груз занимает трюм: пока он у игрока, его можно потерять. */
    desc: (ctx) => `Довезти груз: ${ctx.targetName} · ${ctx.targetLocation}`,
    fail: 'Груз потерян — доставка провалена',
  },
  {
    kind: 'defend', weight: 2, reward: 110,
    name: 'ПРИКРЫТИЕ',
    desc: () => 'Продержать волну прямо здесь, не дав добить самого NPC',
    fail: 'NPC не выжил — прикрытие провалено',
  },
  {
    kind: 'bounty', weight: 2, reward: 140,
    name: 'ЗАКАЗ',
    desc: (ctx) => `Принести трофей с босса «${ctx.bossName}»`,
    fail: 'Заказчик мёртв — заказ провален',
  },
  {
    kind: 'tribute', weight: 2, reward: 0,
    name: 'ВЗНОС',
    desc: (ctx) => `Отдать ${ctx.amount} обломков`,
    fail: 'Заказчик мёртв — взнос некому отдавать',
  },
];

export const serviceByKind = Object.fromEntries(SERVICES.map((s) => [s.kind, s]));

/**
 * ТОВАР. Ничего из этого нет ни в ангаре, ни в пуле карточек — магазин NPC
 * должен быть отдельным источником контента, а не вторым входом в те же
 * покупки. Цена — в обломках текущего забега.
 */
export const SHOP_STOCK = [
  {
    id: 'shop-slot', icon: '⌸', name: 'РАСШИРИТЕЛЬ СЛОТОВ', price: 320,
    desc: '+1 слот активной способности',
    apply: (p) => { p.abilitySlots += 1; },
  },
  {
    id: 'shop-armor', icon: '▤', name: 'ТРОФЕЙНАЯ БРОНЯ', price: 240,
    desc: '+3 очка брони — снижает весь входящий урон',
    apply: (p) => { p.armorPoints = (p.armorPoints ?? 0) + 3; },
  },
  {
    id: 'shop-reroll', icon: '⟳', name: 'ПОДБОРКА', price: 150,
    desc: '+3 переброса карточек до конца забега',
    apply: (p) => { p.rerolls += 3; },
  },
  {
    id: 'shop-hull', icon: '▣', name: 'КОНТРАБАНДНЫЙ КОРПУС', price: 260,
    desc: '+70 к максимуму корпуса и полный ремонт',
    apply: (p) => { p.maxHp += 70; p.hp = p.maxHp; },
  },
  {
    id: 'shop-charts', icon: '⌖', name: 'ЧУЖИЕ КАРТЫ', price: 180,
    desc: 'Открывает на карте все станции и всех NPC забега',
    reveal: true,
    apply: () => {},
  },
];

export const shopItemById = Object.fromEntries(SHOP_STOCK.map((i) => [i.id, i]));
