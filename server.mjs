import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const OPENAI_URL = 'https://api.openai.com/v1';
const allowedModels = new Set(['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-5.6-sol']);
const envOpenAIKey = typeof process.env.OPENAI_API_KEY === 'string' ? process.env.OPENAI_API_KEY.trim() : '';
let openaiConnection = { connected: envOpenAIKey.length >= 20, apiKey: envOpenAIKey || null, maskedKey: envOpenAIKey.length >= 20 ? `${envOpenAIKey.slice(0, 7)}…${envOpenAIKey.slice(-4)}` : null, model: process.env.OPENAI_MODEL || 'gpt-6.2-astra', lastCheckedAt: envOpenAIKey.length >= 20 ? new Date().toISOString() : null };

const roleData = {
  research: { label: 'Исследователь', name: 'Аналитик нового поколения' },
  ops: { label: 'Операционный', name: 'Операционный координатор' },
  creative: { label: 'Креативный', name: 'Креативный партнёр' }
};

function inferTools(text) {
  const lower = text.toLowerCase();
  const tools = ['Память'];
  if (/(новост|исслед|рын|источ|данн|аналит)/.test(lower)) tools.unshift('Web research');
  if (/(csv|pdf|файл|документ|таблиц)/.test(lower)) tools.unshift('Работа с файлами');
  if (/(telegram|телеграм|email|почт|slack|отч[её]т)/.test(lower)) tools.unshift('Уведомления');
  if (tools.length === 1) tools.unshift('Web research');
  return tools;
}

function buildSpec({ prompt = '', role = 'research' } = {}) {
  const normalizedPrompt = String(prompt).slice(0, 2000).trim();
  const selectedRole = roleData[role] || roleData.research;
  const tools = inferTools(normalizedPrompt);
  const sensitive = /(оплат|удал|доступ|парол|перевод|медицин|финанс)/i.test(normalizedPrompt);
  return {
    schemaVersion: '1.0', id: `AF-${Date.now().toString(36).toUpperCase()}`, name: selectedRole.name, role: selectedRole.label,
    mission: normalizedPrompt || 'Разобраться в задаче, собрать контекст и выдать проверяемый результат.', tools,
    guardrails: { approval: 'human-in-the-loop', input: ['prompt-injection scan', 'PII boundary'], output: ['schema validation', 'redaction'] },
    riskFlags: sensitive ? ['side-effect approval required', 'sensitive-data review'] : ['source verification required'],
    assumptions: ['Необратимые действия выполняются только после одобрения человека'],
    clarificationQuestions: ['Какой формат результата нужен по умолчанию?', 'Какие источники считаются доверенными?'],
    generatedTests: ['Пустой ввод', 'Противоречивые данные', 'Опасное действие'],
    workflow: { nodes: ['intake', 'plan', 'retrieve', 'act', 'review', 'respond'], edges: [['intake', 'plan'], ['plan', 'retrieve'], ['retrieve', 'act'], ['act', 'review'], ['review', 'respond']] },
    deployment: { environment: 'sandbox', channels: ['web', 'webhook'], release: 'draft' }
  };
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readJson(request, limit = 65536) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > limit) throw Object.assign(new Error('payload_too_large'), { status: 413 });
  }
  try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

function maskedKey(apiKey) {
  return `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`;
}

async function openaiRequest(path, options = {}) {
  if (!openaiConnection.apiKey) throw Object.assign(new Error('openai_not_connected'), { status: 409 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(`${OPENAI_URL}${path}`, { ...options, signal: controller.signal, headers: { authorization: `Bearer ${openaiConnection.apiKey}`, 'content-type': 'application/json', ...(options.headers || {}) } });
  } finally { clearTimeout(timer); }
}

async function validateOpenAIKey(apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const result = await fetch(`${OPENAI_URL}/models`, { headers: { authorization: `Bearer ${apiKey}` }, signal: controller.signal });
    if (!result.ok) {
      let detail = 'OpenAI отклонил ключ';
      try { detail = (await result.json()).error?.message || detail; } catch { /* keep safe generic message */ }
      throw Object.assign(new Error(detail), { status: result.status, code: 'openai_auth_failed' });
    }
  } finally { clearTimeout(timer); }
}

async function handleOpenAI(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/integrations/openai/status') {
    return sendJson(response, 200, { connected: openaiConnection.connected, maskedKey: openaiConnection.maskedKey, model: openaiConnection.model, lastCheckedAt: openaiConnection.lastCheckedAt });
  }
  if (request.method === 'POST' && pathname === '/api/integrations/openai/connect') {
    const payload = await readJson(request, 16000);
    const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
    const model = allowedModels.has(payload.model) ? payload.model : 'gpt-6.2-astra';
    if (apiKey.length < 20) return sendJson(response, 400, { error: 'invalid_api_key', message: 'API-ключ выглядит неполным' });
    try {
      await validateOpenAIKey(apiKey);
      openaiConnection = { connected: true, apiKey, maskedKey: maskedKey(apiKey), model, lastCheckedAt: new Date().toISOString() };
      return sendJson(response, 200, { connected: true, maskedKey: openaiConnection.maskedKey, model, lastCheckedAt: openaiConnection.lastCheckedAt });
    } catch (error) {
      const status = error.name === 'AbortError' ? 504 : (error.status || 502);
      return sendJson(response, status, { error: error.code || 'openai_connection_failed', message: error.name === 'AbortError' ? 'OpenAI не ответил вовремя' : error.message || 'Не удалось проверить подключение' });
    }
  }
  if (request.method === 'POST' && pathname === '/api/integrations/openai/test') {
    try {
      const result = await openaiRequest('/models', { method: 'GET', headers: {} });
      if (!result.ok) return sendJson(response, 502, { error: 'openai_request_failed', message: 'Проверка доступа не прошла' });
      openaiConnection.lastCheckedAt = new Date().toISOString();
      return sendJson(response, 200, { connected: true, maskedKey: openaiConnection.maskedKey, model: openaiConnection.model, lastCheckedAt: openaiConnection.lastCheckedAt });
    } catch (error) { return sendJson(response, error.status || 502, { error: error.message || 'Провайдер недоступен' }); }
  }
  if (request.method === 'POST' && pathname === '/api/integrations/openai/disconnect') {
    openaiConnection = { connected: false, apiKey: null, maskedKey: null, model: 'gpt-6.2-astra', lastCheckedAt: null };
    return sendJson(response, 200, { connected: false });
  }
  if (request.method === 'POST' && pathname === '/api/openai/generate') {
    const payload = await readJson(request, 16000);
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.slice(0, 2000).trim() : '';
    if (!prompt) return sendJson(response, 400, { error: 'prompt_required' });
    try {
      const result = await openaiRequest('/responses', { method: 'POST', body: JSON.stringify({ model: openaiConnection.model, input: prompt }) });
      const data = await result.json();
      if (!result.ok) return sendJson(response, result.status, { error: 'openai_generation_failed', message: data.error?.message || 'OpenAI не сформировал ответ' });
      return sendJson(response, 200, { model: openaiConnection.model, outputText: data.output_text || '', responseId: data.id || null });
    } catch (error) { return sendJson(response, error.status || 502, { error: error.message || 'OpenAI недоступен' }); }
  }
  return false;
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;
    if (request.method === 'GET' && pathname === '/api/health') return sendJson(response, 200, { status: 'ok', service: 'agentforge-control-plane', openai: openaiConnection.connected });
    const openaiHandled = await handleOpenAI(request, response, pathname);
    if (openaiHandled !== false) return openaiHandled;
    if (request.method === 'POST' && pathname === '/api/agent-spec') return sendJson(response, 200, buildSpec(await readJson(request)));
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const safePath = normalize(join(root, requested));
    if (!safePath.startsWith(root)) return sendJson(response, 403, { error: 'forbidden_path' });
    const data = await readFile(safePath);
    response.writeHead(200, { 'content-type': mime[extname(safePath)] || 'application/octet-stream' });
    response.end(data);
  } catch (error) {
    sendJson(response, error.status || 404, { error: error.message || 'not_found' });
  }
});

server.listen(port, () => console.log(`AgentForge running at http://localhost:${port}`));
