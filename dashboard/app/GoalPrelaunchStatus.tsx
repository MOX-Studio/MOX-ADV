import type { FormationBundle } from "../lib/campaign-formation-portfolio.ts";
import { assessGoalPrelaunch } from "../lib/goal-prelaunch-assessment.ts";
import styles from "./campaign-formation.module.css";

export default function GoalPrelaunchStatus({ bundle, active }: { bundle: FormationBundle; active: boolean }) {
  const result = assessGoalPrelaunch(bundle, active);
  if (!result) return null;
  return <dl className={styles.prelaunchStatus} aria-label="Итог подготовки">
    <div data-preparation-status={result.preparation}><dt>Подготовка</dt><dd>{result.preparation === "PERMITTED_PREPARATION_COMPLETE" ? "Завершена" : "Продолжается"}</dd></div>
    <div data-goal-support={result.goal_support}><dt>Поддержка цели</dt><dd>{result.goal_support === "CONDITIONAL_SUPPORT" ? "Поддержана сценарием" : result.goal_support === "CONSTRAINT_SHORTFALL" ? "Выявлен дефицит" : "Пока не оценена"}</dd></div>
    <div data-technical-status={result.technical}><dt>Проверки черновика</dt><dd>{result.technical === "CHECKED" ? "Пройдены" : "Нужны исправления"}</dd></div>
  </dl>;
}
