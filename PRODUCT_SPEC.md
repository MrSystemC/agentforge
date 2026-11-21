# AgentForge — product specification

**Product thesis**

AgentForge is a provider-neutral control plane that compiles an ordinary business brief into a portable, permission-aware and testable digital employee. The unit of value is a verified successful task, not a generated paragraph.

## Why this product now

The market is moving from isolated prompt experiments toward managed runtimes, memory, registries, evaluations, traces and identity. Google’s Gemini Enterprise Agent Platform, AWS Bedrock AgentCore and OpenAI’s Agents SDK all expose parts of this lifecycle. AgentForge occupies the cross-provider layer where a small team can describe a job once, inspect the resulting permissions, simulate it, and export it to a selected runtime.

## Wedge

The first user reaches a useful result in under fifteen minutes:

1. describe a job;
2. choose a role pack;
3. inspect the generated Agent Passport;
4. run three synthetic edge cases;
5. export a portable `.agentforge.json` or deploy through a selected adapter.

The first target users are SMB operators, AI agencies and product teams that need support, research, reporting, operations or content agents without rebuilding the same logic for every model provider.

## Defensible advantage

- **Agent Passport schema** — portable identity, inputs, outputs, tools, memory, budgets, guardrails and release state;
- **compiler** — converts vague requirements into explicit assumptions, questions, tests and risk flags;
- **simulation evidence** — every release carries scenario results and replayable traces;
- **policy graph** — each tool has capability scopes, data boundaries and approval requirements;
- **lineage** — immutable versions, signed hashes and a diff before deployment;
- **trust network** — verified templates and connectors with compatibility, safety and success scores.

## Control-plane modules

- Studio
- Workflow Canvas
- Tool and MCP Registry
- Simulation Lab
- Agent Passport and Guardrail OS
- Runs and Traces
- Memory and Data Boundaries
- Deployment Hub
- Template Marketplace
- Team, Billing and Governance

## Canonical AgentSpec

```json
{
  "schemaVersion": "1.1",
  "id": "agent-id",
  "mission": "what the agent accomplishes",
  "inputs": [],
  "outputs": { "type": "object", "jsonSchema": {} },
  "tools": [{ "id": "tool", "scopes": [], "requiresApproval": true }],
  "memory": { "mode": "session", "retentionDays": 30 },
  "workflow": { "nodes": [], "edges": [] },
  "guardrails": { "input": [], "output": [], "egress": [] },
  "budgets": { "maxSteps": 12, "maxLatencyMs": 90000, "maxCostUsd": 0.25 },
  "eval": { "suiteId": "suite", "threshold": 0.8 },
  "deployment": { "environment": "sandbox", "channel": "web" }
}
```

## Guardrail OS

Every side-effect tool call passes through a policy gateway. The gateway evaluates identity, scope, data sensitivity, spend, rate, egress and approval state. Code and browser tools run in isolated workers. Secrets are short-lived references, never prompt content. Outputs pass schema validation and PII redaction. Every decision is recorded in a replayable audit ledger. A kill switch can stop a running agent or revoke a tool binding.

This model follows current OWASP agentic risk guidance and NIST work on agent identity and authorization.

## Delivery roadmap

### P0 — delivered production foundation

Prompt-to-blueprint, role packs, Agent Passport, Simulation Lab, local traces, risk map, JSON export, API v1, session access control, audit events, schema migrations, atomic persistence, rollback, idempotent writes, health endpoints, metrics, Docker deployment and responsive Studio.

### P1 — execution platform

Provider adapters, MCP gateway, Postgres/RLS, Redis worker queue, durable runs, approvals, secret references, OpenTelemetry traces, eval suites and version diff.

### P2 — distribution

Telegram, Slack, webhooks, REST deployments, shared registry, templates, verified connectors, usage analytics and billing.

### P3 — enterprise

SSO/SAML, SCIM, private network deployment, data residency, policy-as-code, custom retention, signed releases and SLA support.

## Success metrics

- time to first simulation;
- blueprint-to-deploy conversion;
- verified successful tasks per workspace;
- eval pass rate and regression rate;
- human override rate;
- cost per successful task;
- tool approval acceptance;
- 30-day agent retention;
- unsafe-call rate in red-team suites.

## Research sources

- OpenAI Agents SDK — https://developers.openai.com/api/docs/guides/agents/sdk
- OpenAI integrations and observability — https://developers.openai.com/api/docs/guides/agents/integrations-observability
- Amazon Bedrock AgentCore — https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html
- Google Gemini Enterprise Agent Platform — https://docs.cloud.google.com/gemini-enterprise-agent-platform/vertex-ai-name-changes
- OWASP Top 10 for Agentic Applications 2026 — https://genai.owasp.org/llmrisk/agentic-applications-top-10/
- NIST Software and AI Agent Identity and Authorization — https://csrc.nist.gov/pubs/other/2026/02/05/accelerating-the-adoption-of-software-and-ai-agent
- n8n AI workflow automation — https://n8n.io/ai-agents/
