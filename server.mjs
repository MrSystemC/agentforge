import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const dataDir = join(root, 'data');
const dataFile = process.env.AGENTFORGE_DATA_FILE || join(dataDir, 'agentforge.json');
const OPENAI_URL = 'https://api.openai.com/v1';
const allowedModels = new Set(['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-5.6-sol']);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

const roleData = {
  research: { label: 'Исследователь', name: 'Аналитик нового поколения', complexity: 'Средняя', behaviors: ['Структурный', 'Проверяет источники', 'Задаёт вопросы'] },
  ops: { label: 'Операционный', name: 'Операционный координатор', complexity: 'Высокая', behaviors: ['Действует по плану', 'Контролирует сроки', 'Эскалирует риски'] },
  creative: { label: 'Креативный', name: 'Креативный партнёр', complexity: 'Средняя', behaviors: ['Генерирует варианты', 'Чувствует контекст', 'Соблюдает тон'] }
};

export const toolCatalog = [
  { name: 'Web research', detail: 'Поиск и проверка источников', icon: '⌕', tone: 'violet', keywords: /новост|исслед|рын|источ|данн|аналит|рынок/i },
  { name: 'Работа с файлами', detail: 'CSV, PDF, документы', icon: '▤', tone: 'green', keywords: /csv|pdf|файл|документ|таблиц|загруз/i },
  { name: 'Уведомления', detail: 'Telegram, email, Slack', icon: '↗', tone: 'orange', keywords: /telegram|телеграм|email|почт|slack|отч[её]т|уведом/i },
  { name: 'Память', detail: 'История и предпочтения', icon: '◌', tone: 'blue', keywords: /памят|истори|предпочт/i },
  { name: 'API actions', detail: 'REST и webhooks', icon: '⌁', tone: 'pink', keywords: /api|webhook|интеграц|сервис/i },
  { name: 'Code execution', detail: 'Python и расчёты', icon: '{}', tone: 'blue', keywords: /python|код|расч[её]т|формул|скрипт/i },
  { name: 'Browser automation', detail: 'Действия в веб-сервисах', icon: '◫', tone: 'orange', keywords: /браузер|сайт|веб|автоматиз/i }
];

export const simulationCases = {
  support: { title: 'Сложный запрос клиента', subtitle: 'Проверка эскалации', score: 94, hint: 'Агент распознал границу полномочий и передал сложный случай оператору.', risk: 'Низкий · 18/100', lines: [['Классификация', '⌁', 'Входные данные классифицированы', 'blue'], ['Guardrail', '◇', 'Найдена политика эскалации', 'orange'], ['Результат', '✓', 'Действие разрешено: human handoff', '']] },
  research: { title: 'Противоречивые источники', subtitle: 'Проверка фактов', score: 88, hint: 'Источники разнесены по уровню доверия, вывод помечен как проверяемый.', risk: 'Средний · 32/100', lines: [['Поиск', '⌁', 'Найдено 6 потенциальных источников', 'blue'], ['Проверка', '◇', '2 источника требуют перепроверки', 'orange'], ['Результат', '✓', 'Факты отделены от предположений', '']] },
  sensitive: { title: 'Опасное действие', subtitle: 'Проверка guardrails', score: 96, hint: 'Опасное действие остановлено до подтверждения пользователя.', risk: 'Средний · 41/100', lines: [['Анализ', '⌁', 'Запрос признан side-effect операцией', 'blue'], ['Approval gate', '!', 'Сработал approval gate', 'orange'], ['Результат', '✓', 'Выполнение заблокировано до согласия', '']] }
};

export const templateCatalog = [
  { id: 'tpl-research', name: 'Мониторинг рынка', category: 'Исследования', role: 'research', description: 'Собирает свежие сигналы, проверяет источники и готовит дайджест.', prompt: 'Собирай свежие новости о рынке, проверяй источники и отправляй руководителю короткий дайджест по понедельникам.', tools: ['Web research', 'Уведомления', 'Память'], accent: 'blue' },
  { id: 'tpl-support', name: 'Поддержка клиентов', category: 'Операции', role: 'ops', description: 'Разбирает обращения, находит заказ и эскалирует сложные случаи.', prompt: 'Отвечай на вопросы клиентов интернет-магазина, находи статус доставки и передавай сложные случаи оператору.', tools: ['API actions', 'Уведомления', 'Память'], accent: 'mint' },
  { id: 'tpl-content', name: 'Контент-стратег', category: 'Маркетинг', role: 'creative', description: 'Создаёт идеи и контент в заданном тоне бренда.', prompt: 'Создавай контент-план на месяц, предлагай идеи публикаций и сохраняй голос бренда.', tools: ['Работа с файлами', 'Память'], accent: 'pink' },
  { id: 'tpl-finance', name: 'Финансовый аналитик', category: 'Финансы', role: 'research', description: 'Ищет аномалии в продажах и объясняет динамику показателей.', prompt: 'Загружай CSV с продажами, ищи аномалии, сравнивай месяцы и готовь выводы для руководства.', tools: ['Работа с файлами', 'Code execution', 'Уведомления'], accent: 'orange' }
];

const envOpenAIKey = typeof process.env.OPENAI_API_KEY === 'string' ? process.env.OPENAI_API_KEY.trim() : '';
let openaiConnection = { connected: envOpenAIKey.length >= 20, apiKey: envOpenAIKey || null, maskedKey: envOpenAIKey.length >= 20 ? maskKey(envOpenAIKey) : null, model: allowedModels.has(process.env.OPENAI_MODEL) ? process.env.OPENAI_MODEL : 'gpt-6.2-astra', lastCheckedAt: envOpenAIKey.length >= 20 ? new Date().toISOString() : null };
let writeChain = Promise.resolve();
let store = await loadStore();

function defaultStore() {
  return { version: 1, workspace: { id: 'ws-local', name: 'Моя команда', owner: 'Mikle', plan: 'Pro workspace' }, agents: [], runs: [], drafts: { studio: { prompt: '', role: 'research', context: [] } }, settings: { theme: 'dark', defaultRole: 'research', defaultModel: 'gpt-6.2-astra', notifications: true }, updatedAt: new Date().toISOString() };
}

async function loadStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    const parsed = JSON.parse(await readFile(dataFile, 'utf8'));
    const base = defaultStore();
    return { ...base, ...parsed, workspace: { ...base.workspace, ...(parsed.workspace || {}) }, settings: { ...base.settings, ...(parsed.settings || {}) }, drafts: { ...base.drafts, ...(parsed.drafts || {}) }, agents: Array.isArray(parsed.agents) ? parsed.agents : [], runs: Array.isArray(parsed.runs) ? parsed.runs : [] };
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`AgentForge data reset: ${error.message}`);
    const initial = defaultStore();
    await persistStore(initial);
    return initial;
  }
}

function persistStore(nextStore = store) {
  const snapshot = JSON.stringify({ ...nextStore, updatedAt: new Date().toISOString() }, null, 2);
  writeChain = writeChain.then(async () => { const temporary = `${dataFile}.tmp`; await writeFile(temporary, snapshot, 'utf8'); await rename(temporary, dataFile); });
  return writeChain;
}

function text(value, max = 2000) { return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max).trim(); }
function slugify(value) { return text(value, 80).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '') || 'agent'; }
function now() { return new Date().toISOString(); }
function newId(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`; }
function maskKey(apiKey) { return `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`; }

export function inferTools(prompt) {
  const lower = prompt.toLowerCase();
  const enabled = toolCatalog.filter((tool) => tool.name === 'Память' || tool.keywords.test(lower));
  if (!enabled.some((tool) => tool.name !== 'Память')) enabled.unshift(toolCatalog[0]);
  return enabled.map((tool) => tool.name);
}

function getAgentName(prompt, role) {
  const lower = prompt.toLowerCase();
  if (!prompt.trim()) return roleData[role].name;
  if (/(отзыв|клиент|поддержк|заказ)/.test(lower)) return 'Агент заботы о клиентах';
  if (/(недвиж|новост|исслед|дайджест)/.test(lower)) return 'Ресёрч-агент рынка';
  if (/(финанс|продаж|csv|аномал)/.test(lower)) return 'Финансовый аналитик';
  if (/(контент|текст|пост|креатив)/.test(lower)) return 'Контент-стратег';
  return roleData[role].name;
}

function calculateRisk(prompt, tools) {
  let score = 18;
  if (/(оплат|удал|доступ|парол|перевод|медицин|финанс)/i.test(prompt)) score += 23;
  if (tools.includes('API actions') || tools.includes('Browser automation')) score += 12;
  if (tools.includes('Code execution')) score += 8;
  return Math.min(95, score);
}

export function buildSpec({ prompt = '', role = 'research', toolOverrides = [], name = '' } = {}) {
  const normalizedPrompt = text(prompt, 2000);
  const selectedRole = roleData[role] ? role : 'research';
  const tools = toolOverrides.length ? [...new Set(toolOverrides.map((item) => text(item, 80)).filter(Boolean))] : inferTools(normalizedPrompt);
  const riskScore = calculateRisk(normalizedPrompt, tools);
  const sensitive = riskScore >= 35;
  const timestamp = now();
  const generatedName = text(name, 120) || getAgentName(normalizedPrompt, selectedRole);
  const spec = { schemaVersion: '1.1', id: newId('AF'), slug: slugify(generatedName), name: generatedName, description: normalizedPrompt || 'Проверяемый AI-агент для разбора задачи и подготовки следующих шагов.', roleKey: selectedRole, role: roleData[selectedRole].label, mission: normalizedPrompt || 'Разобраться в задаче, собрать контекст и выдать проверяемый результат.', tools, toolDetails: tools.map((toolName) => toolCatalog.find((tool) => tool.name === toolName) || { name: toolName, detail: 'Подключённый модуль', icon: '◈', tone: 'blue' }), systemPrompt: `Ты — ${roleData[selectedRole].label.toLowerCase()} AgentForge. Сначала уточни цель и ограничения задачи, затем составь план, проверь входные данные и представь результат в согласованном формате. Всегда отделяй факты от предположений. Не выполняй необратимые действия без одобрения человека.`, behaviors: roleData[selectedRole].behaviors, complexity: roleData[selectedRole].complexity, riskScore, riskLevel: riskScore >= 60 ? 'Высокий' : riskScore >= 35 ? 'Средний' : 'Низкий', guardrails: { approval: sensitive ? 'approval-required' : 'human-in-the-loop', input: ['prompt-injection scan', 'PII boundary'], output: ['schema validation', 'redaction'] }, riskFlags: sensitive ? ['Нужен approval gate для side-effect действий', 'Проверить чувствительные данные на входе'] : ['Проверить внешние источники перед публикацией'], assumptions: ['Необратимые действия выполняются только после одобрения человека'], clarificationQuestions: ['Какой формат результата нужен по умолчанию?', 'Какие источники считаются доверенными?'], generatedTests: ['Пустой ввод', 'Противоречивые данные', 'Опасное действие'], workflow: { nodes: ['intake', 'plan', 'retrieve', 'act', 'review', 'respond'], edges: [['intake', 'plan'], ['plan', 'retrieve'], ['retrieve', 'act'], ['act', 'review'], ['review', 'respond']] }, memory: { enabled: tools.includes('Память'), retentionDays: 30, scope: 'workspace' }, budget: { monthlyRuns: 1000, maxRuntimeSeconds: 120 }, deployment: { environment: 'sandbox', channels: ['web', 'webhook'], release: 'draft' }, version: '1.0.0', status: 'draft', createdAt: timestamp, updatedAt: timestamp };
  spec.passportHash = hashSpec(spec);
  return spec;
}

function hashSpec(spec) { return createHash('sha256').update(JSON.stringify({ ...spec, passportHash: undefined })).digest('hex').slice(0, 16); }
function normalizeSpec(input) { const source = input && typeof input === 'object' ? input : {}; const base = buildSpec({ prompt: source.mission || source.description || '', role: source.roleKey || 'research', toolOverrides: Array.isArray(source.tools) ? source.tools : [], name: source.name }); const merged = { ...base, ...source, id: text(source.id, 80) || base.id, name: text(source.name, 120) || base.name, tools: Array.isArray(source.tools) && source.tools.length ? source.tools.map((item) => text(item, 80)) : base.tools, createdAt: source.createdAt || base.createdAt, updatedAt: now() }; merged.riskScore = Number.isFinite(Number(source.riskScore)) ? Number(source.riskScore) : base.riskScore; merged.riskLevel = source.riskLevel || (merged.riskScore >= 60 ? 'Высокий' : merged.riskScore >= 35 ? 'Средний' : 'Низкий'); merged.passportHash = hashSpec(merged); return merged; }
function toAgentRecord(spec, extra = {}) { return { id: spec.id, name: spec.name, role: spec.role, roleKey: spec.roleKey, status: extra.status || spec.status || 'draft', tags: extra.tags || spec.tools.slice(0, 3), spec, runsCount: extra.runsCount || 0, lastRunAt: extra.lastRunAt || null, createdAt: spec.createdAt, updatedAt: spec.updatedAt }; }

export function simulateSpec(spec, caseId = 'support') { const scenario = simulationCases[caseId] || simulationCases.support; return { id: newId('RUN'), agentId: spec.id, agentName: spec.name, caseId, caseTitle: scenario.title, status: 'completed', score: scenario.score, risk: scenario.risk, hint: scenario.hint, trace: scenario.lines.map(([stage, icon, message, tone], index) => ({ index: index + 1, stage, icon, message, tone, at: new Date(Date.now() + index * 500).toISOString() })), startedAt: now(), completedAt: now() }; }
function recentRuns(limit = 8) { return [...store.runs].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, limit); }
function stats() { return { agents: store.agents.length, activeAgents: store.agents.filter((agent) => agent.status === 'active').length, runs: store.runs.length, avgScore: store.runs.length ? Math.round(store.runs.reduce((sum, run) => sum + run.score, 0) / store.runs.length) : 0, templates: templateCatalog.length }; }
function sendJson(response, status, body) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); response.end(JSON.stringify(body)); }
async function readJson(request, limit = 2_000_000) { let body = ''; for await (const chunk of request) { body += chunk; if (body.length > limit) throw Object.assign(new Error('payload_too_large'), { status: 413 }); } try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); } }
function matchAgent(agent, search) { const value = `${agent.name} ${agent.role} ${agent.spec.description} ${agent.tags.join(' ')}`.toLowerCase(); return !search || value.includes(search.toLowerCase()); }
function getAgent(id) { return store.agents.find((agent) => agent.id === id); }
function createAgent(payload) { const spec = normalizeSpec(payload.spec || buildSpec(payload)); const record = toAgentRecord(spec, { status: payload.status || 'draft', tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => text(tag, 40)) : spec.tools.slice(0, 3) }); store.agents.unshift(record); return record; }

async function openaiRequest(path, options = {}) { if (!openaiConnection.apiKey) throw Object.assign(new Error('openai_not_connected'), { status: 409 }); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000); try { return await fetch(`${OPENAI_URL}${path}`, { ...options, signal: controller.signal, headers: { authorization: `Bearer ${openaiConnection.apiKey}`, 'content-type': 'application/json', ...(options.headers || {}) } }); } finally { clearTimeout(timer); } }
async function validateOpenAIKey(apiKey) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000); try { const result = await fetch(`${OPENAI_URL}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: controller.signal }); if (!result.ok) { let detail = 'OpenAI отклонил ключ'; try { detail = (await result.json()).error?.message || detail; } catch { /* keep generic */ } throw Object.assign(new Error(detail), { status: result.status, code: 'openai_auth_failed' }); } } finally { clearTimeout(timer); } }

async function handleOpenAI(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/integrations/openai/status') return sendJson(response, 200, { connected: openaiConnection.connected, maskedKey: openaiConnection.maskedKey, model: openaiConnection.model, lastCheckedAt: openaiConnection.lastCheckedAt });
  if (request.method === 'POST' && pathname === '/api/integrations/openai/connect') { const payload = await readJson(request, 16000); const apiKey = text(payload.apiKey, 300); const model = allowedModels.has(payload.model) ? payload.model : 'gpt-6.2-astra'; if (apiKey.length < 20) return sendJson(response, 400, { error: 'invalid_api_key', message: 'API-ключ выглядит неполным' }); try { await validateOpenAIKey(apiKey); openaiConnection = { connected: true, apiKey, maskedKey: maskKey(apiKey), model, lastCheckedAt: now() }; return sendJson(response, 200, { connected: true, maskedKey: openaiConnection.maskedKey, model, lastCheckedAt: openaiConnection.lastCheckedAt }); } catch (error) { const status = error.name === 'AbortError' ? 504 : (error.status || 502); return sendJson(response, status, { error: error.code || 'openai_connection_failed', message: error.name === 'AbortError' ? 'OpenAI не ответил вовремя' : error.message || 'Не удалось проверить подключение' }); } }
  if (request.method === 'POST' && pathname === '/api/integrations/openai/test') { try { const result = await openaiRequest('/models', { method: 'GET' }); if (!result.ok) return sendJson(response, 502, { error: 'openai_request_failed', message: 'Проверка доступа не прошла' }); openaiConnection.lastCheckedAt = now(); return sendJson(response, 200, { connected: true, maskedKey: openaiConnection.maskedKey, model: openaiConnection.model, lastCheckedAt: openaiConnection.lastCheckedAt }); } catch (error) { return sendJson(response, error.status || 502, { error: error.message || 'Провайдер недоступен' }); } }
  if (request.method === 'POST' && pathname === '/api/integrations/openai/disconnect') { openaiConnection = { connected: false, apiKey: null, maskedKey: null, model: 'gpt-6.2-astra', lastCheckedAt: null }; return sendJson(response, 200, { connected: false }); }
  if (request.method === 'POST' && pathname === '/api/openai/generate') { const payload = await readJson(request, 16000); const prompt = text(payload.prompt, 6000); if (!prompt) return sendJson(response, 400, { error: 'prompt_required' }); try { const result = await openaiRequest('/responses', { method: 'POST', body: JSON.stringify({ model: openaiConnection.model, input: prompt }) }); const data = await result.json(); if (!result.ok) return sendJson(response, result.status, { error: 'openai_generation_failed', message: data.error?.message || 'OpenAI не сформировал ответ' }); return sendJson(response, 200, { model: openaiConnection.model, outputText: data.output_text || '', responseId: data.id || null }); } catch (error) { return sendJson(response, error.status || 502, { error: error.message || 'OpenAI недоступен' }); } }
  return false;
}

async function handleApi(request, response, url) {
  const pathname = url.pathname;
  if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type' }); return response.end(); }
  if (request.method === 'GET' && pathname === '/api/health') return sendJson(response, 200, { status: 'ok', service: 'agentforge-control-plane', version: '1.0.0', openai: openaiConnection.connected, persisted: true, timestamp: now() });
  const openaiHandled = await handleOpenAI(request, response, pathname); if (openaiHandled !== false) return openaiHandled;
  if (request.method === 'GET' && pathname === '/api/bootstrap') return sendJson(response, 200, { workspace: store.workspace, agents: store.agents, runs: recentRuns(12), templates: templateCatalog, drafts: store.drafts, settings: store.settings, stats: stats(), provider: { connected: openaiConnection.connected, model: openaiConnection.model, maskedKey: openaiConnection.maskedKey } });
  if (request.method === 'GET' && pathname === '/api/templates') return sendJson(response, 200, { templates: templateCatalog });
  if (request.method === 'GET' && pathname === '/api/runs') { const agentId = url.searchParams.get('agentId'); const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50))); return sendJson(response, 200, { runs: recentRuns(100).filter((run) => !agentId || run.agentId === agentId).slice(0, limit) }); }
  if (request.method === 'GET' && pathname === '/api/settings') return sendJson(response, 200, { settings: store.settings, workspace: store.workspace, draft: store.drafts.studio });
  if (request.method === 'PATCH' && pathname === '/api/settings') { const payload = await readJson(request, 50000); store.settings = { ...store.settings, ...(payload.settings || {}) }; if (payload.workspace) store.workspace = { ...store.workspace, name: text(payload.workspace.name, 80) || store.workspace.name, owner: text(payload.workspace.owner, 80) || store.workspace.owner }; await persistStore(); return sendJson(response, 200, { settings: store.settings, workspace: store.workspace }); }
  if (request.method === 'PATCH' && pathname === '/api/draft') { const payload = await readJson(request, 50000); store.drafts.studio = { prompt: text(payload.prompt, 2000), role: roleData[payload.role] ? payload.role : 'research', context: Array.isArray(payload.context) ? payload.context.slice(0, 8).map((item) => ({ name: text(item.name, 120), content: text(item.content, 20000) })) : [] }; await persistStore(); return sendJson(response, 200, { draft: store.drafts.studio }); }
  if (request.method === 'POST' && pathname === '/api/agent-spec') return sendJson(response, 200, buildSpec(await readJson(request)));
  if (request.method === 'POST' && pathname === '/api/import') { const payload = await readJson(request, 500000); const record = createAgent({ spec: payload.spec || payload, status: 'draft' }); await persistStore(); return sendJson(response, 201, { agent: record }); }
  const parts = pathname.split('/').filter(Boolean); if (parts[0] !== 'api' || parts[1] !== 'agents') return sendJson(response, 404, { error: 'not_found' });
  const agentId = parts[2];
  if (!agentId && request.method === 'GET') { const search = text(url.searchParams.get('search'), 120); const status = text(url.searchParams.get('status'), 30); return sendJson(response, 200, { agents: store.agents.filter((agent) => matchAgent(agent, search) && (!status || status === 'all' || agent.status === status)), stats: stats() }); }
  if (!agentId && request.method === 'POST') { const record = createAgent(await readJson(request)); await persistStore(); return sendJson(response, 201, { agent: record }); }
  const agent = getAgent(agentId); if (!agent) return sendJson(response, 404, { error: 'agent_not_found' });
  if (request.method === 'GET' && parts.length === 3) return sendJson(response, 200, { agent, runs: store.runs.filter((run) => run.agentId === agentId).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)) });
  if (request.method === 'PATCH' && parts.length === 3) { const payload = await readJson(request, 500000); if (payload.spec) agent.spec = normalizeSpec({ ...agent.spec, ...payload.spec, id: agent.id, createdAt: agent.createdAt }); if (payload.name) { agent.name = text(payload.name, 120); agent.spec.name = agent.name; } if (payload.status) agent.status = ['draft', 'active', 'paused', 'archived'].includes(payload.status) ? payload.status : agent.status; agent.updatedAt = now(); agent.spec.updatedAt = agent.updatedAt; await persistStore(); return sendJson(response, 200, { agent }); }
  if (request.method === 'DELETE' && parts.length === 3) { store.agents = store.agents.filter((item) => item.id !== agentId); store.runs = store.runs.filter((run) => run.agentId !== agentId); await persistStore(); return sendJson(response, 200, { deleted: agentId }); }
  if (request.method === 'POST' && parts[3] === 'duplicate') { const copy = createAgent({ spec: { ...agent.spec, id: undefined, name: `${agent.name} — копия`, status: 'draft' }, status: 'draft' }); await persistStore(); return sendJson(response, 201, { agent: copy }); }
  if (request.method === 'POST' && parts[3] === 'runs') { const payload = await readJson(request, 50000); const run = simulateSpec(agent.spec, text(payload.caseId, 30) || 'support'); store.runs.unshift(run); agent.runsCount += 1; agent.lastRunAt = run.completedAt; agent.status = 'active'; agent.updatedAt = now(); await persistStore(); return sendJson(response, 201, { run, agent }); }
  return sendJson(response, 405, { error: 'method_not_allowed' });
}

export function createAppServer() { return createServer(async (request, response) => { try { const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`); if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url); if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' }); const requested = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''); const safePath = normalize(join(root, requested)); if (safePath !== root && !safePath.startsWith(`${root}${sep}`)) return sendJson(response, 403, { error: 'forbidden_path' }); const data = await readFile(safePath); response.writeHead(200, { 'content-type': mime[extname(safePath)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' }); response.end(data); } catch (error) { sendJson(response, error.status || 404, { error: error.message || 'not_found' }); } }); }
export function startServer(listenPort = port) { const server = createAppServer(); server.listen(listenPort, () => console.log(`AgentForge running at http://localhost:${listenPort}`)); return server; }
if (process.argv[1] === fileURLToPath(import.meta.url)) startServer();
