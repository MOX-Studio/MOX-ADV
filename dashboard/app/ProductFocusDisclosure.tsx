/* eslint-disable @typescript-eslint/no-explicit-any -- revisioned product-focus payload is validated by the application contract. */

function statusLabel(value: unknown) {
  return {
    AVAILABLE: "Данные доступны",
    PARTIAL: "Частичные данные",
    UNAVAILABLE: "Недоступно",
    READY: "Готово к запуску",
    GAPS: "Есть пробелы",
    BLOCKED: "Заблокировано",
    SUFFICIENT: "Достаточно",
    INSUFFICIENT: "Недостаточно",
    LAUNCH_NOW: "Рекомендуемый фокус",
    ALTERNATIVE: "Альтернатива",
    INSUFFICIENT_EVIDENCE: "Недостаточно доказательств",
  }[String(value)] || String(value || "Недоступно");
}

function dimensionValue(kind: "market" | "readiness" | "coverage", dimension: Record<string, any>) {
  if (kind === "market") {
    return typeof dimension.observed_lower_bound === "number"
      ? `${dimension.observed_lower_bound}+ наблюдаемых запросов`
      : "Спрос в точном охвате недоступен";
  }
  if (kind === "coverage") return `${Number(dimension.percent || 0)}%`;
  return `${Number(dimension.score || 0)} / 100`;
}

function FocusDimension({
  title,
  kind,
  dimension,
}: {
  title: string;
  kind: "market" | "readiness" | "coverage";
  dimension: Record<string, any>;
}) {
  const reasons = Array.isArray(dimension.reasons) ? dimension.reasons : [];
  return <section className={`focus-dimension ${String(dimension.status || "").toLowerCase()}`}>
    <span>{title}</span>
    <strong>{dimensionValue(kind, dimension)}</strong>
    <small>{statusLabel(dimension.status)}</small>
    {reasons[0]?.detail && <p>{String(reasons[0].detail)}</p>}
  </section>;
}

export function ProductFocusDisclosure({
  focus,
  onSelect,
  disabled = false,
}: {
  focus: Record<string, any>;
  onSelect(focusOfferId: string): void;
  disabled?: boolean;
}) {
  const catalog = focus.catalog || { offers: [] };
  const opportunities = focus.focus_opportunities || { cards: [] };
  const offers = Array.isArray(catalog.offers) ? catalog.offers : [];
  const cards = Array.isArray(opportunities.cards) ? opportunities.cards : [];
  const nearest = new Set(Array.isArray(opportunities.nearest_alternative_offer_ids) ? opportunities.nearest_alternative_offer_ids : []);
  const selected = focus.selected_offer_id;
  const recommended = opportunities.recommended_offer_id;
  const gate = focus.decision_status === "HUMAN_DECISION_REQUIRED"
    ? opportunities.prepared_human_decision_gate
    : null;
  const offerFor = (offerId: string) => offers.find((offer: Record<string, any>) => offer.offer_id === offerId) || {};

  return <section className="product-focus" aria-labelledby="product-focus-title">
    <header>
      <h3 id="product-focus-title">Каталог предложений и рекламный фокус</h3>
    </header>

    <div className="focus-card-grid">
      {cards.map((card: Record<string, any>) => {
        const offer = offerFor(card.offer_id);
        const isSelected = selected === card.offer_id;
        const isRecommended = recommended === card.offer_id;
        const isAlternative = nearest.has(card.offer_id) && !isRecommended;
        const launchBlocked = card.launch_readiness?.status === "BLOCKED";
        return <article className={`focus-card ${String(card.disposition || "").toLowerCase()} ${isSelected ? "selected" : ""}`} key={card.offer_id}>
          <header>
            <div>
              <span>{isRecommended ? "Рекомендация агента" : isAlternative ? "Ближайшая альтернатива" : statusLabel(card.disposition)}</span>
              <h4>{offer.label || card.label}</h4>
              <p>{offer.value_proposition || offer.material_axes?.offer || "Ценность предложения требует подтверждения."}</p>
            </div>
          </header>
          <dl className="focus-material-axes">
            <div><dt>Аудитория</dt><dd>{offer.material_axes?.audience || "Не подтверждена"}</dd></div>
            <div><dt>Квалифицированный результат</dt><dd>{offer.material_axes?.qualified_outcome || "Не подтверждён"}</dd></div>
            <div><dt>Экономика</dt><dd>{offer.material_axes?.economics || "Не подтверждена"}</dd></div>
            <div><dt>Посадочная страница</dt><dd>{offer.material_axes?.destination ? "Точная страница найдена" : "Не подтверждена"}</dd></div>
            <div><dt>Текущее продвижение</dt><dd>{offer.current_promotion === "OBSERVED" ? "Наблюдается" : offer.current_promotion === "NOT_OBSERVED" ? "Не обнаружено в подтверждённом охвате" : "Неизвестно"}</dd></div>
          </dl>
          <div className="focus-dimensions">
            <FocusDimension title="Рыночная возможность" kind="market" dimension={card.market_opportunity || {}} />
            <FocusDimension title="Готовность к запуску" kind="readiness" dimension={card.launch_readiness || {}} />
            <FocusDimension title="Покрытие доказательств" kind="coverage" dimension={card.evidence_coverage || {}} />
          </div>
          <button type="button" disabled={disabled || launchBlocked || (isSelected && focus.decision_status === "OWNER_SELECTED")} onClick={() => onSelect(card.offer_id)}>
            {launchBlocked ? "Сначала устраните блокировку" : isSelected && focus.decision_status === "OWNER_SELECTED" ? "Выбран владельцем" : isSelected ? "Подтвердить этот фокус" : "Выбрать этот фокус"}
          </button>
        </article>;
      })}
    </div>

    {gate && <section className="focus-decision-gate" aria-labelledby="focus-decision-gate-title">
      <header><div><p className="eyebrow">Подготовленное решение владельца</p><h4 id="focus-decision-gate-title">{String(gate.question)}</h4></div><strong>УВЕРЕННОСТЬ · {gate.confidence === "LOW" ? "НИЗКАЯ" : "СРЕДНЯЯ"}</strong></header>
      <p><b>Рекомендация:</b> {String(gate.recommendation)}</p>
      <div><section><strong>Основания</strong><ul>{(gate.evidence || []).map((item: string) => <li key={item}>{item}</li>)}</ul></section><section><strong>Последствия</strong><ul>{(gate.consequences || []).map((item: string) => <li key={item}>{item}</li>)}</ul></section></div>
    </section>}
  </section>;
}
