# AgentForge

**Из промта — в проверяемого цифрового сотрудника.**

AgentForge — прототип нейтральной к провайдеру control plane для создания AI-агентов и ботов. Он превращает описание задачи в переносимый `Agent Passport`, показывает границы полномочий, прогоняет сценарии до запуска и экспортирует версионируемую спецификацию.

## Уже реализовано

- генерация blueprint по свободному описанию на русском языке;
- роли исследователя, операционного координатора и креативного партнёра;
- переносимый `AgentSpec` с миссией, инструментами, моделью, памятью, workflow, бюджетами и guardrails;
- assumptions, clarification questions, generated tests и risk flags;
- Simulation Lab с тестовыми кейсами, live trace, оценкой качества и risk map;
- Agent Passport с идентификатором, уровнем риска и human-in-the-loop;
- переключение и добавление инструментов;
- вкладки обзора, системного промта, workflow и JSON;
- экспорт `.agentforge.json` и копирование паспорта;
- сохранение черновика в `localStorage`;
- клавиатурный shortcut `Ctrl/Cmd + Enter`;
- CSP, ограничение ввода 2 000 символов, безопасный вывод пользовательского текста;
- адаптивный UI и базовые WCAG-улучшения;
- локальный Node control-plane с `GET /api/health` и `POST /api/agent-spec`.
- админский блок OpenAI с проверкой ключа, выбором модели, статусом, маской секрета и отключением.

## Запуск

Для статического режима откройте `index.html`.

Для режима с локальным API:

```bash
npm start
```

Откройте `http://localhost:4173`.

В интерфейсе откройте «Настройки» или карточку «AI-провайдер». Вставьте API-ключ OpenAI и выберите модель. Ключ отправляется только на серверный endpoint, проверяется через `/v1/models` и хранится только в памяти текущего процесса. После перезапуска сервера его потребуется подключить снова.

Для серверного запуска также можно заранее задать `OPENAI_API_KEY` и при необходимости `OPENAI_MODEL`. Панель администратора остаётся основным способом подключения без ручной настройки окружения.

Проверка API:

```bash
curl http://localhost:4173/api/health
curl -X POST http://localhost:4173/api/agent-spec \
  -H 'content-type: application/json' \
  -d '{"prompt":"Анализируй отзывы клиентов и отправляй отчёт в Telegram","role":"research"}'
```

OpenAI endpoints:

- `GET /api/integrations/openai/status`
- `POST /api/integrations/openai/connect`
- `POST /api/integrations/openai/test`
- `POST /api/integrations/openai/disconnect`
- `POST /api/openai/generate`

## Продуктовая концепция

Основное преимущество AgentForge — связка **requirement-to-agent compiler + simulation + governance**. Пользователь получает не только промт, но и объяснимый контракт агента, тесты, разрешения, риски и доказательство готовности.

Полноценный production-контур должен включать:

- MCP/A2A gateway и адаптеры OpenAI, Anthropic, Gemini, локальных моделей;
- Postgres с tenant isolation и RLS, Redis/BullMQ для resumable runs, S3-совместимое хранилище;
- sandboxed tool workers, short-lived scoped tokens, Vault/secret references;
- immutable audit ledger, replay, OpenTelemetry traces и regression evals;
- approval gates, DLP/PII redaction, egress policy, kill switch и rate budgets;
- web, REST, webhook, Telegram и Slack deployments;
- registry шаблонов, verified connectors и marketplace.

## Структура

- `index.html` — интерфейс Studio, Simulation Lab и Agent Passport;
- `styles.css` — визуальная система digital ecosystem;
- `app.js` — генератор спецификации, simulation trace, guardrails и экспорт;
- `server.mjs` — локальный API и статический сервер;
- `package.json` — команда запуска;
- `PRODUCT_SPEC.md` — продуктовая стратегия, AgentSpec, roadmap и источники исследования.

В текущем прототипе генерация работает детерминированно локально. Точка подключения реального LLM — API `POST /api/agent-spec` и функция `buildBlueprint()`.
