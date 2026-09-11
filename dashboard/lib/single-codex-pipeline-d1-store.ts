import { compressValue, decompressValue } from "./pipeline-current-products-d1-store.ts";
import { loadPipelineValue, storePipelineValue } from "./pipeline-value-chunks.ts";
import { pipelineDigest } from "./pipeline-orchestrator.ts";
import { SINGLE_CODEX_WORKSPACE_SCHEMA, type SingleCodexWorkspace, type SingleCodexWorkspaceStore } from "./single-codex-pipeline.ts";

type WorkspaceRow = { revision: number; digest: string; value_json: string };
export class D1SingleCodexWorkspaceStore implements SingleCodexWorkspaceStore {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }
  private async ensureTables() {
    await this.db.prepare("CREATE TABLE IF NOT EXISTS p0_single_codex_workspaces (run_id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
    await this.db.prepare("CREATE TABLE IF NOT EXISTS p0_single_codex_workspace_revisions (run_id TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (run_id, revision))").run();
    await this.db.prepare("CREATE TRIGGER IF NOT EXISTS p0_single_codex_history_insert AFTER INSERT ON p0_single_codex_workspaces BEGIN INSERT INTO p0_single_codex_workspace_revisions VALUES (NEW.run_id, NEW.revision, NEW.digest, NEW.value_json, NEW.updated_at); END").run();
    await this.db.prepare("CREATE TRIGGER IF NOT EXISTS p0_single_codex_history_update AFTER UPDATE ON p0_single_codex_workspaces BEGIN INSERT INTO p0_single_codex_workspace_revisions VALUES (NEW.run_id, NEW.revision, NEW.digest, NEW.value_json, NEW.updated_at); END").run();
    await this.db.prepare("CREATE TRIGGER IF NOT EXISTS p0_single_codex_history_no_update BEFORE UPDATE ON p0_single_codex_workspace_revisions BEGIN SELECT RAISE(ABORT, 'Codex workspace history is immutable'); END").run();
    await this.db.prepare("CREATE TRIGGER IF NOT EXISTS p0_single_codex_history_no_delete BEFORE DELETE ON p0_single_codex_workspace_revisions BEGIN SELECT RAISE(ABORT, 'Codex workspace history is immutable'); END").run();
  }
  async load(runId: string) {
    await this.ensureTables();
    const row = await this.db.prepare("SELECT revision, digest, value_json FROM p0_single_codex_workspaces WHERE run_id = ?").bind(runId).first<WorkspaceRow>();
    if (!row) return null;
    const value = JSON.parse(await decompressValue(await loadPipelineValue(this.db, row.value_json))) as SingleCodexWorkspace;
    if (value.schema_version !== SINGLE_CODEX_WORKSPACE_SCHEMA || value.run_id !== runId || value.revision !== row.revision
      || value.input.run.run_id !== runId || value.input.run.owner_key !== value.owner_key || await pipelineDigest(value) !== row.digest) throw new Error("Сохранённое рабочее состояние Codex не прошло проверку целостности.");
    return value;
  }
  async compareAndSwap(runId: string, expectedRevision: number | null, workspace: SingleCodexWorkspace) {
    await this.ensureTables();
    if (workspace.schema_version !== SINGLE_CODEX_WORKSPACE_SCHEMA || workspace.run_id !== runId || workspace.input.run.run_id !== runId
      || workspace.input.run.owner_key !== workspace.owner_key || workspace.revision !== (expectedRevision ?? -1) + 1) throw new Error("Неверная версия рабочего состояния Codex.");
    const value = await storePipelineValue(this.db, await compressValue(JSON.stringify(workspace)));
    const digest = await pipelineDigest(workspace);
    const statement = expectedRevision === null
      ? this.db.prepare("INSERT OR IGNORE INTO p0_single_codex_workspaces (run_id, owner_key, revision, digest, value_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(runId, workspace.owner_key, workspace.revision, digest, value, workspace.updated_at)
      : this.db.prepare("UPDATE p0_single_codex_workspaces SET revision = ?, digest = ?, value_json = ?, updated_at = ? WHERE run_id = ? AND owner_key = ? AND revision = ?").bind(workspace.revision, digest, value, workspace.updated_at, runId, workspace.owner_key, expectedRevision);
    const result = await statement.run();
    return Number(result.meta.changes) > 0;
  }
}
