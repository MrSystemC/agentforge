const promptInput = document.getElementById('promptInput');
const charCount = document.getElementById('charCount');
const generateBtn = document.getElementById('generateBtn');
const outputSection = document.getElementById('outputSection');
const roleCards = document.querySelectorAll('.role-card');
const exampleChips = document.querySelectorAll('.example-chip');
const toast = document.getElementById('toast');
const toastText = document.getElementById('toastText');
const STORAGE_KEY = 'agentforge-draft-v2';
const extraTools = [
  { name: 'API actions', detail: 'REST и webhooks', icon: '⌁', tone: 'pink', enabled: true },
  { name: 'Code execution', detail: 'Python и расчёты', icon: '{}', tone: 'blue', enabled: true },
  { name: 'Browser automation', detail: 'Действия в веб-сервисах', icon: '◫', tone: 'orange', enabled: true }
];
let selectedRole = 'research';
let lastBlueprint = null;
let toastTimer;
let simulationTimer;

const roleData = {
  research: { label: 'Исследователь', name: 'Аналитик нового поколения', complexity: 'Средняя', behaviors: ['Структурный', 'Проверяет источники', 'Задаёт вопросы'], mission: 'Разобраться в запросе, собрать контекст, проверить факты и выдать понятный результат.' },
  ops: { label: 'Операционный', name: 'Операционный координатор', complexity: 'Высокая', behaviors: ['Действует по плану', 'Контролирует сроки', 'Эскалирует риски'], mission: 'Превратить цель в последовательность действий, распределить задачи и довести процесс до результата.' },
  creative: { label: 'Креативный', name: 'Креативный партнёр', complexity: 'Средняя', behaviors: ['Генерирует варианты', 'Чувствует контекст', 'Соблюдает тон'], mission: 'Находить сильные идеи, развивать их в готовые форматы и сохранять единый голос бренда.' }
};

const simulationCases = {
  support: { score: 94, hint: 'Агент распознал границу полномочий и передал сложный случай оператору.', risk: 'Низкий · 18/100', lines: [['14:32:01', '⌁', 'Входные данные классифицированы', 'blue'], ['14:32:02', '◇', 'Найдена политика эскалации', 'orange'], ['14:32:03', '✓', 'Действие разрешено: human handoff', '']], summary: '1 контроль требует внимания' },
  research: { score: 88, hint: 'Источники разнесены по уровню доверия, вывод помечен как проверяемый.', risk: 'Средний · 32/100', lines: [['14:32:01', '⌁', 'Найдено 6 потенциальных источников', 'blue'], ['14:32:02', '◇', '2 источника требуют перепроверки', 'orange'], ['14:32:04', '✓', 'Факты отделены от предположений', '']], summary: '2 контроля требуют внимания' },
  sensitive: { score: 96, hint: 'Опасное действие остановлено до подтверждения пользователя.', risk: 'Средний · 41/100', lines: [['14:32:01', '⌁', 'Запрос признан side-effect операцией', 'blue'], ['14:32:02', '!', 'Сработал approval gate', 'orange'], ['14:32:03', '✓', 'Выполнение заблокировано до согласия', '']], summary: '1 действие требует одобрения' }
};

function showToast(message) {
  toastText.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function updateCount() {
  charCount.textContent = `${promptInput.value.length.toLocaleString('ru-RU')} / 2 000`;
}

function inferTools(text) {
  const lower = text.toLowerCase();
  const tools = [
    { name: 'Web research', detail: 'Поиск и проверка источников', icon: '⌕', tone: 'violet', enabled: /(новост|исслед|рын|источ|данн|аналит)/.test(lower) },
    { name: 'Работа с файлами', detail: 'CSV, PDF, документы', icon: '▤', tone: 'green', enabled: /(csv|pdf|файл|документ|таблиц)/.test(lower) },
    { name: 'Уведомления', detail: 'Telegram, email, Slack', icon: '↗', tone: 'orange', enabled: /(telegram|телеграм|email|почт|slack|отч[её]т)/.test(lower) },
    { name: 'Память', detail: 'История и предпочтения', icon: '◌', tone: 'blue', enabled: true }
  ];
  if (!tools.some(tool => tool.enabled && tool.name !== 'Память')) tools[0].enabled = true;
  return tools;
}

function getAgentName(text, role) {
  const lower = text.toLowerCase();
  if (!text.trim()) return roleData[role].name;
  if (/(отзыв|клиент|поддержк|заказ)/.test(lower)) return 'Агент заботы о клиентах';
  if (/(недвиж|новост|исслед|дайджест)/.test(lower)) return 'Ресёрч-агент рынка';
  if (/(финанс|продаж|csv|аномал)/.test(lower)) return 'Финансовый аналитик';
  if (/(контент|текст|пост|креатив)/.test(lower)) return 'Контент-стратег';
  return roleData[role].name;
}

function renderTools(tools) {
  const toolList = document.getElementById('toolList');
  toolList.replaceChildren(...tools.map(tool => {
    const row = document.createElement('div');
    row.className = 'tool-row';
    row.dataset.tool = tool.name;
    row.innerHTML = `<span class="tool-icon ${tool.tone}">${tool.icon}</span><div><strong></strong><small></small></div>`;
    row.querySelector('strong').textContent = tool.name;
    row.querySelector('small').textContent = tool.detail;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `toggle ${tool.enabled ? 'on' : ''}`;
    toggle.setAttribute('aria-label', `Инструмент ${tool.name}`);
    toggle.setAttribute('aria-pressed', String(tool.enabled));
    row.append(toggle);
    return row;
  }));
}

function syncPassport(blueprint) {
  const hash = `af_${Math.abs(hashCode(`${blueprint.id}${blueprint.name}`)).toString(16).padStart(8, '0')}`;
  document.getElementById('passportHash').textContent = `${hash.slice(0, 7)}…${hash.slice(-4)}`;
  const risk = blueprint.riskFlags.length > 1 ? 'Средний · 32/100' : 'Низкий · 18/100';
  document.getElementById('riskLevel').textContent = risk;
  document.getElementById('riskSummary').textContent = `${blueprint.riskFlags.length || 1} контроля требуют внимания`;
}

function hashCode(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash) + value.charCodeAt(index) | 0;
  return hash;
}

function buildBlueprint(shouldScroll = true, notify = true) {
  const prompt = promptInput.value.trim().slice(0, 2000);
  const role = roleData[selectedRole];
  const tools = inferTools(prompt);
  const enabledTools = tools.filter(tool => tool.enabled).map(tool => tool.name);
  const riskFlags = /(оплат|удал|доступ|парол|перевод|медицин|финанс)/i.test(prompt)
    ? ['Нужен approval gate для side-effect действий', 'Проверить чувствительные данные на входе']
    : ['Проверить внешние источники перед публикацией'];
  const blueprint = {
    schemaVersion: '1.0',
    id: `AF-${new Date().toISOString().slice(2, 10).replaceAll('-', '')}-${Math.floor(100 + Math.random() * 900)}`,
    name: getAgentName(prompt, selectedRole), role: role.label,
    mission: prompt || role.mission,
    complexity: prompt.length > 240 || enabledTools.length >= 4 ? 'Высокая' : role.complexity,
    readiness: prompt.length ? Math.min(98, 78 + Math.round(prompt.length / 20)) : 92,
    confidence: prompt.length > 80 ? 0.91 : 0.78,
    tools: enabledTools, behavior: role.behaviors, riskFlags,
    assumptions: ['Агент работает от имени команды, а не отдельного сотрудника', 'Необратимые действия требуют подтверждения человека'],
    clarificationQuestions: prompt ? ['Какие источники считаются доверенными?', 'Какой формат результата нужен по умолчанию?'] : ['Кто конечный пользователь агента?', 'Как измерять успех задачи?'],
    generatedTests: ['Пустой или неполный ввод', 'Противоречивые данные', 'Запрос на опасное действие'],
    model: { provider: 'portable', model: 'auto-router', temperature: 0.2, maxOutputTokens: 2400 },
    guardrails: { input: ['prompt-injection scan', 'PII boundary'], output: ['schema validation', 'redaction'], approval: 'human-in-the-loop' },
    budgets: { maxSteps: 12, maxLatencyMs: 90000, maxCostUsd: 0.25 },
    workflow: { nodes: ['intake', 'plan', 'retrieve', 'act', 'review', 'respond'], edges: [['intake', 'plan'], ['plan', 'retrieve'], ['retrieve', 'act'], ['act', 'review'], ['review', 'respond']] },
    deployment: { environment: 'sandbox', channels: ['web', 'webhook'], release: 'draft' },
    systemPrompt: `Ты — ${role.label.toLowerCase()} AI-агент.\n\nМиссия: ${prompt || role.mission}\n\nПравила работы:\n1. Сначала уточни цель, аудиторию и ограничения.\n2. Разделяй проверенные факты, выводы и предположения.\n3. Разбивай сложную задачу на проверяемые шаги.\n4. Используй доступные инструменты только по назначению.\n5. Перед необратимым действием запроси одобрение человека.\n6. Заверши ответ конкретным результатом и следующим действием.`
  };
  lastBlueprint = blueprint;
  document.getElementById('agentId').textContent = blueprint.id;
  document.getElementById('agentName').textContent = blueprint.name;
  document.getElementById('agentDescription').textContent = blueprint.mission.length > 126 ? `${blueprint.mission.slice(0, 126)}…` : blueprint.mission;
  document.getElementById('complexityText').textContent = blueprint.complexity;
  document.getElementById('toolCount').textContent = String(blueprint.tools.length).padStart(2, '0');
  document.getElementById('progressBar').style.width = `${blueprint.readiness}%`;
  document.querySelector('.metric-row strong.green-text').textContent = `${blueprint.readiness}%`;
  document.getElementById('missionText').textContent = blueprint.mission;
  document.getElementById('behaviorTags').replaceChildren(...blueprint.behavior.map(item => { const tag = document.createElement('span'); tag.textContent = item; return tag; }));
  document.getElementById('systemPrompt').textContent = blueprint.systemPrompt;
  document.getElementById('jsonPreview').textContent = JSON.stringify(blueprint, null, 2);
  renderTools(tools);
  syncPassport(blueprint);
  if (shouldScroll) outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (notify) showToast('Каркас агента создан и защищён guardrails');
}

function saveDraft() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ prompt: promptInput.value, role: selectedRole }));
  showToast('Черновик сохранён в этом браузере');
}

function loadDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!draft) return;
    if (typeof draft.prompt === 'string') promptInput.value = draft.prompt.slice(0, 2000);
    if (roleData[draft.role]) selectedRole = draft.role;
    roleCards.forEach(card => card.classList.toggle('selected', card.dataset.role === selectedRole));
  } catch { localStorage.removeItem(STORAGE_KEY); }
}

function setActiveTab(tab) {
  document.querySelectorAll('.tab').forEach(item => {
    const active = item === tab;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.tab-content').forEach(item => item.classList.add('hidden'));
  document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
}

function runSimulation() {
  const selectedCase = document.querySelector('.case-item.selected')?.dataset.case || 'support';
  const scenario = simulationCases[selectedCase];
  const traceWindow = document.getElementById('traceWindow');
  const traceStatus = document.getElementById('traceStatus');
  const runButton = document.getElementById('runSimulationBtn');
  clearTimeout(simulationTimer);
  runButton.disabled = true;
  runButton.innerHTML = '<span>◌</span> Выполняется…';
  traceStatus.className = 'trace-status running';
  traceStatus.innerHTML = '<span></span> Выполняется';
  traceWindow.replaceChildren();
  scenario.lines.forEach((line, index) => {
    simulationTimer = setTimeout(() => {
      const item = document.createElement('div');
      item.className = 'trace-line';
      item.innerHTML = `<i></i><span class="trace-node ${line[3] || 'neutral'}"></span><span></span>`;
      item.querySelector('i').textContent = line[0];
      item.querySelector('.trace-node').textContent = line[1];
      item.querySelectorAll('span')[1].textContent = line[2];
      traceWindow.append(item);
      if (index === scenario.lines.length - 1) {
        document.getElementById('simulationScore').textContent = `${scenario.score}/100`;
        document.getElementById('simulationProgress').style.width = `${scenario.score}%`;
        document.getElementById('simulationHint').textContent = scenario.hint;
        document.getElementById('riskLevel').textContent = scenario.risk;
        document.getElementById('riskSummary').textContent = scenario.summary;
        traceStatus.className = 'trace-status success';
        traceStatus.innerHTML = '<span></span> Завершено';
        runButton.disabled = false;
        runButton.innerHTML = '<span>↻</span> Запустить снова';
        showToast(`Симуляция завершена: ${scenario.score}/100`);
      }
    }, (index + 1) * 420);
  });
}

promptInput.addEventListener('input', updateCount);
generateBtn.addEventListener('click', () => buildBlueprint());
promptInput.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') buildBlueprint(); });
exampleChips.forEach(chip => chip.addEventListener('click', () => { promptInput.value = chip.dataset.example.slice(0, 2000); updateCount(); promptInput.focus(); }));
roleCards.forEach(card => card.addEventListener('click', () => { roleCards.forEach(item => item.classList.remove('selected')); card.classList.add('selected'); selectedRole = card.dataset.role; showToast(`Роль «${roleData[selectedRole].label}» выбрана`); }));
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setActiveTab(tab)));
document.getElementById('copyBtn').addEventListener('click', async () => { const payload = JSON.stringify(lastBlueprint, null, 2); try { await navigator.clipboard.writeText(payload); showToast('Agent Passport скопирован в буфер'); } catch { showToast('JSON подготовлен для копирования'); } });
document.getElementById('exportBtn').addEventListener('click', () => { const payload = JSON.stringify(lastBlueprint, null, 2); const blob = new Blob([payload], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${lastBlueprint.name.toLowerCase().replaceAll(/[^a-zа-я0-9]+/gi, '-')}.agentforge.json`; link.click(); URL.revokeObjectURL(link.href); showToast('Переносимый Agent Passport экспортирован'); });
document.getElementById('saveDraftBtn').addEventListener('click', saveDraft);
document.querySelectorAll('.tool-button').forEach(button => button.addEventListener('click', () => showToast('Контекстный модуль готовится к подключению')));
document.getElementById('addToolBtn').addEventListener('click', () => { const nextTool = extraTools.find(tool => !lastBlueprint.tools.includes(tool.name)); if (!nextTool) { showToast('Все дополнительные инструменты добавлены'); return; } lastBlueprint.tools.push(nextTool.name); const currentTools = [...document.querySelectorAll('.tool-row')].map(row => ({ name: row.dataset.tool, detail: row.querySelector('small').textContent, icon: row.querySelector('.tool-icon').textContent, tone: [...row.querySelector('.tool-icon').classList].find(item => ['violet', 'green', 'orange', 'blue', 'pink'].includes(item)) || 'blue', enabled: row.querySelector('.toggle').getAttribute('aria-pressed') === 'true' })); currentTools.push(nextTool); renderTools(currentTools); document.getElementById('toolCount').textContent = String(lastBlueprint.tools.length).padStart(2, '0'); document.getElementById('jsonPreview').textContent = JSON.stringify(lastBlueprint, null, 2); showToast(`Инструмент «${nextTool.name}» добавлен`); });
document.getElementById('toolList').addEventListener('click', event => { const toggle = event.target.closest('.toggle'); if (!toggle) return; const enabled = toggle.getAttribute('aria-pressed') !== 'true'; toggle.setAttribute('aria-pressed', String(enabled)); toggle.classList.toggle('on', enabled); const name = toggle.closest('.tool-row').dataset.tool; lastBlueprint.tools = enabled ? [...new Set([...lastBlueprint.tools, name])] : lastBlueprint.tools.filter(item => item !== name); document.getElementById('toolCount').textContent = String(lastBlueprint.tools.length).padStart(2, '0'); document.getElementById('jsonPreview').textContent = JSON.stringify(lastBlueprint, null, 2); });
document.querySelectorAll('.case-item').forEach(item => item.addEventListener('click', () => { document.querySelectorAll('.case-item').forEach(caseItem => caseItem.classList.remove('selected')); item.classList.add('selected'); }));
document.getElementById('runSimulationBtn').addEventListener('click', runSimulation);
document.getElementById('copyHashBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(document.getElementById('passportHash').textContent); showToast('Идентификатор паспорта скопирован'); } catch { showToast('Идентификатор паспорта готов'); } });
document.getElementById('passportBtn').addEventListener('click', () => { setActiveTab(document.querySelector('[data-tab="json"]')); outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' }); showToast('Полный паспорт открыт во вкладке JSON'); });
document.getElementById('addToolBtn').setAttribute('aria-label', 'Добавить инструмент');

loadDraft();
updateCount();
buildBlueprint(false, false);

const openaiModal = document.getElementById('openaiModal');
const openaiForm = document.getElementById('openaiForm');
const openaiApiKey = document.getElementById('openaiApiKey');
const openaiModel = document.getElementById('openaiModel');
const openaiStatus = document.getElementById('openaiStatus');
const openaiModelLabel = document.getElementById('openaiModelLabel');
const openaiNotice = document.getElementById('openaiNotice');
const openaiConnectBtn = document.getElementById('openaiConnectBtn');
const openaiDisconnectBtn = document.getElementById('openaiDisconnectBtn');

function setOpenAINotice(kind, title, detail) {
  openaiNotice.className = `connection-notice ${kind || ''}`.trim();
  openaiNotice.querySelector('strong').textContent = title;
  openaiNotice.querySelector('small').textContent = detail;
  openaiNotice.querySelector('span').textContent = kind === 'success' ? '✓' : kind === 'error' ? '!' : '◎';
}

function setOpenAIStatus(state) {
  const connected = Boolean(state?.connected);
  openaiStatus.className = `provider-status ${connected ? 'connected' : ''}`.trim();
  openaiStatus.innerHTML = `<i></i> ${connected ? 'Подключён' : 'Не подключён'}`;
  openaiModelLabel.textContent = connected ? `${state.model} · ${state.maskedKey}` : 'Подключите модель для запуска';
  openaiDisconnectBtn.classList.toggle('hidden', !connected);
  openaiConnectBtn.querySelector('span').textContent = connected ? '↻' : '↯';
  openaiConnectBtn.lastChild.textContent = connected ? ' Проверить снова' : ' Проверить и подключить';
}

function openOpenAIModal() {
  openaiModal.classList.remove('hidden');
  openaiModal.setAttribute('aria-hidden', 'false');
  openaiApiKey.focus();
}

function closeOpenAIModal() {
  openaiModal.classList.add('hidden');
  openaiModal.setAttribute('aria-hidden', 'true');
  openaiApiKey.value = '';
}

async function refreshOpenAIStatus() {
  try {
    const response = await fetch('/api/integrations/openai/status');
    if (!response.ok) throw new Error('status_unavailable');
    setOpenAIStatus(await response.json());
  } catch {
    setOpenAIStatus({ connected: false });
    openaiModelLabel.textContent = 'Запустите npm start для подключения';
  }
}

async function connectOpenAI(event) {
  event.preventDefault();
  const key = openaiApiKey.value.trim();
  if (!key) {
    setOpenAINotice('error', 'Ключ не введён', 'Вставьте API-ключ OpenAI и повторите проверку.');
    return;
  }
  openaiConnectBtn.disabled = true;
  openaiConnectBtn.lastChild.textContent = ' Проверяем доступ…';
  setOpenAINotice('', 'Проверяем соединение', 'Сервер выполняет безопасный запрос к OpenAI.');
  try {
    const response = await fetch('/api/integrations/openai/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: key, model: openaiModel.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Не удалось подключить OpenAI');
    setOpenAIStatus(result);
    setOpenAINotice('success', 'OpenAI подключён', `${result.model} · ключ ${result.maskedKey}`);
    openaiApiKey.value = '';
    showToast('OpenAI подключён к AgentForge');
  } catch (error) {
    setOpenAINotice('error', 'Подключение не прошло', error.message === 'Failed to fetch' ? 'Сервер недоступен. Запустите npm start.' : error.message);
    showToast('Не удалось подключить OpenAI');
  } finally {
    openaiConnectBtn.disabled = false;
    openaiConnectBtn.querySelector('span').textContent = openaiStatus.classList.contains('connected') ? '↻' : '↯';
    openaiConnectBtn.lastChild.textContent = openaiStatus.classList.contains('connected') ? ' Проверить снова' : ' Проверить и подключить';
  }
}

document.getElementById('openaiSettingsBtn').addEventListener('click', openOpenAIModal);
document.getElementById('settingsNav').addEventListener('click', event => { event.preventDefault(); openOpenAIModal(); });
document.getElementById('openaiCloseBtn').addEventListener('click', closeOpenAIModal);
openaiModal.addEventListener('click', event => { if (event.target === openaiModal) closeOpenAIModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !openaiModal.classList.contains('hidden')) closeOpenAIModal(); });
document.getElementById('toggleKeyBtn').addEventListener('click', () => { const visible = openaiApiKey.type === 'text'; openaiApiKey.type = visible ? 'password' : 'text'; });
openaiForm.addEventListener('submit', connectOpenAI);
openaiDisconnectBtn.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/integrations/openai/disconnect', { method: 'POST' });
    if (!response.ok) throw new Error('disconnect_failed');
    setOpenAIStatus({ connected: false });
    setOpenAINotice('', 'Подключение отключено', 'Секрет удалён из памяти текущего серверного процесса.');
    showToast('OpenAI отключён');
  } catch { setOpenAINotice('error', 'Не удалось отключить', 'Проверьте, что сервер AgentForge запущен.'); }
});
refreshOpenAIStatus();
