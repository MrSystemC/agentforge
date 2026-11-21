# AgentForge operations runbook

## Release checklist

1. Generate a new `SESSION_SECRET` and set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the deployment secret store.
2. Set the exact HTTPS origin in `ALLOWED_ORIGINS`.
3. Run `npm run check` and `npm test` in CI.
4. Build and start the container with `docker compose up -d --build`.
5. Verify `/api/health/live` and `/api/health/ready`.
6. Open the workspace, sign in, create a test agent and run a simulation.
7. Confirm that the data volume is included in the backup schedule.

## Recovery

The persistence layer writes atomically and keeps the previous file as `agentforge.json.bak`. Stop the service before replacing a corrupted data file with the backup, then start the service and verify readiness.

## Observability

- structured application events are written to stdout;
- every request receives an `x-request-id`;
- `/api/metrics` exposes basic Prometheus-compatible counters;
- `/api/health/live` checks process liveness;
- `/api/health/ready` checks persistence and required authentication setup.
