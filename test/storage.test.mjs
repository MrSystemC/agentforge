import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CURRENT_SCHEMA_VERSION, JsonStore } from '../storage.mjs';

test('JsonStore migrates the first schema and keeps a backup on writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentforge-storage-'));
  const file = join(directory, 'agentforge.json');
  await writeFile(file, JSON.stringify({ version: 1, agents: [], runs: [] }));
  const store = await new JsonStore(file).init();

  assert.equal(store.data.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(JSON.parse(await readFile(`${file}.bak`, 'utf8')).version, 1);
  await store.mutate((draft) => { draft.workspace.name = 'Production workspace'; });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).workspace.name, 'Production workspace');
  assert.equal(JSON.parse(await readFile(`${file}.bak`, 'utf8')).workspace.name, 'Моя команда');
  await store.close();
});

test('JsonStore write queue recovers after a failed mutation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentforge-storage-'));
  const store = await new JsonStore(join(directory, 'agentforge.json')).init();

  await assert.rejects(() => store.mutate(() => { throw new Error('expected failure'); }));
  await store.mutate((draft) => { draft.settings.notifications = false; });
  assert.equal(store.data.settings.notifications, false);
  await store.close();
});

test('JsonStore preserves the backup while recovering a corrupted file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentforge-storage-'));
  const file = join(directory, 'agentforge.json');
  await writeFile(`${file}.bak`, JSON.stringify({ schemaVersion: 2, workspace: { name: 'Recovered workspace' } }));
  await writeFile(file, '{broken');
  const store = await new JsonStore(file).init();

  assert.equal(store.data.workspace.name, 'Recovered workspace');
  assert.equal(JSON.parse(await readFile(`${file}.bak`, 'utf8')).workspace.name, 'Recovered workspace');
  await store.close();
});
