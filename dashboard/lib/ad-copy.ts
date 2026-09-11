const normalize = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

export function wordSafeLimit(value: unknown, maximum: number) {
  const text = normalize(value);
  if (text.length <= maximum) return text;
  const room = Math.max(1, maximum - 1);
  const candidate = text.slice(0, room + 1);
  const lastSpace = candidate.lastIndexOf(" ");
  const cutAt = lastSpace >= Math.floor(maximum * 0.45) ? lastSpace : room;
  return `${text.slice(0, cutAt).replace(/[,:;.!?—-]+$/u, "").trim()}…`;
}

function leadingClause(value: unknown) {
  const source = normalize(value);
  const [clause] = source.split(/\s+[—–]\s+|[;:]/u);
  return clause && clause !== source ? clause.replace(/[,:;.!?—–-]+$/u, "").trim() : "";
}

export function buildAdTitle(product: unknown) {
  const clause = leadingClause(product);
  return clause && clause.length <= 56 ? clause : wordSafeLimit(product, 56);
}

export function buildAdText(message: unknown, product: unknown, participation: boolean) {
  const maximum = 81;
  const text = normalize(message);
  if (text && text.length <= maximum) {
    if (/[.!?…]$/u.test(text)) return text;
    if (text.length < maximum) return `${text}.`;
  }

  for (let index = 20; index < Math.min(text.length, maximum); index += 1) {
    if (/[.!?]/u.test(text[index]) && (index + 1 === text.length || /\s/u.test(text[index + 1]))) {
      return text.slice(0, index + 1);
    }
  }

  const callToAction = participation ? "Подайте заявку на участие." : "Оставьте заявку на сайте.";
  const clause = leadingClause(text);
  if (clause.length >= 20) {
    const sentence = `${clause}.`;
    const withCallToAction = `${sentence} ${callToAction}`;
    if (withCallToAction.length <= maximum) return withCallToAction;
    if (sentence.length <= maximum) return sentence;
  }
  const subject = wordSafeLimit(normalize(product) || "Узнайте подробности", maximum - callToAction.length - 1);
  const separator = /[.!?…]$/u.test(subject) ? " " : ". ";
  return `${subject}${separator}${callToAction}`;
}
