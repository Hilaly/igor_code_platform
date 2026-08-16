import type { MissionSnapshot } from "./model.ts";

/**
 * Снимок в виде текста для модели. Нужен потому, что записать миссию и никогда её не увидеть —
 * значит писать вслепую: инструмент заменяет план целиком, и это работает ровно до тех пор, пока
 * автор плана его перечитывает. Результат вызова и `mission-read` — единственные два места, где
 * модель видит своё же состояние таким, каким оно сохранено.
 *
 * Слова статусов те же, что в схеме: собственный словарь («done», «todo») заставлял бы модель
 * переводить прочитанное обратно в значения аргументов.
 */
export function renderSnapshot(snapshot: MissionSnapshot): string {
  const completed = snapshot.plan.filter((step) => step.status === "completed").length;
  const lines = [
    `Mission revision ${snapshot.revision}, updated ${snapshot.updatedAt}`,
    `Goal: ${snapshot.mission}`,
  ];

  if (snapshot.explanation !== undefined) {
    lines.push(`Note: ${snapshot.explanation}`);
  }

  if (snapshot.outcome !== undefined) {
    lines.push(`Outcome: ${snapshot.outcome.kind} — ${snapshot.outcome.summary}`);
  }

  lines.push(`Plan: ${completed} of ${snapshot.plan.length} completed`);

  snapshot.plan.forEach((step, index) => {
    const reason = step.reason === undefined ? "" : ` (reason: ${step.reason})`;

    lines.push(`  ${index + 1}. [${step.status}] ${step.step}${reason}`);
  });

  return lines.join("\n");
}
