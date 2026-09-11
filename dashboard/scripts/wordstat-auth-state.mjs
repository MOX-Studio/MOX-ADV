/** Topic words such as robotics are not evidence of an authentication challenge. */
export function wordstatChallengeText(value) {
  const text = String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
  return /(?:подтвердите|докажите|проверим|проверить),?\s+что\s+вы\s+не\s+робот|^(?:я|вы)\s+не\s+робот[.!?]?$|проверка\s+безопасности|(?:confirm|verify|prove)\s+(?:that\s+)?you(?:'re|\s+are)\s+(?:not\s+a\s+robot|human)|^i(?:'m|\s+am)\s+not\s+a\s+robot[.!?]?$/iu.test(text);
}

export async function hasWordstatChallenge(page) {
  const url = new URL(page.url());
  if (/\/(?:showcaptcha|checkcaptcha)(?:\/|$)/iu.test(url.pathname) || /(?:^|\.)captcha\.yandex\./iu.test(url.hostname)) return true;
  const visibleChallenge = page.locator('form[action*="checkcaptcha"], form[action*="showcaptcha"], iframe[src*="smartcaptcha"]');
  for (let i = 0; i < await visibleChallenge.count(); i++) if (await visibleChallenge.nth(i).isVisible()) return true;
  const candidates = page.getByText(/не\s+робот|проверка\s+безопасности|not\s+a\s+robot|verify.*human|confirm.*human/iu);
  for (let i = 0; i < await candidates.count(); i++) {
    const candidate = candidates.nth(i);
    if (await candidate.isVisible() && wordstatChallengeText(await candidate.innerText())) return true;
  }
  return false;
}
