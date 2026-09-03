import type {
  P0ApplicationStore,
  P0StoredRow,
} from "./p0-application.ts";

const COMPRESSED_VALUE_PREFIX = "p0:gzip-base64:v1:";

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function compressValue(value: string) {
  if (value.startsWith(COMPRESSED_VALUE_PREFIX)) return value;
  const body = new Response(new TextEncoder().encode(value)).body;
  if (!body) throw new Error("P0 state compression stream is unavailable.");
  const compressed = new Uint8Array(await new Response(
    body.pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer());
  return `${COMPRESSED_VALUE_PREFIX}${bytesToBase64(compressed)}`;
}

async function decompressValue(value: string) {
  if (!value.startsWith(COMPRESSED_VALUE_PREFIX)) return value;
  const body = new Response(base64ToBytes(value.slice(COMPRESSED_VALUE_PREFIX.length))).body;
  if (!body) throw new Error("P0 state decompression stream is unavailable.");
  const decompressed = await new Response(
    body.pipeThrough(new DecompressionStream("gzip")),
  ).arrayBuffer();
  return new TextDecoder().decode(decompressed);
}

async function decodeStoredRow(row: P0StoredRow): Promise<P0StoredRow> {
  return { ...row, value_json: await decompressValue(row.value_json) };
}

export async function ensureP0ApplicationTables(db: D1Database) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_state (user_key TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, value_json TEXT NOT NULL)",
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS p0_state_revisions (user_key TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, value_json TEXT NOT NULL, PRIMARY KEY (user_key, revision))",
  ).run();
}

export class D1P0ApplicationStore implements P0ApplicationStore {
  private readonly database: () => D1Database;

  constructor(database: D1Database | (() => D1Database)) {
    this.database = typeof database === "function" ? database : () => database;
  }

  private db() {
    return this.database();
  }

  async load(key: string): Promise<P0StoredRow | null> {
    const db = this.db();
    await ensureP0ApplicationTables(db);
    const row = await db
      .prepare("SELECT revision, updated_at, value_json FROM p0_state WHERE user_key = ?")
      .bind(key)
      .first<P0StoredRow>();
    if (row) {
      await db
        .prepare("INSERT OR IGNORE INTO p0_state_revisions(user_key, revision, updated_at, value_json) VALUES (?, ?, ?, ?)")
        .bind(key, row.revision, row.updated_at, row.value_json)
        .run();
    }
    return row ? decodeStoredRow(row) : null;
  }

  async initialize(key: string, row: P0StoredRow) {
    const db = this.db();
    await ensureP0ApplicationTables(db);
    const storedValue = await compressValue(row.value_json);
    const result = await db
      .prepare("INSERT OR IGNORE INTO p0_state(user_key, revision, updated_at, value_json) VALUES (?, ?, ?, ?)")
      .bind(key, row.revision, row.updated_at, storedValue)
      .run();
    if (Number(result.meta.changes) !== 1) return false;
    await db
      .prepare("INSERT OR IGNORE INTO p0_state_revisions(user_key, revision, updated_at, value_json) SELECT user_key, revision, updated_at, value_json FROM p0_state WHERE user_key = ? AND revision = ?")
      .bind(key, row.revision)
      .run();
    return true;
  }

  async compareAndSwap(key: string, expectedRevision: number, row: P0StoredRow) {
    const db = this.db();
    await ensureP0ApplicationTables(db);
    const storedValue = await compressValue(row.value_json);
    const [result] = await db.batch([
      db.prepare(
        "UPDATE p0_state SET revision = ?, updated_at = ?, value_json = ? WHERE user_key = ? AND revision = ?",
      ).bind(row.revision, row.updated_at, storedValue, key, expectedRevision),
      db.prepare(
        "INSERT OR IGNORE INTO p0_state_revisions(user_key, revision, updated_at, value_json) SELECT user_key, revision, updated_at, value_json FROM p0_state WHERE user_key = ? AND revision = ?",
      ).bind(key, row.revision),
    ]);
    return Number(result.meta.changes) === 1;
  }

  async history(key: string, limit = 50) {
    const db = this.db();
    await ensureP0ApplicationTables(db);
    const result = await db
      .prepare(
        "SELECT revision, updated_at, value_json FROM p0_state_revisions WHERE user_key = ? ORDER BY revision DESC LIMIT ?",
      )
      .bind(key, limit)
      .all<P0StoredRow>();
    return Promise.all(result.results.map((row) => decodeStoredRow(row)));
  }
}
