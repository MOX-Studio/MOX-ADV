// Content-addressed storage for a complete compressed value exceeding one D1 row.
// The owning row is still committed by its original CAS; incomplete writes never
// become visible, and legacy inline values keep their original representation.
const PREFIX = "p0:chunks:v1:";
const PART_SIZE = 256_000;
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, "0")).join("");

async function ensure(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS p0_pipeline_value_chunks (digest TEXT NOT NULL, part INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY (digest, part))").run();
  await db.prepare("CREATE TRIGGER IF NOT EXISTS p0_pipeline_value_chunks_no_update BEFORE UPDATE ON p0_pipeline_value_chunks BEGIN SELECT RAISE(ABORT, 'pipeline value chunks are immutable'); END").run();
  await db.prepare("CREATE TRIGGER IF NOT EXISTS p0_pipeline_value_chunks_no_delete BEFORE DELETE ON p0_pipeline_value_chunks BEGIN SELECT RAISE(ABORT, 'pipeline value chunks are immutable'); END").run();
}

export async function storePipelineValue(db: D1Database, value: string) {
  if (new TextEncoder().encode(value).length <= PART_SIZE) return value;
  await ensure(db);
  const digest = await hash(value), parts = Math.ceil(value.length / PART_SIZE);
  for (let part = 0; part < parts; part++) {
    await db.prepare("INSERT OR IGNORE INTO p0_pipeline_value_chunks (digest, part, value) VALUES (?, ?, ?)")
      .bind(digest, part, value.slice(part * PART_SIZE, (part + 1) * PART_SIZE)).run();
  }
  const reference = `${PREFIX}${JSON.stringify({ digest, parts, length: value.length })}`;
  // Also verifies a pre-existing digest before a current/history row can refer to it.
  if (await loadPipelineValue(db, reference) !== value) throw new Error("Pipeline value chunk verification failed.");
  return reference;
}

export async function loadPipelineValue(db: D1Database, value: string) {
  if (!value.startsWith(PREFIX)) return value;
  const ref = JSON.parse(value.slice(PREFIX.length)) as { digest: string; parts: number; length: number };
  if (Object.keys(ref).sort().join() !== "digest,length,parts" || !/^[a-f0-9]{64}$/u.test(ref.digest)
    || !Number.isSafeInteger(ref.parts) || ref.parts < 1 || ref.parts > 4096
    || !Number.isSafeInteger(ref.length) || ref.length < 1 || Math.ceil(ref.length / PART_SIZE) !== ref.parts) throw new Error("Pipeline value chunk reference is corrupt.");
  const result = await db.prepare("SELECT part, value FROM p0_pipeline_value_chunks WHERE digest = ? ORDER BY part").bind(ref.digest).all<{ part: number; value: string }>();
  if (result.results.length !== ref.parts || result.results.some((row, index) => row.part !== index || typeof row.value !== "string")) throw new Error("Pipeline value chunks are incomplete.");
  const decoded = result.results.map(row => row.value).join("");
  if (decoded.length !== ref.length || await hash(decoded) !== ref.digest) throw new Error("Pipeline value chunks failed integrity verification.");
  return decoded;
}
