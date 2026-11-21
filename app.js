const root = document.getElementById('viewRoot');
const toast = document.getElementById('toast');
const toastText = document.getElementById('toastText');
const modalBackdrop = document.getElementById('modalBackdrop');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const fileInput = document.getElementById('contextFileInput');
const passportInput = document.getElementById('passportFileInput');
const authGate = document.getElementById('authGate');
const authError = document.getElementById('authError');
const logoutButton = document.getElementById('logoutButton');
const STORAGE_KEY = 'agentforge-draft-v3';

const roles = {
  research: { label: 'Исследователь', name: 'Аналитик нового поколения', icon: '⌕', tone: 'blue', complexity: 'Средняя', behaviors: ['Структурный', 'Проверяет источники', 'Задаёт вопросы'] },
  ops: { label: 'Операционный', name: 'Операционный координатор', icon: '↻', tone: 'orange', complexity: 'Высокая', behaviors: ['Действует по плану', 'Контролирует сроки', 'Эскалирует риски'] },
  creative: { label: 'Креативный', name: 'Креативный партнёр', icon: '✎', tone: 'pink', complexity: 'Средняя', behaviors: ['Генерирует варианты', 'Чувствует контекст', 'Соблюдает тон'] }
};

const tools = [
  { name: 'Web research', detail: 'Поиск и проверка источников', icon: '⌕', tone: 'violet' },
  { name: 'Работа с файлами', detail: 'CSV, PDF, документы', icon: '▤', tone: 'green' },
  { name: 'Уведомления', detail: 'Telegram, email, Slack', icon: '↗', tone: 'orange' },
  { name: 'Память', detail: 'История и предпочтения', icon: '◌', tone: 'blue' },
  { name: 'API actions', detail: 'REST и webhooks', icon: '⌁', tone: 'pink' },
  { name: 'Code execution', detail: 'Python и расчёты', icon: '{}', tone: 'blue' },
  { name: 'Browser automation', detail: 'Действия в веб-сервисах', icon: '◫', tone: 'orange' }
];

const cases = {
  support: { title: 'Сложный запрос клиента', subtitle: 'Проверка эскалации' },
  research: { title: 'Противоречивые источники', subtitle: 'Проверка фактов' },
  sensitive: { title: 'Опасное действие', subtitle: 'Проверка guardrails' }
};

const state = {
  view: 'studio',
  bootstrap: null,
  agents: [],
  runs: [],
  templates: [],
  stats: { agents: 0, activeAgents: 0, runs: 0, avgScore: 0, templates: 0 },
  settings: {},
  workspace: { name: 'Моя команда', owner: 'Mikle' },
  provider: { connected: false, model: 'gpt-6.2-astra' },
  draft: { prompt: '', role: 'research', context: [] },
  blueprint: null,
  selectedAgent: null,
  lastRun: null,
  selectedCase: 'support',
  activeTab: 'overview',
  agentSearch: '',
  agentStatus: 'all',
  context: [],
  loading: false,
  offline: false,
  authRequired: false
};

let toastTimer;

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function formatDate(value) { if (!value) return '—'; return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function formatNumber(value) { return new Intl.NumberFormat('ru-RU').format(Number(value || 0)); }
function showToast(message, tone = 'success') { toastText.textContent = message; toast.dataset.tone = tone; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 2800); }
function setFooter(message) { document.getElementById('footerState').textContent = message; }
function api(path, options = {}) { const endpoint = path.startsWith('/api/') && !path.startsWith('/api/v1/') ? path.replace('/api/', '/api/v1/') : path; return fetch(endpoint, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options }).then(async (response) => { const body = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(body.message || body.error || `Ошибка ${response.status}`); error.status = response.status; error.code = body.error; if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/status')) showAuthGate(error.message); throw error; } return body; }); }

function showAuthGate(message = '') { authGate.classList.remove('hidden'); authGate.setAttribute('aria-hidden', 'false'); authError.textContent = message; logoutButton.classList.add('hidden'); setFooter('Требуется вход в workspace'); }
function hideAuthGate() { authGate.classList.add('hidden'); authGate.setAttribute('aria-hidden', 'true'); authError.textContent = ''; logoutButton.classList.remove('hidden'); }
function readLocalDraft() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { localStorage.removeItem(STORAGE_KEY); return null; } }

function fallbackSpec() {
  const prompt = state.draft.prompt.trim() || 'Разобраться в задаче, собрать контекст и выдать проверяемый результат.';
  const role = roles[state.draft.role] || roles.research;
  const lower = prompt.toLowerCase();
  const name = [/(отзыв|клиент|поддержк|заказ)/.test(lower) ? 'Агент заботы о клиентах' : null, /(недвиж|новост|исслед|дайджест)/.test(lower) ? 'Ресёрч-агент рынка' : null, /(финанс|продаж|csv|аномал)/.test(lower) ? 'Финансовый аналитик' : null, /(контент|текст|пост|креатив)/.test(lower) ? 'Контент-стратег' : null].find(Boolean) || role.name;
  const selectedTools = tools.filter((tool) => tool.name === 'Память' || /исслед|аналит|новост|файл|csv|telegram|почт|отч[её]т|api|сервис|расч[её]т|код|браузер|автоматиз/i.test(`${prompt} ${tool.name}`)).map((tool) => tool.name);
  if (!selectedTools.some((tool) => tool !== 'Память')) selectedTools.unshift('Web research');
  const riskScore = 18 + (/(оплат|удал|доступ|парол|перевод|медицин|финанс)/i.test(prompt) ? 23 : 0);
  return { schemaVersion: '1.1', id: `AF-LOCAL-${Date.now().toString(36).toUpperCase()}`, name, description: prompt, roleKey: state.draft.role, role: role.label, mission: prompt, tools: [...new Set(selectedTools)], toolDetails: tools.filter((tool) => selectedTools.includes(tool.name)), systemPrompt: `Ты — ${role.label.toLowerCase()} AgentForge. Работай по плану, проверяй входные данные и не выполняй необратимые действия без одобрения человека.`, behaviors: role.behaviors, complexity: role.complexity, riskScore, riskLevel: riskScore >= 35 ? 'Средний' : 'Низкий', riskFlags: ['Проверить внешние источники перед публикацией'], assumptions: ['Необратимые действия выполняются только после одобрения человека'], clarificationQuestions: ['Какой формат результата нужен по умолчанию?'], generatedTests: ['Пустой ввод', 'Противоречивые данные', 'Опасное действие'], workflow: { nodes: ['intake', 'plan', 'retrieve', 'act', 'review', 'respond'] }, memory: { enabled: true, retentionDays: 30 }, budget: { monthlyRuns: 1000 }, version: '1.0.0', status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), passportHash: 'local-preview' };
}

async function loadBootstrap() {
  try {
    state.bootstrap = await api('/api/bootstrap');
    state.agents = state.bootstrap.agents || [];
    state.runs = state.bootstrap.runs || [];
    state.templates = state.bootstrap.templates || [];
    state.stats = state.bootstrap.stats || state.stats;
    state.settings = state.bootstrap.settings || {};
    state.workspace = state.bootstrap.workspace || state.workspace;
    state.provider = state.bootstrap.provider || state.provider;
    state.draft = state.bootstrap.drafts?.studio || state.draft;
    const localDraft = readLocalDraft();
    if (localDraft && !state.draft.prompt) state.draft = { ...state.draft, ...localDraft };
    state.context = Array.isArray(state.draft.context) ? state.draft.context : [];
    state.offline = false;
  } catch (error) {
    if (error.status === 401) { state.offline = false; showAuthGate(); updateShell(); return; }
    state.offline = true;
    const localDraft = readLocalDraft();
    if (localDraft) {
      state.draft = { ...state.draft, ...localDraft };
      state.context = Array.isArray(localDraft.context) ? localDraft.context : [];
    }
    showToast('Работаем в автономном режиме', 'info');
  }
  updateShell();
  render();
}

function updateShell() {
  document.getElementById('workspaceName').textContent = state.workspace.name || 'Моя команда';
  document.getElementById('agentNavCount').textContent = formatNumber(state.stats.agents);
  const status = document.getElementById('connectionStatus');
  status.className = `connection-pill ${state.offline ? 'offline' : 'online'}`;
  status.innerHTML = `<i></i> ${state.offline ? 'Автономный режим' : 'Система онлайн'}`;
  if (state.authRequired && state.bootstrap) logoutButton.classList.remove('hidden');
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view));
  const labels = { studio: ['Студия', 'Новый агент'], agents: ['Рабочее пространство', 'Мои агенты'], templates: ['Рабочее пространство', 'Шаблоны'], runs: ['Контрольный центр', 'Запуски'], docs: ['AgentForge', 'Документация'], settings: ['Рабочее пространство', 'Настройки'] };
  const [rootLabel, current] = labels[state.view] || labels.studio;
  document.getElementById('breadcrumbRoot').textContent = rootLabel;
  document.getElementById('breadcrumbCurrent').textContent = current;
}

function statCard(label, value, detail, tone = 'mint') { return `<div class="stat-card ${tone}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`; }
function emptyState(title, text, action = 'new-agent', actionLabel = 'Создать агента') { return `<div class="empty-state"><div class="empty-orbit">✦</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p><button class="button primary" data-action="${action}" type="button">${escapeHtml(actionLabel)} <span>↗</span></button></div>`; }

function render() {
  updateShell();
  const views = { studio: renderStudio, agents: renderAgents, templates: renderTemplates, runs: renderRuns, docs: renderDocs, settings: renderSettings };
  root.innerHTML = (views[state.view] || renderStudio)();
  bindAfterRender();
}

function renderStudio() {
  const blueprint = state.blueprint;
  return `<section class="hero-block"><div><div class="eyebrow"><span class="eyebrow-dot"></span> AGENT STUDIO <span class="eyebrow-line"></span> RELEASE 2.0</div><h1>Соберите агента,<br /><em>который решает.</em></h1><p class="hero-copy">Спроектируйте цифрового сотрудника, проверьте его границы и сохраните готовый паспорт в рабочем пространстве.</p><div class="hero-actions"><span class="release-badge">● Рабочий релиз</span><span class="muted-label">${state.stats.agents} агентов · ${state.stats.runs} запусков</span></div></div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="core"><span>✦</span></div><div class="art-node node-a">{ }</div><div class="art-node node-b">◉</div><div class="art-node node-c">↗</div></div></section>
  <section class="builder-grid"><form class="prompt-card panel" id="builderForm"><div class="panel-heading"><div><span class="step-number">01</span><div><h2>Опишите задачу</h2><p>Цель, ограничения и ожидаемый результат</p></div></div><span class="live-pill"><span></span> Live builder</span></div><div class="prompt-input-wrap"><textarea id="promptInput" maxlength="2000" aria-label="Описание задачи" spellcheck="false" placeholder="Например: нужен агент, который каждое утро анализирует отзывы клиентов и отправляет команде короткий отчёт...">${escapeHtml(state.draft.prompt)}</textarea><div class="input-meta"><span id="charCount">${state.draft.prompt.length.toLocaleString('ru-RU')} / 2 000</span><span class="input-hint">Ctrl/Cmd + Enter</span></div></div><div class="prompt-footer"><div class="prompt-tools"><button class="tool-button" data-action="attach-context" type="button">＋ Файл</button><button class="tool-button" data-action="save-draft" type="button">● Сохранить</button></div><button class="button primary generate-button" type="submit" ${state.loading ? 'disabled' : ''}><span class="sparkle">✦</span> ${state.loading ? 'Собираем...' : 'Сгенерировать агента'} <span class="button-arrow">↗</span></button></div>${state.context.length ? `<div class="context-strip"><span>Контекст</span>${state.context.map((item) => `<b>${escapeHtml(item.name)}</b>`).join('')}<button type="button" data-action="clear-context" aria-label="Очистить контекст">×</button></div>` : ''}<div class="example-row"><span>Попробуйте пример</span><button class="example-chip" data-example="Собери ресёрч-агента: собирай свежие новости о рынке недвижимости, проверяй источники и делай дайджест для руководителя по понедельникам." type="button">Рынок недвижимости</button><button class="example-chip" data-example="Нужен ассистент поддержки для интернет-магазина: отвечай на вопросы о заказах, находи статус доставки и передавай сложные случаи оператору." type="button">Поддержка клиентов</button><button class="example-chip" data-example="Собери финансового аналитика: загружай CSV с продажами, ищи аномалии, сравнивай месяцы и готовь выводы для руководства." type="button">Финансовый аналитик</button></div></form><div class="right-rail"><div class="mini-card panel"><div class="mini-heading"><span class="step-number">02</span><div><h3>Быстрый старт</h3><p>Выберите специализацию агента</p></div></div><div class="role-list">${Object.entries(roles).map(([key, role]) => `<button class="role-card ${state.draft.role === key ? 'selected' : ''}" data-role="${key}" type="button"><span class="role-icon ${role.tone}">${role.icon}</span><span><strong>${role.label}</strong><small>${role.behaviors[0]}</small></span><span class="role-check">✓</span></button>`).join('')}</div></div><div class="tip-card"><div class="tip-mark">✦</div><div><strong>Добавьте контекст</strong><p>Файлы и ограничения попадут в паспорт и помогут точнее проверить сценарий.</p></div></div><div class="mini-status panel"><span class="status-icon">✓</span><div><strong>${state.provider.connected ? 'AI-провайдер подключён' : 'Локальный генератор готов'}</strong><small>${state.provider.connected ? state.provider.model : 'Можно подключить OpenAI в настройках'}</small></div><button data-view="settings" type="button">↗</button></div></div></section>
  ${blueprint ? renderBlueprint(blueprint) : `<section class="preflight panel"><div class="preflight-icon">◈</div><div><span class="eyebrow">CONTROL PLANE</span><h2>Соберите первый паспорт</h2><p>После генерации здесь появятся системный промт, инструменты, workflow, симуляция и история запусков.</p></div><div class="preflight-list"><span><b>01</b> Спецификация</span><span><b>02</b> Guardrails</span><span><b>03</b> Тестовый запуск</span></div></section>`}
  ${renderRecentActivity()}`;
}

function renderBlueprint(spec) {
  const active = state.activeTab;
  const toolDetails = spec.toolDetails || spec.tools.map((name) => tools.find((tool) => tool.name === name) || { name, detail: 'Модуль', icon: '◈', tone: 'blue' });
  const tabs = [['overview', 'Обзор'], ['prompt', 'Системный промт'], ['workflow', 'Workflow'], ['json', 'JSON']];
  const tabContent = active === 'overview' ? `<div class="overview-columns"><div><span class="block-label">МИССИЯ</span><p>${escapeHtml(spec.mission)}</p><div class="info-grid"><span>Роль<strong>${escapeHtml(spec.role)}</strong></span><span>Память<strong>${spec.memory?.enabled ? `${spec.memory.retentionDays} дней` : 'Отключена'}</strong></span><span>Лимит<strong>${formatNumber(spec.budget?.monthlyRuns || 1000)} / мес.</strong></span></div></div><div><span class="block-label">ПОВЕДЕНИЕ</span><div class="tag-list">${(spec.behaviors || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div><span class="block-label block-label-gap">ВОПРОСЫ ПЕРЕД ЗАПУСКОМ</span><ul class="compact-list">${(spec.clarificationQuestions || []).map((question) => `<li>${escapeHtml(question)}</li>`).join('')}</ul></div></div>` : active === 'prompt' ? `<pre class="code-block">${escapeHtml(spec.systemPrompt)}</pre>` : active === 'workflow' ? `<div class="workflow">${(spec.workflow?.nodes || []).map((node, index) => `<div class="flow-step"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml({ intake: 'Получить задачу', plan: 'Понять контекст', retrieve: 'Найти данные', act: 'Выполнить', review: 'Проверить', respond: 'Отдать результат' }[node] || node)}</strong><small>${escapeHtml(node)}</small></div>${index < (spec.workflow.nodes.length - 1) ? '<i>→</i>' : ''}`).join('')}</div>` : `<pre class="code-block json-code">${escapeHtml(JSON.stringify(spec, null, 2))}</pre>`;
  const lastRun = state.lastRun && state.lastRun.agentId === spec.id ? state.lastRun : null;
  return `<section class="output-section" id="outputSection"><div class="section-heading"><div><div class="eyebrow"><span class="eyebrow-dot"></span> GENERATED AGENT PASSPORT</div><h2>Каркас агента</h2></div><div class="heading-actions"><button class="button outline" data-action="copy-json" type="button">▣ Копировать JSON</button><button class="button secondary" data-action="export-json" type="button">↓ Экспорт</button></div></div><div class="output-grid"><div class="blueprint-card panel"><div class="agent-header"><div class="agent-symbol">✦</div><div class="agent-title"><span class="tiny-label">AGENT ID <b>${escapeHtml(spec.id)}</b></span><h3>${escapeHtml(spec.name)}</h3><p>${escapeHtml(spec.description)}</p></div><span class="status-badge ${escapeHtml(spec.status || 'draft')}">${spec.status === 'active' ? 'Активен' : 'Черновик'}</span></div><div class="metric-row"><div><span>Готовность</span><strong class="green-text">${Math.max(72, 100 - (spec.riskScore || 0) / 4).toFixed(0)}%</strong></div><div><span>Сложность</span><strong>${escapeHtml(spec.complexity || 'Средняя')}</strong></div><div><span>Инструменты</span><strong>${String(spec.tools?.length || 0).padStart(2, '0')}</strong></div><div><span>Версия</span><strong>v${escapeHtml(spec.version || '1.0.0')}</strong></div></div><div class="progress-track"><span style="width:${Math.max(72, 100 - (spec.riskScore || 0) / 4)}%"></span></div><div class="tabs" role="tablist">${tabs.map(([key, label]) => `<button class="tab ${active === key ? 'active' : ''}" data-tab="${key}" type="button" role="tab" aria-selected="${active === key}">${label}</button>`).join('')}</div><div class="tab-content">${tabContent}</div><div class="blueprint-actions"><button class="button primary" data-action="save-agent" type="button">${state.selectedAgent ? 'Сохранить изменения' : 'Сохранить агента'} <span>↗</span></button><button class="button outline" data-action="run-simulation" type="button">▶ Тестовый запуск</button></div></div><div class="side-panels"><div class="side-card panel"><div class="side-card-heading"><div><span class="step-number">03</span><h3>Инструменты</h3></div><span class="tool-count-badge">${spec.tools.length}</span></div><p class="side-subtitle">Что агент умеет делать</p><div class="tool-list">${toolDetails.map((tool) => `<div class="tool-row"><span class="tool-icon ${escapeHtml(tool.tone || 'blue')}">${escapeHtml(tool.icon || '◈')}</span><div><strong>${escapeHtml(tool.name)}</strong><small>${escapeHtml(tool.detail || 'Подключённый модуль')}</small></div><button class="toggle on" data-action="toggle-tool" data-tool="${escapeHtml(tool.name)}" aria-label="Отключить ${escapeHtml(tool.name)}" aria-pressed="true" type="button"></button></div>`).join('')}</div><button class="add-module" data-action="add-tool" type="button">＋ Добавить модуль</button></div><div class="side-card panel runtime-card"><div class="side-card-heading"><div><span class="step-number">04</span><h3>Среда запуска</h3></div><span class="secure-badge">● Secure</span></div><div class="runtime-select"><span class="runtime-logo">◈</span><span><strong>AgentForge Runtime</strong><small>Локальный control plane</small></span><span>⌄</span></div><div class="runtime-meta"><span>Лимит запуска</span><strong>${formatNumber(spec.budget?.monthlyRuns || 1000)} / мес.</strong></div><div class="runtime-meta"><span>Статус</span><strong class="green-text">${state.selectedAgent ? 'Готов к запуску' : 'Нужно сохранить'}</strong></div></div><div class="side-card panel provider-card"><div class="side-card-heading"><div><span class="step-number">07</span><h3>AI-провайдер</h3></div><span class="provider-status ${state.provider.connected ? 'connected' : ''}"><i></i> ${state.provider.connected ? 'Подключён' : 'Не подключён'}</span></div><div class="provider-row"><span class="openai-logo">◎</span><div><strong>${state.provider.connected ? 'OpenAI' : 'Local engine'}</strong><small>${state.provider.connected ? escapeHtml(state.provider.model) : 'Детерминированный режим'}</small></div></div><button class="provider-button" data-view="settings" type="button">Настроить подключение <span>↗</span></button></div></div></div>${lastRun ? renderRunResult(lastRun) : ''}</section>`;
}

function renderRunResult(run) { return `<div class="run-result panel"><div><span class="eyebrow">LAST TEST RUN</span><h3>${escapeHtml(run.caseTitle)} <span class="score-chip">${run.score}/100</span></h3><p>${escapeHtml(run.hint)}</p></div><button class="button outline" data-view="runs" type="button">История запусков ↗</button></div>`; }
function renderRecentActivity() { const items = state.runs.slice(0, 3); return `<section class="activity-section"><div class="section-heading"><div><div class="eyebrow"><span class="eyebrow-dot"></span> ACTIVITY</div><h2>Последняя активность</h2></div><button class="button outline" data-view="runs" type="button">Все запуски ↗</button></div>${items.length ? `<div class="activity-list">${items.map((run) => `<button class="activity-row" data-action="open-run" data-run="${escapeHtml(run.id)}" type="button"><span class="activity-icon ${run.score >= 90 ? 'good' : 'warn'}">${run.score >= 90 ? '✓' : '!'}</span><span><strong>${escapeHtml(run.agentName)}</strong><small>${escapeHtml(run.caseTitle)} · ${formatDate(run.completedAt)}</small></span><b>${run.score}/100</b><span>↗</span></button>`).join('')}</div>` : emptyState('История пока пустая', 'Сохраните агента и запустите первый сценарий, чтобы увидеть доказательства качества.', 'new-agent', 'Создать агента')}</section>`; }

function renderAgents() {
  const filtered = state.agents.filter((agent) => (!state.agentSearch || `${agent.name} ${agent.role} ${agent.tags.join(' ')}`.toLowerCase().includes(state.agentSearch.toLowerCase())) && (state.agentStatus === 'all' || agent.status === state.agentStatus));
  return `<section class="page-heading"><div><div class="eyebrow"><span class="eyebrow-dot"></span> WORKSPACE / AGENTS</div><h1>Мои агенты</h1><p>Сохранённые паспорта, версии и история проверок в одном месте.</p></div><button class="button primary" data-action="new-agent" type="button">＋ Новый агент</button></section><div class="stats-grid">${statCard('Всего агентов', formatNumber(state.stats.agents), `${state.stats.activeAgents} активных`)}${statCard('Тестовых запусков', formatNumber(state.stats.runs), state.stats.runs ? `Средняя оценка ${state.stats.avgScore}/100` : 'Запусков пока нет', 'blue')}${statCard('Шаблонов', formatNumber(state.stats.templates), 'Готовые сценарии', 'violet')}${statCard('Состояние', state.offline ? 'Offline' : 'Online', 'Control plane', state.offline ? 'orange' : 'mint')}</div><section class="list-panel panel"><div class="list-toolbar"><label class="search-box"><span>⌕</span><input id="agentSearch" value="${escapeHtml(state.agentSearch)}" placeholder="Найти агента по имени или инструменту" /></label><div class="filter-group">${[['all', 'Все'], ['active', 'Активные'], ['draft', 'Черновики'], ['paused', 'Пауза']].map(([key, label]) => `<button class="filter-button ${state.agentStatus === key ? 'active' : ''}" data-agent-status="${key}" type="button">${label}</button>`).join('')}</div></div>${filtered.length ? `<div class="agent-list">${filtered.map(renderAgentRow).join('')}</div>` : emptyState('Агенты не найдены', 'Измените запрос или создайте нового цифрового сотрудника.')}</section>`;
}

function renderAgentRow(agent) { const spec = agent.spec || {}; return `<article class="agent-row"><div class="agent-row-symbol">${escapeHtml((agent.role || 'A').slice(0, 1))}</div><div class="agent-row-main"><div class="agent-row-title"><h3>${escapeHtml(agent.name)}</h3><span class="status-badge ${escapeHtml(agent.status)}">${agent.status === 'active' ? 'Активен' : agent.status === 'paused' ? 'Пауза' : 'Черновик'}</span></div><p>${escapeHtml(spec.description || 'Без описания')}</p><div class="tag-list compact">${(agent.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div></div><div class="agent-row-meta"><span>${escapeHtml(agent.role || '—')}</span><small>${agent.runsCount || 0} запусков</small><small>Изменён ${formatDate(agent.updatedAt)}</small></div><div class="agent-row-actions"><button class="button outline" data-action="open-agent" data-agent="${escapeHtml(agent.id)}" type="button">Открыть</button><button class="icon-button" data-action="agent-menu" data-agent="${escapeHtml(agent.id)}" type="button" aria-label="Действия с агентом">•••</button></div></article>`; }

function renderTemplates() { return `<section class="page-heading"><div><div class="eyebrow"><span class="eyebrow-dot"></span> VERIFIED TEMPLATES</div><h1>Шаблоны агентов</h1><p>Проверенные заготовки для типовых задач. Используйте как есть или адаптируйте под свою команду.</p></div><button class="button outline" data-action="import-agent" type="button">Импорт паспорта</button></section><div class="template-grid">${state.templates.map((template) => `<article class="template-card panel ${escapeHtml(template.accent || 'blue')}"><div class="template-top"><span class="template-icon">✦</span><span class="template-category">${escapeHtml(template.category)}</span></div><h3>${escapeHtml(template.name)}</h3><p>${escapeHtml(template.description)}</p><div class="tag-list compact">${template.tools.map((tool) => `<span>${escapeHtml(tool)}</span>`).join('')}</div><button class="button primary" data-action="use-template" data-template="${escapeHtml(template.id)}" type="button">Использовать шаблон <span>↗</span></button></article>`).join('')}</div><section class="template-note panel"><span>◈</span><div><strong>Шаблоны — это отправная точка</strong><p>После использования вы можете изменить инструменты, системный промт, память и правила одобрения перед сохранением агента.</p></div></section>`; }

function renderRuns() { return `<section class="page-heading"><div><div class="eyebrow"><span class="eyebrow-dot"></span> CONTROL PLANE / RUNS</div><h1>Запуски</h1><p>Полная история тестовых прогонов и контроль качества агентов.</p></div><button class="button outline" data-view="agents" type="button">Мои агенты ↗</button></section><div class="stats-grid">${statCard('Всего прогонов', formatNumber(state.stats.runs), 'С сохранением trace', 'blue')}${statCard('Средняя оценка', state.stats.runs ? `${state.stats.avgScore}/100` : '—', state.stats.runs ? 'По всем сценариям' : 'Запустите первый тест', 'mint')}${statCard('Последний статус', state.runs[0]?.status === 'completed' ? 'Готово' : 'Ожидание', state.runs[0] ? formatDate(state.runs[0].completedAt) : 'Нет данных', 'violet')}</div><section class="list-panel panel">${state.runs.length ? `<div class="run-table"><div class="run-table-head"><span>Агент</span><span>Сценарий</span><span>Оценка</span><span>Статус</span><span>Дата</span><span></span></div>${state.runs.map((run) => `<button class="run-table-row" data-action="open-run" data-run="${escapeHtml(run.id)}" type="button"><span><strong>${escapeHtml(run.agentName)}</strong><small>${escapeHtml(run.agentId)}</small></span><span>${escapeHtml(run.caseTitle)}</span><b class="score-text ${run.score >= 90 ? 'good' : 'warn'}">${run.score}/100</b><span class="run-status">${escapeHtml(run.status === 'completed' ? 'Завершён' : run.status)}</span><span>${formatDate(run.completedAt)}</span><span>↗</span></button>`).join('')}</div>` : emptyState('Запусков пока нет', 'Откройте агента и запустите сценарий в Simulation Lab.')}</section>`; }

function renderDocs() { return `<section class="page-heading"><div><div class="eyebrow"><span class="eyebrow-dot"></span> AGENTFORGE DOCS</div><h1>Документация</h1><p>Рабочая модель AgentForge и правила безопасного запуска цифровых сотрудников.</p></div><button class="button outline" data-action="download-docs" type="button">↓ Скачать памятку</button></section><div class="docs-grid"><article class="doc-card panel"><span class="doc-number">01</span><h3>Соберите спецификацию</h3><p>Опишите цель, аудиторию, формат результата и ограничения. Генератор сформирует AgentSpec с миссией, инструментами, workflow и guardrails.</p></article><article class="doc-card panel"><span class="doc-number">02</span><h3>Проверьте границы</h3><p>Risk map показывает чувствительные действия, доступы и места, где требуется одобрение человека. Сценарии Simulation Lab сохраняются в истории.</p></article><article class="doc-card panel"><span class="doc-number">03</span><h3>Сохраните и развивайте</h3><p>Каждый агент хранится в локальном control plane. Его можно открыть, дублировать, экспортировать, импортировать и тестировать повторно.</p></article><article class="doc-card panel"><span class="doc-number">04</span><h3>Подключите провайдера</h3><p>OpenAI подключается отдельно в настройках. Секрет хранится только в памяти текущего серверного процесса и не попадает в паспорт или localStorage.</p></article></div><section class="docs-code panel"><div><span class="eyebrow">API SURFACE</span><h2>Интеграция с control plane</h2></div><pre>GET /api/bootstrap · POST /api/agent-spec · POST /api/agents · POST /api/agents/:id/runs · GET /api/runs · PATCH /api/settings</pre></section>`; }

function renderSettings() { return `<section class="page-heading"><div><div class="eyebrow"><span class="eyebrow-dot"></span> WORKSPACE / SETTINGS</div><h1>Настройки</h1><p>Управляйте рабочим пространством, генерацией и подключением AI-провайдера.</p></div><span class="release-badge">● Рабочий релиз 2.0</span></section><div class="settings-grid"><section class="settings-card panel"><div class="settings-heading"><span class="settings-icon">◈</span><div><h2>Рабочее пространство</h2><p>Название и профиль локальной команды</p></div></div><form id="workspaceForm"><label>Название<input name="workspaceName" value="${escapeHtml(state.workspace.name || '')}" maxlength="80" /></label><label>Владелец<input name="workspaceOwner" value="${escapeHtml(state.workspace.owner || '')}" maxlength="80" /></label><button class="button primary" type="submit">Сохранить настройки</button></form></section><section class="settings-card panel"><div class="settings-heading"><span class="settings-icon">◎</span><div><h2>AI-провайдер</h2><p>Подключение модели для расширенной генерации</p></div><span class="provider-status ${state.provider.connected ? 'connected' : ''}"><i></i> ${state.provider.connected ? 'Подключён' : 'Не подключён'}</span></div><form id="openaiForm"><label>API-ключ OpenAI<div class="secret-input"><input id="openaiApiKey" name="apiKey" type="password" autocomplete="new-password" placeholder="sk-proj-••••••••" minlength="20" /><button type="button" data-action="toggle-key" aria-label="Показать или скрыть ключ">◉</button></div></label><label>Модель<select name="model"><option value="gpt-6.2-astra" ${state.provider.model === 'gpt-6.2-astra' ? 'selected' : ''}>gpt-6.2-astra</option><option value="gpt-6.2-sol" ${state.provider.model === 'gpt-6.2-sol' ? 'selected' : ''}>gpt-6.2-sol</option><option value="gpt-5.6-sol" ${state.provider.model === 'gpt-5.6-sol' ? 'selected' : ''}>gpt-5.6-sol</option></select></label><p class="form-help">Ключ проверяется через официальный API и хранится только в памяти процесса. При перезапуске его потребуется подключить заново.</p><div class="settings-actions"><button class="button primary" type="submit">Проверить и подключить</button>${state.provider.connected ? '<button class="button danger" data-action="disconnect-openai" type="button">Отключить</button>' : ''}</div></form></section><section class="settings-card panel"><div class="settings-heading"><span class="settings-icon">⚙</span><div><h2>Поведение среды</h2><p>Параметры по умолчанию для новых паспортов</p></div></div><form id="defaultsForm"><label>Роль по умолчанию<select name="defaultRole"><option value="research" ${state.settings.defaultRole === 'research' ? 'selected' : ''}>Исследователь</option><option value="ops" ${state.settings.defaultRole === 'ops' ? 'selected' : ''}>Операционный</option><option value="creative" ${state.settings.defaultRole === 'creative' ? 'selected' : ''}>Креативный</option></select></label><label class="switch-label"><span><strong>Уведомления</strong><small>Показывать подтверждения и статусы</small></span><input name="notifications" type="checkbox" ${state.settings.notifications !== false ? 'checked' : ''} /><i></i></label><button class="button outline" type="submit">Сохранить параметры</button></form></section></div>`; }

function bindAfterRender() {
  const input = document.getElementById('promptInput');
  if (input) { input.addEventListener('input', () => { state.draft.prompt = input.value.slice(0, 2000); const count = document.getElementById('charCount'); if (count) count.textContent = `${input.value.length.toLocaleString('ru-RU')} / 2 000`; }); input.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); document.getElementById('builderForm').requestSubmit(); } }); }
  const search = document.getElementById('agentSearch'); if (search) search.addEventListener('input', () => { state.agentSearch = search.value; const list = document.querySelector('.agent-list'); if (list) { const filtered = state.agents.filter((agent) => (!state.agentSearch || `${agent.name} ${agent.role} ${agent.tags.join(' ')}`.toLowerCase().includes(state.agentSearch.toLowerCase())) && (state.agentStatus === 'all' || agent.status === state.agentStatus)); list.innerHTML = filtered.length ? filtered.map(renderAgentRow).join('') : emptyState('Агенты не найдены', 'Измените запрос или создайте нового цифрового сотрудника.'); } });
}

async function generateAgent() { state.loading = true; render(); try { const result = state.offline ? { spec: fallbackSpec() } : { spec: await api('/api/agent-spec', { method: 'POST', body: JSON.stringify({ prompt: state.draft.prompt, role: state.draft.role, toolOverrides: state.blueprint?.tools || [] }) }) }; state.blueprint = result.spec || result; state.selectedAgent = null; state.lastRun = null; state.activeTab = 'overview'; showToast('Паспорт агента собран'); } catch (error) { showToast(error.message, 'error'); } finally { state.loading = false; render(); } }
async function saveDraft() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state.draft, context: state.context })); if (!state.offline) await api('/api/draft', { method: 'PATCH', body: JSON.stringify({ ...state.draft, context: state.context }) }); showToast('Черновик сохранён'); } catch (error) { showToast(`Черновик сохранён локально: ${error.message}`, 'info'); } }
async function saveAgent() { if (!state.blueprint) return generateAgent(); try { const result = state.selectedAgent ? await api(`/api/agents/${state.selectedAgent.id}`, { method: 'PATCH', body: JSON.stringify({ spec: state.blueprint }) }) : await api('/api/agents', { method: 'POST', body: JSON.stringify({ spec: state.blueprint, status: 'draft' }) }); state.selectedAgent = result.agent; state.blueprint = result.agent.spec; await loadBootstrap(); state.view = 'studio'; showToast('Агент сохранён в рабочем пространстве'); } catch (error) { showToast(error.message, 'error'); } }
async function runSimulation() { if (!state.blueprint) return showToast('Сначала соберите паспорт', 'info'); try { if (!state.selectedAgent) { const result = await api('/api/agents', { method: 'POST', body: JSON.stringify({ spec: state.blueprint, status: 'draft' }) }); state.selectedAgent = result.agent; state.blueprint = result.agent.spec; } const result = await api(`/api/agents/${state.selectedAgent.id}/runs`, { method: 'POST', body: JSON.stringify({ caseId: state.selectedCase }) }); state.lastRun = result.run; await loadBootstrap(); state.blueprint = result.agent.spec; state.selectedAgent = result.agent; state.view = 'studio'; showToast(`Сценарий завершён: ${result.run.score}/100`); } catch (error) { showToast(error.message, 'error'); } }

function exportJson() { if (!state.blueprint) return showToast('Нет паспорта для экспорта', 'info'); const blob = new Blob([JSON.stringify(state.blueprint, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${state.blueprint.slug || 'agentforge-agent'}.agentforge.json`; link.click(); URL.revokeObjectURL(url); showToast('Passport экспортирован'); }
async function copyJson() { if (!state.blueprint) return; try { await navigator.clipboard.writeText(JSON.stringify(state.blueprint, null, 2)); showToast('JSON скопирован'); } catch { showToast('Буфер недоступен, используйте экспорт', 'info'); } }
async function openAgent(id) { try { const result = await api(`/api/agents/${encodeURIComponent(id)}`); state.selectedAgent = result.agent; state.blueprint = result.agent.spec; state.lastRun = result.runs?.[0] || null; state.activeTab = 'overview'; state.view = 'studio'; render(); } catch (error) { showToast(error.message, 'error'); } }
async function duplicateAgent(id) { try { await api(`/api/agents/${encodeURIComponent(id)}/duplicate`, { method: 'POST', body: '{}' }); await loadBootstrap(); state.view = 'agents'; showToast('Агент продублирован'); } catch (error) { showToast(error.message, 'error'); } }
async function deleteAgent(id) { const agent = state.agents.find((item) => item.id === id); if (!agent || !window.confirm(`Удалить агента «${agent.name}» и его историю запусков?`)) return; try { await api(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (state.selectedAgent?.id === id) { state.selectedAgent = null; state.blueprint = null; } await loadBootstrap(); state.view = 'agents'; showToast('Агент удалён'); } catch (error) { showToast(error.message, 'error'); } }
function openRun(id) { const run = state.runs.find((item) => item.id === id); if (!run) return; modalTitle.textContent = run.caseTitle; modalBody.innerHTML = `<div class="run-modal-summary"><div class="score-ring">${run.score}</div><div><strong>${escapeHtml(run.agentName)}</strong><p>${escapeHtml(run.hint)}</p><span class="run-status">${escapeHtml(run.status)}</span></div></div><div class="modal-trace">${(run.trace || []).map((line) => `<div class="modal-trace-line"><span>${escapeHtml(line.stage)}</span><b class="trace-node ${escapeHtml(line.tone || '')}">${escapeHtml(line.icon)}</b><strong>${escapeHtml(line.message)}</strong><small>${formatDate(line.at)}</small></div>`).join('')}</div><button class="button primary full" data-action="close-modal" type="button">Готово</button>`; modalBackdrop.classList.remove('hidden'); modalBackdrop.setAttribute('aria-hidden', 'false'); }
function useTemplate(id) { const template = state.templates.find((item) => item.id === id); if (!template) return; state.draft.prompt = template.prompt; state.draft.role = template.role; state.context = []; state.blueprint = null; state.selectedAgent = null; state.view = 'studio'; render(); showToast(`Шаблон «${template.name}» загружен`); }
function clearContext() { state.context = []; showToast('Контекст очищен', 'info'); render(); }
function downloadDocs() { const text = ['# AgentForge — памятка', '', '1. Опишите цель агента.', '2. Проверьте инструменты и guardrails.', '3. Сохраните паспорт и запустите сценарий.', '4. Используйте историю запусков для контроля качества.', ''].join(String.fromCharCode(10)); const blob = new Blob([text], { type: 'text/markdown' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'agentforge-quickstart.md'; link.click(); URL.revokeObjectURL(url); showToast('Памятка скачана'); }

document.addEventListener('click', async (event) => {
  const viewButton = event.target.closest('[data-view]'); if (viewButton) { state.view = viewButton.dataset.view; render(); return; }
  const roleButton = event.target.closest('[data-role]'); if (roleButton) { state.draft.role = roleButton.dataset.role; render(); return; }
  const tabButton = event.target.closest('[data-tab]'); if (tabButton && state.blueprint) { state.activeTab = tabButton.dataset.tab; render(); return; }
  const example = event.target.closest('[data-example]'); if (example) { state.draft.prompt = example.dataset.example; render(); document.getElementById('promptInput')?.focus(); return; }
  const status = event.target.closest('[data-agent-status]'); if (status) { state.agentStatus = status.dataset.agentStatus; render(); return; }
  const actionButton = event.target.closest('[data-action]'); if (!actionButton) return;
  const action = actionButton.dataset.action;
  if (action === 'workspace-menu') { state.view = 'settings'; render(); return; }
  if (action === 'logout') { try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); state.bootstrap = null; state.authRequired = true; showAuthGate('Вы вышли из рабочего пространства'); } catch (error) { showToast(error.message, 'error'); } return; }
  if (action === 'new-agent') { state.view = 'studio'; state.blueprint = null; state.selectedAgent = null; state.lastRun = null; state.draft = { prompt: '', role: state.settings.defaultRole || 'research', context: [] }; state.context = []; render(); return; }
  if (action === 'save-draft') return saveDraft();
  if (action === 'attach-context') return fileInput.click();
  if (action === 'clear-context') return clearContext();
  if (action === 'copy-json') return copyJson();
  if (action === 'export-json') return exportJson();
  if (action === 'save-agent') return saveAgent();
  if (action === 'run-simulation') return runSimulation();
  if (action === 'open-agent') { modalBackdrop.classList.add('hidden'); modalBackdrop.setAttribute('aria-hidden', 'true'); return openAgent(actionButton.dataset.agent); }
  if (action === 'duplicate-agent') { modalBackdrop.classList.add('hidden'); return duplicateAgent(actionButton.dataset.agent); }
  if (action === 'delete-agent') { modalBackdrop.classList.add('hidden'); return deleteAgent(actionButton.dataset.agent); }
  if (action === 'open-run') return openRun(actionButton.dataset.run);
  if (action === 'use-template') return useTemplate(actionButton.dataset.template);
  if (action === 'import-agent') return passportInput.click();
  if (action === 'download-docs') return downloadDocs();
  if (action === 'close-modal') { modalBackdrop.classList.add('hidden'); modalBackdrop.setAttribute('aria-hidden', 'true'); return; }
  if (action === 'toggle-key') { const key = document.getElementById('openaiApiKey'); if (key) key.type = key.type === 'password' ? 'text' : 'password'; return; }
  if (action === 'disconnect-openai') { try { await api('/api/integrations/openai/disconnect', { method: 'POST', body: '{}' }); state.provider = { connected: false, model: 'gpt-6.2-astra' }; render(); showToast('OpenAI отключён'); } catch (error) { showToast(error.message, 'error'); } return; }
  if (action === 'add-tool' && state.blueprint) { const next = tools.find((tool) => !state.blueprint.tools.includes(tool.name)); if (!next) return showToast('Все модули уже добавлены', 'info'); state.blueprint.tools.push(next.name); state.blueprint.toolDetails = [...(state.blueprint.toolDetails || []), next]; render(); return; }
  if (action === 'toggle-tool' && state.blueprint) { const name = actionButton.dataset.tool; const enabled = actionButton.getAttribute('aria-pressed') === 'true'; state.blueprint.tools = enabled ? state.blueprint.tools.filter((item) => item !== name) : [...state.blueprint.tools, name]; actionButton.setAttribute('aria-pressed', String(!enabled)); actionButton.classList.toggle('on', !enabled); return; }
  if (action === 'agent-menu') { const id = actionButton.dataset.agent; modalTitle.textContent = 'Действия с агентом'; modalBody.innerHTML = `<div class="modal-menu"><button data-action="open-agent" data-agent="${escapeHtml(id)}" type="button">Открыть в студии <span>↗</span></button><button data-action="duplicate-agent" data-agent="${escapeHtml(id)}" type="button">Дублировать <span>＋</span></button><button class="danger-menu" data-action="delete-agent" data-agent="${escapeHtml(id)}" type="button">Удалить агента <span>×</span></button></div>`; modalBackdrop.classList.remove('hidden'); modalBackdrop.setAttribute('aria-hidden', 'false'); return; }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.target.id === 'authForm') {
    const data = new FormData(event.target);
    const button = event.target.querySelector('button[type="submit"]');
    button.disabled = true;
    authError.textContent = '';
    try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: data.get('email'), password: data.get('password') }) }); state.authRequired = true; hideAuthGate(); await loadBootstrap(); showToast('Вход выполнен'); } catch (error) { authError.textContent = error.message; } finally { button.disabled = false; }
    return;
  }
  if (event.target.id === 'builderForm') return generateAgent();
  if (event.target.id === 'workspaceForm') { const data = new FormData(event.target); try { await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ workspace: { name: data.get('workspaceName'), owner: data.get('workspaceOwner') } }) }); state.workspace.name = data.get('workspaceName'); state.workspace.owner = data.get('workspaceOwner'); updateShell(); showToast('Рабочее пространство обновлено'); } catch (error) { showToast(error.message, 'error'); } return; }
  if (event.target.id === 'defaultsForm') { const data = new FormData(event.target); try { const result = await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ settings: { defaultRole: data.get('defaultRole'), notifications: data.get('notifications') === 'on' } }) }); state.settings = result.settings; showToast('Параметры сохранены'); } catch (error) { showToast(error.message, 'error'); } return; }
  if (event.target.id === 'openaiForm') { const data = new FormData(event.target); const button = event.target.querySelector('button[type="submit"]'); button.disabled = true; try { const result = await api('/api/integrations/openai/connect', { method: 'POST', body: JSON.stringify({ apiKey: data.get('apiKey'), model: data.get('model') }) }); state.provider = result; showToast(`Подключено: ${result.model}`); render(); } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; } }
});

fileInput.addEventListener('change', async () => { const files = [...fileInput.files]; for (const file of files.slice(0, 8)) { const content = await file.text(); state.context.push({ name: file.name, content: content.slice(0, 20000) }); } fileInput.value = ''; render(); showToast(`${files.length} файл(ов) добавлено в контекст`); });
passportInput.addEventListener('change', async () => { const file = passportInput.files[0]; if (!file) return; try { const parsed = JSON.parse(await file.text()); const result = state.offline ? { agent: { spec: parsed, id: parsed.id, name: parsed.name, role: parsed.role, status: 'draft', tags: parsed.tools || [], runsCount: 0 } } : await api('/api/import', { method: 'POST', body: JSON.stringify({ spec: parsed }) }); state.selectedAgent = result.agent; state.blueprint = result.agent.spec; state.view = 'studio'; await loadBootstrap(); showToast('Паспорт импортирован'); } catch (error) { showToast(`Импорт не выполнен: ${error.message}`, 'error'); } finally { passportInput.value = ''; } });
modalBackdrop.addEventListener('click', (event) => { if (event.target === modalBackdrop) { modalBackdrop.classList.add('hidden'); modalBackdrop.setAttribute('aria-hidden', 'true'); } });

async function healthCheck() { try { const health = await api('/api/health'); state.offline = health.status !== 'ok'; setFooter(`Система готова · ${health.version}`); } catch { state.offline = true; setFooter('Автономный режим'); } updateShell(); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
loadBootstrap();
healthCheck();
setInterval(healthCheck, 30000);

