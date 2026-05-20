'use strict';

// ============================================================
// State
// ============================================================
const DATA = window.__DATA__;
const CRITERIA = DATA.criteria;
const CITIES = DATA.cities;
const SOURCES = DATA.sources;
const TIER_WEIGHTS = DATA.tier_weights;

// ── Suggested weights ────────────────────────────────────────────────────────
// The recommended baseline lives in suggested-weights.js (keyed by readable
// criterion name, with comments). The Ranking tab starts here, and "Reset
// weights" returns here. Any criterion omitted — or with an unrecognised name —
// falls back to 1.
const DEFAULT_WEIGHTS = (function () {
  const labelToSlug = Object.fromEntries(CRITERIA.map(c => [c.label, c.slug]));
  const slugSet = new Set(CRITERIA.map(c => c.slug));
  const provided = (window.SUGGESTED_WEIGHTS && typeof window.SUGGESTED_WEIGHTS === 'object')
    ? window.SUGGESTED_WEIGHTS : {};
  const bySlug = {};
  for (const [key, val] of Object.entries(provided)) {
    const slug = labelToSlug[key] || (slugSet.has(key) ? key : null);
    if (slug && typeof val === 'number') bySlug[slug] = val;
    else if (!slug) console.warn('suggested-weights.js: unrecognised criterion "' + key + '"');
  }
  return Object.fromEntries(CRITERIA.map(c => [c.slug, bySlug[c.slug] ?? 1]));
})();

// Cities pre-selected in the Ranking tab's "Select cities" control on a first
// visit. A returning visitor's saved selection in localStorage overrides this.
const DEFAULT_RANK_CITIES = [
  'medellin', 'mexico-city', 'porto', 'buenos-aires', 'guadalajara',
  'valencia', 'tirana', 'chiang-mai', 'bali-ubud', 'kuala-lumpur',
  'sofia', 'da-nang', 'jakarta',
];

const State = {
  weights: { ...DEFAULT_WEIGHTS },
  rankCities: new Set(DEFAULT_RANK_CITIES.filter(id => CITIES.some(c => c.id === id))),
  compareCities: [],
  compareCritSort: 'original', // original | spread | maxscore | name
  rankMode: 'weighted',        // raw | weighted (driven by the shared "Weight-adjusted" toggle, used by Ranking / Compare / City detail)
  costAdjusted: true,          // master on/off for the cost (value-per-$) layer
  costK: window.SUGGESTED_K ?? 1.0,  // cost-sensitivity exponent — default from suggested-weights.js (applies only when costAdjusted)
  housingMode: 'shared',       // single (1BR) | shared (4BR split 4 ways)
  cityDetail: CITIES[0]?.id,
  sourceQuery: '',
  sourceTier: 'all',
  citySearch: '',
  myPicks: [],           // ordered array of city ids
  myNotes: {},           // {city_id: "freeform notes"}
  cityCritSort: null,    // contribution | score | name
  openSections: new Set(['weights', 'export']),  // <details> blocks that survived across renders
};

// Load persisted state
try {
  const saved = localStorage.getItem('weights');
  if (saved) {
    const obj = JSON.parse(saved);
    for (const k of Object.keys(DEFAULT_WEIGHTS)) {
      if (typeof obj[k] === 'number') State.weights[k] = obj[k];
    }
  }
  const savedCities = localStorage.getItem('rankCities');
  if (savedCities) {
    const arr = JSON.parse(savedCities);
    if (Array.isArray(arr) && arr.length) State.rankCities = new Set(arr);
  }
  const savedPicks = localStorage.getItem('myPicks');
  if (savedPicks) {
    const arr = JSON.parse(savedPicks);
    if (Array.isArray(arr)) State.myPicks = arr.filter(id => CITIES.some(c => c.id === id));
  }
  const savedNotes = localStorage.getItem('myNotes');
  if (savedNotes) {
    const obj = JSON.parse(savedNotes);
    if (obj && typeof obj === 'object') State.myNotes = obj;
  }
  const savedOpen = localStorage.getItem('openSections');
  if (savedOpen) {
    const arr = JSON.parse(savedOpen);
    if (Array.isArray(arr)) State.openSections = new Set(arr);
  }
  const savedK = localStorage.getItem('costK');
  if (savedK != null) {
    const n = parseFloat(savedK);
    if (!isNaN(n)) State.costK = Math.max(0, Math.min(1, Math.round(n * 10) / 10));
  }
  const savedHousing = localStorage.getItem('housingMode');
  if (savedHousing === 'single' || savedHousing === 'shared') State.housingMode = savedHousing;
  const savedCA = localStorage.getItem('costAdjusted');
  if (savedCA != null) State.costAdjusted = savedCA === '1';
} catch {}

// ============================================================
// Helpers
// ============================================================
const $ = sel => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e[k] = v;
    else if (k === 'dataset' && typeof v === 'object') Object.assign(e.dataset, v);
    else if (v != null && v !== false) e.setAttribute(k, v);
  }
  function appendChild(kk) {
    if (kk == null || kk === false) return;
    if (typeof kk === 'string' || typeof kk === 'number') e.appendChild(document.createTextNode(String(kk)));
    else if (kk instanceof Node) e.appendChild(kk);
  }
  for (const k of kids) {
    if (Array.isArray(k)) k.forEach(appendChild);
    else appendChild(k);
  }
  return e;
};
const fmt = n => n == null ? '—' : (Math.round(n * 10) / 10).toString();
const escapeHtml = s => (s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

// Semantics for every badge/chip/pill — surfaced via native `title` tooltips
const SCORE_DESCRIPTIONS = {
  1: 'severe weakness — disqualifying',
  2: 'severe weakness',
  3: 'significant weakness',
  4: 'below midpoint',
  5: 'midpoint — acceptable with caveats',
  6: 'workable',
  7: 'good',
  8: 'strong',
  9: 'excellent',
  10: 'best-in-set',
};
const SRC_TIER_DESCRIPTIONS = {
  1: 'Tier 1 — primary government / academic / NGO source',
  2: 'Tier 2 — reputable news, well-curated wiki, official press',
  3: 'Tier 3 — mid-quality industry data',
  4: 'Tier 4 — aggregated user reports (Numbeo, Nomadlist, Reddit)',
  5: 'Tier 5 — SEO content / content farms (downgraded)',
};
const FLAG_DESCRIPTIONS = [
  { match: '✓ primary', text: 'Confirmed from a primary source' },
  { match: '✓ cross-checked', text: 'Verified against 2+ independent sources' },
  { match: '⚠ verify', text: 'Recommend re-checking — time-sensitive or sparse coverage' },
  { match: '⚠ reduced confidence', text: 'Sources weaker than ideal, treat as directional' },
  { match: '⚠ unverified', text: 'Single source, not yet independently confirmed' },
];

// Chip/pill/badge helpers — plain rendering, no tooltips. Meaning is documented
// once in the Quick legend (header) and the Methodology tab. Removing per-cell
// tooltips eliminates the noise of hovering anywhere triggering a popover.
function scoreChip(score) {
  if (score == null || isNaN(score)) return el('span', { class: 's-chip s-na' }, '—');
  const r = Math.max(1, Math.min(10, Math.round(score)));
  return el('span', { class: 's-chip s-' + r }, fmt(score));
}
function srcTierBadge(tier) {
  if (tier == null) return el('span', { class: 'src-tier src-untiered' }, '?');
  return el('span', { class: 'src-tier src-t' + tier }, 'T' + tier);
}
function flagBadge(flagStr) {
  let cls = 'flag';
  if (flagStr.includes('✓')) cls += ' flag-good';
  else if (flagStr.includes('⚠')) cls += ' flag-warn';
  return el('span', { class: cls }, flagStr);
}


function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1400);
}

function persistOpenSections() {
  try { localStorage.setItem('openSections', JSON.stringify([...State.openSections])); } catch {}
}

// Collapsible <details> that remembers its open state across re-renders
function detailsBlock(id, summary, ...kids) {
  const open = State.openSections.has(id);
  const props = open ? { open: 'open' } : {};
  const d = el('details', props, el('summary', {}, summary), ...kids);
  d.addEventListener('toggle', () => {
    if (d.open) State.openSections.add(id);
    else State.openSections.delete(id);
    persistOpenSections();
  });
  return d;
}

// Star toggle for My picks — used in tables and column headers
function pickStar(cityId, opts = {}) {
  const inPicks = State.myPicks.includes(cityId);
  return el('span', {
    class: 'pick-star' + (inPicks ? ' on' : '') + (opts.compact ? ' compact' : ''),
    'data-tip': inPicks ? 'In My picks — click to remove' : 'Add to My picks',
    onclick: (ev) => {
      ev.stopPropagation();
      if (inPicks) State.myPicks = State.myPicks.filter(x => x !== cityId);
      else State.myPicks.push(cityId);
      persistMyPicks();
      render();
    },
  }, inPicks ? '★' : '☆');
}

// Custom tooltip system — instant show, no native-title delay. Reads `data-tip` (preferred) or `title`.
// Keeps `title` set so screen-reader users still get the text; we just don't let the browser render it visually.
const Tooltip = (function () {
  const pop = document.createElement('div');
  pop.className = 'tooltip-popover';
  pop.setAttribute('role', 'tooltip');
  document.body.appendChild(pop);
  let active = null;
  function show(target) {
    const text = target.dataset.tip || target.getAttribute('title') || target.getAttribute('aria-label');
    if (!text) return;
    // Suppress native flash by stashing title temporarily
    if (target.hasAttribute('title')) {
      target.dataset._tipTitle = target.getAttribute('title');
      target.removeAttribute('title');
    }
    pop.textContent = text;
    pop.style.display = 'block';
    // Position: prefer above; fall back to below if not enough room
    const rect = target.getBoundingClientRect();
    pop.classList.remove('below');
    const popH = pop.offsetHeight;
    const popW = pop.offsetWidth;
    let top = rect.top - popH - 8;
    let left = rect.left + rect.width / 2 - popW / 2;
    if (top < 8) {
      top = rect.bottom + 8;
      pop.classList.add('below');
    }
    if (left < 8) left = 8;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    requestAnimationFrame(() => pop.classList.add('show'));
    active = target;
  }
  function hide() {
    pop.classList.remove('show');
    if (active && active.dataset._tipTitle) {
      active.setAttribute('title', active.dataset._tipTitle);
      delete active.dataset._tipTitle;
    }
    active = null;
  }
  document.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-tip], [title]');
    if (!t || t === active) return;
    if (active) hide();
    show(t);
  });
  document.addEventListener('mouseout', e => {
    // Hide when the mouse leaves the active element (or any descendant) for somewhere outside it.
    // Can't use `closest('[title]')` here because show() removed the title attribute to suppress
    // the native tooltip flash — that match would fail and the popover would stick.
    if (!active) return;
    if (active.contains(e.target) && !active.contains(e.relatedTarget)) hide();
  });
  document.addEventListener('scroll', hide, true);
  document.addEventListener('click', hide, true);
  return { hide };
})();

function setHash(h) { history.replaceState(null, '', h); }

// Sort state (per logical table key)
const SortState = {};
function getSort(key, defaultCol, defaultDir = 'desc') {
  if (!SortState[key]) SortState[key] = { col: defaultCol, dir: defaultDir };
  return SortState[key];
}
function applySort(key, list, sortDescriptors) {
  const s = getSort(key, sortDescriptors[0].col, sortDescriptors[0].dir);
  const desc = sortDescriptors.find(d => d.col === s.col) || sortDescriptors[0];
  const sign = s.dir === 'asc' ? 1 : -1;
  return list.slice().sort((a, b) => {
    const va = desc.get(a), vb = desc.get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;       // nulls always last
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return sign * (va - vb);
    return sign * String(va).localeCompare(String(vb));
  });
}
function sortHeaderRow(key, cols, onChange, defaultCol, defaultDir = 'desc') {
  // cols: [{label, sortKey, defaultDir, title}]
  const firstSortable = cols.find(c => c.sortKey);
  const s = getSort(key, defaultCol || firstSortable?.sortKey, defaultDir);
  return el('tr', {}, ...cols.map(c => {
    if (!c.sortKey) return el('th', { title: c.title || '' }, c.label);
    const isSorted = s.col === c.sortKey;
    const cls = 'sortable' + (isSorted ? (s.dir === 'asc' ? ' sorted-asc' : ' sorted-desc') : '');
    return el('th', {
      class: cls,
      title: c.title || 'Click to sort',
      onclick: () => {
        if (s.col === c.sortKey) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
        else { s.col = c.sortKey; s.dir = c.defaultDir || 'desc'; }
        onChange();
      },
    }, c.label);
  }));
}

// ============================================================
// Weighted ranking
// ============================================================
function rankCities(weights) {
  const maxScore = CRITERIA.reduce((s, c) => s + (weights[c.slug] || 0) * 10, 0);
  const list = CITIES.map(city => {
    let total = 0;
    let counted = 0;
    for (const c of CRITERIA) {
      const w = weights[c.slug] || 0;
      if (w === 0) continue;
      const s = city.scores[c.slug];
      if (s == null || isNaN(s)) continue;
      total += s * w;
      counted++;
    }
    return { city, total, counted };
  });
  list.sort((a, b) => b.total - a.total);
  return { list, maxScore };
}

// ============================================================
// Cost model — burn → multiplier → final score
// ============================================================
// Cost is a multiplier on weighted quality ("value per dollar"), not a weighted
// criterion. See Methodology Section G.
const MULT_MIN = 0.5, MULT_MAX = 2.0;

// Monthly housing rent for the active housing mode.
function cityRent(city, mode = State.housingMode) {
  const cb = city.cost_basis || {};
  return mode === 'shared' ? cb.rent_4br_pp : cb.rent_1br;
}
// Monthly burn = comfortable non-housing basket + housing rent.
function cityBurn(city, mode = State.housingMode) {
  const cb = city.cost_basis || {};
  return (cb.basket_comfortable || 0) + (cityRent(city, mode) || 0);
}
// Median burn over ALL cities (never the filtered subset), for the active mode.
function medianBurn(mode = State.housingMode) {
  const burns = CITIES.map(c => cityBurn(c, mode)).filter(b => b > 0).sort((a, b) => a - b);
  if (!burns.length) return 0;
  const m = Math.floor(burns.length / 2);
  return burns.length % 2 ? burns[m] : (burns[m - 1] + burns[m]) / 2;
}
// Cost multiplier: clamp( (median_burn / burn) ^ k , 0.5, 2.0 ).
// k = 0 → multiplier = 1 for every city (cost ignored).
function costMultiplier(city, k = State.costK, mode = State.housingMode, medBurn = null) {
  if (k === 0) return 1;
  const burn = cityBurn(city, mode);
  if (!burn) return 1;
  const med = medBurn != null ? medBurn : medianBurn(mode);
  if (!med) return 1;
  const raw = Math.pow(med / burn, k);
  return Math.max(MULT_MIN, Math.min(MULT_MAX, raw));
}

// ============================================================
// Weight URL encoding
// ============================================================
function encodeWeights(weights) {
  // Compact form: only deltas from default
  const parts = [];
  for (const c of CRITERIA) {
    const w = weights[c.slug];
    if (w !== c.default_weight) parts.push(`${c.slug}:${w}`);
  }
  return parts.join(',');
}
function decodeWeights(s) {
  const out = { ...DEFAULT_WEIGHTS };
  if (!s) return out;
  for (const p of s.split(',')) {
    const [k, v] = p.split(':');
    if (k in DEFAULT_WEIGHTS) {
      const n = parseFloat(v);
      if (!isNaN(n)) out[k] = Math.max(0, Math.min(10, Math.round(n * 10) / 10));
    }
  }
  return out;
}

// ============================================================
// Router
// ============================================================
function parseRoute() {
  const h = location.hash || '#/rank';
  const [path, query] = h.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query || '');
  return { tab: parts[0] || 'rank', arg: parts[1] || null, params };
}

function go(tab, arg, params) {
  let hash = '#/' + tab;
  if (arg) hash += '/' + arg;
  if (params) {
    const s = params.toString();
    if (s) hash += '?' + s;
  }
  location.hash = hash;
}

// On hashchange (navigation OR external URL paste), pull URL params into State.
// Inside render() we DON'T read from URL — that would clobber mutations from clicks.
function initStateFromURL() {
  const { tab, params } = parseRoute();
  if (tab === 'rank') {
    const urlW = params.get('w');
    if (urlW) State.weights = decodeWeights(urlW);
    const urlSubset = params.get('only');
    if (urlSubset) State.rankCities = new Set(urlSubset.split(','));
    const urlCs = params.get('cs');
    if (urlCs != null) {
      const n = parseFloat(urlCs);
      if (!isNaN(n)) { State.costK = Math.max(0, Math.min(1, Math.round(n * 10) / 10)); persistCostK(); }
    }
    const urlHm = params.get('hm');
    if (urlHm === 'single' || urlHm === 'shared') { State.housingMode = urlHm; persistHousingMode(); }
  } else if (tab === 'compare') {
    const cities = params.get('cities');
    if (cities) State.compareCities = cities.split(',').filter(s => CITIES.some(c => c.id === s));
  } else if (tab === 'mypicks') {
    const picks = params.get('picks');
    if (picks) {
      const ids = picks.split(',').filter(id => CITIES.some(c => c.id === id));
      if (ids.length) { State.myPicks = ids; persistMyPicks(); }
    }
  }
}
window.addEventListener('hashchange', () => { initStateFromURL(); render(); });
// First load: pull URL → state, then render
initStateFromURL();

// ============================================================
// Render: ranking
// ============================================================
// Returns the weights actually used for ranking. In Raw mode every criterion
// counts equally (×1), regardless of what's on the weight sliders — the user's
// custom weights are preserved but not applied.
function effectiveRankWeights() {
  if (State.rankMode === 'raw') {
    return Object.fromEntries(CRITERIA.map(c => [c.slug, 1]));
  }
  return State.weights;
}

// The cost exponent actually in effect: 0 when the "Cost-adjusted" toggle is off
// (cost ignored entirely), otherwise the cost-sensitivity slider value.
function effectiveCostK() {
  return State.costAdjusted ? State.costK : 0;
}

// Attaches the cost layer to a quality-ranked list: burn, cost multiplier, and
// final = weighted_quality × multiplier. Re-sorts by `final`.
// medianBurn is computed over ALL cities for the active mode, not the subset.
function applyCostLayer(list) {
  const med = medianBurn();
  const k = effectiveCostK();
  return list.map(r => {
    const burn = cityBurn(r.city);
    const multiplier = costMultiplier(r.city, k, State.housingMode, med);
    return { ...r, burn, multiplier, final: r.total * multiplier };
  }).sort((a, b) => b.final - a.final);
}

function currentFilteredList() {
  const { list: fullList, maxScore } = rankCities(effectiveRankWeights());
  const filtered = fullList.filter(r => State.rankCities.has(r.city.id));
  const list = applyCostLayer(filtered);
  return { list, maxScore };
}

// ── Shared score-mode toggles ────────────────────────────────────────────────
// The two on/off switches — Weight-adjusted and Cost-adjusted — surfaced on the
// Ranking, Compare and City-detail tabs alike. Both mutate the shared `State`
// and trigger a full render(), so the active tab re-renders with the new mode.
//   Weight-adjusted ON  → rank by your weighted criteria; OFF → raw scores (every criterion ×1).
//   Cost-adjusted   ON  → quality × cost multiplier (cheaper-than-median boosted); OFF → cost ignored.
// Extracted on its own so Compare / City-detail can show JUST these toggles,
// while the Ranking tab pairs them with the deeper cost + weights controls.
function renderModeToggles() {
  const rankMode = State.rankMode || 'weighted';
  State.rankMode = rankMode;
  function modeToggle(label, isOn, onClick, tip) {
    return el('button', {
      class: 'small toggle-btn' + (isOn ? ' on' : ''),
      'data-tip': tip,
      onclick: onClick,
    }, el('span', { class: 'toggle-box' }, isOn ? '✓' : ''), label);
  }
  return el('div', { class: 'row', style: { marginTop: '0.5rem', gap: '0.5rem' } },
    el('span', { class: 'muted' }, 'Score mode:'),
    modeToggle('Weight-adjusted', rankMode === 'weighted', () => {
      State.rankMode = rankMode === 'weighted' ? 'raw' : 'weighted';
      render();
    }, 'On: rank by your weighted criteria. Off: every criterion counts equally (raw 1–10 scores); your weight sliders are preserved but not applied.'),
    modeToggle('Cost-adjusted', State.costAdjusted, () => {
      State.costAdjusted = !State.costAdjusted;
      persistCostAdjusted();
      render();
    }, "On: multiply each city's quality by a cost multiplier — cities below the set's median monthly burn get boosted, pricier ones penalised, scaled by the Cost sensitivity slider. Off: cost is ignored; the ranking is pure quality."),
  );
}

// ── Ranking-tab control cluster ──────────────────────────────────────────────
// The Ranking ("front page") tab's full control cluster: the shared score-mode
// toggles plus the deeper cost controls (cost-sensitivity slider, housing-mode
// toggle) and the collapsible per-criterion weights panel. The deeper controls
// live ONLY here — Compare and City-detail render renderModeToggles() alone.
//
// opts.onRebuild: optional callback for a targeted re-render after a slider
// drag. The Ranking tab passes its `rebuildBody` (rebuilds only the table body
// so the slider DOM survives mid-drag); callers that omit it fall back to a
// full render().
function renderControlCluster(opts = {}) {
  const onRebuild = opts.onRebuild || render;

  const rankMode = State.rankMode || 'weighted';
  State.rankMode = rankMode;
  const modeToggles = renderModeToggles();

  // ── Cost controls — value-per-dollar adjustment ─────────────────────────────
  // The cost-sensitivity slider sets exponent k; the housing toggle picks which
  // rent figure feeds burn. Both are only meaningful while "Cost-adjusted" is on,
  // so the slider is disabled when it's off.
  const kNum = el('input', {
    type: 'number', min: '0', max: '1', step: '0.1', class: 'weight-num', value: State.costK,
  });
  const kSlider = el('input', {
    type: 'range', min: '0', max: '1', step: '0.1', value: State.costK, class: 'cost-k-slider',
  });
  kNum.disabled = kSlider.disabled = !State.costAdjusted;
  function applyCostK(v, syncSlider, syncNum) {
    v = Math.max(0, Math.min(1, Math.round(v * 10) / 10));
    State.costK = v;
    if (syncSlider) kSlider.value = v;
    if (syncNum) kNum.value = v;
    persistCostK();
    onRebuild();
  }
  kSlider.addEventListener('input', () => {
    const v = parseFloat(kSlider.value);
    if (!isNaN(v)) applyCostK(v, false, true);
  });
  kNum.addEventListener('input', () => {
    const v = parseFloat(kNum.value);
    if (!isNaN(v)) applyCostK(v, true, false);
  });
  kNum.addEventListener('change', () => {
    let v = parseFloat(kNum.value);
    if (isNaN(v)) v = State.costK;
    applyCostK(v, true, true);
  });
  const costSlider = el('div', { class: 'cost-slider-row' + (State.costAdjusted ? '' : ' disabled') },
    kNum,
    kSlider,
  );
  const housingToggle = el('div', { class: 'row', style: { gap: '0.4rem' } },
    el('span', { class: 'muted' }, 'Housing:'),
    ...[
      { v: 'single', label: 'Single (1BR)' },
      { v: 'shared', label: 'Shared (4BR ÷ 4)' },
    ].map(o => el('button', {
      class: 'small' + (State.housingMode === o.v ? ' primary' : ''),
      'data-tip': 'Which rent figure feeds the monthly burn used for the cost adjustment.',
      onclick: () => { State.housingMode = o.v; persistHousingMode(); render(); },
    }, o.label)),
  );
  const costControls = el('div', { class: 'cost-controls', style: { marginTop: '0.6rem' } },
    el('div', { class: 'row', style: { gap: '0.55rem' } },
      el('span', { class: 'muted' }, 'Cost sensitivity:'),
      costSlider,
      el('span', { class: 'muted', style: { fontSize: '0.8rem' } },
        '— 1 weighs cost linearly (full value-per-dollar); below 1 dampens it; 0 leaves cost out entirely'),
    ),
    el('div', { class: 'row', style: { gap: '0.4rem', marginTop: '0.45rem' } },
      housingToggle,
    ),
  );

  // ── Customize-weights panel ─────────────────────────────────────────────────
  // Flat list of all criteria in a column-major grid. Sort order is a view
  // preference; it only re-applies on button click, not during a slider drag
  // (so sliders don't jump around mid-drag).
  const weightSort = State.weightSort || 'alpha';
  State.weightSort = weightSort;
  const sortedCrits = CRITERIA.slice();
  if (weightSort === 'weight') {
    sortedCrits.sort((a, b) => (State.weights[b.slug] - State.weights[a.slug]) || a.label.localeCompare(b.label));
  } else {
    sortedCrits.sort((a, b) => a.label.localeCompare(b.label));
  }
  const weightSortRow = el('div', { class: 'row', style: { marginBottom: '0.6rem' } },
    el('span', { class: 'muted' }, 'Sort criteria:'),
    el('button', {
      class: 'small' + (weightSort === 'alpha' ? ' primary' : ''),
      onclick: () => { State.weightSort = 'alpha'; render(); },
    }, 'A–Z'),
    el('button', {
      class: 'small' + (weightSort === 'weight' ? ' primary' : ''),
      'data-tip': 'Order criteria by your current weight, highest first — so the ones you care about most rise to the top.',
      onclick: () => { State.weightSort = 'weight'; render(); },
    }, 'By weight'),
  );

  const weightInputs = el('div', { class: 'weights' });
  const critDefsW = DATA.criterion_defs || {};
  for (const c of sortedCrits) {
    const row = el('div', { class: 'weight-row' });
    const def = critDefsW[c.slug];
    row.appendChild(el('span', def ? { class: 'lbl', 'data-tip': def } : { class: 'lbl' }, c.label));

    // Editable number field + slider, both 0–10 in 0.1 steps, kept in sync.
    const numInput = el('input', {
      type: 'number', min: '0', max: '10', step: '0.1',
      class: 'weight-num', value: State.weights[c.slug],
    });
    const slider = el('input', { type: 'range', min: '0', max: '10', step: '0.1', value: State.weights[c.slug] });

    function apply(v, syncSlider, syncNum) {
      v = Math.max(0, Math.min(10, Math.round(v * 10) / 10));
      State.weights[c.slug] = v;
      if (syncSlider) slider.value = v;
      if (syncNum) numInput.value = v;
      persistWeights();
      onRebuild();   // Ranking: targeted body rebuild; other tabs: full render
    }
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      if (!isNaN(v)) apply(v, false, true);
    });
    numInput.addEventListener('input', () => {
      const v = parseFloat(numInput.value);
      if (!isNaN(v)) apply(v, true, false);
    });
    numInput.addEventListener('change', () => {
      // Final clamp on blur / Enter — also fixes an empty or out-of-range entry
      let v = parseFloat(numInput.value);
      if (isNaN(v)) v = State.weights[c.slug];
      apply(v, true, true);
    });

    row.appendChild(el('span', { class: 'num-wrap' },
      el('span', { class: 'num-x' }, '×'),
      numInput,
    ));
    row.appendChild(slider);
    weightInputs.appendChild(row);
  }

  const presets = el('div', { class: 'preset-bar' },
    el('span', { class: 'muted' }, 'Reset weights:'),
    el('button', { class: 'small', onclick: () => resetWeights('suggested') }, 'To suggested baseline'),
    el('button', { class: 'small', onclick: () => resetWeights('zero') }, 'To 0'),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'small primary',
      'data-tip': 'Copies a URL that reproduces your current weight sliders. Anyone who opens it sees the ranking computed with these exact weights — use it to share your priorities.',
      onclick: () => copyShareLink(),
    }, 'Copy link to these weights'),
  );

  // Weight panel only relevant in Weight-adjusted mode
  const weightsBlock = rankMode === 'weighted' ? detailsBlock('weights',
    [el('strong', {}, '⚖️ Customize weights'), ' ', el('span', { class: 'muted' }, '— tweak how much each criterion counts')],
    presets, weightSortRow, weightInputs,
  ) : null;

  return el('div', { class: 'control-cluster' }, modeToggles, costControls, weightsBlock);
}

function renderRanking() {
  let tbodyEl = null;
  let theadEl = null;
  const tableEl = el('table', { class: 'data' });

  const isRawMode = State.rankMode === 'raw';
  const qualityWord = isRawMode ? 'raw' : 'weighted';
  const rankCols = [
    { label: '#',        sortKey: null, title: 'Position by final score (quality × cost multiplier) — sort by Score column to change order' },
    { label: '★',        sortKey: null, title: 'Toggle this city in My picks' },
    { label: 'City',     sortKey: 'name',    defaultDir: 'asc',  title: 'City name — click to sort alphabetically' },
    { label: 'Country',  sortKey: 'country', defaultDir: 'asc',  title: 'Country — click to sort alphabetically' },
    { label: 'Score',    sortKey: 'score',   defaultDir: 'desc', title: 'Final score = ' + qualityWord + ' quality × cost multiplier. Default sort. Click to flip direction' },
    { label: 'Cost',     sortKey: 'cost',    defaultDir: 'asc',  title: 'Monthly burn — comfortable basket + rent for the chosen housing mode. Click to sort cheapest-first' },
    { label: isRawMode ? 'Top scores' : 'Top contributors',          sortKey: null, title: isRawMode ? 'The three highest raw scores for this city' : 'The three criteria contributing most to this city under your weights (score × weight)' },
    { label: isRawMode ? 'Bottom scores' : 'Bottom contributors',    sortKey: null, title: isRawMode ? 'The three lowest raw scores' : 'The three criteria contributing least under your weights' },
  ];

  function rebuildHead() {
    const newHead = el('thead');
    newHead.appendChild(sortHeaderRow('rank', rankCols, rebuildBody, 'score', 'desc'));
    if (theadEl && theadEl.parentNode) theadEl.parentNode.replaceChild(newHead, theadEl);
    else tableEl.appendChild(newHead);
    theadEl = newHead;
  }

  function rebuildBody() {
    rebuildHead();   // refresh sort indicators
    const { list, maxScore } = currentFilteredList();
    // sort — `score` column ranks by `final` (quality × cost multiplier)
    const sorted = applySort('rank', list, [
      { col: 'score',   get: r => r.final },
      { col: 'cost',    get: r => r.burn },
      { col: 'name',    get: r => r.city.name },
      { col: 'country', get: r => r.city.country },
    ]);
    const newBody = el('tbody');
    if (sorted.length === 0) {
      newBody.appendChild(el('tr', {}, el('td', { colspan: '8', class: 'muted', style: { textAlign: 'center', padding: '1.25rem' } },
        'No cities match the current filters. Adjust the city selection above.')));
    }
    sorted.forEach((row, i) => {
      const c = row.city;
      // For the position column, when sorting by score we show 1..N; when sorting by other cols we show the final-score rank, not the row index
      const scoreRankedIdx = list.findIndex(r => r.city.id === c.id);  // list is final-desc from currentFilteredList
      const positionLabel = String(scoreRankedIdx + 1);
      const isPodium = scoreRankedIdx < 3;

      // Per-criterion contribution under effective weights (Raw mode = all ×1)
      const eff = effectiveRankWeights();
      const isRaw = State.rankMode === 'raw';
      const items = CRITERIA
        .map(crit => {
          const w = eff[crit.slug] || 0;
          const s = c.scores[crit.slug];
          if (w === 0 || s == null) return null;
          const short = crit.label.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*\(mo, USD\)/, '');
          return { label: short, contrib: w * s, score: s, weight: w };
        })
        .filter(Boolean)
        .sort((a, b) => b.contrib - a.contrib);
      const topItems = items.slice(0, 3);
      const botItems = items.slice(-3).reverse();

      function mkContribCell(arr) {
        const wrap = el('div', { class: 'contrib-list' });
        arr.forEach(x => {
          const row = el('div', { class: 'contrib-row' },
            el('span', { class: 'contrib-name' }, x.label),
            scoreChip(x.score),
            // hide the "×1" multiplier in Raw mode since it's redundant
            isRaw ? el('span') : el('span', { class: 'contrib-w' }, `× ${x.weight}`),
          );
          wrap.appendChild(row);
        });
        return wrap;
      }

      const tr = el('tr', { class: 'clickable' + (isPodium ? ' rank-' + (scoreRankedIdx+1) : ''), onclick: () => go('city', c.id) });
      tr.appendChild(el('td', { class: 'mono' }, positionLabel));
      tr.appendChild(el('td', { class: 'star-cell', onclick: (ev) => ev.stopPropagation() }, pickStar(c.id, { compact: true })));
      tr.appendChild(el('td', {}, el('strong', {}, c.name)));
      tr.appendChild(el('td', { class: 'muted' }, c.country));
      // Score cell — the final score, rounded to a whole number.
      tr.appendChild(el('td', { class: 'mono' }, el('strong', {}, String(Math.round(row.final)))));
      // Cost cell — monthly burn for the chosen housing mode.
      tr.appendChild(el('td', { class: 'mono cost-cell' },
        el('span', { class: 'burn-val' }, '$' + (row.burn || 0).toLocaleString()),
      ));
      tr.appendChild(el('td', {}, mkContribCell(topItems)));
      tr.appendChild(el('td', {}, mkContribCell(botItems)));
      newBody.appendChild(tr);
    });
    if (tbodyEl && tbodyEl.parentNode) {
      tbodyEl.parentNode.replaceChild(newBody, tbodyEl);
    } else {
      tableEl.appendChild(newBody);
    }
    tbodyEl = newBody;
  }

  // City subset chips. Star control for My picks lives on the table rows (not here).
  const cityChips = el('div', { class: 'chip-tray' });
  const sortedAll = CITIES.slice().sort((a,b) => a.name.localeCompare(b.name));
  for (const c of sortedAll) {
    const isSel = State.rankCities.has(c.id);
    cityChips.appendChild(el('span', {
      class: 'chip' + (isSel ? ' selected' : ''),
      onclick: () => {
        if (isSel) State.rankCities.delete(c.id); else State.rankCities.add(c.id);
        persistRankCities();
        render();
      },
    }, isSel ? '✓ ' : '', c.name));
  }
  const cityControls = el('div', { class: 'row', style: { marginTop: '0.5rem', flexWrap: 'wrap' } },
    el('span', { class: 'muted' }, `${State.rankCities.size} of ${CITIES.length} included.`),
    el('button', { class: 'small', onclick: () => { State.rankCities = new Set(CITIES.map(c => c.id)); persistRankCities(); render(); } }, 'Select all'),
    el('button', { class: 'small', onclick: () => { State.rankCities = new Set(); persistRankCities(); render(); } }, 'Clear'),
    el('button', { class: 'small', onclick: () => {
      if (State.myPicks.length === 0) { toast('No cities in My picks yet'); return; }
      State.rankCities = new Set(State.myPicks);
      persistRankCities(); render();
    }}, `My picks (${State.myPicks.length})`),
  );

  // Export bar
  const exportBar = el('div', { class: 'row', style: { marginTop: '0.5rem' } },
    el('span', { class: 'muted' }, 'Export:'),
    el('a', { class: 'btn small', href: 'data-bundle.zip', download: 'community-data-bundle.zip' }, '⬇ Source data (5 CSVs)'),
    el('button', { class: 'small primary', onclick: () => {
      const { list, maxScore } = currentFilteredList();
      exportPersonalRanking(list, maxScore);
    }}, '⬇ My ranking (CSV)'),
    el('span', { class: 'muted', style: { marginLeft: '0.5rem', fontSize: '0.82rem' } },
      'The CSV reflects your current weights and city selection.'),
  );

  // Initial body render — must happen before the table element is inserted into the DOM
  rebuildBody();

  // Shared score-mode controls — Ranking passes its targeted `rebuildBody` so
  // slider drags rebuild only the table body (the slider DOM survives).
  const controlCluster = renderControlCluster({ onRebuild: rebuildBody });

  // Intro
  const intro = el('div', { class: 'card' },
    el('h2', {}, 'Ranking'),
    el('p', { class: 'muted', style: { marginBottom: '0.5rem' } },
      "Re-rank live by adjusting per-criterion weight sliders or selecting a subset of cities. Weights, cost settings and city selection persist locally; ", el('em', {}, 'Copy link to these weights'), ' produces a URL that reproduces them for someone else.',
    ),
    controlCluster,
    detailsBlock('cities',
      [el('strong', {}, '🏙️ Select cities'), ' ', el('span', { class: 'muted' }, '— include/exclude cities from the ranking')],
      cityChips, cityControls,
    ),
    detailsBlock('export',
      [el('strong', {}, '⬇️ Export')],
      exportBar,
    ),
  );

  return el('div', {}, intro, el('div', { class: 'card' }, tableEl));
}

function persistRankCities() {
  try { localStorage.setItem('rankCities', JSON.stringify([...State.rankCities])); } catch {}
}

function exportPersonalRanking(list, maxScore) {
  const weightStr = CRITERIA.map(c => `${c.slug}=${State.weights[c.slug]}`).join(',');
  const date = new Date().toISOString().slice(0, 10);
  const rows = [];
  rows.push(['# Personal ranking exported from cities.moiri.dev on ' + date]);
  rows.push(['# Weights used: ' + weightStr]);
  rows.push(['# Cost sensitivity: ' + (State.costAdjusted ? State.costK : 'off') +
             '  ·  Housing mode: ' + State.housingMode +
             '  ·  Median burn: $' + medianBurn()]);
  rows.push(['# Cities included: ' + State.rankCities.size + ' of ' + CITIES.length]);
  rows.push([]);
  rows.push(['Rank','City','Country','Weighted quality','Max possible','% of max','Monthly burn (USD)','Cost multiplier','Final score','Top contributors','Bottom contributors']);
  list.forEach((row, i) => {
    const c = row.city;
    // Per-criterion contributions to rank top/bottom
    const contribs = CRITERIA
      .map(crit => {
        const w = State.weights[crit.slug] || 0;
        const s = c.scores[crit.slug];
        if (w === 0 || s == null) return null;
        return { label: crit.label, contrib: w * s, score: s, weight: w };
      })
      .filter(Boolean)
      .sort((a, b) => b.contrib - a.contrib);
    const top3 = contribs.slice(0, 3).map(x => `${x.label} (${x.score}×${x.weight})`).join('; ');
    const bot3 = contribs.slice(-3).reverse().map(x => `${x.label} (${x.score}×${x.weight})`).join('; ');
    const pct = maxScore > 0 ? (row.total / maxScore * 100).toFixed(1) : '0';
    rows.push([
      String(i + 1),
      c.name,
      c.country,
      fmt(row.total),
      fmt(maxScore),
      pct,
      String(row.burn || 0),
      fmt(row.multiplier),
      fmt(row.final),
      top3,
      bot3,
    ]);
  });
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `my-ranking-${date}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Ranking CSV downloaded');
}
function csvCell(s) {
  s = (s == null) ? '' : String(s);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function resetWeights(mode) {
  if (mode === 'zero') {
    State.weights = Object.fromEntries(CRITERIA.map(c => [c.slug, 0]));
  } else {
    // Back to the suggested baseline (from suggested-weights.js)
    State.weights = { ...DEFAULT_WEIGHTS };
  }
  persistWeights();
  render();
}
function persistWeights() {
  try { localStorage.setItem('weights', JSON.stringify(State.weights)); } catch {}
}
function persistCostK() {
  try { localStorage.setItem('costK', String(State.costK)); } catch {}
}
function persistCostAdjusted() {
  try { localStorage.setItem('costAdjusted', State.costAdjusted ? '1' : '0'); } catch {}
}
function persistHousingMode() {
  try { localStorage.setItem('housingMode', State.housingMode); } catch {}
}
function copyShareLink() {
  // Encodes weights + cost-sensitivity + housing mode; only non-default values appear.
  const p = new URLSearchParams();
  const enc = encodeWeights(State.weights);
  if (enc) p.set('w', enc);
  if (State.costK !== (window.SUGGESTED_K ?? 1.0)) p.set('cs', String(State.costK));
  if (State.housingMode !== 'shared') p.set('hm', State.housingMode);
  const qs = p.toString();
  const base = location.origin + location.pathname;
  const link = base + '#/rank' + (qs ? '?' + qs : '');
  navigator.clipboard.writeText(link).then(() => toast('Link copied — reproduces your weights, cost sensitivity and housing mode'));
}

// ============================================================
// Render: cost-of-living panel (city detail special section)
// ============================================================
// Cost is not a scored criterion — it gets its own section, like "Practical
// considerations". Shows the non-housing basket write-up, the structured cost
// basis, and this city's live burn + multiplier at the active k / housing mode.
function renderCostPanel(city) {
  const cb = city.cost_basis || {};
  const cl = city.cost_living || {};
  const mode = State.housingMode;
  const rent = cityRent(city, mode);
  const burn = cityBurn(city, mode);
  const med = medianBurn(mode);
  const mult = costMultiplier(city, effectiveCostK(), mode, med);
  const modeLabel = mode === 'shared' ? 'shared (4BR ÷ 4)' : 'single (1BR)';

  const card = el('div', { class: 'card cost-panel' });
  card.appendChild(el('h3', {}, 'Cost of living'));
  card.appendChild(el('p', { class: 'muted', style: { marginTop: 0 } },
    'Cost is not scored on the 1–10 scale — it adjusts the ranked score as a value-per-dollar multiplier. ',
    'See the Ranking tab to change cost sensitivity and housing mode.',
  ));

  // Non-housing basket prose (sourced, rendered like a criterion card)
  if (cl.prose) {
    const p = el('div', { class: 'crit-card' });
    p.appendChild(el('div', { class: 'crit-header' },
      el('span', { class: 'crit-label' }, 'Non-housing basket')));
    p.appendChild(el('div', { class: 'crit-prose' }, cl.prose));
    if (cl.sources_text || cl.tier != null || cl.flags?.length) {
      const srcLine = el('div', { class: 'crit-sources' });
      if (cl.tier != null) srcLine.appendChild(srcTierBadge(cl.tier));
      (cl.flags || []).forEach(f => srcLine.appendChild(flagBadge(f)));
      if (cl.sources_text) srcLine.appendChild(document.createTextNode(' ' + cl.sources_text));
      p.appendChild(srcLine);
    }
    card.appendChild(p);
  }

  // Structured cost-basis numbers
  const num = (label, val, note) => el('div', { class: 'cost-stat' },
    el('div', { class: 'cost-stat-label muted' }, label),
    el('div', { class: 'cost-stat-val mono' }, val == null ? '—' : '$' + Number(val).toLocaleString()),
    note ? el('div', { class: 'cost-stat-note dim' }, note) : null,
  );
  card.appendChild(el('div', { class: 'cost-basis-grid' },
    num('Non-housing basket — lean', cb.basket_lean),
    num('Non-housing basket — comfortable', cb.basket_comfortable, 'used in burn'),
    num('Non-housing basket — premium', cb.basket_premium),
    num('Rent — private 1BR', cb.rent_1br, mode === 'single' ? 'used in burn' : null),
    num('Rent — 4BR per person', cb.rent_4br_pp, mode === 'shared' ? 'used in burn' : null),
  ));
  card.appendChild(el('div', { class: 'muted', style: { fontSize: '0.8rem', marginTop: '0.4rem' } },
    'All figures USD/month.'));

  // Live burn + how it moves the score, at the current cost sensitivity / housing mode
  const cheaper = burn > 0 && med > 0 && burn < med;
  const pricier = burn > 0 && med > 0 && burn > med;
  let explain;
  if (effectiveCostK() === 0) {
    explain = State.costAdjusted
      ? 'Cost sensitivity is 0 — cost is ignored; the score is pure quality.'
      : 'Cost-adjusted is off — cost is ignored; the score is pure quality.';
  } else if (cheaper) {
    explain = `Cheaper than the median city ($${med.toLocaleString()}) → this city's score is boosted ×${fmt(mult)}.`;
  } else if (pricier) {
    explain = `Pricier than the median city ($${med.toLocaleString()}) → this city's score is reduced ×${fmt(mult)}.`;
  } else {
    explain = `Right at the median city ($${med.toLocaleString()}) → score unchanged (×${fmt(mult)}).`;
  }
  card.appendChild(el('div', { class: 'cost-burn-box' },
    el('div', { class: 'cost-burn-line' },
      el('span', { class: 'muted' }, 'This city, ' + modeLabel + ':'),
      el('span', { class: 'mono' }, 'burn $' + (burn || 0).toLocaleString()),
      el('span', { class: 'dim mono' }, '= $' + (cb.basket_comfortable || 0).toLocaleString() + ' basket + $' + (rent || 0).toLocaleString() + ' rent'),
    ),
    el('div', { class: 'muted', style: { fontSize: '0.84rem', marginTop: '0.3rem' } }, explain),
  ));

  return card;
}

// ============================================================
// Render: city detail
// ============================================================
function renderCityDetail() {
  const { arg } = parseRoute();
  const cityId = arg || State.cityDetail || CITIES[0].id;
  State.cityDetail = cityId;
  const city = CITIES.find(c => c.id === cityId) || CITIES[0];

  // Compute current rank + score the same way the Ranking tab does: effective
  // weights (raw mode → all ×1) and, when Cost-adjusted is on, the value-per-$
  // cost layer applied to the aggregate. `final` is the cost-adjusted total
  // (equals `total` when the cost layer is off). Ranked over ALL cities so the
  // "#N of M" reading matches the Ranking tab's notion of position.
  const eff = effectiveRankWeights();
  const { list: rankedRaw, maxScore } = rankCities(eff);
  const weighted = applyCostLayer(rankedRaw);
  const myRow = weighted.find(r => r.city.id === city.id);
  const myRank = weighted.findIndex(r => r.city.id === city.id) + 1;
  const myTotal = myRow?.final ?? 0;            // cost-adjusted aggregate (equals quality when cost off)
  const isRawMode = State.rankMode === 'raw';
  const costOn = State.costAdjusted && effectiveCostK() !== 0;

  // Header dropdown — sorted alphabetically (avoids anchoring to any particular ranking)
  const sel = el('select', { onchange: e => go('city', e.target.value) });
  CITIES.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(c => {
    const r = weighted.findIndex(x => x.city.id === c.id) + 1;
    sel.appendChild(el('option', { value: c.id, ...(c.id === city.id ? { selected: 'selected' } : {}) },
      `${c.name}, ${c.country}` + (maxScore > 0 ? `  · current #${r}` : '')));
  });

  // "Compare with..." quick picker — alphabetical
  const cmpSel = el('select', { onchange: e => {
    if (!e.target.value) return;
    State.compareCities = [city.id, e.target.value];
    go('compare');
  }});
  cmpSel.appendChild(el('option', { value: '' }, 'Compare with…'));
  CITIES.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(c => {
    if (c.id === city.id) return;
    cmpSel.appendChild(el('option', { value: c.id }, `${c.name}, ${c.country}`));
  });
  // Star/unstar for My picks
  const inPicks = State.myPicks.includes(city.id);
  const starBtn = el('button', {
    class: 'small' + (inPicks ? ' primary' : ''),
    onclick: () => {
      if (inPicks) State.myPicks = State.myPicks.filter(x => x !== city.id);
      else State.myPicks.push(city.id);
      persistMyPicks();
      render();
    },
  }, inPicks ? '★ In My picks' : '☆ Add to My picks');

  const header = el('div', { class: 'card' },
    el('div', { class: 'row between' },
      el('div', {},
        el('h2', { style: { margin: 0 } }, city.name),
        el('div', { class: 'muted' }, city.country),
      ),
      el('div', { class: 'row', style: { gap: '0.5rem' } },
        starBtn,
        cmpSel,
        el('label', { class: 'muted', style: { marginLeft: '0.5rem' } }, 'Switch:'),
        sel,
      ),
    ),
    el('div', { class: 'row', style: { marginTop: '0.75rem' } },
      maxScore > 0 ? el('div', {},
        el('div', { class: 'muted' }, 'Rank (' + (isRawMode ? 'raw scores' : 'your weights') + (costOn ? ', cost-adjusted' : '') + ')'),
        el('div', { style: { fontSize: '1.4rem', fontWeight: 600 } }, '#' + myRank + ' ',
          el('span', { class: 'muted', style: { fontSize: '0.9rem', fontWeight: 400 } }, 'of ' + CITIES.length))) : null,
      maxScore > 0 ? el('div', {},
        el('div', { class: 'muted' }, costOn
          ? (isRawMode ? 'Raw score, cost-adjusted' : 'Weighted score, cost-adjusted')
          : (isRawMode ? 'Raw score' : 'Weighted score')),
        el('div', { style: { fontSize: '1.4rem', fontWeight: 600 } },
          // Cost off: classic "score / max possible". Cost on: the multiplier can
          // push the total past max, so the /max scale is dropped.
          costOn
            ? fmt(myTotal)
            : [fmt(myTotal) + ' ', el('span', { class: 'muted', style: { fontSize: '0.9rem', fontWeight: 400 } }, '/' + fmt(maxScore))],
        )) : null,
    ),
    // Dynamic top/bottom under the effective weights (raw mode → all ×1),
    // rendered as readable stacked rows
    (function () {
      const items = CRITERIA
        .map(crit => {
          const w = eff[crit.slug] || 0;
          const s = city.scores[crit.slug];
          if (s == null) return null;
          const short = crit.label.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*\(mo, USD\)/, '');
          return { label: short, score: s, weight: w, contrib: s * w };
        })
        .filter(Boolean);
      const byContrib = items.slice().sort((a, b) => b.contrib - a.contrib);
      const byScoreDesc = items.slice().sort((a, b) => b.score - a.score);
      const byScoreAsc = items.slice().sort((a, b) => a.score - b.score);
      function mkRow(x, mode) {
        return el('div', { class: 'contrib-row' },
          el('span', { class: 'contrib-name' }, x.label),
          scoreChip(x.score),
          mode === 'contrib' && !isRawMode ? el('span', { class: 'contrib-w' }, `× ${x.weight}`) : el('span'),
        );
      }
      // In raw mode contributions equal raw scores, so just show the score order.
      const mode = (maxScore > 0 && !isRawMode) ? 'contrib' : 'score';
      const topItems = mode === 'contrib' ? byContrib.slice(0, 3) : byScoreDesc.slice(0, 3);
      const botItems = mode === 'contrib' ? byContrib.slice(-3).reverse() : byScoreAsc.slice(0, 3);
      return el('div', { style: { marginTop: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' } },
        el('div', {},
          el('div', { class: 'muted', style: { fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' } },
            mode === 'contrib' ? 'Top contributors (your weights)' : 'Top scores'),
          el('div', { class: 'contrib-list' }, ...topItems.map(x => mkRow(x, mode))),
        ),
        el('div', {},
          el('div', { class: 'muted', style: { fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' } },
            mode === 'contrib' ? 'Bottom contributors' : 'Lowest scores'),
          el('div', { class: 'contrib-list' }, ...botItems.map(x => mkRow(x, mode))),
        ),
      );
    })(),
  );

  // Horizon notes — prose notes on popup-window and long-term-base fit
  const hasHorizonNotes = city.popup_notes || city.lt_notes;
  const horizonNotes = hasHorizonNotes ? el('div', { class: 'card' },
    el('h3', {}, 'Horizon-fit notes'),
    el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' } },
      el('div', {},
        el('div', { class: 'muted', style: { fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' } }, 'Popup-fit Jul–Sep 2026'),
        el('div', { style: { whiteSpace: 'pre-wrap', color: 'var(--text-soft)', fontSize: '0.92rem' } }, city.popup_notes || '(no notes)'),
      ),
      el('div', {},
        el('div', { class: 'muted', style: { fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' } }, 'Long-term-base-fit'),
        el('div', { style: { whiteSpace: 'pre-wrap', color: 'var(--text-soft)', fontSize: '0.92rem' } }, city.lt_notes || '(no notes)'),
      ),
    ),
  ) : null;

  // Criteria cards with per-criterion contribution under the effective weights
  // (raw mode → every criterion ×1, matching the Ranking tab).
  const critWrap = el('div', { class: 'card' });
  // Toggle for sort: contribution (default when weights are non-uniform) vs original order
  if (!State.cityCritSort) {
    // Default: contribution when weights vary, alphabetical otherwise
    const allEqual = CRITERIA.every(c => eff[c.slug] === eff[CRITERIA[0].slug]);
    State.cityCritSort = allEqual ? 'name' : 'contribution';
  }
  const sortToggle = el('div', { class: 'row', style: { gap: '0.4rem', margin: '0.6rem 0 0.9rem' } },
    el('span', { class: 'muted', style: { fontSize: '0.82rem' } }, 'Sort criteria by:'),
    ...[
      { v: 'contribution', label: isRawMode ? 'Contribution (= raw score)' : 'Contribution (score × your weight)' },
      { v: 'score',        label: 'Raw score' },
      { v: 'name',         label: 'Name (A–Z)' },
    ].map(o => el('button', {
      class: 'small' + (State.cityCritSort === o.v ? ' primary' : ''),
      onclick: () => { State.cityCritSort = o.v; render(); },
    }, o.label)),
  );

  // Build sortable list of (meta, score, weight, contribution)
  const critEntries = CRITERIA.map(meta => {
    const sc = city.scores[meta.slug];
    const w = eff[meta.slug] || 0;
    return { meta, score: sc, weight: w, contrib: sc != null ? sc * w : null };
  });
  if (State.cityCritSort === 'contribution') {
    critEntries.sort((a, b) => (b.contrib ?? -1) - (a.contrib ?? -1));
  } else if (State.cityCritSort === 'score') {
    critEntries.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  } // 'name' uses natural CRITERIA order which is already curated

  const maxContrib = Math.max(1, ...critEntries.map(e => e.contrib || 0));

  critWrap.appendChild(el('h3', {}, 'All criteria'));
  critWrap.appendChild(el('p', { class: 'muted' },
    isRawMode
      ? 'Each card shows: 1–10 score · prose · source citations + verification flag. Weight-adjusted mode is off, so every criterion counts equally.'
      : 'Each card shows: 1–10 score · contribution under your weights (score × weight) · prose · source citations + verification flag. Cards with weight = 0 are dimmed.',
  ));
  critWrap.appendChild(sortToggle);

  for (const entry of critEntries) {
    const { meta, score: sc, weight: w, contrib } = entry;
    const txt = city.criteria_text[meta.slug] || {};
    const isZero = w === 0;
    const def = (DATA.criterion_defs || {})[meta.slug];
    const card = el('div', { class: 'crit-card' + (isZero ? ' dimmed' : '') });
    const header = el('div', { class: 'crit-header' },
      scoreChip(sc),
      el('span', def ? { class: 'crit-label', 'data-tip': def } : { class: 'crit-label' }, meta.label),
    );
    // Contribution badge / bar — skipped in raw mode (contribution = raw score,
    // so a "8×1=8" badge would just be noise; the score chip already says it).
    if (sc != null && !isRawMode) {
      const cb = el('span', { class: 'contrib-bar' + (isZero ? ' cb-zero' : '') },
        el('span', { class: 'mono muted' }, `${sc}×${w}=`),
        el('span', { class: 'cb-val' }, fmt(contrib || 0)),
      );
      if (!isZero && contrib > 0) {
        const fillPct = Math.round((contrib / maxContrib) * 100);
        const track = el('span', { class: 'cb-track' }, el('span', { class: 'cb-fill', style: { width: fillPct + '%' } }));
        cb.appendChild(track);
      }
      header.appendChild(cb);
    }
    card.appendChild(header);
    if (txt.prose) card.appendChild(el('div', { class: 'crit-prose' }, txt.prose));
    if (txt.sources_text || txt.tier || (txt.flags && txt.flags.length)) {
      const srcLine = el('div', { class: 'crit-sources' });
      if (txt.tier != null) srcLine.appendChild(srcTierBadge(txt.tier));
      (txt.flags || []).forEach(f => srcLine.appendChild(flagBadge(f)));
      if (txt.sources_text) {
        srcLine.appendChild(document.createTextNode(' '));
        srcLine.appendChild(document.createTextNode(txt.sources_text));
      }
      card.appendChild(srcLine);
    }
    critWrap.appendChild(card);
  }

  // Practical considerations (text-only)
  if (city.practical && city.practical.prose) {
    const p = el('div', { class: 'crit-card' });
    p.appendChild(el('div', { class: 'crit-header' },
      el('span', { class: 'crit-label' }, 'Practical considerations (text only)')));
    p.appendChild(el('div', { class: 'crit-prose' }, city.practical.prose));
    if (city.practical.sources_text || city.practical.tier != null || city.practical.flags?.length) {
      const srcLine = el('div', { class: 'crit-sources' });
      if (city.practical.tier != null) srcLine.appendChild(srcTierBadge(city.practical.tier));
      (city.practical.flags || []).forEach(f => srcLine.appendChild(flagBadge(f)));
      if (city.practical.sources_text) {
        srcLine.appendChild(document.createTextNode(' ' + city.practical.sources_text));
      }
      p.appendChild(srcLine);
    }
    critWrap.appendChild(p);
  }

  // Living arrangements grouped by type
  const livWrap = el('div', { class: 'card' });
  livWrap.appendChild(el('h3', {}, `Living arrangements (${(city.living || []).length} entries)`));
  if (!city.living || city.living.length === 0) {
    livWrap.appendChild(el('p', { class: 'muted' }, 'No living-arrangement entries on file.'));
  } else {
    const byType = {};
    for (const it of city.living) (byType[it.type] = byType[it.type] || []).push(it);
    const typeOrder = ['Coliving','Coworking','Climbing','Climbing gym','Group housing','Neighborhood','Closed','Removed'];
    const types = Object.keys(byType).sort((a,b) => {
      const ai = typeOrder.indexOf(a); const bi = typeOrder.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    for (const tp of types) {
      const group = el('div', { class: 'liv-group' });
      group.appendChild(el('h4', {}, `${tp} (${byType[tp].length})`));
      for (const it of byType[tp]) {
        const cls = 'liv-item status-' + (it.status || 'UNKNOWN').replace(/\s+/g, '_').toUpperCase().split('_')[0];
        const item = el('div', { class: cls });
        item.appendChild(el('div', {},
          el('span', { class: 'liv-name' }, it.name || '(unnamed)'),
          ' ',
          el('span', { class: 'liv-meta' },
            it.status ? `· ${it.status}` : '',
            it.source ? ` · ${it.source}` : '',
            it.flag ? ` ${it.flag}` : '',
          ),
        ));
        if (it.text) item.appendChild(el('div', { style: { marginTop: '0.25rem' }, class: 'muted' }, it.text));
        group.appendChild(item);
      }
      livWrap.appendChild(group);
    }
  }

  const costPanel = renderCostPanel(city);

  // Shared score-mode toggles — Weight-adjusted + Cost-adjusted, the same two
  // switches the Ranking and Compare tabs show, driving the same State. The
  // deeper cost slider / housing toggle / weights panel stay on the Ranking
  // tab. Each toggle triggers a full render(), re-rendering this tab.
  const controls = el('div', { class: 'card' },
    el('p', { class: 'muted', style: { marginTop: 0, marginBottom: '0.4rem', fontSize: '0.86rem' } },
      'Score mode — shared with the Ranking and Compare tabs. Weight-adjusted and Cost-adjusted change the score and rank shown above. Cost sensitivity, housing mode and per-criterion weights live on the Ranking tab.'),
    renderModeToggles(),
  );

  // Order: controls · header (rank/score) · horizon-fit notes · cost-of-living
  // card · per-criterion list · living arrangements.
  return el('div', {}, controls, header, horizonNotes, costPanel, critWrap, livWrap);
}

// ============================================================
// Render: compare
// ============================================================
function renderCompare() {
  // Seed 5 demo cities once, on the first visit to this tab. After that an
  // empty selection (e.g. from the Clear button) is left empty.
  if (State.compareCities.length === 0 && !State.compareSeeded) {
    State.compareCities = CITIES.slice(0, 5).map(c => c.id);
  }
  State.compareSeeded = true;

  const selectedSet = new Set(State.compareCities);

  // Bulk-selection buttons
  const bulkRow = el('div', { class: 'row', style: { gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' } },
    el('span', { class: 'muted' }, 'Quick set:'),
    el('button', { class: 'small', onclick: () => { State.compareCities = CITIES.map(c => c.id); render(); } }, 'All cities'),
    el('button', { class: 'small', onclick: () => {
      if (State.myPicks.length === 0) { toast('No cities in My picks yet'); return; }
      State.compareCities = State.myPicks.slice();
      render();
    }}, 'My picks (' + State.myPicks.length + ')'),
    el('button', { class: 'small', onclick: () => { State.compareCities = []; render(); } }, 'Clear'),
  );

  // Chip tray — star lives on the matrix column headers below, not here.
  const chips = el('div', { class: 'chip-tray' });
  const sortedCities = CITIES.slice().sort((a,b) => a.name.localeCompare(b.name));
  for (const c of sortedCities) {
    const isSel = selectedSet.has(c.id);
    const chip = el('span', {
      class: 'chip' + (isSel ? ' selected' : ''),
      onclick: () => {
        if (isSel) State.compareCities = State.compareCities.filter(x => x !== c.id);
        else State.compareCities.push(c.id);
        render();
      },
    }, isSel ? '✓ ' : '', c.name);
    chips.appendChild(chip);
  }

  // Score mode is shared with the Ranking tab via State.rankMode. `mode` here
  // mirrors that ('raw' | 'weighted'); the toggle itself lives in the shared
  // control cluster rendered at the top of the tab.
  const mode = State.rankMode || 'weighted';
  State.rankMode = mode;

  // Sort toggle for criteria rows
  if (!State.compareCritSort) State.compareCritSort = 'original';
  const critSortOpts = el('div', { class: 'row', style: { marginTop: '0.5rem' } },
    el('span', { class: 'muted' }, 'Sort criteria by:'),
    ...[
      { v: 'original', label: 'Original order' },
      { v: 'spread',   label: 'Spread (where they differ most)' },
      { v: 'maxscore', label: 'Max score' },
      { v: 'name',     label: 'A–Z' },
    ].map(o => el('button', {
      class: 'small' + (State.compareCritSort === o.v ? ' primary' : ''),
      onclick: () => { State.compareCritSort = o.v; render(); },
    }, o.label)),
  );

  // Build matrix
  let critsShown = CRITERIA.slice();
  const selectedCities = State.compareCities.map(id => CITIES.find(c => c.id === id)).filter(Boolean);

  // valueFor returns the comparison metric for a (city, criterion) pair:
  // raw mode → raw score; weighted mode → score × user-weight (0 if weight=0).
  const valueFor = (c, slug) => {
    const sc = c?.scores[slug];
    if (sc == null) return null;
    if (mode === 'weighted') return sc * (State.weights[slug] || 0);
    return sc;
  };
  const fmtCell = (c, slug) => {
    const sc = c?.scores[slug];
    if (sc == null) return null;
    if (mode === 'raw') return { score: sc, weight: null, contrib: null };
    return { score: sc, weight: State.weights[slug] || 0, contrib: sc * (State.weights[slug] || 0) };
  };

  // Apply sort to criteria rows — uses the same metric as the current mode
  if (State.compareCritSort === 'spread') {
    critsShown.sort((a, b) => {
      const sa = selectedCities.map(c => valueFor(c, a.slug)).filter(v => v != null);
      const sb = selectedCities.map(c => valueFor(c, b.slug)).filter(v => v != null);
      const spreadA = sa.length ? Math.max(...sa) - Math.min(...sa) : -1;
      const spreadB = sb.length ? Math.max(...sb) - Math.min(...sb) : -1;
      return spreadB - spreadA;
    });
  } else if (State.compareCritSort === 'maxscore') {
    critsShown.sort((a, b) => {
      const sa = selectedCities.map(c => valueFor(c, a.slug)).filter(v => v != null);
      const sb = selectedCities.map(c => valueFor(c, b.slug)).filter(v => v != null);
      const maxA = sa.length ? Math.max(...sa) : -1;
      const maxB = sb.length ? Math.max(...sb) : -1;
      return maxB - maxA;
    });
  } else if (State.compareCritSort === 'name') {
    critsShown.sort((a, b) => a.label.localeCompare(b.label));
  }

  const isHeadToHead = State.compareCities.length === 2;

  const matrix = el('div', { class: 'compare-matrix' });
  const t = el('table', { class: 'data' });
  const thead = el('thead');
  const headRow = el('tr', {}, el('th', { style: { minWidth: '180px' } }, 'Criterion'));
  for (const cid of State.compareCities) {
    const c = CITIES.find(x => x.id === cid);
    if (!c) continue;
    headRow.appendChild(el('th', { class: 'cmp-city-h', style: { minWidth: '100px', textAlign: 'center' } },
      el('div', { class: 'cmp-city-link', style: { cursor: 'pointer' }, onclick: () => go('city', c.id) }, c.name),
      el('div', { class: 'muted', style: { fontSize: '0.72rem' } }, pickStar(c.id, { compact: true })),
    ));
  }
  if (isHeadToHead) headRow.appendChild(el('th', { style: { textAlign: 'center', minWidth: '70px' } }, 'Δ'));
  thead.appendChild(headRow);
  t.appendChild(thead);
  const tbody = el('tbody');
  // Total row (weighted mode only) — sum of contributions across all criteria
  // per city, then the value-per-$ cost layer applied to that aggregate, exactly
  // as the Ranking tab does. Cost adjustment touches ONLY this aggregate row;
  // the per-criterion cells below are never cost-adjusted. When Cost-adjusted is
  // off, effectiveCostK() is 0 → every multiplier is 1 → totals == quality.
  const compareCostOn = State.costAdjusted && effectiveCostK() !== 0;
  if (mode === 'weighted') {
    const medBurn = medianBurn();
    // Pre-cost weighted quality per city
    const quality = selectedCities.map(c => CRITERIA.reduce((sum, m) => {
      const s = c.scores[m.slug];
      if (s == null) return sum;
      return sum + s * (State.weights[m.slug] || 0);
    }, 0));
    const mults = selectedCities.map(c => costMultiplier(c, effectiveCostK(), State.housingMode, medBurn));
    // Cost-adjusted aggregate — what the row displays and what diffs use.
    const totals = quality.map((q, i) => q * mults[i]);
    const max = Math.max(...totals);
    const tr = el('tr', { class: 'totals-row' });
    tr.appendChild(el('td', {}, el('strong', {}, compareCostOn ? 'Total (cost-adjusted)' : 'Total weighted')));
    selectedCities.forEach((c, i) => {
      const isMax = totals[i] === max && max > 0;
      const cell = el('td', { class: 'score-cell totals-cell' + (isMax ? ' totals-max' : '') },
        el('strong', {}, fmt(totals[i])));
      tr.appendChild(cell);
    });
    if (isHeadToHead) {
      const [a, b] = totals;
      const diff = a - b;
      const cell = diff > 0 ? el('td', { class: 'score-cell', style: { color: '#7bb287', fontWeight: '600' } }, '← +' + fmt(diff))
                 : diff < 0 ? el('td', { class: 'score-cell', style: { color: '#7bb287', fontWeight: '600' } }, '+' + fmt(-diff) + ' →')
                 : el('td', { class: 'score-cell muted' }, '=');
      tr.appendChild(cell);
    }
    tbody.appendChild(tr);
  }
  const critDefs = DATA.criterion_defs || {};
  for (const meta of critsShown) {
    const tr = el('tr', {});
    const def = critDefs[meta.slug];
    tr.appendChild(el('td', def ? { 'data-tip': def } : {}, meta.label));
    const valuesInRow = [];
    for (const cid of State.compareCities) {
      const c = CITIES.find(x => x.id === cid);
      const v = valueFor(c, meta.slug);
      valuesInRow.push(v);
      const cell = fmtCell(c, meta.slug);
      if (cell == null) {
        tr.appendChild(el('td', { class: 'score-cell' }, scoreChip(null)));
      } else if (mode === 'raw') {
        tr.appendChild(el('td', { class: 'score-cell' }, scoreChip(cell.score)));
      } else {
        // weighted: show raw chip + small "× W" + contribution number
        const dim = cell.weight === 0;
        const td = el('td', { class: 'score-cell weighted-cell' + (dim ? ' dim' : '') },
          scoreChip(cell.score),
          el('span', { class: 'wcell-mult' }, '×' + cell.weight),
          el('span', { class: 'wcell-eq' }, '='),
          el('span', { class: 'wcell-val' }, fmt(cell.contrib)),
        );
        tr.appendChild(td);
      }
    }
    if (isHeadToHead) {
      const [a, b] = valuesInRow;
      let diffCell;
      if (a == null || b == null) diffCell = el('td', { class: 'score-cell muted' }, '—');
      else if (a > b) diffCell = el('td', { class: 'score-cell', style: { color: '#7bb287', fontWeight: '600' } }, '← +' + fmt(a-b));
      else if (b > a) diffCell = el('td', { class: 'score-cell', style: { color: '#7bb287', fontWeight: '600' } }, '+' + fmt(b-a) + ' →');
      else diffCell = el('td', { class: 'score-cell muted' }, '=');
      tr.appendChild(diffCell);
    }
    // Highlight the winning cell in head-to-head
    if (isHeadToHead && valuesInRow.every(v => v != null) && valuesInRow[0] !== valuesInRow[1]) {
      const winIdx = valuesInRow[0] > valuesInRow[1] ? 0 : 1;
      tr.children[1 + winIdx].style.background = 'rgba(45,164,78,0.07)';
    }
    tbody.appendChild(tr);
  }
  t.appendChild(tbody);
  matrix.appendChild(t);

  // Wins summary: uses raw scores or contributions per the current mode. In weighted mode
  // criteria with weight=0 are skipped entirely (they can't affect the decision).
  let winsSummary = null;
  if (selectedCities.length >= 2) {
    const wins = new Map(selectedCities.map(c => [c.id, 0]));
    let sharedTop = 0, noData = 0, weightZero = 0;
    for (const meta of CRITERIA) {
      if (mode === 'weighted' && (State.weights[meta.slug] || 0) === 0) { weightZero++; continue; }
      const vals = selectedCities.map(c => valueFor(c, meta.slug));
      if (vals.some(v => v == null)) { noData++; continue; }
      const max = Math.max(...vals);
      const winners = selectedCities.filter((c, i) => vals[i] === max);
      if (winners.length === 1) wins.set(winners[0].id, wins.get(winners[0].id) + 1);
      else sharedTop++;
    }
    const sorted = [...wins.entries()].sort((a, b) => b[1] - a[1]);
    const tile = (label, value) => el('div', { class: 'wins-tile' },
      el('div', { class: 'muted', style: { fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em' } }, label),
      el('div', { style: { fontSize: '1.4rem', fontWeight: 600 } }, String(value)),
    );
    const note = (mode === 'weighted'
      ? 'Number of criteria where each city has the strict-best contribution (score × your weight) among the selection. ' +
        sharedTop + ' shared between top cities; ' + noData + ' have missing data; ' + weightZero + ' have weight 0 (skipped).'
      : 'Number of criteria where each city has the strict-best raw score among the selection. ' +
        sharedTop + ' shared between top cities; ' + noData + ' have missing data.');
    winsSummary = el('div', { class: 'card' },
      el('h3', {}, selectedCities.length === 2
        ? 'Head-to-head: ' + selectedCities[0].name + ' vs ' + selectedCities[1].name + (mode === 'weighted' ? ' (weight-adjusted)' : '')
        : 'Wins across ' + selectedCities.length + ' cities' + (mode === 'weighted' ? ' (weight-adjusted)' : '')),
      el('p', { class: 'muted', style: { marginTop: 0 } }, note),
      el('div', { class: 'wins-row' },
        ...sorted.map(([cid, count]) => {
          const c = CITIES.find(x => x.id === cid);
          return el('div', { class: 'wins-tile', onclick: () => go('city', cid), style: { cursor: 'pointer' } },
            el('div', { class: 'muted', style: { fontSize: '0.78rem' } }, c.name),
            el('div', { style: { fontSize: '1.4rem', fontWeight: 600, color: '#7bb287' } }, String(count)),
          );
        }),
        tile('Shared top', sharedTop),
      ),
    );
  }

  const intro = el('div', { class: 'card' },
    el('h2', {}, 'Compare cities'),
    el('p', { class: 'muted' }, 'Pick any number of cities to compare side-by-side. Click a city in the chip tray to add or remove. Selecting exactly two activates a head-to-head view with a diff column and win counts.'),
    bulkRow,
    el('div', { class: 'muted', style: { marginTop: '0.6rem' } }, 'Selected (' + State.compareCities.length + '):'),
    chips,
    critSortOpts,
  );

  // Shared score-mode toggles — Weight-adjusted + Cost-adjusted, the same two
  // switches the Ranking and City-detail tabs show. Weight-adjusted drives the
  // matrix mode (raw chips vs score × weight); Cost-adjusted re-weights the
  // Total row only. The deeper cost slider / housing toggle / weights panel
  // stay on the Ranking tab. Each toggle triggers a full render().
  const controls = el('div', { class: 'card' },
    el('p', { class: 'muted', style: { marginTop: 0, marginBottom: '0.4rem', fontSize: '0.86rem' } },
      'Score mode — shared with the Ranking and City-detail tabs. Weight-adjusted switches the matrix between raw scores and score × weight; Cost-adjusted re-weights the Total row. Cost sensitivity, housing mode and per-criterion weights live on the Ranking tab.'),
    renderModeToggles(),
  );

  return el('div', {}, intro, controls, winsSummary, el('div', { class: 'card' }, matrix));
}

// ============================================================
// Render: my picks (manual ordering + notes + export)
// ============================================================
function renderMyPicks() {
  const picksIds = State.myPicks.filter(id => CITIES.some(c => c.id === id));
  const picks = picksIds.map(id => CITIES.find(c => c.id === id));
  const notInPicks = CITIES.filter(c => !picksIds.includes(c.id)).sort((a,b) => a.name.localeCompare(b.name));

  // Add-a-city dropdown
  const addSel = el('select', { onchange: e => {
    if (!e.target.value) return;
    State.myPicks.push(e.target.value);
    persistMyPicks();
    render();
  }});
  addSel.appendChild(el('option', { value: '' }, 'Add a city…'));
  notInPicks.forEach(c => addSel.appendChild(el('option', { value: c.id }, `${c.name}, ${c.country}`)));

  // Picks list
  const list = el('div');
  if (picks.length === 0) {
    list.appendChild(el('div', { class: 'muted', style: { padding: '1rem 0' } },
      'No cities in your picks yet. Add some from the dropdown above, or click "★ Add to My picks" on any city detail page.'));
  }
  picks.forEach((c, i) => {
    const row = el('div', { class: 'card', style: { padding: '0.6rem 0.85rem' } });
    const header = el('div', { class: 'row between' },
      el('div', { class: 'row', style: { alignItems: 'center', gap: '0.5rem' } },
        el('div', { class: 'mono muted', style: { minWidth: '2rem' } }, '#' + (i + 1)),
        el('strong', { style: { fontSize: '1.05rem', cursor: 'pointer', color: 'var(--accent)' }, onclick: () => go('city', c.id) }, c.name),
        el('span', { class: 'muted' }, c.country),
      ),
      el('div', { class: 'row', style: { gap: '0.25rem' } },
        el('button', { class: 'small', disabled: i === 0 ? '' : null, onclick: () => movePick(i, -1) }, '↑'),
        el('button', { class: 'small', disabled: i === picks.length - 1 ? '' : null, onclick: () => movePick(i, 1) }, '↓'),
        el('button', { class: 'small', onclick: () => moveToTop(i) }, 'Top'),
        el('button', { class: 'small danger', onclick: () => removePick(i) }, '✕'),
      ),
    );
    row.appendChild(header);
    // Notes textarea
    const ta = el('textarea', {
      placeholder: 'Personal notes about ' + c.name + '…',
      style: { width: '100%', minHeight: '2.5rem', marginTop: '0.4rem', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.4rem', fontFamily: 'inherit', fontSize: '0.9rem' },
    });
    ta.value = State.myNotes[c.id] || '';
    ta.addEventListener('input', () => {
      State.myNotes[c.id] = ta.value;
      persistMyNotes();
    });
    row.appendChild(ta);
    list.appendChild(row);
  });

  // Controls
  const intro = el('div', { class: 'card' },
    el('h2', {}, 'My picks'),
    el('p', { class: 'muted' },
      'Build your shortlist in your preferred order. Move cities up/down or to the top. Add personal notes that persist on this browser. Export your picks with all the metadata + your weights via the button below. Use ',
      el('em', {}, '★ Add to My picks'), ' on any city detail to add it.'),
    el('div', { class: 'row', style: { marginTop: '0.5rem' } },
      addSel,
      el('span', { class: 'spacer' }),
      el('button', { class: 'small primary', onclick: () => exportMyPicks() }, '⬇ Export my picks (CSV)'),
      el('button', {
        class: 'small primary',
        'data-tip': 'Copies a URL containing your shortlist and its order. Anyone who opens it sees the same My picks list.',
        onclick: () => copyMyPicksLink(),
      }, 'Copy link to this shortlist'),
      el('button', { class: 'small', onclick: () => clearAllPicks() }, 'Clear all'),
      el('button', { class: 'small', onclick: () => seedFromTop10() }, 'Seed from top 10'),
    ),
  );

  return el('div', {}, intro, el('div', { class: 'card' }, list));
}

function movePick(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= State.myPicks.length) return;
  [State.myPicks[i], State.myPicks[j]] = [State.myPicks[j], State.myPicks[i]];
  persistMyPicks();
  render();
}
function moveToTop(i) {
  const [id] = State.myPicks.splice(i, 1);
  State.myPicks.unshift(id);
  persistMyPicks();
  render();
}
function removePick(i) {
  State.myPicks.splice(i, 1);
  persistMyPicks();
  render();
}
function clearAllPicks() {
  if (!confirm('Clear all My picks and notes?')) return;
  State.myPicks = [];
  State.myNotes = {};
  persistMyPicks();
  persistMyNotes();
  render();
}
function seedFromTop10() {
  // Seed from the SAME ranked list the Ranking tab currently shows: the user's
  // effective weights (raw mode → all ×1) with the cost adjustment applied.
  // currentFilteredList() is that exact pipeline; it also honours the Ranking
  // tab's city selection, so "top 10" means the top 10 the user is looking at.
  const { list } = currentFilteredList();
  State.myPicks = list.slice(0, 10).map(r => r.city.id);
  persistMyPicks();
  render();
}
function persistMyPicks() {
  try { localStorage.setItem('myPicks', JSON.stringify(State.myPicks)); } catch {}
}
function persistMyNotes() {
  try { localStorage.setItem('myNotes', JSON.stringify(State.myNotes)); } catch {}
}
function copyMyPicksLink() {
  const ids = State.myPicks.join(',');
  const link = location.origin + location.pathname + '#/mypicks?picks=' + encodeURIComponent(ids);
  navigator.clipboard.writeText(link).then(() => toast('Picks link copied'));
}
function exportMyPicks() {
  const date = new Date().toISOString().slice(0, 10);
  const weightStr = CRITERIA.map(c => `${c.slug}=${State.weights[c.slug]}`).join(',');
  const rows = [];
  rows.push(['# My picks exported from cities.moiri.dev on ' + date]);
  rows.push(['# Custom weights: ' + weightStr]);
  rows.push([]);
  rows.push(['My rank','City','Country','Weighted (your weights)','Max possible','Personal notes']);
  const { list: weighted, maxScore } = rankCities(State.weights);
  const wByCity = Object.fromEntries(weighted.map(r => [r.city.id, r.total]));
  State.myPicks.forEach((id, i) => {
    const c = CITIES.find(x => x.id === id);
    if (!c) return;
    rows.push([
      String(i + 1),
      c.name,
      c.country,
      fmt(wByCity[c.id] || 0),
      fmt(maxScore),
      State.myNotes[c.id] || '',
    ]);
  });
  const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `my-picks-${date}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('My picks CSV downloaded');
}

// ============================================================
// Render: sources
// ============================================================
function renderSources() {
  const tiers = ['all','1','2','3','4','5','Untiered'];
  const tierBar = el('div', { class: 'tier-filter' },
    ...tiers.map(t => el('button', {
      class: 'small' + (State.sourceTier === t ? ' primary' : ''),
      onclick: () => { State.sourceTier = t; render(); },
    }, t === 'all' ? 'All' : (t === 'Untiered' ? 'Untiered' : 'Tier ' + t))),
  );
  const search = el('input', {
    type: 'search', placeholder: 'Search sources…',
    value: State.sourceQuery,
    style: { width: '300px' },
  });
  search.addEventListener('input', () => {
    State.sourceQuery = search.value;
    renderSourceTable();
  });

  const tableWrap = el('div', { id: 'src-table' });
  const sourceCols = [
    { label: 'Tier',      sortKey: 'tier',  defaultDir: 'asc',  title: 'Source quality tier. T1 = primary government / academic; T5 = SEO content. Lower is better. Click to sort' },
    { label: 'Source',    sortKey: 'name',  defaultDir: 'asc',  title: 'Source name — click to sort alphabetically' },
    { label: 'Citations', sortKey: 'cites', defaultDir: 'desc', title: 'Total times this source is cited across cells. Default sort — most-cited first' },
    { label: 'Origins',   sortKey: null,    title: 'Which CSV the citations come from' },
  ];
  function renderSourceTable() {
    tableWrap.innerHTML = '';
    let rows = SOURCES;
    if (State.sourceTier !== 'all') {
      rows = rows.filter(s => String(s.tier) === State.sourceTier);
    }
    if (State.sourceQuery.trim()) {
      const q = State.sourceQuery.toLowerCase();
      rows = rows.filter(s => s.source.toLowerCase().includes(q) || (s.origins || '').toLowerCase().includes(q));
    }
    rows = applySort('sources', rows, [
      { col: 'cites', get: r => r.citations },
      { col: 'tier',  get: r => typeof r.tier === 'number' ? r.tier : 99 },
      { col: 'name',  get: r => r.source.toLowerCase() },
    ]);
    const t = el('table', { class: 'data' });
    t.appendChild(el('thead', {}, sortHeaderRow('sources', sourceCols, renderSourceTable, 'cites', 'desc')));
    const tb = el('tbody');
    rows.slice(0, 500).forEach(s => {
      const tr = el('tr', {});
      tr.appendChild(el('td', {}, srcTierBadge(typeof s.tier === 'number' ? s.tier : null)));
      tr.appendChild(el('td', {}, el('strong', {}, s.source)));
      tr.appendChild(el('td', { class: 'mono', title: 'Number of cells referencing this source' }, String(s.citations)));
      tr.appendChild(el('td', { class: 'muted' }, s.origins));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    tableWrap.appendChild(t);
    tableWrap.appendChild(el('div', { class: 'muted', style: { marginTop: '0.5rem' } },
      `Showing ${Math.min(rows.length, 500)} of ${rows.length} sources` + (rows.length > 500 ? ' (capped at 500 — refine search to see more)' : '')));
  }
  renderSourceTable();

  return el('div', {},
    el('div', { class: 'card' },
      el('h2', {}, 'Master source index'),
      el('p', { class: 'muted' }, 'Every source cited across the dataset, deduplicated and grouped by quality tier. Click a tier button to filter; type to search by name; click a column header to sort. See the Quick legend for tier meanings.'),
      el('div', { class: 'sources-toolbar' }, tierBar, el('span', { class: 'spacer' }), search),
    ),
    el('div', { class: 'card' }, tableWrap),
  );
}

// ============================================================
// Render: legend (markdown)
// ============================================================
function renderLegend() {
  let md = DATA.legend_md || '';
  // Strip the example weighting-scheme section (the renderer is neutral on weight choice).
  md = md.replace(/##[^\n]*Section H[\s\S]*?(?=^---\s*$|^## )/m, '');
  const html = mdToHtml(md);
  const wrap = el('div', { class: 'card legend-md' });
  wrap.innerHTML = html;
  return el('div', {},
    el('div', { class: 'card' },
      el('h2', {}, 'Methodology & legend'),
      el('p', { class: 'muted' }, "What the flags mean, how the 1–10 score scale works, the five source-quality tiers, and definitions for every criterion. Weights in the ranking tab start at ×1 — adjust them however suits your decision."),
    ),
    renderAnatomyCard(),
    wrap,
  );
}

// Anatomy of a criterion card — example on the left, key list on the right, hover-sync highlight
function renderAnatomyCard() {
  // Build chips manually so they don't pick up the global tooltip handler
  const scoreChipPlain = el('span', { class: 's-chip s-8' }, '8');
  const srcTierPlain = el('span', { class: 'src-tier src-t2' }, 'T2');
  const flagPlain = el('span', { class: 'flag flag-good' }, '✓ cross-checked');

  function ann(key, ...kids) {
    return el('span', { 'data-akey': key }, ...kids);
  }

  const exampleCard = el('div', { class: 'crit-card' });
  exampleCard.appendChild(el('div', { class: 'crit-header' },
    ann('score', scoreChipPlain),
    ann('name', el('span', { class: 'crit-label' }, 'Climbing / bouldering gym')),
    ann('contrib', el('span', { class: 'contrib-bar' },
      el('span', { class: 'mono muted' }, '8×3='),
      el('span', { class: 'cb-val' }, '24'),
      el('span', { class: 'cb-track' }, el('span', { class: 'cb-fill', style: { width: '80%' } })),
    )),
  ));
  exampleCard.appendChild(el('div', { 'data-akey': 'prose', class: 'crit-prose', style: { marginTop: '0.6rem' } },
    'Bouldering ecosystem with N gyms, lead routes within X km, indoor walls up to Y m. Outdoor crag day-trippable from city centre.',
  ));
  exampleCard.appendChild(el('div', { class: 'crit-sources', style: { marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' } },
    ann('tier', srcTierPlain),
    ann('flag', flagPlain),
    ann('sources', el('span', { class: 'muted', style: { fontSize: '0.82rem' } }, 'Gym operator websites, climbingcrag.com, expat reviews (2025–26)')),
  ));

  const keys = [
    { key: 'score',   title: 'Score',             body: 'How this city scored on this criterion (1 = severe weakness, 10 = best-in-set). Colour goes red → amber → green. Hover any score chip in the explorer for the exact descriptor.' },
    { key: 'name',    title: 'Criterion name',    body: 'What is being scored. Full per-criterion rubrics live in the legend section below.' },
    { key: 'contrib', title: 'Contribution',      body: 'score × your weight = how many points this criterion adds to this city\'s ranked total. The amber bar shows magnitude relative to this city\'s biggest contributor. When your weight is 0 the criterion doesn\'t affect the ranking, so its score row is faded — but the prose stays fully readable.' },
    { key: 'prose',   title: 'Prose evidence',    body: 'Concrete synthesis — specific numbers, dates, comparisons. Pulled from the underlying CSV cells; the originals are in the data-bundle download.' },
    { key: 'tier',    title: 'Source tier',       body: 'T1 (primary government / academic / NGO) → T5 (SEO content, downgraded). Lower is better; T4 and below are aggregated user reports or content farms.' },
    { key: 'flag',    title: 'Verification flag', body: 'How independently the cell has been confirmed. ✓ primary = a direct primary source. ✓ cross-checked = verified against 2+ independent sources. ⚠ verify / reduced confidence / unverified = re-check before relying on it.' },
    { key: 'sources', title: 'Sources cited',     body: 'The actual sources backing this cell. Every source in the explorer is listed (with citation counts) on the Sources tab.' },
  ];
  const keyList = el('div', { class: 'anatomy-key' });
  keys.forEach(({ key, title, body }) => {
    keyList.appendChild(el('div', { class: 'key-row', 'data-akey': key },
      el('div', { class: 'key-title' }, title),
      el('div', { class: 'key-body' }, body),
    ));
  });

  const wrap = el('div', { class: 'anatomy' },
    el('div', { class: 'anatomy-example' }, exampleCard),
    keyList,
  );
  setTimeout(() => bindAnatomyHover(wrap), 0);

  return el('div', { class: 'card' },
    el('h2', {}, 'Anatomy of a criterion card'),
    el('p', { class: 'muted' },
      'Hover any element on the example card — or any row in the key — and the matching item on the other side highlights. Every criterion card you see in the explorer follows this template.',
    ),
    wrap,
  );
}

function bindAnatomyHover(container) {
  const els = container.querySelectorAll('[data-akey]');
  els.forEach(node => {
    node.addEventListener('mouseenter', () => {
      const k = node.dataset.akey;
      container.dataset.active = k;
      els.forEach(e => e.classList.toggle('akey-active', e.dataset.akey === k));
    });
    node.addEventListener('mouseleave', () => {
      delete container.dataset.active;
      els.forEach(e => e.classList.remove('akey-active'));
    });
  });
}

// Quick legend popover — accessible from the header. Self-contained reference: no hover tooltips
// inside the popout (the popout IS the reference). Inline labels next to each symbol.
function toggleQuickLegend() {
  const existing = document.getElementById('quick-legend-pop');
  if (existing) { existing.remove(); return; }
  function qlgRow(symbol, label) {
    return el('div', { class: 'qlg-row' }, symbol, el('span', { class: 'qlg-text' }, label));
  }
  const pop = el('div', { class: 'quick-legend-pop', id: 'quick-legend-pop' },
    el('h4', {}, 'Quick legend'),
    el('div', { class: 'qlg-section' },
      el('div', { class: 'qlg-label' }, 'Score scale'),
      el('div', { class: 'qlg-content' },
        el('span', { class: 'muted', style: { fontSize: '0.72rem' } }, 'weak'),
        ...[1,2,3,4,5,6,7,8,9,10].map(n => el('span', { class: 's-chip s-' + n }, String(n))),
        el('span', { class: 'muted', style: { fontSize: '0.72rem' } }, 'strong'),
      ),
    ),
    el('div', { class: 'qlg-section' },
      el('div', { class: 'qlg-label' }, 'Source tier (lower = better)'),
      qlgRow(el('span', { class: 'src-tier src-t1' }, 'T1'), 'primary government / academic / NGO'),
      qlgRow(el('span', { class: 'src-tier src-t2' }, 'T2'), 'reputable news / well-curated wiki'),
      qlgRow(el('span', { class: 'src-tier src-t3' }, 'T3'), 'mid-quality industry'),
      qlgRow(el('span', { class: 'src-tier src-t4' }, 'T4'), 'aggregated user reports (Numbeo, Nomadlist, Reddit)'),
      qlgRow(el('span', { class: 'src-tier src-t5' }, 'T5'), 'SEO content (downgraded)'),
    ),
    el('div', { class: 'qlg-section' },
      el('div', { class: 'qlg-label' }, 'Verification flag'),
      ...FLAG_DESCRIPTIONS.map(f => qlgRow(
        el('span', { class: 'flag ' + (f.match.startsWith('✓') ? 'flag-good' : 'flag-warn') }, f.match),
        f.text,
      )),
    ),
    el('div', { class: 'muted', style: { fontSize: '0.78rem', marginTop: '0.5rem', borderTop: '1px solid var(--border-soft)', paddingTop: '0.5rem' } },
      'Full methodology on the ',
      el('a', { href: '#/legend', onclick: () => { toggleQuickLegend(); } }, 'Methodology'), ' tab.',
    ),
  );
  document.body.appendChild(pop);
}

// Tiny markdown → HTML (handles headers, paragraphs, lists, code, tables, hr, bold/italic)
function mdToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];
    // Code block
    if (line.startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    // Header
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++; continue;
    }
    // HR
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    // Table — proper header + separator + rows
    if (line.includes('|') && i+1 < lines.length && /^\s*\|?\s*[-: ]+\s*\|/.test(lines[i+1])) {
      const headers = splitMdRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitMdRow(lines[i]));
        i++;
      }
      out.push('<table><thead><tr>' + headers.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead>');
      out.push('<tbody>' + rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    // Orphan table rows — author broke the table across a subsection; render as table-without-header
    // Heuristic: a line that starts with `|`, ends with `|`, has 3+ pipes, and the next line also looks like a row
    const looksLikeRow = s => /^\s*\|.*\|\s*$/.test(s) && s.split('|').length >= 3;
    if (looksLikeRow(line) && i+1 < lines.length && looksLikeRow(lines[i+1])) {
      const rows = [];
      while (i < lines.length && looksLikeRow(lines[i])) {
        rows.push(splitMdRow(lines[i]));
        i++;
      }
      out.push('<table class="orphan-rows"><tbody>' +
        rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>');
      continue;
    }
    // List
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      out.push('<ul>' + items.map(x => `<li>${inline(x)}</li>`).join('') + '</ul>');
      continue;
    }
    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push('<ol>' + items.map(x => `<li>${inline(x)}</li>`).join('') + '</ol>');
      continue;
    }
    // Blockquote
    if (line.startsWith('>')) {
      const items = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        items.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      out.push('<blockquote>' + inline(items.join(' ')) + '</blockquote>');
      continue;
    }
    // Paragraph
    if (line.trim() === '') { i++; continue; }
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|>|\s*[-*]\s|\s*\d+\.\s|---)/.test(lines[i]) && !lines[i].startsWith('```') && !(lines[i].includes('|') && i+1 < lines.length && /^\s*\|?\s*[-: ]+\s*\|/.test(lines[i+1]))) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');

  function inline(s) {
    s = escapeHtml(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }
  function splitMdRow(line) {
    return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(s => s.trim());
  }
}

// ============================================================
// Render: about
// ============================================================
function renderAbout() {
  return el('div', { class: 'card legend-md' }, ...mdSection(`
## About this explorer

This is an interactive view over a research dataset prepared for a coliving + coworking hub
that's deciding (a) where to run a popup Jul–Sep 2026 and (b) where to base long-term (3–5+ years).

The underlying data is also available as 5 CSV files (paste-ready for Google Sheets / Excel) plus
121 long-form research markdown files documenting source-by-source diligence.

### How to use

- **Ranking tab** — every weight slider starts at ×1. Push up the criteria you care about, drop
  the ones you don't to 0. Pick which cities to include via the city-subset panel. *Copy share
  link* encodes your weights in the URL so you can send your ranking to someone else.
- **Compare tab** — pick any subset of cities for a side-by-side matrix. Selecting exactly two
  activates head-to-head mode with a Δ column and win counts.
- **City detail tab** — drill into one city's prose, source citations, and per-operator housing
  inventory. ★ Add to My picks to shortlist; Compare with… for quick pairwise.
- **My picks tab** — build a shortlist and reorder manually (the data-driven ranking and the
  hand-curated shortlist are independent — use whichever is more useful for the decision at hand).
  Add personal notes per city; export as CSV.
- **Sources tab** — every source cited across all cells, ranked by citation count, filterable by
  source-quality tier (Tier 1 = primary government / academic, Tier 5 = SEO content downgraded).
- **Methodology tab** — what every flag, tier, score, and criterion definition means.

### Confidence model

Every cell carries a source-quality tier (1–5) and a verification flag (✓ primary, ✓ cross-checked,
⚠ verify, ⚠ reduced confidence, ⚠ unverified). Trust the cells in this order:

- ✓ primary > ✓ cross-checked > ⚠ verify > ⚠ reduced confidence > ⚠ unverified
- Tier 1 (gov / academic / NGO primary) > Tier 2 (reputable news / well-curated wiki) > Tier 3 (mid-quality industry) > Tier 4 (Numbeo / Nomadlist / Reddit aggregated) > Tier 5 (SEO content, downgraded)

### Caveats

- **Scores are normalised within this dataset**, not against a global benchmark. A "9 walkability"
  means "top of this set," not "world-class."
- **Cells are 2026 snapshots** with explicit dates where data is moving (e.g. Mexico V-Dem reclassification,
  Bulgaria 2026 election outcome). Re-verify time-sensitive items before deciding.
- **Horizon-fit is prose-only** in the city detail tab: short notes on popup-window and long-term-base
  fit per city, intended to be read rather than ranked.

### Update cadence

The CSVs are regenerated from markdown source documents under \`outputs/\` whenever new research
lands. This explorer rebuilds via \`web/build_data.py\` → \`data.js\`. Last data refresh:
${DATA.generated_at}.
`));
}

function mdSection(s) {
  const html = mdToHtml(s.trim());
  const div = document.createElement('div');
  div.innerHTML = html;
  return Array.from(div.childNodes);
}

// ============================================================
// Top-level render
// ============================================================
function render() {
  const { tab, params } = parseRoute();
  // tab nav active state
  document.querySelectorAll('nav.tabs a').forEach(a => {
    a.classList.toggle('active', a.dataset.tab === tab);
  });
  const app = $('#app');
  app.innerHTML = '';
  let view;
  switch (tab) {
    case 'rank': view = renderRanking(); break;
    case 'compare': view = renderCompare(); break;
    case 'city': view = renderCityDetail(); break;
    case 'mypicks': view = renderMyPicks(); break;
    case 'sources': view = renderSources(); break;
    case 'legend': view = renderLegend(); break;
    case 'about': view = renderAbout(); break;
    default: view = renderRanking();
  }
  app.appendChild(view);
  // Sync compare cities URL (without re-firing hashchange, so the route stays "compare")
  if (tab === 'compare') {
    const p = new URLSearchParams();
    if (State.compareCities.length) p.set('cities', State.compareCities.join(','));
    setHash('#/compare' + (p.toString() ? '?' + p : ''));
  }
}

// Source count in footer
document.getElementById('src-count').textContent = SOURCES.length.toLocaleString();
document.getElementById('gen-date').textContent = DATA.generated_at;

// Quick legend — hover-triggered. Small delay before closing so users can mouse
// into the popout (e.g., to click the Methodology link).
(function () {
  const btn = document.getElementById('qlg-btn');
  let closeTimer = null;
  let pop = null;
  function open() {
    clearTimeout(closeTimer);
    if (document.getElementById('quick-legend-pop')) return;
    toggleQuickLegend();
    pop = document.getElementById('quick-legend-pop');
    if (pop) {
      pop.addEventListener('mouseenter', () => clearTimeout(closeTimer));
      pop.addEventListener('mouseleave', scheduleClose);
    }
  }
  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      const existing = document.getElementById('quick-legend-pop');
      if (existing) existing.remove();
    }, 220);
  }
  btn.addEventListener('mouseenter', open);
  btn.addEventListener('mouseleave', scheduleClose);
  // Also support keyboard focus
  btn.addEventListener('focus', open);
  btn.addEventListener('blur', scheduleClose);
})();

render();
