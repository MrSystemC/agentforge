# AgentForge architecture

## Design horizon

AgentForge is organized around a stable Agent Passport contract and replaceable infrastructure adapters. The first deployment is a single Node service with durable JSON storage. The API, event vocabulary and versioned passport are the seams for later scale-out.

## Runtime boundaries

```text
Browser / PWA
      |
      v
HTTP boundary ── authentication ── rate limit ── request ID
      |
      +── workspace API ── repository adapter ── JSON / PostgreSQL
      +── run API ──────── execution adapter ── local / queue workers
      +── provider API ─── model adapter ────── OpenAI / other providers
      +── audit events ─── event sink ───────── stdout / OpenTelemetry
```

The HTTP boundary owns input limits, authentication, authorization, idempotency, optimistic concurrency and response contracts. Domain code owns Agent Passport normalization, simulation policy and audit events. Storage owns migrations, atomic writes and recovery. Provider and execution adapters are intentionally outside the passport model.

## Long-term compatibility rules

1. Additive fields are preferred in Agent Passport schema changes.
2. Breaking changes require a new `schemaVersion` and a migration.
3. Public endpoints are versioned under `/api/v1`. Compatibility aliases may remain during a migration window.
4. Every mutating request may carry an `Idempotency-Key`.
5. Agent updates use `If-Match` to prevent lost writes.
6. Archived agents remain auditable and recoverable through restore.
7. Secrets never enter passports, local storage or audit metadata.
8. Every run records policy version, actor, scenario and trace.

## Scale path

The current `JsonStore` can be replaced with a repository implementation backed by PostgreSQL and row-level workspace isolation. Run creation can move from the synchronous simulation adapter to an outbox and Redis/BullMQ worker without changing `POST /agents/:id/runs`. File context can move to object storage while the passport keeps immutable references and checksums. Audit events can be streamed to an append-only ledger and OpenTelemetry collector.

## Operational guarantees

- atomic writes prevent partially written workspace files;
- the previous persistence snapshot is retained as `.bak`;
- readiness fails when required authentication setup is incomplete;
- the process handles `SIGTERM` and waits for the write queue before exit;
- static files use ETag validation and private data paths are denied;
- structured logs and request IDs allow incident correlation.

## Deliberate boundaries

The repository does not pretend that a single-process JSON adapter is a multi-region database or that a deterministic simulation is a live tool execution worker. Those capabilities have explicit adapter boundaries and deployment milestones in `PRODUCT_SPEC.md`.
