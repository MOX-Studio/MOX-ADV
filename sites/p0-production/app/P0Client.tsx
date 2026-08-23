"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type {
  OwnerActionField,
  OwnerJourneyProjection,
} from "../lib/p0-owner-journey";

type JsonRecord = Record<string, unknown>;

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, init);
  const value = await response.json() as JsonRecord;
  if (!response.ok) throw new Error(String(value.message ?? "Действие не выполнено."));
  return value as OwnerJourneyProjection;
}

function actionValues(form: HTMLFormElement, fields: OwnerActionField[]) {
  const data = new FormData(form);
  return Object.fromEntries(fields.map((field) => [field.key, String(data.get(field.key) ?? "").trim()]));
}

const cardLabels = {
  "agent-activity": "Работа агента",
  finding: "Вывод",
  problem: "Проблема",
  "human-decision-gate": "Решение владельца",
} as const;

export default function P0Client() {
  const [projection, setProjection] = useState<OwnerJourneyProjection | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    request("/api/p0")
      .then(setProjection)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (!projection || projection.businessOutcome.status !== "working" || projection.primaryAction) return;
    const timer = window.setTimeout(() => {
      request("/api/p0").then(setProjection).catch(() => undefined);
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [projection]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projection?.primaryAction || busy) return;
    setBusy(true);
    setError("");
    try {
      setProjection(await request("/api/p0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: projection.primaryAction.handle,
          values: actionValues(event.currentTarget, projection.primaryAction.fields),
        }),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!projection) {
    return <div className="owner-shell">
      <Header />
      <main className="owner-page"><section className="owner-loading" aria-live="polite"><strong>Готовлю путь владельца</strong><p>{error || "Собираю текущий бизнес-вывод…"}</p></section></main>
    </div>;
  }

  return <div className="owner-shell">
    <Header />
    <main className="owner-page">
      <header className="owner-hero">
        <div><p className="owner-eyebrow">РЕКЛАМНАЯ СТРАТЕГИЯ</p><h1>От цели до готовых кампаний</h1></div>
        <span className={`owner-outcome-status ${projection.businessOutcome.status}`}>{projection.businessOutcome.status === "complete" ? "Готово" : projection.businessOutcome.status === "blocked" ? "Нужно внимание" : "В работе"}</span>
      </header>

      <ol className="owner-journey" aria-label="Путь владельца">
        {projection.journey.stages.map((stage, index) => <li key={stage.id} className={stage.status} aria-current={stage.status === "current" ? "step" : undefined}>
          <span>{stage.status === "complete" ? "✓" : index + 1}</span><strong>{stage.label}</strong>
        </li>)}
      </ol>

      {projection.introduction && <section className="owner-introduction"><p className="owner-eyebrow">КАК ЭТО РАБОТАЕТ</p><h2>{projection.introduction.title}</h2><p>{projection.introduction.body}</p></section>}

      <div className="owner-workspace">
        <section className="owner-main">
          <header className="owner-outcome">
            <p className="owner-eyebrow">ТЕКУЩИЙ БИЗНЕС-РЕЗУЛЬТАТ</p>
            <h2>{projection.businessOutcome.headline}</h2>
            <p>{projection.businessOutcome.summary}</p>
          </header>

          {projection.currentRecommendation && <section className="owner-recommendation">
            <span>Текущая рекомендация</span><h3>{projection.currentRecommendation.headline}</h3><p>{projection.currentRecommendation.rationale}</p>
          </section>}

          <section className="owner-cards" aria-label="Выводы и решения">
            {projection.cards.map((card, index) => <article key={`${card.kind}-${index}`} className={`owner-card ${card.kind}`}>
              <span>{cardLabels[card.kind]}</span><h3>{card.title}</h3><p>{card.body}</p>
              {card.facts && <dl>{card.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
            </article>)}
          </section>

          {projection.campaignOptions.length > 0 && <section className="owner-campaigns" aria-labelledby="owner-campaigns-title">
            <header><p className="owner-eyebrow">ВАРИАНТЫ КАМПАНИЙ</p><h2 id="owner-campaigns-title">Кампании для бизнес-проверки</h2></header>
            <div>{projection.campaignOptions.map((campaign, index) => <article key={`${campaign.name}-${index}`} className={campaign.selected ? "selected" : ""}>
              <header><span>{campaign.readiness}</span>{campaign.selected && <b>В рекомендованном наборе</b>}</header>
              <h3>{campaign.name}</h3>
              <dl><div><dt>Предложение</dt><dd>{campaign.offer}</dd></div><div><dt>Аудитория</dt><dd>{campaign.audience}</dd></div><div><dt>Куда ведём</dt><dd>{campaign.destination}</dd></div></dl>
              {campaign.reasons.length > 0 && <ul>{campaign.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
            </article>)}</div>
          </section>}

          {projection.packageSummary && <section className="owner-package" aria-labelledby="owner-package-title">
            <header><div><p className="owner-eyebrow">ИТОГОВАЯ ПРОВЕРКА</p><h2 id="owner-package-title">{projection.packageSummary.campaignCount} кампании к созданию</h2></div><strong>{projection.packageSummary.preflight}</strong></header>
            <p>{projection.packageSummary.execution}</p>
            {projection.packageSummary.outcomes.length > 0 && <ul>{projection.packageSummary.outcomes.map((item) => <li key={item.campaign}><strong>{item.campaign}</strong><span>{item.outcome}</span></li>)}</ul>}
          </section>}

          {projection.primaryAction && <form key={projection.primaryAction.handle} className="owner-action" onSubmit={submit}>
            <header><p className="owner-eyebrow">СЛЕДУЮЩИЙ ШАГ</p><h2>{projection.primaryAction.label}</h2><p>{projection.primaryAction.description}</p></header>
            {projection.primaryAction.fields.length > 0 && <div className="owner-fields">{projection.primaryAction.fields.map((field) => <OwnerField key={field.key} field={field} />)}</div>}
            <button type="submit" disabled={busy}>{busy ? "Агент выполняет работу…" : projection.primaryAction.label}</button>
          </form>}
          {!projection.primaryAction && projection.businessOutcome.status === "working" && <div className="owner-progress" role="status"><i /><div><strong>Агент продолжает работу</strong><p>Ожидание, повторные проверки и безопасная сверка не требуют действий владельца.</p></div></div>}
          {error && <p className="owner-error" role="alert">{error}</p>}
        </section>

        <aside className="owner-aside">
          <section><p className="owner-eyebrow">СУЩЕСТВЕННЫЕ НЕИЗВЕСТНЫЕ</p>{projection.materialUnknowns.length ? <ul>{projection.materialUnknowns.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Нет неизвестных, требующих решения владельца сейчас.</p>}</section>
          <section className="owner-roadmap" aria-label="Дорожная карта"><p className="owner-eyebrow">ДАЛЬШЕ В MOX-ADV</p><ul>{projection.roadmap.map((item) => <li key={item.label}><span>{item.label}</span><small>{item.horizon}</small></li>)}</ul></section>
        </aside>
      </div>
    </main>
  </div>;
}

function Header() {
  return <header className="owner-topbar"><Link className="brand" href="/"><span>M</span>MOX-ADV</Link><nav aria-label="Основная навигация"><span>Реклама</span></nav><div className="owner-connection"><i />Агент готов</div></header>;
}

function OwnerField({ field }: { field: OwnerActionField }) {
  const common = { name: field.key, required: field.required, defaultValue: field.value };
  return <label className={field.control === "textarea" ? "wide" : ""}><span>{field.label}</span>
    {field.control === "textarea" ? <textarea {...common} /> : field.control === "select" ? <select {...common}><option value="" disabled>Выберите</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : <input {...common} type={field.control} />}
    {field.help && <small>{field.help}</small>}
  </label>;
}
