import { GLOSSARY, GLOSSARY_BY_ID } from '../data/glossary.js';

const formToTerm = new Map();
for (const term of GLOSSARY) {
  for (const form of term.forms) {
    const key = form.toLocaleLowerCase('ru-RU');
    if (!formToTerm.has(key)) formToTerm.set(key, term);
  }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternatives = [...formToTerm.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');
const termPattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${alternatives})(?![\\p{L}\\p{N}_])`, 'giu');

const documentStates = new WeakMap();

function getTermFromTarget(target) {
  return target?.nodeType === 1 ? target.closest('.game-term') : null;
}

function positionTooltip(state, target) {
  const box = target.getBoundingClientRect();
  const tip = state.tooltip;
  const viewport = state.doc.defaultView;
  const pad = 12;
  const gap = 9;
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  const viewWidth = viewport?.innerWidth ?? state.doc.documentElement.clientWidth;
  const viewHeight = viewport?.innerHeight ?? state.doc.documentElement.clientHeight;
  const left = Math.max(pad, Math.min(viewWidth - width - pad, box.left + box.width / 2 - width / 2));
  const above = box.top - height - gap;
  const top = above >= pad ? above : Math.min(viewHeight - height - pad, box.bottom + gap);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(Math.max(pad, top))}px`;
}

function showFor(state, target) {
  const term = GLOSSARY_BY_ID[target?.dataset.term];
  if (!term) return;
  state.active = target;
  state.title.textContent = term.title;
  state.definition.textContent = term.definition;
  state.tooltip.hidden = false;
  positionTooltip(state, target);
}

function hideState(state) {
  state.active = null;
  state.tooltip.hidden = true;
}

function cycleScreenFocus(doc, backwards) {
  // Tab остаётся боевой клавишей на экране характеристик и в самом забеге.
  // На остальных открытых DOM-экранах возвращаем обычную клавиатурную
  // навигацию, которую глобальный обработчик игры иначе блокирует.
  const screen = [...doc.querySelectorAll('.screen:not([hidden])')]
    .find((node) => node.id !== 'screen-stats');
  if (!screen || !screen.querySelector('.game-term')) return false;
  const focusable = [...screen.querySelectorAll(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((node) => !node.closest('[hidden]'));
  if (!focusable.length) return false;
  const current = focusable.indexOf(doc.activeElement);
  const next = backwards
    ? (current <= 0 ? focusable.length - 1 : current - 1)
    : (current < 0 || current === focusable.length - 1 ? 0 : current + 1);
  focusable[next].focus();
  return true;
}

function moveStatsTermFocus(doc, direction) {
  const screen = doc.getElementById('screen-stats');
  if (!screen || screen.hidden) return false;
  const terms = [...screen.querySelectorAll('.game-term')];
  if (!terms.length) return false;
  const current = terms.indexOf(doc.activeElement);
  const next = current < 0
    ? (direction > 0 ? 0 : terms.length - 1)
    : (current + direction + terms.length) % terms.length;
  terms[next].focus();
  return true;
}

/** Создаёт один tooltip на документ и делегирует события динамическому UI. */
export function initTermTooltips(doc = document) {
  if (documentStates.has(doc)) return documentStates.get(doc).tooltip;

  const tooltip = doc.createElement('div');
  tooltip.id = 'game-term-tooltip';
  tooltip.className = 'game-term-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;

  const title = doc.createElement('strong');
  title.className = 'game-term-tooltip-title';
  const definition = doc.createElement('span');
  definition.className = 'game-term-tooltip-definition';
  tooltip.append(title, definition);
  doc.body.appendChild(tooltip);

  const state = { doc, tooltip, title, definition, active: null };
  documentStates.set(doc, state);

  doc.addEventListener('mouseover', (event) => {
    const target = getTermFromTarget(event.target);
    if (target) showFor(state, target);
  });
  doc.addEventListener('mouseout', (event) => {
    const target = getTermFromTarget(event.target);
    if (!target || target.contains(event.relatedTarget)) return;
    if (doc.activeElement !== target) hideState(state);
  });
  doc.addEventListener('focusin', (event) => {
    const target = getTermFromTarget(event.target);
    if (target) showFor(state, target);
  });
  doc.addEventListener('focusout', (event) => {
    const target = getTermFromTarget(event.target);
    if (target && !target.contains(event.relatedTarget)) hideState(state);
  });
  doc.addEventListener('keydown', (event) => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp')
      && moveStatsTermFocus(doc, event.key === 'ArrowDown' ? 1 : -1)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Tab' && cycleScreenFocus(doc, event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape' && !tooltip.hidden) {
      event.preventDefault();
      event.stopPropagation();
      hideState(state);
    }
  }, true);
  doc.addEventListener('scroll', () => hideState(state), true);
  doc.defaultView?.addEventListener('resize', () => hideState(state));

  return tooltip;
}

export function hideTermTooltip(doc = document) {
  const state = documentStates.get(doc);
  if (state) hideState(state);
}

function shouldSkip(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  if (['SCRIPT', 'STYLE', 'TEXTAREA', 'OPTION'].includes(parent.tagName)) return true;
  return Boolean(parent.closest('.game-term, .game-term-tooltip, [data-no-terms]'));
}

function termSpan(doc, text, term) {
  const span = doc.createElement('span');
  span.className = 'game-term';
  span.tabIndex = 0;
  span.dataset.term = term.id;
  span.setAttribute('aria-describedby', 'game-term-tooltip');
  span.textContent = text;
  // Карточки и строки ангара сами кликабельны: открытие подсказки не должно
  // случайно выбирать карточку или покупать улучшение.
  span.addEventListener('pointerdown', (event) => event.stopPropagation());
  span.addEventListener('click', (event) => event.stopPropagation());
  return span;
}

/**
 * Оборачивает только точные словоформы в текстовых узлах указанного контейнера.
 * Существующая HTML-разметка сохраняется; уже обработанные термины не трогаются.
 */
export function decorateTerms(container) {
  if (!container?.ownerDocument) return 0;
  const doc = container.ownerDocument;
  initTermTooltips(doc);
  const nodeFilter = doc.defaultView?.NodeFilter ?? NodeFilter;
  const walker = doc.createTreeWalker(container, nodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) {
    if (!shouldSkip(walker.currentNode) && termPattern.test(walker.currentNode.nodeValue)) {
      textNodes.push(walker.currentNode);
    }
    termPattern.lastIndex = 0;
  }

  let count = 0;
  for (const node of textNodes) {
    const text = node.nodeValue;
    const fragment = doc.createDocumentFragment();
    let cursor = 0;
    termPattern.lastIndex = 0;
    for (const match of text.matchAll(termPattern)) {
      if (match.index > cursor) fragment.append(doc.createTextNode(text.slice(cursor, match.index)));
      const visible = match[0];
      const term = formToTerm.get(visible.toLocaleLowerCase('ru-RU'));
      if (term) {
        fragment.append(termSpan(doc, visible, term));
        count++;
      } else {
        fragment.append(doc.createTextNode(visible));
      }
      cursor = match.index + visible.length;
    }
    if (cursor < text.length) fragment.append(doc.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  }
  termPattern.lastIndex = 0;
  return count;
}
