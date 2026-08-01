import { bestiaryViewModel } from '../systems/bestiary.js';
import { navigationCapabilities } from '../systems/location-policy.js';
import { renderMapCanvas } from './mapscreen.js';
import { renderStatsInto } from './stats.js';

const TABS = Object.freeze([
  { id: 'map', label: 'КАРТА' },
  { id: 'stats', label: 'ХАРАКТЕРИСТИКИ' },
  { id: 'bestiary', label: 'БЕСТИАРИЙ' },
  { id: 'control', label: 'УПРАВЛЕНИЕ' },
]);
const CATEGORY_LABELS = Object.freeze({
  enemies: 'ВРАГИ', bosses: 'БОССЫ', locations: 'ЛОКАЦИИ',
  weapons: 'ОРУЖИЕ', perks: 'МОДУЛИ', abilities: 'СПОСОБНОСТИ',
});

let root;
let game;
let onResume = () => {};
let onQuit = () => {};
let lastTab = 'map';
let currentCategory = 'enemies';
let selectedId = null;

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function stateOf(entry) {
  if (!entry.seen) return { id: 'unknown', label: 'НЕ ВСТРЕЧЕНО' };
  if (entry.analysed || (!entry.thresholds && entry.unlocked)) return { id: 'analysed', label: 'ИЗУЧЕНО' };
  if (entry.unlocked) return { id: 'partial', label: 'ЧАСТИЧНО' };
  return { id: 'seen', label: 'УВИДЕНО' };
}

const identityKnown = (entry) => entry.seen && (!entry.thresholds || entry.unlocked);

function progressText(entry) {
  if (!entry.thresholds) return entry.unlocked ? 'ЗАПИСЬ ОТКРЫТА' : 'СИГНАТУРА ЗАМЕЧЕНА';
  const target = entry.analysed ? entry.thresholds.analyse : entry.thresholds.unlock;
  const label = entry.analysed ? 'АНАЛИЗ' : entry.unlocked ? 'ДО АНАЛИЗА' : 'ДО ИДЕНТИФИКАЦИИ';
  return `${label}: ${Math.min(entry.kills, target)} / ${target}`;
}

function closeMenu() {
  hideRunMenu();
  onResume();
}

function renderTabs() {
  root.tabs.replaceChildren();
  for (const tab of TABS) {
    const button = make('button', `run-menu-tab${tab.id === lastTab ? ' active' : ''}`, tab.label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(tab.id === lastTab));
    button.onclick = () => {
      lastTab = tab.id;
      selectedId = null;
      renderRunMenu();
    };
    root.tabs.appendChild(button);
  }
}

function renderCategories(groups) {
  root.categories.replaceChildren();
  for (const group of groups) {
    const button = make('button', `run-menu-category${group.id === currentCategory ? ' active' : ''}`);
    button.type = 'button';
    button.textContent = CATEGORY_LABELS[group.id] ?? group.label;
    button.setAttribute('aria-current', String(group.id === currentCategory));
    button.onclick = () => {
      currentCategory = group.id;
      selectedId = null;
      renderRunMenu();
    };
    const count = make('span', 'run-menu-category-count', `${group.entries.filter((entry) => entry.seen).length}/${group.entries.length}`);
    button.appendChild(count);
    root.categories.appendChild(button);
  }
}

function renderList(group) {
  root.list.replaceChildren();
  if (!group) return;
  for (const entry of group.entries) {
    const state = stateOf(entry);
    const button = make('button', `run-menu-record state-${state.id}${entry.id === selectedId ? ' active' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(entry.id === selectedId));
    button.setAttribute('aria-label', identityKnown(entry) ? `${entry.name}: ${state.label}` : `Неизвестная запись: ${state.label}`);
    button.onclick = () => {
      selectedId = entry.id;
      renderRunMenu();
    };
    button.append(
      make('span', 'run-menu-record-icon', entry.seen ? entry.icon : '◌'),
      make('span', 'run-menu-record-name', identityKnown(entry) ? entry.name : 'НЕИЗВЕСТНАЯ СИГНАТУРА'),
      make('span', 'run-menu-record-state', state.label),
    );
    root.list.appendChild(button);
  }
}

function detailLine(label, value, muted = false) {
  const row = make('div', `run-menu-detail-line${muted ? ' muted' : ''}`);
  row.append(make('span', '', label), make('b', '', value));
  return row;
}

function renderDetail(group) {
  root.detail.replaceChildren();
  root.screen.classList.toggle('detail-open', Boolean(selectedId));
  const entry = group?.entries.find((item) => item.id === selectedId);
  if (!entry) {
    const seen = group?.entries.filter((item) => item.seen).length ?? 0;
    root.detail.append(
      make('p', 'run-menu-detail-kicker', CATEGORY_LABELS[group?.id] ?? 'БЕСТИАРИЙ'),
      make('h3', 'run-menu-detail-title', 'ВЫБЕРИ ЗАПИСЬ'),
      make('p', 'run-menu-detail-copy', `${seen} из ${group?.entries.length ?? 0} сигнатур внесено в журнал.`),
    );
    return;
  }

  const state = stateOf(entry);
  const back = make('button', 'run-menu-back', '← К СПИСКУ');
  back.type = 'button';
  back.onclick = () => { selectedId = null; renderRunMenu(); };
  const identity = identityKnown(entry) ? entry.name : 'НЕИЗВЕСТНАЯ СИГНАТУРА';
  root.detail.append(
    back,
    make('p', 'run-menu-detail-kicker', CATEGORY_LABELS[group.id] ?? group.label),
    make('div', 'run-menu-detail-icon', entry.seen ? entry.icon : '◌'),
    make('h3', 'run-menu-detail-title', identity),
    make('p', `run-menu-detail-state state-${state.id}`, state.label),
    make('p', 'run-menu-detail-progress', progressText(entry)),
  );

  if (!entry.unlocked) {
    root.detail.append(make('p', 'run-menu-detail-copy', entry.seen
      ? 'Собери больше данных, чтобы открыть описание и защитные свойства.'
      : 'Сигнатура появится в журнале после первой встречи.'));
    return;
  }

  root.detail.append(make('p', 'run-menu-detail-copy', entry.description || 'Описание записи пока не получено.'));
  if (entry.protection) {
    const protection = make('div', 'run-menu-protection');
    protection.append(make('span', '', 'ЗАЩИТА'), make('p', '', entry.protection));
    root.detail.append(protection);
  }

  if (group.id === 'enemies' || group.id === 'bosses') {
    const resistance = make('div', 'run-menu-resistance');
    resistance.append(make('h4', '', 'СОПРОТИВЛЕНИЯ'));
    if (entry.analysed) {
      resistance.append(
        detailLine('ФИЗИЧЕСКОЕ', entry.physicalResist == null ? 'НЕТ' : `${entry.physicalResist}%`),
        detailLine('ТЕХНИЧЕСКОЕ', entry.technicalResist == null ? 'НЕТ' : `${entry.technicalResist}%`),
      );
    } else {
      const needed = Math.max(0, (entry.thresholds?.analyse ?? 0) - entry.kills);
      resistance.append(detailLine('ДАННЫЕ', `НУЖЕН АНАЛИЗ · ЕЩЁ ${needed}`, true));
    }
    root.detail.append(resistance);
  }
}

function renderActivePanel() {
  for (const [id, panel] of Object.entries(root.panels)) panel.hidden = id !== lastTab;
  root.screen.classList.toggle('detail-open', lastTab === 'bestiary' && Boolean(selectedId));

  if (lastTab === 'map') {
    const available = navigationCapabilities(game).map;
    root.mapCanvas.hidden = !available;
    root.mapUnavailable.hidden = available;
    if (available) renderMapCanvas(root.mapCanvas);
  } else if (lastTab === 'stats') {
    renderStatsInto(game, root.statsColumns, root.statsModules);
  }
}

export function renderRunMenu() {
  if (!root) return;
  renderTabs();
  if (lastTab === 'bestiary') {
    const groups = bestiaryViewModel();
    if (!groups.some((group) => group.id === currentCategory)) currentCategory = groups[0]?.id ?? 'enemies';
    const group = groups.find((item) => item.id === currentCategory);
    if (selectedId && !group?.entries.some((entry) => entry.id === selectedId)) selectedId = null;
    renderCategories(groups);
    renderList(group);
    renderDetail(group);
  }
  renderActivePanel();
}

export function initRunMenu({ game: activeGame, onResume: resume, onQuit: quit } = {}) {
  if (root) return;
  game = activeGame;
  onResume = resume ?? onResume;
  onQuit = quit ?? onQuit;
  root = {
    screen: document.getElementById('screen-run-menu'),
    tabs: document.getElementById('run-menu-tabs'),
    categories: document.getElementById('run-menu-categories'),
    list: document.getElementById('run-menu-list'),
    detail: document.getElementById('run-menu-detail'),
    close: document.getElementById('btn-run-menu-close'),
    mapCanvas: document.getElementById('run-menu-map-canvas'),
    mapUnavailable: document.getElementById('run-menu-map-unavailable'),
    statsColumns: document.getElementById('run-menu-stats-columns'),
    statsModules: document.getElementById('run-menu-stats-modules'),
    controlResume: document.getElementById('btn-run-menu-resume'),
    controlQuit: document.getElementById('btn-run-menu-quit'),
    panels: {
      map: document.getElementById('run-menu-map'),
      stats: document.getElementById('run-menu-stats'),
      bestiary: document.getElementById('run-menu-bestiary'),
      control: document.getElementById('run-menu-control'),
    },
  };
  root.close.onclick = closeMenu;
  root.controlResume.onclick = closeMenu;
  root.controlQuit.onclick = () => {
    hideRunMenu();
    onQuit();
  };
}

export function showRunMenu(tab = lastTab) {
  if (!root) return false;
  if (TABS.some((item) => item.id === tab)) lastTab = tab;
  root.screen.hidden = false;
  renderRunMenu();
  root.close.focus();
  return true;
}

export function hideRunMenu() {
  if (!root) return;
  root.screen.hidden = true;
  root.screen.classList.remove('detail-open');
}

export const isRunMenuOpen = () => Boolean(root && !root.screen.hidden);
