# AgentForge

**Production-ready control plane for designing, validating and operating AI agents.**

AgentForge turns a natural-language goal into a versioned `Agent Passport` with a mission, tools, workflow, memory, budget, guardrails, risk signals and test scenarios. The product runs as a single deployable service today and is organized so storage, model providers and execution workers can evolve independently over time.

## What is included in 2.0

- Studio for creating agents from a goal, role and context files;
- research, operations and creative agent profiles;
- versioned Agent Passport with hash, contract, policy version and risk map;
- local deterministic generator with optional OpenAI integration;
- workspace CRUD with search, status filters, duplication, archival and restore;
- immutable audit trail for workspace, authentication, agent and run actions;
- Agent Passport version history with rollback support;
- Simulation Lab with score, trace, policy version and idempotent runs;
- import/export of `.agentforge.json`;
- session authentication, owner role, secure cookies and production bootstrap through environment variables;
- workspace user administration with owner, operator and viewer roles;
- API v1 at `/api/v1/*` with compatibility routes at `/api/*`;
- request IDs, structured logs, rate limiting, body limits, CORS allow-list, security headers and ETag caching;
- liveness, readiness and Prometheus-compatible metrics endpoints;
- schema migration, atomic persistence, file permissions and automatic `.bak` recovery;
- Docker image, Compose deployment, CI workflow, security policy and operations runbook;
- responsive PWA interface with an authentication gate for protected deployments.

## Local development

```bash
npm install
npm start
```

Open [http://localhost:4173](http://localhost:4173). Development mode uses `AUTH_MODE=off` by default and stores data in `data/agentforge.json`.

Quality checks:

```bash
npm run check
npm test
```

The integration surface can be checked directly:

```bash
curl http://localhost:4173/api/health/ready
curl http://localhost:4173/api/v1/openapi.json
curl -X POST http://localhost:4173/api/v1/agent-spec \
  -H 'content-type: application/json' \
  -d '{"prompt":"Анализируй отзывы клиентов и готовь отчёт","role":"research"}'
```

## Production deployment

Create `.env` from `.env.example`, set a strong `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, HTTPS cookie settings and the exact public origin. Keep the file outside Git.

```bash
cp .env.example .env
docker compose up -d --build
```

The container runs as an unprivileged user and keeps persistent data in the `agentforge-data` volume. Put TLS termination, DNS and network policy in front of the container. Follow [OPERATIONS.md](OPERATIONS.md) for release, recovery and observability checks.

When `AUTH_MODE=required`, the server creates the owner account on the first start if `ADMIN_EMAIL` and `ADMIN_PASSWORD` are present. Every protected request requires the secure session cookie. `/api/health/live` stays public for liveness checks, while `/api/health/ready` confirms persistence and authentication setup.

## OpenAI provider

OpenAI is optional. Connect it from Settings or provide `OPENAI_API_KEY` and `OPENAI_MODEL` to the server. Keys stay in process memory and never enter Agent Passports, local storage or audit metadata.

## API surface

The preferred base path is `/api/v1`. Existing `/api` paths remain compatible.

- `GET /api/v1/health`, `/health/live`, `/health/ready` — service state;
- `GET /api/v1/auth/status`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` — sessions;
- `GET /api/v1/bootstrap` — workspace state;
- `GET/POST /api/v1/users` and `PATCH /api/v1/users/:id` — owner-managed workspace access;
- `GET /api/v1/templates` — starter templates;
- `POST /api/v1/agent-spec` — generate a passport;
- `GET/POST /api/v1/agents` — list and create agents;
- `GET/PATCH/DELETE /api/v1/agents/:id` — read, update and archive;
- `POST /api/v1/agents/:id/restore` — restore an archived agent;
- `GET /api/v1/agents/:id/versions` and `POST /agents/:id/rollback` — version control;
- `POST /api/v1/agents/:id/duplicate` — duplicate a passport;
- `POST /api/v1/agents/:id/runs` — run a simulation;
- `GET /api/v1/runs` — run history;
- `GET /api/v1/audit` — audit events;
- `GET /api/v1/metrics` — basic metrics;
- `GET /api/v1/openapi.json` — machine-readable API description.

Write endpoints accept `Idempotency-Key`. Agent updates accept `If-Match` with the last `updatedAt` value to prevent lost updates.

## Architecture

- `server.mjs` — HTTP boundary, API routing, sessions, rate limiting and runtime integrations;
- `storage.mjs` — schema versioning, migrations, atomic writes, backups and write queue;
- `security.mjs` — password hashing, token hashing, cookies and client identity;
- `config.mjs` — validated environment configuration;
- `app.js` — client state, Studio, workspace, import/export and authentication UX;
- `index.html` and `styles.css` — responsive PWA shell;
- `manifest.webmanifest` and `sw.js` — installable client shell;
- `test/server.test.mjs` — deterministic generator and simulation tests;
- `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml` — deployment and verification;
- `SECURITY.md` and `OPERATIONS.md` — operating requirements and recovery procedures.
- `ARCHITECTURE.md` — boundaries, compatibility rules and scale path.

The current persistence adapter is intentionally small and durable for a single service instance. The API boundaries allow a later PostgreSQL repository, Redis-backed job queue, object storage and isolated tool workers without changing the Agent Passport contract.
