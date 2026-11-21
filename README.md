# AgentForge

**Из промта — в проверяемого цифрового сотрудника.**

AgentForge — локальный control plane для проектирования, проверки и хранения AI-агентов. Описание задачи превращается в переносимый `Agent Passport` с миссией, инструментами, workflow, памятью, бюджетом, guardrails и тестовыми сценариями.

## Возможности релиза 1.0

- Studio с детерминированной локальной генерацией и подключаемым OpenAI-провайдером;
- три готовые специализации — исследователь, операционный координатор и креативный партнёр;
- контекстные файлы до восьми вложений с ограничением размера и безопасным выводом;
- паспорт агента с версией схемы, хэшем, риском, разрешениями, assumptions и clarification questions;
- управление инструментами — Web research, файлы, уведомления, память, API actions, code execution и browser automation;
- workflow с этапами intake, plan, retrieve, act, review и respond;
- Simulation Lab с готовыми кейсами, live trace, score и risk map;
- рабочее пространство с CRUD-операциями, поиском, фильтрами, дублированием и удалением агентов;
- история запусков с трассировкой и результатами;
- импорт и экспорт `.agentforge.json`, копирование JSON и загрузка стартовых шаблонов;
- настройки команды, роль по умолчанию, уведомления и статус AI-провайдера;
- PWA manifest, service worker, адаптивный интерфейс и автономный fallback-режим;
- локальное атомарное JSON-хранилище, готовое к замене на SQL/Redis в следующем контуре.

## Быстрый запуск

```bash
npm install
npm start
```

Откройте [http://localhost:4173](http://localhost:4173).

Для проверки синтаксиса и бизнес-логики:

```bash
npm run check
npm test
```

## Подключение OpenAI

В интерфейсе откройте «Настройки», вставьте API-ключ и выберите модель. Сервер проверяет ключ через официальный API, хранит его только в памяти текущего процесса и не добавляет секрет в паспорт или `localStorage`.

Для серверного старта можно задать переменные окружения:

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-6.2-astra
npm start
```

Без ключа приложение полноценно работает в локальном детерминированном режиме.

## API

- `GET /api/health` — состояние control plane;
- `GET /api/bootstrap` — рабочее пространство, агенты, запуски, шаблоны и настройки;
- `GET /api/templates` — каталог стартовых шаблонов;
- `GET /api/agents` и `POST /api/agents` — список и создание агентов;
- `GET/PATCH/DELETE /api/agents/:id` — просмотр, изменение и удаление агента;
- `POST /api/agents/:id/duplicate` — дублирование паспорта;
- `POST /api/agents/:id/runs` — тестовый запуск сценария;
- `GET /api/runs` — история запусков;
- `POST /api/agent-spec` — генерация паспорта;
- `POST /api/import` — импорт паспорта;
- `PATCH /api/draft` и `PATCH /api/settings` — сохранение черновика и настроек;
- `/api/integrations/openai/*` — подключение, проверка и отключение провайдера;
- `POST /api/openai/generate` — запрос к подключённой модели.

## Структура

- `index.html` — оболочка приложения и доступные view;
- `styles.css` — адаптивная визуальная система;
- `app.js` — состояние клиента, Studio, workspace, шаблоны, импорт/экспорт и UX;
- `server.mjs` — API, persistence, simulation и static server;
- `manifest.webmanifest` и `sw.js` — PWA-слой;
- `test/server.test.mjs` — автоматические тесты генерации и симуляции;
- `PRODUCT_SPEC.md` — продуктовая стратегия и AgentSpec;
- `agentforge-generator.zip` — исходный архив генератора.

## Данные и расширение

Рабочие данные сохраняются в `data/agentforge.json`. Файл создаётся автоматически и исключён из Git. Для отдельного окружения можно указать другой путь через `AGENTFORGE_DATA_FILE`.

Текущий persistence-слой рассчитан на локальный релиз и совместим с дальнейшей заменой на Postgres, Redis/BullMQ, S3, OpenTelemetry, scoped secrets, approval gates и внешние deployment-адаптеры.
