import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSpec, inferTools, simulateSpec } from '../server.mjs';

test('inferTools selects modules from a natural-language task', () => {
  const selected = inferTools('Загружай CSV с продажами, ищи аномалии и отправляй отчёт в Telegram');
  assert.deepEqual(selected, ['Работа с файлами', 'Уведомления', 'Память']);
});

test('buildSpec creates a guarded, portable passport', () => {
  const spec = buildSpec({
    prompt: 'Проверяй оплату и передавай спорные случаи оператору',
    role: 'ops'
  });

  assert.equal(spec.schemaVersion, '1.1');
  assert.equal(spec.roleKey, 'ops');
  assert.ok(spec.id.startsWith('AF-'));
  assert.ok(spec.passportHash);
  assert.equal(spec.guardrails.approval, 'approval-required');
  assert.ok(spec.workflow.nodes.includes('review'));
});

test('simulateSpec returns a trace tied to the agent and scenario', () => {
  const spec = buildSpec({ prompt: 'Собери дайджест новостей', role: 'research' });
  const run = simulateSpec(spec, 'research');

  assert.equal(run.agentId, spec.id);
  assert.equal(run.caseId, 'research');
  assert.equal(run.status, 'completed');
  assert.equal(run.trace.length, 3);
  assert.equal(run.score, 88);
});
