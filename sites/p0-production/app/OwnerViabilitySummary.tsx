import type { OwnerJourneyProjection } from "../lib/p0-owner-journey";

type CampaignOption = OwnerJourneyProjection["campaignOptions"][number];

type StatusCopy = {
  headline: string;
  explanation: string;
  reasonsTitle: string;
};

const STATUS_COPY: Record<CampaignOption["status"], StatusCopy> = {
  VIABLE: {
    headline: "Допустима для предстартового теста",
    explanation: "Жёсткие условия пройдены, а доказательств достаточно для сравнительного приоритета внутри текущей сопоставимой группы.",
    reasonsTitle: "Главные причины сравнительного приоритета",
  },
  TESTABLE_WITH_GAPS: {
    headline: "Допустима с проверяемыми пробелами",
    explanation: "Жёсткие условия пройдены. Необязательные пробелы не подменяются фактами и расширяют показанный диапазон чувствительности.",
    reasonsTitle: "Главные причины и проверяемые пробелы",
  },
  INSUFFICIENT_EVIDENCE: {
    headline: "Недостаточно доказательств для балла",
    explanation: "Обязательное доказательство ещё недоступно или не подтверждено для текущей редакции, поэтому балл и место не рассчитываются.",
    reasonsTitle: "Каких доказательств не хватает",
  },
  BLOCKED: {
    headline: "Заблокирована жёстким условием",
    explanation: "Черновик не прошёл обязательное условие допустимости. Положительные факторы не усредняют и не скрывают блокировку.",
    reasonsTitle: "Что блокирует допустимость",
  },
};

export function OwnerViabilitySummary({ campaign }: { campaign: CampaignOption }) {
  const copy = STATUS_COPY[campaign.status];
  const scoreAvailable = /^\d+(?:[.,]\d+)?\/100/u.test(campaign.comparativeScore);
  return <section
    className={`owner-viability owner-viability-${campaign.status.toLocaleLowerCase("en-US").replaceAll("_", "-")}`}
    data-viability-status={campaign.status}
    aria-label={`Предстартовая жизнеспособность «${campaign.name}»`}
  >
    <header><div><span>ПРЕДСТАРТОВАЯ ЖИЗНЕСПОСОБНОСТЬ</span><h4>{copy.headline}</h4></div><strong>{campaign.status}</strong></header>
    <div className="owner-viability-metrics">
      <div><span>Сравнительный приоритет</span><b>{campaign.comparativeScore}</b></div>
      <div><span>Покрытие доказательств</span><b>{campaign.evidenceCoverage}</b></div>
      <div><span>Чувствительность</span><b>{campaign.sensitivity}</b></div>
    </div>
    <p>{copy.explanation}</p>
    {campaign.reasons.length > 0 && <div className="owner-viability-reasons"><h5>{copy.reasonsTitle}</h5><ol>{campaign.reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}</ol></div>}
    <footer>{scoreAvailable
      ? "Балл задаёт только очерёдность предстартовых тестов. Это не вероятность, не прогноз результата и не обещание эффективности."
      : "Балл появится только после прохождения обязательных условий для этой точной редакции."}</footer>
  </section>;
}
