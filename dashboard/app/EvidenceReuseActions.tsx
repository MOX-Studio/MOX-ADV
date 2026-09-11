"use client";

import styles from "./production-dashboard.module.css";

export default function EvidenceReuseActions({
  available,
  reason,
  refreshAvailable,
  busy,
  active,
  onRegenerate,
  onRefresh,
}: {
  available: boolean;
  reason: string;
  refreshAvailable: boolean;
  busy: boolean;
  active: boolean;
  onRegenerate: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  return <section className={styles.evidenceReuse} aria-label="Продолжение подготовки">
    <div className={styles.evidenceReuseActions}>
      <button type="button" disabled={busy || active || !available} onClick={onRegenerate} title={!available ? reason : undefined}>{busy ? "Запускаю…" : "Продолжить по собранным сведениям"}</button>
      <button type="button" disabled={busy || active || !refreshAvailable} onClick={onRefresh}>Собрать сведения заново</button>
    </div>
  </section>;
}
