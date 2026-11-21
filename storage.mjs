import { copyFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const CURRENT_SCHEMA_VERSION = 2;

export function defaultStore() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    version: 1,
    workspace: { id: 'ws-local', name: 'Моя команда', owner: 'Mikle', plan: 'Pro workspace' },
    users: [],
    agents: [],
    runs: [],
    audit: [],
    idempotency: {},
    drafts: { studio: { prompt: '', role: 'research', context: [] } },
    settings: { theme: 'dark', defaultRole: 'research', defaultModel: 'gpt-6.2-astra', notifications: true },
    updatedAt: new Date().toISOString()
  };
}

function migrationV1ToV2(store) {
  return {
    ...store,
    schemaVersion: 2,
    users: Array.isArray(store.users) ? store.users : [],
    audit: Array.isArray(store.audit) ? store.audit : [],
    idempotency: store.idempotency && typeof store.idempotency === 'object' ? store.idempotency : {},
    agents: Array.isArray(store.agents) ? store.agents.map((agent) => ({ ...agent, deletedAt: agent.deletedAt || null, versions: Array.isArray(agent.versions) ? agent.versions : [] })) : [],
    runs: Array.isArray(store.runs) ? store.runs : []
  };
}

export function migrateStore(input) {
  const base = defaultStore();
  const source = input && typeof input === 'object' ? input : {};
  const merged = {
    ...base,
    ...source,
    workspace: { ...base.workspace, ...(source.workspace || {}) },
    settings: { ...base.settings, ...(source.settings || {}) },
    drafts: { ...base.drafts, ...(source.drafts || {}) }
  };
  return migrationV1ToV2(merged);
}

export class JsonStore {
  constructor(file) {
    this.file = file;
    this.data = defaultStore();
    this.writeChain = Promise.resolve();
    this.ready = false;
  }

  async init() {
    await mkdir(dirname(this.file), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      const needsMigration = Number(parsed.schemaVersion || 1) !== CURRENT_SCHEMA_VERSION;
      this.data = migrateStore(parsed);
      if (needsMigration) await this.persist();
    } catch (error) {
      if (error.code !== 'ENOENT') {
        try {
          this.data = migrateStore(JSON.parse(await readFile(`${this.file}.bak`, 'utf8')));
        } catch {
          this.data = defaultStore();
        }
      }
      await this.persist(this.data, { backup: false });
    }
    this.ready = true;
    return this;
  }

  async mutate(mutator) {
    const operation = this.writeChain.catch(() => undefined).then(async () => {
      const draft = structuredClone(this.data);
      const result = await mutator(draft);
      draft.updatedAt = new Date().toISOString();
      const next = migrateStore(draft);
      await this.persist(next);
      this.data = next;
      return result;
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }

  async persist(next = this.data, options = {}) {
    const snapshot = JSON.stringify(next, null, 2);
    const temporary = `${this.file}.tmp`;
    if (options.backup !== false) {
      try {
        await copyFile(this.file, `${this.file}.bak`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.file);
  }

  async close() {
    await this.writeChain;
    try { await unlink(`${this.file}.tmp`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
