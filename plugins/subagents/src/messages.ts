/**
 * Строки панели. Один модуль на обе половины плагина: воркер объявляет их вкладом
 * `contribute.localeCatalog`, браузерная часть строит из них переводчик кита.
 *
 * Держать их в двух местах нельзя — расхождение поймал бы только человек, читающий панель.
 */

export const messagesNamespace = "subagents";

export const englishMessages: Record<string, string> = {
  "panel.scope.session": "This session",
  "panel.scope.all": "All",
  "panel.scope.label": "Which subagents to show",
  "panel.empty": "No subagent has been started yet.",
  "panel.empty.session": "This session has started no subagent.",
  "panel.failure": "Could not read the subagents: {reason}",
  "panel.feed": "Work of the subagent",
  "panel.back": "Back to the list",
  "panel.detail.spend": "{tokens} tokens, {cost}",
  "panel.detail.problem": "Could not read the session of this subagent: {reason}",
  "panel.detail.empty": "This subagent has said nothing yet.",
  "state.starting": "Starting",
  "state.running": "Working",
  "state.finished": "Finished",
  "state.failed": "Failed",
  "state.stopped": "Stopped",
  "tool.output": "Output",
  "tool.status.done": "Done",
  "duration.elapsed": "Working for",
  "duration.days": "d",
  "duration.hours": "h",
  "duration.minutes": "m",
  "duration.seconds": "s",
};

export const russianMessages: Record<string, string> = {
  "panel.scope.session": "Эта сессия",
  "panel.scope.all": "Все",
  "panel.scope.label": "Каких субагентов показывать",
  "panel.empty": "Субагентов ещё не запускали.",
  "panel.empty.session": "Эта сессия не запускала субагентов.",
  "panel.failure": "Не удалось прочитать субагентов: {reason}",
  "panel.feed": "Работа субагента",
  "panel.back": "Назад к списку",
  "panel.detail.spend": "{tokens} токенов, {cost}",
  "panel.detail.problem": "Не удалось прочитать сессию этого субагента: {reason}",
  "panel.detail.empty": "Этот субагент пока ничего не сказал.",
  "state.starting": "Запускается",
  "state.running": "Работает",
  "state.finished": "Закончил",
  "state.failed": "Сорвался",
  "state.stopped": "Остановлен",
  "tool.output": "Вывод",
  "tool.status.done": "Готово",
  "duration.elapsed": "Работает",
  "duration.days": "д",
  "duration.hours": "ч",
  "duration.minutes": "м",
  "duration.seconds": "с",
};
