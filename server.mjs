import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { JsonStore } from './storage.mjs';
import { clientIp, hashPassword, hashToken, parseCookies, randomToken, serializeCookie, verifyPassword } from './security.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const rootPath = root.endsWith(sep) ? root.slice(0, -1) : root;
const store = new JsonStore(config.dataFile);
await store.init();

const roles = {
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

const defaultModel = /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(config.openaiModel) ? config.openaiModel : 'gpt-6.2-astra';
let openaiConnection = {
  connected: config.openaiKey.length >= 20,
  apiKey: config.openaiKey || null,
  maskedKey: config.openaiKey.length >= 20 ? maskKey(config.openaiKey) : null,
  model: defaultModel,
  lastCheckedAt: config.openaiKey.length >= 20 ? now() : null
};
const sessions = new Map();
const rateBuckets = new Map();
const metrics = { startedAt: now(), requests: 0, errors: 0, activeRuns: 0, routeCounts: new Map() };

await ensureConfiguredAdmin();

function now() { return new Date().toISOString(); }
function text(value, max = 2000) { return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max).trim(); }
function newId(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`; }
function maskKey(apiKey) { return `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`; }
function slugify(value) { return text(value, 80).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '') || 'agent'; }
function hashSpec(spec) { return createHash('sha256').update(JSON.stringify({ ...spec, passportHash: undefined })).digest('hex').slice(0, 16); }

function log(level, event, fields = {}) {
  if (config.logLevel === 'silent') return;
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  if ((order[level] || 20) < (order[config.logLevel] || 20)) return;
  process.stdout.write(`${JSON.stringify({ time: now(), level, service: 'agentforge', event, ...fields })}\n`);
}

function requestId(request) {
  const supplied = text(request.headers['x-request-id'], 80);
  return supplied || randomUUID();
}

function securityHeaders(requestIdValue) {
  const headers = {
    'x-request-id': requestIdValue,
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'x-dns-prefetch-control': 'off',
    'content-security-policy': "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  };
  if (config.isProduction) headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function sendJson(response, status, body, id, extra = {}) {
  response.writeHead(status, { ...securityHeaders(id), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  response.end(JSON.stringify(body));
}

function sendError(response, status, code, message, id, details = undefined) {
  const body = { error: code, message, requestId: id };
  if (details !== undefined) body.details = details;
  sendJson(response, status, body, id);
}

async function readJson(request, id, limit = config.maxBodyBytes) {
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > limit) throw Object.assign(new Error('payload_too_large'), { status: 413 });
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw Object.assign(new Error('payload_too_large'), { status: 413 });
  }
  try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

function normalizePath(pathname) {
  return pathname.replace(/^\/api\/v1(?=\/|$)/, '/api');
}

function originAllowed(origin) {
  if (!origin || config.allowedOrigins.length === 0) return true;
  return config.allowedOrigins.includes(origin);
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (!origin || config.allowedOrigins.length === 0) return true;
  if (!originAllowed(origin)) return false;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-credentials', 'true');
  return true;
}

function rateLimit(request, pathname) {
  const key = `${clientIp(request, config.trustedProxy)}:${pathname.split('/').slice(0, 4).join('/')}`;
  const timestamp = Date.now();
  const current = rateBuckets.get(key) || { start: timestamp, count: 0 };
  if (timestamp - current.start >= config.rateLimitWindowMs) { current.start = timestamp; current.count = 0; }
  current.count += 1;
  rateBuckets.set(key, current);
  if (rateBuckets.size > 10_000) {
    for (const [bucketKey, bucket] of rateBuckets) if (timestamp - bucket.start >= config.rateLimitWindowMs) rateBuckets.delete(bucketKey);
  }
  const limit = pathname === '/api/auth/login' ? Math.min(10, config.rateLimitMax) : config.rateLimitMax;
  return current.count <= limit;
}

function activeAgents() { return store.data.agents.filter((agent) => !agent.deletedAt && agent.status === 'active'); }
function visibleAgents() { return store.data.agents.filter((agent) => !agent.deletedAt); }
function recentRuns(limit = 12) { return [...store.data.runs].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, limit); }
function stats() {
  const runs = store.data.runs;
  return { agents: visibleAgents().length, activeAgents: activeAgents().length, runs: runs.length, avgScore: runs.length ? Math.round(runs.reduce((sum, run) => sum + run.score, 0) / runs.length) : 0, templates: templateCatalog.length };
}

function actorFromRequest(request) {
  if (request.user) return request.user;
  return { id: 'local-user', email: store.data.workspace.owner || 'local@agentforge', role: 'owner', workspaceId: store.data.workspace.id };
}

function ownerOnly(request, response, id) {
  if (request.user?.role === 'owner') return true;
  sendError(response, 403, 'owner_required', 'Требуются права владельца workspace', id);
  return false;
}

function appendAudit(draft, actor, action, resourceType, resourceId, metadata = {}) {
  draft.audit.unshift({ id: newId('AUD'), at: now(), actorId: actor.id, actorEmail: actor.email, action, resourceType, resourceId: resourceId || null, metadata });
  draft.audit = draft.audit.slice(0, 10_000);
}

function createVersion(spec, actor, message = 'created') {
  return { version: spec.version || '1.0.0', at: now(), actorId: actor.id, message, spec: structuredClone(spec) };
}

function inferTools(prompt) {
  const lower = prompt.toLowerCase();
  const enabled = toolCatalog.filter((tool) => tool.name === 'Память' || tool.keywords.test(lower));
  if (!enabled.some((tool) => tool.name !== 'Память')) enabled.unshift(toolCatalog[0]);
  return enabled.map((tool) => tool.name);
}
export { inferTools };

function getAgentName(prompt, role) {
  const lower = prompt.toLowerCase();
  if (!prompt.trim()) return roles[role].name;
  if (/(отзыв|клиент|поддержк|заказ)/.test(lower)) return 'Агент заботы о клиентах';
  if (/(недвиж|новост|исслед|дайджест)/.test(lower)) return 'Ресёрч-агент рынка';
  if (/(финанс|продаж|csv|аномал)/.test(lower)) return 'Финансовый аналитик';
  if (/(контент|текст|пост|креатив)/.test(lower)) return 'Контент-стратег';
  return roles[role].name;
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
  const selectedRole = roles[role] ? role : 'research';
  const tools = toolOverrides.length ? [...new Set(toolOverrides.map((item) => text(item, 80)).filter(Boolean))] : inferTools(normalizedPrompt);
  const riskScore = calculateRisk(normalizedPrompt, tools);
  const sensitive = riskScore >= 35;
  const timestamp = now();
  const generatedName = text(name, 120) || getAgentName(normalizedPrompt, selectedRole);
  const spec = {
    schemaVersion: '1.1',
    id: newId('AF'),
    slug: slugify(generatedName),
    name: generatedName,
    description: normalizedPrompt || 'Проверяемый AI-агент для разбора задачи и подготовки следующих шагов.',
    roleKey: selectedRole,
    role: roles[selectedRole].label,
    mission: normalizedPrompt || 'Разобраться в задаче, собрать контекст и выдать проверяемый результат.',
    tools,
    toolDetails: tools.map((toolName) => toolCatalog.find((tool) => tool.name === toolName) || { name: toolName, detail: 'Подключённый модуль', icon: '◈', tone: 'blue' }),
    systemPrompt: `Ты — ${roles[selectedRole].label.toLowerCase()} AgentForge. Сначала уточни цель и ограничения задачи, затем составь план, проверь входные данные и представь результат в согласованном формате. Всегда отделяй факты от предположений. Не выполняй необратимые действия без одобрения человека.`,
    behaviors: roles[selectedRole].behaviors,
    complexity: roles[selectedRole].complexity,
    riskScore,
    riskLevel: riskScore >= 60 ? 'Высокий' : riskScore >= 35 ? 'Средний' : 'Низкий',
    guardrails: { approval: sensitive ? 'approval-required' : 'human-in-the-loop', input: ['prompt-injection scan', 'PII boundary'], output: ['schema validation', 'redaction'] },
    riskFlags: sensitive ? ['Нужен approval gate для side-effect действий', 'Проверить чувствительные данные на входе'] : ['Проверить внешние источники перед публикацией'],
    assumptions: ['Необратимые действия выполняются только после одобрения человека'],
    clarificationQuestions: ['Какой формат результата нужен по умолчанию?', 'Какие источники считаются доверенными?'],
    generatedTests: ['Пустой ввод', 'Противоречивые данные', 'Опасное действие'],
    workflow: { nodes: ['intake', 'plan', 'retrieve', 'act', 'review', 'respond'], edges: [['intake', 'plan'], ['plan', 'retrieve'], ['retrieve', 'act'], ['act', 'review'], ['review', 'respond']] },
    memory: { enabled: tools.includes('Память'), retentionDays: 30, scope: 'workspace' },
    budget: { monthlyRuns: 1000, maxRuntimeSeconds: 120 },
    deployment: { environment: 'sandbox', channels: ['web', 'webhook'], release: 'draft' },
    contract: { input: { type: 'object', required: ['prompt'] }, output: { type: 'object', required: ['result', 'citations', 'confidence'] } },
    policyVersion: '1.0.0',
    version: '1.0.0',
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp
  };
  spec.passportHash = hashSpec(spec);
  return spec;
}

function normalizeSpec(input) {
  const source = input && typeof input === 'object' ? input : {};
  const base = buildSpec({ prompt: source.mission || source.description || '', role: source.roleKey || 'research', toolOverrides: Array.isArray(source.tools) ? source.tools : [], name: source.name });
  const merged = {
    ...base,
    ...source,
    id: text(source.id, 80) || base.id,
    name: text(source.name, 120) || base.name,
    tools: Array.isArray(source.tools) && source.tools.length ? source.tools.map((item) => text(item, 80)).filter(Boolean) : base.tools,
    createdAt: source.createdAt || base.createdAt,
    updatedAt: now(),
    behaviors: Array.isArray(source.behaviors) ? source.behaviors.slice(0, 20).map((item) => text(item, 120)) : base.behaviors,
    toolDetails: Array.isArray(source.toolDetails) ? source.toolDetails.slice(0, 30) : base.toolDetails
  };
  merged.slug = slugify(merged.name);
  merged.riskScore = Number.isFinite(Number(source.riskScore)) ? Math.max(0, Math.min(100, Number(source.riskScore))) : base.riskScore;
  merged.riskLevel = source.riskLevel || (merged.riskScore >= 60 ? 'Высокий' : merged.riskScore >= 35 ? 'Средний' : 'Низкий');
  merged.passportHash = hashSpec(merged);
  return merged;
}

function toAgentRecord(spec, actor, extra = {}) {
  return {
    id: spec.id,
    name: spec.name,
    role: spec.role,
    roleKey: spec.roleKey,
    status: extra.status || spec.status || 'draft',
    tags: extra.tags || spec.tools.slice(0, 3),
    spec,
    versions: [createVersion(spec, actor, 'created')],
    runsCount: extra.runsCount || 0,
    lastRunAt: extra.lastRunAt || null,
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt,
    deletedAt: null,
    workspaceId: actor.workspaceId || store.data.workspace.id
  };
}

export function simulateSpec(spec, caseId = 'support') {
  const scenario = simulationCases[caseId] || simulationCases.support;
  return {
    id: newId('RUN'), agentId: spec.id, agentName: spec.name, caseId: simulationCases[caseId] ? caseId : 'support', caseTitle: scenario.title,
    status: 'completed', score: scenario.score, risk: scenario.risk, hint: scenario.hint, policyVersion: spec.policyVersion || '1.0.0',
    trace: scenario.lines.map(([stage, icon, message, tone], index) => ({ index: index + 1, stage, icon, message, tone, at: new Date(Date.now() + index * 500).toISOString() })),
    startedAt: now(), completedAt: now()
  };
}

function getAgent(id, includeDeleted = false) {
  return store.data.agents.find((agent) => agent.id === id && (includeDeleted || !agent.deletedAt));
}

function matchAgent(agent, search) {
  const value = `${agent.name} ${agent.role} ${agent.spec.description} ${(agent.tags || []).join(' ')}`.toLowerCase();
  return !search || value.includes(search.toLowerCase());
}

function sessionUser(request) {
  const token = parseCookies(request.headers.cookie)[config.cookieName];
  if (!token) return null;
  const key = hashToken(token);
  const session = sessions.get(key);
  if (!session || session.expiresAt <= Date.now()) { sessions.delete(key); return null; }
  const user = store.data.users.find((item) => item.id === session.userId && !item.disabledAt);
  if (!user) return null;
  session.expiresAt = Date.now() + config.sessionTtlSeconds * 1000;
  return { id: user.id, email: user.email, role: user.role, workspaceId: user.workspaceId };
}

async function ensureConfiguredAdmin() {
  if (config.authMode !== 'required' || !config.adminEmail || !config.adminPassword || store.data.users.length > 0) return;
  const passwordHash = await hashPassword(config.adminPassword);
  await store.mutate((draft) => {
    draft.users.push({ id: newId('USR'), email: config.adminEmail, passwordHash, role: 'owner', workspaceId: draft.workspace.id, createdAt: now(), disabledAt: null });
    appendAudit(draft, { id: 'system', email: 'system' }, 'user.bootstrap', 'user', draft.users[0].id, { role: 'owner' });
  });
  log('info', 'admin_bootstrapped', { email: config.adminEmail });
}

function authStatus() {
  return { required: config.authMode === 'required', configured: store.data.users.length > 0, activeSessions: sessions.size };
}

async function requireUser(request, response, pathname, id) {
  if (config.authMode !== 'required') {
    request.user = actorFromRequest(request);
    return true;
  }
  request.user = sessionUser(request);
  if (request.user) return true;
  sendError(response, 401, 'authentication_required', 'Требуется вход в рабочее пространство', id, { login: '/api/v1/auth/login' });
  log('warn', 'auth_required', { requestId: id, pathname });
  return false;
}

async function handleAuth(request, response, pathname, id) {
  if (request.method === 'GET' && pathname === '/api/auth/status') return sendJson(response, 200, authStatus(), id);
  if (request.method === 'GET' && pathname === '/api/auth/me') {
    const user = sessionUser(request);
    return user ? sendJson(response, 200, { user }, id) : sendError(response, 401, 'authentication_required', 'Требуется вход', id);
  }
  if (request.method === 'POST' && pathname === '/api/auth/login') {
    const payload = await readJson(request, id, 30_000);
    const email = text(payload.email, 160).toLowerCase();
    const user = store.data.users.find((item) => item.email === email && !item.disabledAt);
    if (!user || !(await verifyPassword(payload.password, user.passwordHash))) return sendError(response, 401, 'invalid_credentials', 'Неверный email или пароль', id);
    const token = randomToken();
    sessions.set(hashToken(token), { userId: user.id, expiresAt: Date.now() + config.sessionTtlSeconds * 1000 });
    await store.mutate((draft) => appendAudit(draft, { id: user.id, email: user.email }, 'auth.login', 'session', null));
    return sendJson(response, 200, { user: { id: user.id, email: user.email, role: user.role }, expiresIn: config.sessionTtlSeconds }, id, { 'set-cookie': serializeCookie(config.cookieName, token, { maxAge: config.sessionTtlSeconds, secure: config.cookieSecure }) });
  }
  if (request.method === 'POST' && pathname === '/api/auth/logout') {
    const user = sessionUser(request);
    const token = parseCookies(request.headers.cookie)[config.cookieName];
    if (token) sessions.delete(hashToken(token));
    if (user) await store.mutate((draft) => appendAudit(draft, user, 'auth.logout', 'session', null));
    return sendJson(response, 200, { loggedOut: true }, id, { 'set-cookie': serializeCookie(config.cookieName, '', { maxAge: 0, secure: config.cookieSecure }) });
  }
  return false;
}

async function openaiRequest(path, options = {}) {
  if (!openaiConnection.apiKey) throw Object.assign(new Error('openai_not_connected'), { status: 409 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(`${config.openaiUrl}${path}`, { ...options, signal: controller.signal, headers: { authorization: `Bearer ${openaiConnection.apiKey}`, 'content-type': 'application/json', ...(options.headers || {}) } });
  } finally { clearTimeout(timer); }
}

async function validateOpenAIKey(apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const result = await fetch(`${config.openaiUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: controller.signal });
    if (!result.ok) {
      let detail = 'OpenAI отклонил ключ';
      try { detail = (await result.json()).error?.message || detail; } catch { /* keep generic */ }
      throw Object.assign(new Error(detail), { status: result.status, code: 'openai_auth_failed' });
    }
  } finally { clearTimeout(timer); }
}

async function handleOpenAI(request, response, pathname, id) {
  if (request.method === 'GET' && pathname === '/api/integrations/openai/status') return sendJson(response, 200, { connected: openaiConnection.connected, maskedKey: openaiConnection.maskedKey, model: openaiConnection.model, lastCheckedAt: openaiConnection.lastCheckedAt }, id);
  if (request.method === 'POST' && pathname === '/api/integrations/openai/connect') {
    const payload = await readJson(request, id, 16_000);
    const apiKey = text(payload.apiKey, 300);
    const model = /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(String(payload.model || '')) ? String(payload.model) : defaultModel;
    if (apiKey.length < 20) return sendError(response, 400, 'invalid_api_key', 'API-ключ выглядит неполным', id);
    try {
      await validateOpenAIKey(apiKey);
      openaiConnection = { connected: true, apiKey, maskedKey: maskKey(apiKey), model, lastCheckedAt: now() };
      return sendJson(response, 200, { connected: true, maskedKey: openaiConnection.maskedKey, model, lastCheckedAt: openaiConnection.lastCheckedAt }, id);
    } catch (error) {
      return sendError(response, error.name === 'AbortError' ? 504 : (error.status || 502), error.code || 'openai_connection_failed', error.name === 'AbortError' ? 'OpenAI не ответил вовремя' : error.message || 'Не удалось проверить подключение', id);
    }
  }
  if (request.method === 'POST' && pathname === '/api/integrations/openai/test') {
    try {
      const result = await openaiRequest('/models', { method: 'GET' });
      if (!result.ok) return sendError(response, 502, 'openai_request_failed', 'Проверка доступа не прошла', id);
      openaiConnection.lastCheckedAt = now();
      return sendJson(response, 200, { connected: true, maskedKey: openaiConnection.maskedKey, model: openaiConnection.model, lastCheckedAt: openaiConnection.lastCheckedAt }, id);
    } catch (error) { return sendError(response, error.status || 502, 'openai_unavailable', error.message || 'Провайдер недоступен', id); }
  }
  if (request.method === 'POST' && pathname === '/api/integrations/openai/disconnect') {
    openaiConnection = { connected: false, apiKey: null, maskedKey: null, model: defaultModel, lastCheckedAt: null };
    return sendJson(response, 200, { connected: false }, id);
  }
  if (request.method === 'POST' && pathname === '/api/openai/generate') {
    const payload = await readJson(request, id, 16_000);
    const prompt = text(payload.prompt, 6_000);
    if (!prompt) return sendError(response, 400, 'prompt_required', 'Нужен prompt', id);
    try {
      const result = await openaiRequest('/responses', { method: 'POST', body: JSON.stringify({ model: openaiConnection.model, input: prompt }) });
      const data = await result.json();
      if (!result.ok) return sendError(response, result.status, 'openai_generation_failed', data.error?.message || 'OpenAI не сформировал ответ', id);
      return sendJson(response, 200, { model: openaiConnection.model, outputText: data.output_text || '', responseId: data.id || null }, id);
    } catch (error) { return sendError(response, error.status || 502, 'openai_unavailable', error.message || 'OpenAI недоступен', id); }
  }
  return false;
}

function openApiDocument() {
  return {
    openapi: '3.1.0', info: { title: 'AgentForge Control Plane API', version: '2.0.0' }, servers: [{ url: '/api/v1' }],
    paths: {
      '/health': { get: { summary: 'Service health' } },
      '/auth/login': { post: { summary: 'Create a session' } },
      '/bootstrap': { get: { summary: 'Load workspace state' } },
      '/users': { get: { summary: 'List workspace users' }, post: { summary: 'Create workspace user' } },
      '/agent-spec': { post: { summary: 'Generate an Agent Passport' } },
      '/agents': { get: { summary: 'List agents' }, post: { summary: 'Create an agent' } },
      '/agents/{id}': { get: { summary: 'Read an agent' }, patch: { summary: 'Update an agent' }, delete: { summary: 'Archive an agent' } },
      '/agents/{id}/runs': { post: { summary: 'Run a simulation' } },
      '/audit': { get: { summary: 'Read audit events' } }
    }
  };
}

function ifMatchMatches(request, agent) {
  const expected = text(request.headers['if-match'], 120);
  return !expected || expected === '*' || expected === agent.updatedAt;
}

function idempotencyKey(request) {
  return text(request.headers['idempotency-key'], 160);
}

async function handleApi(request, response, url, id) {
  const pathname = normalizePath(url.pathname);
  metrics.requests += 1;
  metrics.routeCounts.set(pathname, (metrics.routeCounts.get(pathname) || 0) + 1);
  if (!applyCors(request, response)) return sendError(response, 403, 'origin_not_allowed', 'Источник запроса не разрешён', id);
  if (!rateLimit(request, pathname)) {
    response.setHeader('retry-after', Math.ceil(config.rateLimitWindowMs / 1000));
    return sendError(response, 429, 'rate_limit_exceeded', 'Слишком много запросов', id, { retryAfterSeconds: Math.ceil(config.rateLimitWindowMs / 1000) });
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { ...securityHeaders(id), 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type, if-match, idempotency-key, x-request-id' });
    return response.end();
  }

  const authResult = await handleAuth(request, response, pathname, id);
  if (authResult !== false) return authResult;
  if (request.method === 'GET' && pathname === '/api/openapi.json') return sendJson(response, 200, openApiDocument(), id);
  if (request.method === 'GET' && pathname === '/api/health/live') return sendJson(response, 200, { status: 'ok', service: 'agentforge-control-plane', version: '2.0.0', timestamp: now() }, id);
  if (request.method === 'GET' && pathname === '/api/health/ready') {
    const ready = store.ready && (config.authMode !== 'required' || store.data.users.length > 0);
    return sendJson(response, ready ? 200 : 503, { status: ready ? 'ready' : 'not_ready', persistence: store.ready, auth: authStatus(), timestamp: now() }, id);
  }
  if (request.method === 'GET' && pathname === '/api/health') return sendJson(response, 200, { status: 'ok', service: 'agentforge-control-plane', version: '2.0.0', persisted: store.ready, auth: authStatus(), openai: openaiConnection.connected, timestamp: now() }, id);
  if (request.method === 'GET' && pathname === '/api/metrics') {
    const uptime = Math.floor((Date.now() - Date.parse(metrics.startedAt)) / 1000);
    const lines = [`# HELP agentforge_requests_total Total HTTP requests`, `# TYPE agentforge_requests_total counter`, `agentforge_requests_total ${metrics.requests}`, `# HELP agentforge_errors_total Total HTTP errors`, `# TYPE agentforge_errors_total counter`, `agentforge_errors_total ${metrics.errors}`, `agentforge_uptime_seconds ${uptime}`];
    response.writeHead(200, { ...securityHeaders(id), 'content-type': 'text/plain; version=0.0.4', 'cache-control': 'no-store' });
    response.end(`${lines.join('\n')}\n`);
    return;
  }
  if (!await requireUser(request, response, pathname, id)) return;
  const actor = actorFromRequest(request);

  const openaiHandled = await handleOpenAI(request, response, pathname, id);
  if (openaiHandled !== false) return openaiHandled;
  if (request.method === 'GET' && pathname === '/api/bootstrap') return sendJson(response, 200, { workspace: store.data.workspace, agents: visibleAgents(), runs: recentRuns(), templates: templateCatalog, drafts: store.data.drafts, settings: store.data.settings, stats: stats(), provider: { connected: openaiConnection.connected, model: openaiConnection.model, maskedKey: openaiConnection.maskedKey }, apiVersion: 'v1' }, id);
  if ((pathname === '/api/users' || pathname.startsWith('/api/users/')) && !ownerOnly(request, response, id)) return;
  if (request.method === 'GET' && pathname === '/api/users') return sendJson(response, 200, { users: store.data.users.map((user) => ({ id: user.id, email: user.email, role: user.role, createdAt: user.createdAt, disabledAt: user.disabledAt })) }, id);
  if (request.method === 'POST' && pathname === '/api/users') {
    const payload = await readJson(request, id, 30_000);
    const email = text(payload.email, 160).toLowerCase();
    const password = String(payload.password || '');
    const role = ['owner', 'operator', 'viewer'].includes(payload.role) ? payload.role : 'operator';
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12) return sendError(response, 400, 'invalid_user', 'Нужен корректный email и пароль не короче 12 символов', id);
    if (store.data.users.some((user) => user.email === email)) return sendError(response, 409, 'user_exists', 'Пользователь уже существует', id);
    const passwordHash = await hashPassword(password);
    const result = await store.mutate((draft) => {
      const user = { id: newId('USR'), email, passwordHash, role, workspaceId: draft.workspace.id, createdAt: now(), disabledAt: null };
      draft.users.push(user);
      appendAudit(draft, actor, 'user.create', 'user', user.id, { email, role });
      return { user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt } };
    });
    return sendJson(response, 201, result, id);
  }
  if (request.method === 'PATCH' && pathname.startsWith('/api/users/')) {
    const userId = pathname.split('/').pop();
    const payload = await readJson(request, id, 20_000);
    const result = await store.mutate((draft) => {
      const user = draft.users.find((item) => item.id === userId);
      if (!user) throw Object.assign(new Error('user_not_found'), { status: 404 });
      if (payload.role && ['owner', 'operator', 'viewer'].includes(payload.role)) user.role = payload.role;
      if (payload.disabled === true && user.id !== actor.id) user.disabledAt = now();
      if (payload.disabled === false) user.disabledAt = null;
      appendAudit(draft, actor, 'user.update', 'user', user.id, { role: user.role, disabled: Boolean(user.disabledAt) });
      return { user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt, disabledAt: user.disabledAt } };
    });
    return sendJson(response, 200, result, id);
  }
  if (request.method === 'GET' && pathname === '/api/templates') return sendJson(response, 200, { templates: templateCatalog }, id);
  if (request.method === 'GET' && pathname === '/api/runs') {
    const agentId = text(url.searchParams.get('agentId'), 100);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    return sendJson(response, 200, { runs: recentRuns(100).filter((run) => !agentId || run.agentId === agentId).slice(0, limit) }, id);
  }
  if (request.method === 'GET' && pathname === '/api/audit') { if (!ownerOnly(request, response, id)) return; return sendJson(response, 200, { events: store.data.audit.slice(0, 200) }, id); }
  if (request.method === 'GET' && pathname === '/api/settings') return sendJson(response, 200, { settings: store.data.settings, workspace: store.data.workspace, draft: store.data.drafts.studio }, id);
  if (request.method === 'PATCH' && pathname === '/api/settings') {
    if (!ownerOnly(request, response, id)) return;
    const payload = await readJson(request, id, 50_000);
    const result = await store.mutate((draft) => {
      draft.settings = { ...draft.settings, ...(payload.settings || {}) };
      if (payload.workspace) draft.workspace = { ...draft.workspace, name: text(payload.workspace.name, 80) || draft.workspace.name, owner: text(payload.workspace.owner, 80) || draft.workspace.owner };
      appendAudit(draft, actor, 'workspace.settings.update', 'workspace', draft.workspace.id, { settings: Object.keys(payload.settings || {}), workspace: Boolean(payload.workspace) });
      return { settings: draft.settings, workspace: draft.workspace };
    });
    return sendJson(response, 200, result, id);
  }
  if (request.method === 'PATCH' && pathname === '/api/draft') {
    const payload = await readJson(request, id, 50_000);
    const draft = await store.mutate((next) => {
      next.drafts.studio = { prompt: text(payload.prompt, 2_000), role: roles[payload.role] ? payload.role : 'research', context: Array.isArray(payload.context) ? payload.context.slice(0, 8).map((item) => ({ name: text(item.name, 120), content: text(item.content, 20_000) })) : [] };
      appendAudit(next, actor, 'draft.update', 'draft', 'studio');
      return next.drafts.studio;
    });
    return sendJson(response, 200, { draft }, id);
  }
  if (request.method === 'POST' && pathname === '/api/agent-spec') return sendJson(response, 200, buildSpec(await readJson(request, id)), id);
  if (request.method === 'POST' && pathname === '/api/import') {
    const payload = await readJson(request, id, 500_000);
    const key = idempotencyKey(request);
    if (key && store.data.idempotency[key]) return sendJson(response, 200, store.data.idempotency[key], id);
    const result = await store.mutate((draft) => {
      const spec = normalizeSpec(payload.spec || payload);
      const record = toAgentRecord(spec, actor, { status: 'draft' });
      draft.agents.unshift(record);
      appendAudit(draft, actor, 'agent.import', 'agent', record.id, { passportHash: record.spec.passportHash });
      return { agent: record };
    });
    if (key) await store.mutate((draft) => { draft.idempotency[key] = result; });
    return sendJson(response, 201, result, id);
  }

  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'agents') return sendError(response, 404, 'not_found', 'Маршрут не найден', id);
  const agentId = parts[2];
  if (!agentId && request.method === 'GET') {
    const search = text(url.searchParams.get('search'), 120);
    const status = text(url.searchParams.get('status'), 30);
    return sendJson(response, 200, { agents: visibleAgents().filter((agent) => matchAgent(agent, search) && (!status || status === 'all' || agent.status === status)), stats: stats() }, id);
  }
  if (!agentId && request.method === 'POST') {
    const key = idempotencyKey(request);
    if (key && store.data.idempotency[key]) return sendJson(response, 200, store.data.idempotency[key], id);
    const payload = await readJson(request, id, 500_000);
    const result = await store.mutate((draft) => {
      const spec = normalizeSpec(payload.spec || buildSpec(payload));
      const record = toAgentRecord(spec, actor, { status: ['draft', 'active', 'paused'].includes(payload.status) ? payload.status : 'draft', tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => text(tag, 40)) : spec.tools.slice(0, 3) });
      draft.agents.unshift(record);
      appendAudit(draft, actor, 'agent.create', 'agent', record.id, { role: record.roleKey });
      return { agent: record };
    });
    if (key) await store.mutate((draft) => { draft.idempotency[key] = result; });
    return sendJson(response, 201, result, id);
  }
  if (!agentId) return sendError(response, 405, 'method_not_allowed', 'Метод не поддерживается', id);
  const agent = getAgent(agentId, request.method === 'POST' && parts[3] === 'restore');
  if (!agent) return sendError(response, 404, 'agent_not_found', 'Агент не найден', id);
  if (request.method === 'GET' && parts.length === 3) return sendJson(response, 200, { agent, runs: store.data.runs.filter((run) => run.agentId === agentId).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)) }, id);
  if (request.method === 'GET' && parts[3] === 'versions') return sendJson(response, 200, { versions: agent.versions || [] }, id);
  if (request.method === 'PATCH' && parts.length === 3) {
    if (!ifMatchMatches(request, agent)) return sendError(response, 409, 'version_conflict', 'Агент уже изменён другим запросом', id, { currentUpdatedAt: agent.updatedAt });
    const payload = await readJson(request, id, 500_000);
    const result = await store.mutate((draft) => {
      const target = draft.agents.find((item) => item.id === agentId);
      if (!target || !ifMatchMatches(request, target)) throw Object.assign(new Error('version_conflict'), { status: 409 });
      if (payload.spec) {
        target.spec = normalizeSpec({ ...target.spec, ...payload.spec, id: target.id, createdAt: target.createdAt, version: payload.spec.version || target.spec.version });
        target.versions = [...(target.versions || []), createVersion(target.spec, actor, 'updated')].slice(-50);
      }
      if (payload.name) { target.name = text(payload.name, 120); target.spec.name = target.name; target.spec.slug = slugify(target.name); }
      if (payload.status && ['draft', 'active', 'paused', 'archived'].includes(payload.status)) target.status = payload.status;
      target.updatedAt = now();
      target.spec.updatedAt = target.updatedAt;
      appendAudit(draft, actor, 'agent.update', 'agent', target.id, { status: target.status, version: target.spec.version });
      return { agent: target };
    });
    return sendJson(response, 200, result, id, { etag: result.agent.updatedAt });
  }
  if (request.method === 'DELETE' && parts.length === 3) {
    const result = await store.mutate((draft) => {
      const target = draft.agents.find((item) => item.id === agentId);
      if (!target) return { deleted: agentId };
      target.status = 'archived';
      target.deletedAt = now();
      target.updatedAt = target.deletedAt;
      appendAudit(draft, actor, 'agent.archive', 'agent', agentId);
      return { deleted: agentId, archivedAt: target.deletedAt };
    });
    return sendJson(response, 200, result, id);
  }
  if (request.method === 'POST' && parts[3] === 'restore') {
    const result = await store.mutate((draft) => {
      const target = draft.agents.find((item) => item.id === agentId);
      if (!target) throw Object.assign(new Error('agent_not_found'), { status: 404 });
      target.deletedAt = null;
      target.status = 'draft';
      target.updatedAt = now();
      appendAudit(draft, actor, 'agent.restore', 'agent', agentId);
      return { agent: target };
    });
    return sendJson(response, 200, result, id);
  }
  if (request.method === 'POST' && parts[3] === 'rollback') {
    const payload = await readJson(request, id, 20_000);
    const result = await store.mutate((draft) => {
      const target = draft.agents.find((item) => item.id === agentId);
      const version = target?.versions?.[Number(payload.version) - 1];
      if (!target || !version) throw Object.assign(new Error('version_not_found'), { status: 404 });
      target.spec = structuredClone(version.spec);
      target.spec.updatedAt = now();
      target.spec.passportHash = hashSpec(target.spec);
      target.versions = [...target.versions, createVersion(target.spec, actor, `rollback:${payload.version}`)].slice(-50);
      target.updatedAt = target.spec.updatedAt;
      appendAudit(draft, actor, 'agent.rollback', 'agent', agentId, { version: payload.version });
      return { agent: target };
    });
    return sendJson(response, 200, result, id);
  }
  if (request.method === 'POST' && parts[3] === 'duplicate') {
    const result = await store.mutate((draft) => {
      const spec = normalizeSpec({ ...agent.spec, id: undefined, name: `${agent.name} — копия`, status: 'draft' });
      const copy = toAgentRecord(spec, actor, { status: 'draft' });
      draft.agents.unshift(copy);
      appendAudit(draft, actor, 'agent.duplicate', 'agent', copy.id, { sourceId: agent.id });
      return { agent: copy };
    });
    return sendJson(response, 201, result, id);
  }
  if (request.method === 'POST' && parts[3] === 'runs') {
    const key = idempotencyKey(request);
    if (key && store.data.idempotency[key]) return sendJson(response, 200, store.data.idempotency[key], id);
    const payload = await readJson(request, id, 50_000);
    metrics.activeRuns += 1;
    try {
      const result = await store.mutate((draft) => {
        const target = draft.agents.find((item) => item.id === agentId && !item.deletedAt);
        if (!target) throw Object.assign(new Error('agent_not_found'), { status: 404 });
        const run = simulateSpec(target.spec, text(payload.caseId, 30) || 'support');
        draft.runs.unshift({ ...run, actorId: actor.id, workspaceId: actor.workspaceId || draft.workspace.id, idempotencyKey: key || null });
        target.runsCount = Number(target.runsCount || 0) + 1;
        target.lastRunAt = run.completedAt;
        target.status = 'active';
        target.updatedAt = now();
        appendAudit(draft, actor, 'agent.run', 'run', run.id, { agentId, score: run.score, caseId: run.caseId });
        return { run, agent: target };
      });
      if (key) await store.mutate((draft) => { draft.idempotency[key] = result; });
      return sendJson(response, 201, result, id);
    } finally { metrics.activeRuns = Math.max(0, metrics.activeRuns - 1); }
  }
  return sendError(response, 405, 'method_not_allowed', 'Метод не поддерживается', id);
}

async function serveStatic(request, response, url, id) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return sendError(response, 405, 'method_not_allowed', 'Метод не поддерживается', id);
  const requested = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  if (requested === 'data' || requested.startsWith('data/')) return sendError(response, 403, 'private_path', 'Путь закрыт', id);
  const safeRoot = rootPath;
  const safePath = normalize(join(safeRoot, requested));
  if (safePath !== safeRoot && !safePath.startsWith(`${safeRoot}${sep}`)) return sendError(response, 403, 'forbidden_path', 'Путь запрещён', id);
  const fileInfo = await stat(safePath);
  const etag = `W/"${fileInfo.size.toString(16)}-${Math.floor(fileInfo.mtimeMs).toString(16)}"`;
  if (request.headers['if-none-match'] === etag) { response.writeHead(304, securityHeaders(id)); return response.end(); }
  const data = request.method === 'HEAD' ? null : await readFile(safePath);
  const isHtml = extname(safePath) === '.html';
  response.writeHead(200, { ...securityHeaders(id), 'content-type': mime[extname(safePath)] || 'application/octet-stream', etag, 'cache-control': isHtml ? 'no-cache' : 'public, max-age=3600' });
  response.end(data);
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

export function createAppServer() {
  return createServer(async (request, response) => {
    const id = requestId(request);
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url, id);
      await serveStatic(request, response, url, id);
    } catch (error) {
      metrics.errors += 1;
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
      log(status >= 500 ? 'error' : 'warn', 'request_failed', { requestId: id, status, code: error.code || error.message });
      if (!response.headersSent) sendError(response, status, error.code || 'internal_error', status >= 500 ? 'Внутренняя ошибка сервера' : error.message, id);
      else response.end();
    }
  });
}

export function startServer(listenPort = config.port, listenHost = config.host) {
  const server = createAppServer();
  server.listen(listenPort, listenHost, () => log('info', 'server_started', { host: listenHost, port: listenPort, env: config.nodeEnv, auth: config.authMode }));
  const shutdown = async (signal) => {
    log('info', 'shutdown_started', { signal });
    server.close(async () => { await store.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startServer();
export { store };
