const button = document.getElementById('creator-button');
const menu = document.getElementById('creator-menu');
const emptyView = document.getElementById('empty-view');
const dataView = document.getElementById('data-view');
const botGrid = document.getElementById('bot-grid');
const tagGrid = document.getElementById('tag-grid');
const weekGrid = document.getElementById('week-grid');
const deltaGrid = document.getElementById('delta-grid');
const weeksEmpty = document.getElementById('weeks-empty');
const weeksView = document.getElementById('weeks-view');
const weekDeltasView = document.getElementById('week-deltas-view');
const botContext = document.getElementById('bot-context');
const botNameLabel = document.getElementById('bot-name-label');
const backLink = document.getElementById('back-link');
const pieSection = document.getElementById('pie-section');
const defaultCreatorSelect = document.getElementById('settings-default-creator');
const unlockInput = document.getElementById('settings-unlock-input');
const unlockStatus = document.getElementById('settings-unlock-status');
const eggsSection = document.getElementById('settings-eggs-section');
const eggsList = document.getElementById('settings-eggs-list');
const versionCurrent = document.getElementById('version-current');
const versionCheckButton = document.getElementById('version-check');
const versionStatus = document.getElementById('version-status');
const settingsTabButton = document.querySelector('.tab[data-tab="settings"]');

let currentCreator = null;
let currentTab = 'bots';
let currentTheme = 'teal';

let currentCreatorSummary = null;
let currentCreatorTimeseries = null;

let allBots = [];
let allTags = [];
let allWeeks = [];

let currentBotSort = 'recency';
let currentTagSort = 'popularity';
let currentWeekSort = 'recency';
let currentDeltaSort = 'messages';

let selectedBotId = null;
let selectedTagName = null;
let selectedWeekStart = null;

let menuOpen = false;

let promptConfig = null;
let promptValues = {};
let promptLocked = {};
let promptGender = 'Female';
let promptCopyStatusTimeout = null;

let allEggs = null;
let activeEggs = new Set();
let unlockStatusTimeout = null;
let updateCheckInflight = false;

const STAT_LABELS = {
  creator: ['Bots', 'Messages', 'Chats', 'Avg Retention', 'Followers'],
  bot: ['Release Date', 'Messages', 'Chats', 'Retention', 'Token Count'],
  tag: ['Bot Count', 'Messages', 'Chats', 'Retention', 'Avg per Bot'],
  week: ['Week', 'Messages Gained', 'Chats Gained', 'Active Bots', 'Top Bot'],
};

// Default theme parameters. Bumped toward pastel range — brighter mid-lightness
// with slight desaturation. Dark text on accent (light enough that white fails contrast).
const THEME_DEFAULTS = {
  sat: 80,
  accent: 38,
  accentHover: 45,
  accentPressed: 30,
  accentLink: 58,
  pie: [68, 63, 58, 53, 48, 44, 40, 36, 32, 28],
  textOnAccent: '#1a1a1a',
};

// Each theme provides at minimum a hue. Themes that need to look different
// (e.g. pastel lavender) override saturation/lightness/text-color.
const THEMES = {
  teal:   { hue: 180 },
  pink: {
    hue: 330,
    sat: 45,
    accent: 72,
    accentHover: 78,
    accentPressed: 62,
    accentLink: 82,
    pie: [88, 84, 80, 76, 72, 68, 64, 60, 56, 52],
    textOnAccent: '#1a1a1a',
  },
  orange: { hue: 30 },
  lime:   { hue: 90 },
  yellow: { hue: 60 },
  lavender: {
    hue: 275,
    sat: 45,
    accent: 72,
    accentHover: 78,
    accentPressed: 62,
    accentLink: 82,
    pie: [88, 84, 80, 76, 72, 68, 64, 60, 56, 52],
    textOnAccent: '#1a1a1a',
  },
};

const PIE_OTHERS_COLOR = '#666666';

function hsl(h, s, l) {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

function themeColors(themeName) {
  const t = { ...THEME_DEFAULTS, ...(THEMES[themeName] || THEMES.teal) };
  return {
    accent: hsl(t.hue, t.sat, t.accent),
    accentHover: hsl(t.hue, t.sat, t.accentHover),
    accentPressed: hsl(t.hue, t.sat, t.accentPressed),
    accentLink: hsl(t.hue, t.sat, t.accentLink),
    pieColors: t.pie.map(l => hsl(t.hue, t.sat, l)).concat([PIE_OTHERS_COLOR]),
    textOnAccent: t.textOnAccent,
  };
}

function applyTheme(themeName) {
  if (!THEMES[themeName]) themeName = 'teal';
  currentTheme = themeName;
  const c = themeColors(themeName);
  const root = document.documentElement;
  root.style.setProperty('--accent', c.accent);
  root.style.setProperty('--accent-hover', c.accentHover);
  root.style.setProperty('--accent-pressed', c.accentPressed);
  root.style.setProperty('--accent-link', c.accentLink);
  root.style.setProperty('--text-on-accent', c.textOnAccent);

  document.querySelectorAll('[data-theme-option]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeOption === themeName);
  });

  if (currentCreator) renderActiveTab();
  checkOwlConditions();
}

// === Creator picker ===

async function showMenu() {
  menu.innerHTML = '<div class="creator-menu-loading">Loading...</div>';
  menu.classList.remove('hidden');
  button.classList.add('open');
  menuOpen = true;

  const creators = await window.pywebview.api.list_creators();
  if (!menuOpen) return;

  menu.innerHTML = '';
  if (creators.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'creator-menu-empty';
    empty.textContent = 'No creators found yet.';
    menu.appendChild(empty);
    return;
  }
  for (const name of creators) {
    const item = document.createElement('button');
    item.className = 'creator-menu-item';
    if (name === currentCreator) item.classList.add('current');
    item.textContent = name;
    item.addEventListener('click', () => selectCreator(name));
    menu.appendChild(item);
  }
}

function hideMenu() {
  menu.classList.add('hidden');
  button.classList.remove('open');
  menuOpen = false;
}

async function selectCreator(name) {
  currentCreator = name;
  button.textContent = `${name} Analytics`;
  hideMenu();
  await loadCreatorData(name);
  checkLowercaseConditions();
}

async function loadCreatorData(name) {
  emptyView.classList.add('hidden');
  dataView.classList.remove('hidden');

  const [summary, timeseries, bots, tags, weeks] = await Promise.all([
    window.pywebview.api.get_creator_summary(name),
    window.pywebview.api.get_creator_timeseries(name),
    window.pywebview.api.get_bot_list(name),
    window.pywebview.api.get_tag_list(name),
    window.pywebview.api.get_weekly_report(name),
  ]);

  currentCreatorSummary = summary;
  currentCreatorTimeseries = timeseries;
  allBots = bots;
  allTags = tags;
  allWeeks = weeks;
  selectedBotId = null;
  selectedTagName = null;
  selectedWeekStart = null;

  renderActiveTab();
  checkOwlConditions();
}

// === Tab switching ===

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-body').forEach(b => b.classList.add('hidden'));
  const body = document.getElementById(`${tab}-body`);
  if (body) body.classList.remove('hidden');

  // Hide shared header (stats + graph) for tabs that don't need it.
  const showHeader = tab !== 'prompts' && tab !== 'settings';
  document.querySelector('.stats-row').classList.toggle('hidden', !showHeader);
  document.querySelector('.graph-row').classList.toggle('hidden', !showHeader);

  if (tab === 'settings') {
    populateSettingsForm();
    return;
  }
  if (tab === 'prompts') {
    initPromptTab();
    return;
  }
  renderActiveTab();
}

function renderActiveTab() {
  if (!currentCreator) return;
  if (currentTab === 'bots') {
    if (selectedBotId) {
      const bot = allBots.find(b => b.id === selectedBotId);
      if (bot) renderBotView(bot);
      else renderCreatorView();
    } else {
      renderCreatorView();
    }
    applyBotSort();
  } else if (currentTab === 'tags') {
    if (selectedTagName) {
      const tag = allTags.find(t => t.tag === selectedTagName);
      if (tag) renderTagView(tag);
      else renderCreatorView();
    } else {
      renderCreatorView();
    }
    applyTagSort();
  } else if (currentTab === 'history') {
    if (selectedWeekStart) {
      const week = allWeeks.find(w => w.week_start === selectedWeekStart);
      if (week) renderWeekView(week);
      else renderCreatorView();
    } else {
      renderCreatorView();
    }
    applyWeekSort();
    applyDeltaSort();
  } else {
    renderCreatorView();
  }
}

// === Stats + graph rendering ===

function renderCreatorView() {
  botContext.classList.add('hidden');
  pieSection.classList.add('hidden');

  if (currentTab === 'bots') {
    selectedBotId = null;
  } else if (currentTab === 'tags') {
    selectedTagName = null;
  } else if (currentTab === 'history') {
    selectedWeekStart = null;
    weeksView.classList.remove('hidden');
    weekDeltasView.classList.add('hidden');
  }
  applyCardSelection();

  setStatLabels(STAT_LABELS.creator);
  const s = currentCreatorSummary;
  if (s) {
    setStat(1, formatNum(s.bots));
    setStat(2, formatNum(s.messages));
    setStat(3, formatNum(s.chats));
    setStat(4, s.avg_retention.toFixed(1));
    setStat(5, formatNum(s.follower_count));
  }
  renderGraph(currentCreatorTimeseries || []);
}

async function renderBotView(bot) {
  botNameLabel.textContent = bot.name;
  backLink.textContent = `Back to ${currentCreator} overview`;
  botContext.classList.remove('hidden');
  pieSection.classList.add('hidden');

  selectedBotId = bot.id;
  applyCardSelection();

  setStatLabels(STAT_LABELS.bot);
  setStat(1, formatDate(bot.created_at));
  setStat(2, formatNum(bot.messages));
  setStat(3, formatNum(bot.chats));
  setStat(4, bot.retention.toFixed(1));
  setStat(5, formatNum(bot.tokens));

  const timeseries = await window.pywebview.api.get_bot_timeseries(currentCreator, bot.id);
  renderGraph(timeseries);
}

async function renderTagView(tag) {
  botNameLabel.textContent = tag.tag;
  backLink.textContent = `Back to ${currentCreator} overview`;
  botContext.classList.remove('hidden');
  pieSection.classList.remove('hidden');

  selectedTagName = tag.tag;
  applyCardSelection();

  setStatLabels(STAT_LABELS.tag);
  const avgPerBot = tag.bot_count ? tag.messages / tag.bot_count : 0;
  setStat(1, formatNum(tag.bot_count));
  setStat(2, formatNum(tag.messages));
  setStat(3, formatNum(tag.chats));
  setStat(4, tag.retention.toFixed(1));
  setStat(5, formatNum(Math.round(avgPerBot)));

  const [timeseries, pie] = await Promise.all([
    window.pywebview.api.get_tag_timeseries(currentCreator, tag.tag),
    window.pywebview.api.get_tag_pie(currentCreator, tag.tag),
  ]);
  renderGraph(timeseries);
  renderPie(pie);
}

function renderWeekView(week) {
  const range = `${formatShortDate(week.week_start)} - ${formatShortDate(week.week_end)}`;
  botNameLabel.textContent = range;
  backLink.textContent = `Back to ${currentCreator} overview`;
  botContext.classList.remove('hidden');
  pieSection.classList.remove('hidden');

  selectedWeekStart = week.week_start;
  applyCardSelection();

  weeksView.classList.add('hidden');
  weekDeltasView.classList.remove('hidden');

  setStatLabels(STAT_LABELS.week);
  setStat(1, range);
  setStat(2, '+' + formatNum(week.total_messages_gained));
  setStat(3, '+' + formatNum(week.total_chats_gained));
  setStat(4, formatNum(week.active_bots));
  setStat(5, week.top_bot_name || '--');

  renderGraph(currentCreatorTimeseries || []);
  renderPie(buildWeekPieData(week));
  renderDeltaCards(sortDeltas(week.bots, currentDeltaSort));
}

function buildWeekPieData(week) {
  const sorted = [...week.bots].sort((a, b) => b.messages_gained - a.messages_gained);
  const TOP_N = 10;
  const top = sorted.slice(0, TOP_N).map(b => ({
    name: b.name,
    messages: Math.max(b.messages_gained, 0),
  }));
  const others = sorted.slice(TOP_N);
  if (others.length > 0) {
    const othersMsgs = others.reduce((sum, b) => sum + Math.max(b.messages_gained, 0), 0);
    if (othersMsgs > 0) {
      top.push({ name: `Others (${others.length} bots)`, messages: othersMsgs });
    }
  }
  return top;
}

// === Card selection (shared) ===

function applyCardSelection() {
  document.querySelectorAll('.bot-card').forEach(card => {
    const isBot = card.dataset.botId && card.dataset.botId === selectedBotId;
    const isTag = card.dataset.tagName && card.dataset.tagName === selectedTagName;
    const isWeek = card.dataset.weekStart && card.dataset.weekStart === selectedWeekStart;
    if (isBot || isTag || isWeek) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });
}

// === Bot grid ===

function applyBotSort() {
  const sorted = [...allBots];
  switch (currentBotSort) {
    case 'messages':
      sorted.sort((a, b) => b.messages - a.messages);
      break;
    case 'retention':
      sorted.sort((a, b) => b.retention - a.retention);
      break;
    case 'recency':
    default:
      sorted.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      break;
  }
  renderBotCards(sorted);
}

function renderBotCards(bots) {
  botGrid.innerHTML = '';
  for (const bot of bots) {
    const card = document.createElement('div');
    card.className = 'bot-card';
    if (bot.id === selectedBotId) card.classList.add('selected');
    card.dataset.botId = bot.id;

    const nameEl = document.createElement('div');
    nameEl.className = 'bot-card-name';
    nameEl.textContent = bot.name;
    nameEl.title = bot.name;

    const statsEl = document.createElement('div');
    statsEl.className = 'bot-card-stats';
    statsEl.innerHTML =
      `<div><span class="num">${formatNum(bot.messages)}</span> msgs</div>` +
      `<div><span class="num">${bot.retention.toFixed(1)}</span> retention</div>`;

    card.appendChild(nameEl);
    card.appendChild(statsEl);
    card.addEventListener('click', () => {
      if (bot.id === selectedBotId) renderCreatorView();
      else renderBotView(bot);
    });
    botGrid.appendChild(card);
  }
}

// === Tag grid ===

function applyTagSort() {
  const sorted = [...allTags];
  switch (currentTagSort) {
    case 'messages':
      sorted.sort((a, b) => b.messages - a.messages);
      break;
    case 'retention':
      sorted.sort((a, b) => b.retention - a.retention);
      break;
    case 'alpha':
      sorted.sort((a, b) => a.tag.localeCompare(b.tag));
      break;
    case 'popularity':
    default:
      sorted.sort((a, b) => b.bot_count - a.bot_count);
      break;
  }
  renderTagCards(sorted);
}

function renderTagCards(tags) {
  tagGrid.innerHTML = '';
  for (const tag of tags) {
    const card = document.createElement('div');
    card.className = 'bot-card';
    if (tag.tag === selectedTagName) card.classList.add('selected');
    card.dataset.tagName = tag.tag;

    const nameEl = document.createElement('div');
    nameEl.className = 'bot-card-name';
    nameEl.textContent = tag.tag;
    nameEl.title = tag.tag;

    const statsEl = document.createElement('div');
    statsEl.className = 'bot-card-stats';
    statsEl.innerHTML =
      `<div><span class="num">${formatNum(tag.bot_count)}</span> bots</div>` +
      `<div><span class="num">${formatNum(tag.messages)}</span> msgs</div>`;

    card.appendChild(nameEl);
    card.appendChild(statsEl);
    card.addEventListener('click', () => {
      if (tag.tag === selectedTagName) renderCreatorView();
      else renderTagView(tag);
    });
    tagGrid.appendChild(card);
  }
}

// === Week grid ===

function applyWeekSort() {
  const sorted = [...allWeeks];
  switch (currentWeekSort) {
    case 'messages':
      sorted.sort((a, b) => b.total_messages_gained - a.total_messages_gained);
      break;
    case 'recency':
    default:
      sorted.sort((a, b) => b.week_start.localeCompare(a.week_start));
      break;
  }
  renderWeekCards(sorted);
}

function renderWeekCards(weeks) {
  weekGrid.innerHTML = '';
  if (weeks.length === 0) {
    weekGrid.classList.add('hidden');
    weeksEmpty.classList.remove('hidden');
    return;
  }
  weekGrid.classList.remove('hidden');
  weeksEmpty.classList.add('hidden');

  for (const week of weeks) {
    const card = document.createElement('div');
    card.className = 'bot-card';
    if (week.week_start === selectedWeekStart) card.classList.add('selected');
    card.dataset.weekStart = week.week_start;

    const range = `${formatShortDate(week.week_start)} - ${formatShortDate(week.week_end)}`;
    const nameEl = document.createElement('div');
    nameEl.className = 'bot-card-name';
    nameEl.textContent = range;
    nameEl.title = range;

    const statsEl = document.createElement('div');
    statsEl.className = 'bot-card-stats';
    statsEl.innerHTML =
      `<div><span class="num">+${formatNum(week.total_messages_gained)}</span> msgs</div>` +
      `<div><span class="num">${formatNum(week.active_bots)}</span> bots active</div>`;

    card.appendChild(nameEl);
    card.appendChild(statsEl);
    card.addEventListener('click', () => {
      if (week.week_start === selectedWeekStart) renderCreatorView();
      else renderWeekView(week);
    });
    weekGrid.appendChild(card);
  }
}

// === Bot delta grid (within a week) ===

function applyDeltaSort() {
  if (!selectedWeekStart) return;
  const week = allWeeks.find(w => w.week_start === selectedWeekStart);
  if (!week) return;
  renderDeltaCards(sortDeltas(week.bots, currentDeltaSort));
}

function sortDeltas(bots, sortKey) {
  const sorted = [...bots];
  switch (sortKey) {
    case 'chats':
      sorted.sort((a, b) => b.chats_gained - a.chats_gained);
      break;
    case 'alpha':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'messages':
    default:
      sorted.sort((a, b) => b.messages_gained - a.messages_gained);
      break;
  }
  return sorted;
}

function renderDeltaCards(bots) {
  deltaGrid.innerHTML = '';
  for (const bot of bots) {
    const card = document.createElement('div');
    card.className = 'bot-card';
    card.dataset.deltaBotId = bot.id;

    const nameEl = document.createElement('div');
    nameEl.className = 'bot-card-name';
    nameEl.textContent = bot.name;
    nameEl.title = bot.name;

    const statsEl = document.createElement('div');
    statsEl.className = 'bot-card-stats';
    const msgSign = bot.messages_gained >= 0 ? '+' : '';
    const chatSign = bot.chats_gained >= 0 ? '+' : '';
    statsEl.innerHTML =
      `<div><span class="num">${msgSign}${formatNum(bot.messages_gained)}</span> msgs</div>` +
      `<div><span class="num">${chatSign}${formatNum(bot.chats_gained)}</span> chats</div>`;

    card.appendChild(nameEl);
    card.appendChild(statsEl);
    deltaGrid.appendChild(card);
  }
}

// === Settings ===

async function populateSettingsForm() {
  const settings = await window.pywebview.api.get_settings();
  const creators = await window.pywebview.api.list_creators();
  const version = await window.pywebview.api.get_version();
  versionCurrent.textContent = `Current: v${version}`;

  defaultCreatorSelect.innerHTML = '<option value="">None</option>';
  for (const name of creators) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === settings.default_creator) opt.selected = true;
    defaultCreatorSelect.appendChild(opt);
  }

  document.querySelectorAll('[data-theme-option]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeOption === (settings.theme || 'teal'));
  });

  await renderEggsSection(settings);
}

async function renderEggsSection(settings) {
  if (allEggs === null) {
    allEggs = await window.pywebview.api.get_egg_definitions();
  }
  const unlocked = settings.unlocked_eggs || [];
  const enabled = new Set(settings.enabled_eggs || []);
  activeEggs = new Set(enabled);

  if (unlocked.length === 0) {
    eggsSection.classList.add('hidden');
    eggsList.innerHTML = '';
    return;
  }

  eggsSection.classList.remove('hidden');
  eggsList.innerHTML = '';
  for (const egg of allEggs) {
    if (!unlocked.includes(egg.id)) continue;

    const row = document.createElement('div');
    row.className = 'egg-row';

    const info = document.createElement('div');
    info.className = 'egg-info';

    const name = document.createElement('div');
    name.className = 'egg-name';
    name.textContent = egg.name;

    const desc = document.createElement('div');
    desc.className = 'egg-desc';
    desc.textContent = egg.description;

    info.appendChild(name);
    info.appendChild(desc);

    const toggle = document.createElement('button');
    toggle.className = 'lock-toggle';
    const isEnabled = enabled.has(egg.id);
    if (isEnabled) toggle.classList.add('locked');
    toggle.textContent = isEnabled ? 'On' : 'Off';
    toggle.dataset.eggId = egg.id;
    toggle.addEventListener('click', async () => {
      const newState = !toggle.classList.contains('locked');
      await window.pywebview.api.set_egg_enabled(egg.id, newState);
      toggle.classList.toggle('locked', newState);
      toggle.textContent = newState ? 'On' : 'Off';
      if (newState) activeEggs.add(egg.id);
      else activeEggs.delete(egg.id);
      applyEggs();
    });

    row.appendChild(info);
    row.appendChild(toggle);
    eggsList.appendChild(row);
  }
}

async function tryUnlockEgg(word) {
  const result = await window.pywebview.api.try_unlock_egg(word);
  if (result) {
    showUnlockStatus(`Unlocked: ${result.name}`);
    const settings = await window.pywebview.api.get_settings();
    await renderEggsSection(settings);
    applyEggs();
  }
}

function showUnlockStatus(msg) {
  unlockStatus.textContent = msg;
  unlockStatus.style.opacity = '1';
  clearTimeout(unlockStatusTimeout);
  unlockStatusTimeout = setTimeout(() => {
    unlockStatus.style.opacity = '0';
  }, 2500);
}

async function checkForUpdate(showLoading) {
  if (updateCheckInflight) return;
  updateCheckInflight = true;
  if (showLoading) {
    versionStatus.textContent = 'Checking...';
    versionStatus.className = 'version-status';
  }
  try {
    const result = await window.pywebview.api.check_for_update();
    versionCurrent.textContent = `Current: v${result.current}`;
    if (result.error) {
      versionStatus.textContent = result.error;
      versionStatus.className = 'version-status error';
      return;
    }
    if (result.has_update && result.html_url) {
      renderUpdateAvailable(result);
      settingsTabButton.dataset.updateAvailable = 'true';
    } else {
      versionStatus.textContent = "You're up to date.";
      versionStatus.className = 'version-status ok';
      delete settingsTabButton.dataset.updateAvailable;
    }
  } finally {
    updateCheckInflight = false;
  }
}

function renderUpdateAvailable(result) {
  versionStatus.innerHTML = '';
  versionStatus.className = 'version-status has-update';

  const text = document.createElement('span');
  text.textContent = `New version available: ${result.latest}. `;
  versionStatus.appendChild(text);

  if (result.asset_url) {
    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.className = 'version-update-button';
    updateBtn.textContent = 'Update now';
    updateBtn.addEventListener('click', () => performUpdate(result.asset_url, updateBtn));
    versionStatus.appendChild(updateBtn);
    versionStatus.appendChild(document.createTextNode(' '));
  }

  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'version-link';
  link.textContent = result.asset_url ? 'or open release page' : 'Open release page';
  link.addEventListener('click', () => {
    window.pywebview.api.open_release_page(result.html_url);
  });
  versionStatus.appendChild(link);
}

async function performUpdate(assetUrl, button) {
  if (!assetUrl) return;
  button.disabled = true;
  versionStatus.innerHTML = '';
  versionStatus.className = 'version-status has-update';
  const msg = document.createElement('span');
  msg.textContent = 'Downloading update...';
  versionStatus.appendChild(msg);

  let result;
  try {
    result = await window.pywebview.api.download_and_install_update(assetUrl);
  } catch (e) {
    // Bridge can throw if the app exits mid-call; that's expected on success.
    return;
  }
  if (!result || !result.ok) {
    versionStatus.textContent = (result && result.error) || 'Update failed.';
    versionStatus.className = 'version-status error';
    button.disabled = false;
    return;
  }
  msg.textContent = 'Installing... the app will close in a moment.';
}

// === Egg-specific implementations ===

const SCANDALARI_COLORS = [
  '#c845ff', '#6370ff', '#00ff9e', '#00ff2d',
  '#d2ff00', '#ff8700', '#ff0000', '#ff88ff',
];

const SCANDALARI_TARGETS = [
  '.tab',
  '.bot-card-name',
  '.stat-value',
  '.creator-button',
  '.prompt-gen-title',
  '.empty-title',
  '.settings-section-title',
];

let scandalariInterval = null;

function randScandalariColor() {
  return SCANDALARI_COLORS[Math.floor(Math.random() * SCANDALARI_COLORS.length)];
}

function paintScandalari() {
  for (const sel of SCANDALARI_TARGETS) {
    document.querySelectorAll(sel).forEach((el) => {
      el.style.color = randScandalariColor();
    });
  }
  document.querySelectorAll('.tab.active').forEach((el) => {
    el.style.borderBottomColor = randScandalariColor();
  });
  document.querySelectorAll('.bot-card.selected').forEach((el) => {
    const c = randScandalariColor();
    el.style.borderColor = c;
    el.style.boxShadow = `inset 3px 0 0 ${c}`;
  });
}

function unpaintScandalari() {
  const all = SCANDALARI_TARGETS.concat(['.tab.active', '.bot-card.selected']);
  for (const sel of all) {
    document.querySelectorAll(sel).forEach((el) => {
      el.style.color = '';
      el.style.borderColor = '';
      el.style.borderBottomColor = '';
      el.style.boxShadow = '';
    });
  }
}

const NIKKI_COLORS = ['#ffffff', '#ffd6e0', '#e6d5f5'];
const HEART_SVG =
  '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M12 21.5s-7.5-4.83-7.5-11.5c0-2.5 1.93-4.5 4.5-4.5 1.5 0 2.83.83 3 2 ' +
  '.17-1.17 1.5-2 3-2 2.57 0 4.5 2 4.5 4.5 0 6.67-7.5 11.5-7.5 11.5z"/></svg>';

let nikkiInterval = null;

function spawnHeart() {
  const heart = document.createElement('div');
  heart.className = 'nikki-heart';
  heart.innerHTML = HEART_SVG;
  heart.style.left = (Math.random() * 100) + 'vw';
  const size = 18 + Math.random() * 22;
  heart.style.width = size + 'px';
  heart.style.height = size + 'px';
  heart.style.color = NIKKI_COLORS[Math.floor(Math.random() * NIKKI_COLORS.length)];
  heart.style.animationDuration = (8 + Math.random() * 6) + 's';
  document.body.appendChild(heart);
  setTimeout(() => heart.remove(), 16000);
}

function clearHearts() {
  document.querySelectorAll('.nikki-heart').forEach((h) => h.remove());
}

// Craos — random flicker on UI chunks. Skips whatever's under the mouse.
const CRAOS_TARGETS = [
  '.bot-card',
  '.stat-box',
  '.tab',
  '.creator-button',
  '.graph-section',
  '.prompt-row',
  '.settings-section',
];

let craosTimeout = null;

function craosFlicker() {
  const sel = CRAOS_TARGETS[Math.floor(Math.random() * CRAOS_TARGETS.length)];
  const elements = document.querySelectorAll(sel);
  if (elements.length === 0) return;

  const el = elements[Math.floor(Math.random() * elements.length)];
  if (el.matches(':hover')) return;

  const duration = 50 + Math.random() * 100;
  const prevOpacity = el.style.opacity;
  const prevTransition = el.style.transition;
  el.style.transition = 'none';
  el.style.opacity = '0';
  setTimeout(() => {
    el.style.opacity = prevOpacity;
    setTimeout(() => {
      el.style.transition = prevTransition;
    }, 30);
  }, duration);
}

function scheduleCraos() {
  if (!activeEggs.has('craos')) return;
  craosFlicker();
  craosTimeout = setTimeout(scheduleCraos, 200 + Math.random() * 300);
}

function stopCraos() {
  if (craosTimeout) {
    clearTimeout(craosTimeout);
    craosTimeout = null;
  }
  for (const sel of CRAOS_TARGETS) {
    document.querySelectorAll(sel).forEach((el) => {
      el.style.opacity = '';
      el.style.transition = '';
    });
  }
}

function applyEggs() {
  // CSS-class-driven eggs
  document.body.classList.toggle('egg-lumbridge', activeEggs.has('lumbridge'));
  document.body.classList.toggle('egg-why', activeEggs.has('why'));
  document.body.classList.toggle('egg-lorem', activeEggs.has('lorem_ipsum'));
  document.body.classList.toggle('egg-owl', activeEggs.has('owl'));
  document.body.classList.toggle('egg-trek', activeEggs.has('trek'));
  document.body.classList.toggle('egg-lowercase', activeEggs.has('lowercase'));

  // Absolute Mommy — rename the prompt-gen title
  const promptTitle = document.querySelector('.prompt-gen-title');
  if (promptTitle) {
    promptTitle.textContent = activeEggs.has('absolute_mommy')
      ? 'Mommy Maker'
      : 'Character Concept';
  }

  // Scandalari — periodic color randomizer
  if (activeEggs.has('scandalari')) {
    if (!scandalariInterval) {
      paintScandalari();
      scandalariInterval = setInterval(paintScandalari, 1500);
    }
  } else if (scandalariInterval) {
    clearInterval(scandalariInterval);
    scandalariInterval = null;
    unpaintScandalari();
  }

  // Nikki — periodic heart spawner
  if (activeEggs.has('nikki')) {
    if (!nikkiInterval) {
      spawnHeart();
      nikkiInterval = setInterval(spawnHeart, 750);
    }
  } else if (nikkiInterval) {
    clearInterval(nikkiInterval);
    nikkiInterval = null;
    clearHearts();
  }

  // Craos — random flicker scheduler
  if (activeEggs.has('craos')) {
    if (!craosTimeout) scheduleCraos();
  } else if (craosTimeout) {
    stopCraos();
  }

  // Meta-egg: check Owl unlock conditions every time egg state changes
  checkOwlConditions();
}

// === Absolute Mommy meta-egg ===
// Unlocks when prompt gen has Female + MILF (35+) + Ginger + Athletic.
async function checkAbsoluteMommyConditions() {
  if (!promptConfig) return;
  const female = promptGender === 'Female';
  const milf = promptValues.age_category === 'MILF (35+)';
  const ginger = promptValues.hair_color === 'Ginger';
  const athletic = promptValues.body_type === 'Athletic';
  if (!(female && milf && ginger && athletic)) return;

  try {
    const result = await window.pywebview.api.unlock_egg_by_id('absolute_mommy');
    if (!result) return;
    await window.pywebview.api.set_egg_enabled('absolute_mommy', true);
    activeEggs.add('absolute_mommy');
    showUnlockStatus(`Unlocked: ${result.name}`);
    applyEggs();
    const settings = await window.pywebview.api.get_settings();
    await renderEggsSection(settings);
  } catch (e) {
    console.error('Mommy unlock failed:', e);
  }
}

// === Lowercase Tone meta-egg ===
// Unlocks the first time the user views a creator whose name has no capital
// letters. Auto-enables on first unlock so the effect happens immediately;
// after that it's a regular Settings toggle.
async function checkLowercaseConditions() {
  if (!currentCreator) return;
  if (currentCreator !== currentCreator.toLowerCase()) return;

  try {
    const result = await window.pywebview.api.unlock_egg_by_id('lowercase');
    if (!result) return; // already unlocked or unknown
    await window.pywebview.api.set_egg_enabled('lowercase', true);
    activeEggs.add('lowercase');
    showUnlockStatus(`Unlocked: ${result.name}`);
    applyEggs();
    const settings = await window.pywebview.api.get_settings();
    await renderEggsSection(settings);
  } catch (e) {
    console.error('Lowercase unlock failed:', e);
  }
}

// === Owl meta-egg ===
// Unlocks when: viewing creator "sickynikki" + Lavender theme + Nikki egg enabled.
async function checkOwlConditions() {
  if (!currentCreator) return;
  const isNikkiCreator = currentCreator.toLowerCase() === 'sickynikki';
  const isLavender = currentTheme === 'lavender';
  const isNikkiEgg = activeEggs.has('nikki');
  if (!(isNikkiCreator && isLavender && isNikkiEgg)) return;

  try {
    const result = await window.pywebview.api.unlock_egg_by_id('owl');
    if (!result) return; // already unlocked or unknown
    // Auto-enable so the owl appears immediately
    await window.pywebview.api.set_egg_enabled('owl', true);
    activeEggs.add('owl');
    showUnlockStatus(`Unlocked: ${result.name}`);
    document.body.classList.toggle('egg-owl', true);
    const settings = await window.pywebview.api.get_settings();
    await renderEggsSection(settings);
  } catch (e) {
    console.error('Owl unlock failed:', e);
  }
}

async function saveSettings(patch) {
  const current = await window.pywebview.api.get_settings();
  const next = { ...current, ...patch };
  await window.pywebview.api.set_settings(next);
}

// === Stat helpers ===

function setStat(idx, value) {
  document.getElementById(`stat-${idx}-value`).textContent = value;
}

function setStatLabels(labels) {
  for (let i = 0; i < labels.length; i++) {
    document.getElementById(`stat-${i + 1}-label`).textContent = labels[i];
  }
}

function formatNum(n) {
  if (n === null || n === undefined) return '--';
  return Number(n).toLocaleString('en-US');
}

function formatDate(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatShortDate(iso) {
  if (!iso) return '--';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// === Plotly ===

function renderGraph(timeseries) {
  const c = themeColors(currentTheme);
  const x = timeseries.map(p => p.pulledAt);
  const messages = timeseries.map(p => p.messages);
  const retention = timeseries.map(p => p.retention);

  const traces = [
    {
      x, y: messages,
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Messages',
      line: { color: c.accent, width: 2 },
      marker: { color: c.accent, size: 6 },
      yaxis: 'y',
    },
    {
      x, y: retention,
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Retention',
      line: { color: c.accentLink, width: 2, dash: 'dash' },
      marker: { color: c.accentLink, size: 6 },
      yaxis: 'y2',
    },
  ];

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#a0a0a0', family: 'Segoe UI, sans-serif', size: 12 },
    margin: { l: 70, r: 70, t: 20, b: 50 },
    xaxis: {
      type: 'date',
      gridcolor: '#2a2a2a',
      linecolor: '#2a2a2a',
      tickcolor: '#2a2a2a',
      zerolinecolor: '#2a2a2a',
    },
    yaxis: {
      gridcolor: '#2a2a2a',
      linecolor: '#2a2a2a',
      tickcolor: '#2a2a2a',
      zerolinecolor: '#2a2a2a',
      tickfont: { color: c.accent },
    },
    yaxis2: {
      overlaying: 'y',
      side: 'right',
      gridcolor: 'transparent',
      linecolor: '#2a2a2a',
      tickcolor: '#2a2a2a',
      zerolinecolor: 'transparent',
      tickfont: { color: c.accentLink },
    },
    legend: {
      orientation: 'h',
      x: 1, xanchor: 'right',
      y: 1.08, yanchor: 'bottom',
      bgcolor: 'rgba(0,0,0,0)',
    },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: '#1a1a1a',
      bordercolor: '#2a2a2a',
      font: { color: '#e0e0e0', family: 'Segoe UI, sans-serif' },
    },
  };

  Plotly.newPlot('graph', traces, layout, {
    displaylogo: false,
    displayModeBar: false,
    responsive: true,
  });
}

function renderPie(pieData) {
  const c = themeColors(currentTheme);
  const labels = pieData.map(p => p.name);
  const values = pieData.map(p => p.messages);

  const othersEntry = pieData.find(p => p.name && p.name.startsWith('Others'));
  const hiddenLabels = othersEntry ? [othersEntry.name] : [];

  const trace = {
    type: 'pie',
    labels,
    values,
    textinfo: 'percent',
    textposition: 'inside',
    insidetextfont: { color: '#0f0f0f', family: 'Segoe UI, sans-serif', size: 12 },
    hoverinfo: 'label+value+percent',
    marker: {
      colors: c.pieColors.slice(0, labels.length),
      line: { color: '#0f0f0f', width: 1 },
    },
    hole: 0.35,
    sort: false,
  };

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#a0a0a0', family: 'Segoe UI, sans-serif', size: 11 },
    margin: { l: 10, r: 10, t: 10, b: 10 },
    showlegend: false,
    hoverlabel: {
      bgcolor: '#1a1a1a',
      bordercolor: '#2a2a2a',
      font: { color: '#e0e0e0', family: 'Segoe UI, sans-serif' },
    },
    hiddenlabels: hiddenLabels,
  };

  Plotly.newPlot('pie-chart', [trace], layout, {
    displaylogo: false,
    displayModeBar: false,
    responsive: true,
  });
}

// === Prompt generator ===

async function initPromptTab() {
  if (!promptConfig) {
    promptConfig = await window.pywebview.api.get_prompt_config();
    for (const slot of promptConfig.slots) {
      promptValues[slot.key] = randomFrom(slot.options);
      promptLocked[slot.key] = false;
    }
    promptGender = promptConfig.gender_options.includes('Female')
      ? 'Female'
      : promptConfig.gender_options[0];
  }
  renderPromptUI();
  updateAdlib();
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rollUnlocked() {
  if (!promptConfig) return;
  for (const slot of promptConfig.slots) {
    if (!promptLocked[slot.key]) {
      promptValues[slot.key] = randomFrom(slot.options);
    }
  }
  renderPromptUI();
  updateAdlib();
  checkAbsoluteMommyConditions();
}

function toggleLock(key) {
  promptLocked[key] = !promptLocked[key];
  const btn = document.querySelector(`.lock-toggle[data-slot="${key}"]`);
  if (btn) {
    btn.classList.toggle('locked', promptLocked[key]);
    btn.textContent = promptLocked[key] ? 'Locked' : 'Lock';
  }
}

function makePromptSelect(options, currentValue, onChange) {
  const sel = document.createElement('select');
  sel.className = 'prompt-row-select';
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (opt === currentValue) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function renderPromptUI() {
  const container = document.getElementById('prompt-rows');
  container.innerHTML = '';

  const genderRow = document.createElement('div');
  genderRow.className = 'prompt-row';

  const genderLabel = document.createElement('div');
  genderLabel.className = 'prompt-row-label';
  genderLabel.textContent = 'Gender';

  const genderSelect = makePromptSelect(
    promptConfig.gender_options,
    promptGender,
    (v) => {
      promptGender = v;
      updateAdlib();
      checkAbsoluteMommyConditions();
    },
  );

  const genderSpacer = document.createElement('span');
  genderSpacer.className = 'prompt-row-spacer';

  genderRow.appendChild(genderLabel);
  genderRow.appendChild(genderSelect);
  genderRow.appendChild(genderSpacer);
  container.appendChild(genderRow);

  for (const slot of promptConfig.slots) {
    const row = document.createElement('div');
    row.className = 'prompt-row';

    const label = document.createElement('div');
    label.className = 'prompt-row-label';
    label.textContent = slot.label;

    const lock = document.createElement('button');
    lock.className = 'lock-toggle';
    if (promptLocked[slot.key]) lock.classList.add('locked');
    lock.textContent = promptLocked[slot.key] ? 'Locked' : 'Lock';
    lock.dataset.slot = slot.key;
    lock.addEventListener('click', () => toggleLock(slot.key));

    const select = makePromptSelect(slot.options, promptValues[slot.key], (v) => {
      promptValues[slot.key] = v;
      // Manual select auto-locks: if you picked it, you meant it.
      if (!promptLocked[slot.key]) {
        promptLocked[slot.key] = true;
        lock.classList.add('locked');
        lock.textContent = 'Locked';
      }
      updateAdlib();
      checkAbsoluteMommyConditions();
    });

    row.appendChild(label);
    row.appendChild(select);
    row.appendChild(lock);
    container.appendChild(row);
  }
}

async function updateAdlib() {
  const display = document.getElementById('adlib-display');
  if (!promptConfig) {
    display.textContent = '';
    return;
  }
  const values = {};
  for (const slot of promptConfig.slots) {
    values[slot.key] = promptValues[slot.key];
  }
  try {
    const adlib = await window.pywebview.api.generate_adlib(values, promptGender);
    display.textContent = adlib;
  } catch (e) {
    console.error('Adlib generation failed:', e);
    display.textContent = '(adlib generation failed)';
  }
}

async function copyText(text, successMsg) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    document.body.removeChild(ta);
  }
  showCopyStatus(copied ? successMsg : 'Copy failed.');
}

async function copyPromptList() {
  if (!promptConfig) return;
  const lines = [`Gender: ${promptGender}`];
  for (const slot of promptConfig.slots) {
    lines.push(`${slot.label}: ${promptValues[slot.key]}`);
  }
  await copyText(lines.join('\n'), 'List copied to clipboard.');
}

async function copyPromptAdlib() {
  const adlib = document.getElementById('adlib-display').textContent;
  if (!adlib) return;
  await copyText(adlib, 'Paragraph copied to clipboard.');
}

function showCopyStatus(msg) {
  const el = document.getElementById('prompt-copy-status');
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(promptCopyStatusTimeout);
  promptCopyStatusTimeout = setTimeout(() => {
    el.style.opacity = '0';
  }, 2000);
}

// === Event wiring ===

backLink.addEventListener('click', () => {
  renderCreatorView();
});

button.addEventListener('click', (e) => {
  e.stopPropagation();
  if (menuOpen) hideMenu();
  else showMenu();
});

document.addEventListener('click', (e) => {
  if (!menu.contains(e.target) && e.target !== button) {
    hideMenu();
  }
});

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

document.querySelectorAll('[data-sort-bots]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-sort-bots]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentBotSort = btn.dataset.sortBots;
    applyBotSort();
  });
});

document.querySelectorAll('[data-sort-tags]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-sort-tags]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTagSort = btn.dataset.sortTags;
    applyTagSort();
  });
});

document.querySelectorAll('[data-sort-weeks]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-sort-weeks]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentWeekSort = btn.dataset.sortWeeks;
    applyWeekSort();
  });
});

document.querySelectorAll('[data-sort-deltas]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-sort-deltas]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentDeltaSort = btn.dataset.sortDeltas;
    applyDeltaSort();
  });
});

defaultCreatorSelect.addEventListener('change', () => {
  const value = defaultCreatorSelect.value || null;
  saveSettings({ default_creator: value });
});

document.querySelectorAll('[data-theme-option]').forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.themeOption;
    applyTheme(theme);
    saveSettings({ theme });
  });
});

document.getElementById('prompt-roll').addEventListener('click', rollUnlocked);
document.getElementById('prompt-copy-list').addEventListener('click', copyPromptList);
document.getElementById('prompt-copy-adlib').addEventListener('click', copyPromptAdlib);

unlockInput.addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const value = unlockInput.value;
  unlockInput.value = '';
  if (!value.trim()) return;
  await tryUnlockEgg(value);
});

document.getElementById('settings-kofi').addEventListener('click', () => {
  window.pywebview.api.open_kofi();
});

versionCheckButton.addEventListener('click', () => {
  checkForUpdate(true);
});

// === Init ===

function whenReady(callback) {
  if (window.pywebview && window.pywebview.api) callback();
  else window.addEventListener('pywebviewready', callback);
}

whenReady(async () => {
  try {
    const settings = await window.pywebview.api.get_settings();
    activeEggs = new Set(settings.enabled_eggs || []);
    applyTheme(settings.theme || 'teal');
    applyEggs();
    if (settings.default_creator) {
      await selectCreator(settings.default_creator);
    }
    checkForUpdate(false).catch(() => {});
  } catch (e) {
    console.error('Init failed:', e);
  }
});
