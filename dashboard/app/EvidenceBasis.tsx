"use client";

import type { ReactNode } from "react";
import type { FormationResearch } from "../lib/campaign-formation-method.ts";
import type { ReadableEvidenceFact } from "../lib/readable-evidence.ts";
import { businessText, businessSourceUrl } from "../lib/owner-business-copy.ts";
import styles from "./evidence-basis.module.css";

const basisLabels = { OBSERVATION: "Сведения источника", INFERENCE: "Вывод исследования", OWNER: "Данные владельца", UNKNOWN: "Не подтверждено" };
const findingLabels = { OBSERVED: "Сведения исследования", INFERRED: "Вывод исследования", UNKNOWN: "Не подтверждено", CONFLICT: "Есть противоречие", NO_ROWS_RETURNED: "Источник не показал результатов" };
const date = (value: string | null) => {
  if (!value) return "Дата неизвестна";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "Дата неизвестна" : "Дата: " + parsed.toLocaleDateString("ru-RU");
};
const safeUrl = businessSourceUrl;
const readable = (value: string) => { const clean = businessText(value); return machineText(clean) ? "" : clean; };
// Literal offers and quotations keep their exact wording. Diagnostic-only text is
// not rewritten into a business fact merely to make it look understandable.
const machineText = (value: string) => /urn:|sha256:|\b[a-f\d]{32,}\b|\b(?:snapshot|schema(?:_version)?|source_?ids?|source_refs|evidence_?ids?|evidence_refs|record_id|provider_metadata|raw)\b|\bp0-[a-z\d-]+|\b[A-Z]+(?:_[A-Z\d]+){1,}\b|\b(?:PUBLIC|DIRECT|WORDSTAT|HTML|FRESH)[-_][A-Z\d][A-Za-z\d:_-]*\b|сохран[её]нн[а-я]*\s+(?:запис|фрагмент)|(?:восстанов|восстанавл)[а-я]*\s+фрагмент/iu.test(value)
  || [...value.matchAll(/https?:\/\/[^\s<>"')]+/gu)].some(match => !safeUrl(match[0]));
const literal = (value: string) => machineText(value) ? "" : value;
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/\s+/gu, " ").trim().replace(/[.!?]+$/u, "");
const unique = (values: string[]) => [...new Map(values.filter(Boolean).map(value => [normalized(value), value])).values()];
const sameText = (left: string, right: string) => normalized(left) === normalized(right);
// Exact repeated sentences can be omitted without interpreting or shortening a fact.
const alreadyShown = (value: string, displayed: string[]) => {
  const target = normalized(value);
  const fragments = value.split(/\s*[·•]\s*|(?<=[.!?])\s+/u).map(normalized).filter(Boolean);
  return Boolean(target) && (displayed.some(item => normalized(item) === target)
    || fragments.every(fragment => displayed.some(item => normalized(item) === fragment)));
};
const genericFact = (fact: ReadableEvidenceFact) => (fact.kind && ["MATERIAL", "SOURCE", "SNAPSHOT", "UNRESOLVED"].includes(fact.kind))
  || !fact.value || sameText(fact.label, fact.value) || /^(?:Набор сохранённых источников|Краткое содержание основания не сохранено|Основание не найдено|Подтверждение недоступно)/u.test(fact.value);
const missingExcerpt = (fact: ReadableEvidenceFact) => fact.sources.some(source => source.excerptStatus === "MISSING")
  || fact.limitations.some(value => /no recoverable first-party evidence span|подтверждающий фрагмент[^.]*не сохранил|фрагмент[^.]*не сохран/iu.test(value));
const criticalNotes = (fact: ReadableEvidenceFact) => [
  ...(missingExcerpt(fact) ? ["Подтверждающая цитата со страницы недоступна."] : []),
  ...(fact.sources.some(source => source.excerptStatus === "PARTIAL") || fact.limitations.some(value => /цитата[^.]*частично|фрагмент[^.]*неполный/iu.test(value)) ? ["Цитата источника доступна частично."] : []),
  ...(fact.limitations.some(value => /противоречие|conflict/iu.test(value)) ? ["В источниках есть противоречие."] : []),
  ...(fact.limitations.some(value => /более раннему периоду|другой период|\bstale\b/iu.test(value)) ? ["Источник относится к другому периоду."] : []),
  ...(fact.limitations.some(value => /(?:свежесть|актуальность)[^.]*не установлена|freshness[^.]*unknown/iu.test(value)) ? ["Актуальность данных не установлена."] : []),
  ...(fact.limitations.some(value => /области наблюдений не совпадают|scope.mismatch/iu.test(value)) ? ["Области наблюдений не совпадают."] : []),
  ...(fact.limitations.some(value => /данные источника недоступны/iu.test(value)) ? ["Данные источника недоступны."] : []),
];
const address = (value: string) => {
  const url = new URL(value);
  return url.host + (url.pathname === "/" || machineText(url.pathname) ? "" : url.pathname);
};

export default function EvidenceBasis({ research, sourceFacts = [], findingIds = [], sourceRefs = [], explanation, choice, label = "Основание", children }: {
  research: FormationResearch;
  sourceFacts?: ReadableEvidenceFact[];
  findingIds?: string[];
  sourceRefs?: string[];
  explanation?: string;
  choice?: string;
  label?: string;
  children?: ReactNode;
}) {
  const findingSet = new Set(findingIds);
  const directRefs = new Set(sourceRefs);
  const findings = research.findings.filter(finding => findingIds.length ? findingSet.has(finding.id) : finding.evidence_refs.some(ref => directRefs.has(ref)));
  const requested = new Set(sourceRefs.length ? sourceRefs : findings.flatMap(finding => finding.evidence_refs));
  const facts = sourceFacts.filter(fact => requested.has(fact.id) || fact.aliases.some(ref => requested.has(ref)));
  const unresolved = [...requested].filter(ref => !facts.some(fact => fact.id === ref || fact.aliases.includes(ref)));
  const statements: ReadableEvidenceFact[] = [];
  for (const fact of facts.filter(fact => !genericFact(fact) && literal(fact.value)).sort((left, right) => Number(left.id.endsWith(":quote")) - Number(right.id.endsWith(":quote")))) {
    if (!alreadyShown(fact.value, statements.filter(item => item.basis === fact.basis).map(item => item.value))) statements.push(fact);
  }
  const relatedFindings = statements.length ? [] : findings.filter(finding => readable(finding.finding));
  const displayedText = [...statements.map(fact => fact.value), ...relatedFindings.map(finding => readable(finding.finding))];
  const decisions = unique([choice ?? "", explanation ?? ""].map(readable)).filter(value => !alreadyShown(value, displayedText));
  const scopedFindings = statements.length && sourceRefs.length ? findings.filter(finding => finding.evidence_refs.some(ref => directRefs.has(ref))) : findings;
  const limits = unique([...facts.flatMap(fact => fact.limitations), ...scopedFindings.map(finding => finding.limitation)].map(readable));
  const notes = unique(facts.flatMap(criticalNotes));

  type Source = ReadableEvidenceFact["sources"][number] & { excerpts: string[] };
  const sourceMap = new Map<string, Source>();
  for (const source of facts.flatMap(fact => fact.sources)) {
    const url = source.url ? safeUrl(source.url) ?? null : null;
    const title = readable(source.title) || (url ? new URL(url).host : "Источник информации");
    const scope = (source.scope ?? []).filter(value => !machineText(value)).map(readable).filter(Boolean);
    const key = JSON.stringify([url ?? title, source.observedAt, scope]);
    const existing = sourceMap.get(key);
    const excerptStatus = existing?.excerptStatus === "MISSING" || source.excerptStatus === "MISSING" ? "MISSING"
      : existing?.excerptStatus === "PARTIAL" || source.excerptStatus === "PARTIAL" ? "PARTIAL" : source.excerptStatus ?? existing?.excerptStatus;
    sourceMap.set(key, { ...source, title, scope, url, excerptStatus, excerpts: unique([...(existing?.excerpts ?? []), literal(source.excerpt ?? "")]) });
  }
  for (const sourceUrl of relatedFindings.flatMap(finding => finding.source_urls ?? [])) {
    const url = safeUrl(sourceUrl);
    if (url && ![...sourceMap.values()].some(source => source.url === url)) sourceMap.set(url, { title: "Страница из исследования", url, observedAt: null, excerpts: [] });
  }
  const sources = [...sourceMap.values()];
  const titleCounts = new Map(sources.map(source => [source.title, sources.filter(item => sameText(item.title, source.title)).length]));
  const sharedScope = (sources[0]?.scope ?? []).filter(scope => sources.length > 1 && sources.every(source => source.scope?.some(item => sameText(item, scope))));

  return <details className={styles.basis} data-evidence-basis>
    <summary>{readable(label) || "Основание"}</summary>
    <div className={styles.content}>
      {notes.length > 0 && <div className={styles.caution} data-evidence-caution>{notes.map(note => <p key={note}>{note}</p>)}</div>}
      {statements.map(fact => <article className={styles.statement} key={fact.id} data-readable-evidence>
        <header><strong>{readable(fact.label) || "Основание"}</strong><span>{missingExcerpt(fact) && fact.basis === "OBSERVATION" ? "Без подтверждающей цитаты" : basisLabels[fact.basis]}</span></header>
        <p>{fact.value}</p>
      </article>)}
      {relatedFindings.map(finding => <article className={styles.statement} key={finding.id} data-basis-finding>
        <header><strong>Вывод из собранных материалов</strong><span>{findingLabels[finding.state]}</span></header>
        <p>{readable(finding.finding)}</p>
      </article>)}
      {decisions.length > 0 && <section className={styles.decision}><h4>Как использовано</h4>{decisions.map(value => <p key={value}>{value}</p>)}</section>}
      {children}
      {sources.length > 0 && <section className={styles.sources}><h4>Источники</h4>{sharedScope.length > 0 && <small>{sharedScope.join(" · ")}</small>}{sources.map((source, index) => {
        const sourceAddress = source.url ? address(source.url) : "";
        const repeatedTitle = (titleCounts.get(source.title) ?? 0) > 1 || source.scope?.some(scope => sameText(scope, source.title));
        const excerpts = source.excerpts.filter(excerpt => !alreadyShown(excerpt, [...displayedText, ...decisions]));
        const scope = source.scope?.filter(value => !sharedScope.some(item => sameText(item, value))) ?? [];
        return <div className={styles.source} key={String(source.url) + "-" + source.observedAt + "-" + index}>
          {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{repeatedTitle ? sourceAddress : readable(source.title)}</a> : <strong>{readable(source.title)}</strong>}
          {source.url && !repeatedTitle && <small className={styles.address}>{sourceAddress}</small>}
          <small>{date(source.observedAt)}</small>
          {scope.length > 0 && <small>{scope.map(readable).join(" · ")}</small>}
          {excerpts.length > 0 && <div className={styles.excerpt}>
            <small>{source.excerptStatus === "MISSING" ? "Подтверждающая цитата недоступна" : source.excerptStatus === "PARTIAL" ? "Цитата доступна частично" : "Цитата из источника"}</small>
            {excerpts.map(excerpt => source.excerptStatus === "MISSING" ? <p key={excerpt}>{excerpt}</p> : <blockquote key={excerpt}>{excerpt}</blockquote>)}
          </div>}
        </div>;
      })}</section>}
      {limits.length > 0 && <details className={styles.limitDetails}><summary>Ограничения источников</summary><ul className={styles.limits}>{limits.map(item => <li key={item}>{readable(item)}</li>)}</ul></details>}
      {unresolved.length > 0 && <p className={styles.limitation}>Для части выводов подтверждение недоступно.</p>}
      {!statements.length && !relatedFindings.length && <p className={styles.limitation}>Подтверждение этого вывода недоступно.{sources.length ? " Доступные материалы перечислены выше." : ""}</p>}
    </div>
  </details>;
}
