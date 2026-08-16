/**
 * Строки панели. Один модуль на обе половины плагина: воркер объявляет их вкладом
 * `contribute.localeCatalog`, браузерная часть строит из них переводчик кита.
 *
 * Держать их в двух местах нельзя — расхождение поймал бы только человек, читающий панель.
 */

export const messagesNamespace = "mission";

export const englishMessages: Record<string, string> = {
  "panel.title": "Mission",
  "panel.loading": "Loading mission",
  "panel.empty": "No mission yet",
  "panel.empty.session": "No active session",
  "panel.failure": "Could not read mission: {reason}",
  "panel.updated": "Updated {time}",
  "plan.label": "Steps",
  "plan.count": "{completed} of {total}",
  "plan.progress": "Mission progress",
  "state.completed": "Done",
  "state.in_progress": "In progress",
  "state.pending": "Not started",
};

export const russianMessages: Record<string, string> = {
  "panel.title": "Миссия",
  "panel.loading": "Загружаю миссию",
  "panel.empty": "Миссии пока нет",
  "panel.empty.session": "Нет открытой сессии",
  "panel.failure": "Не удалось прочитать миссию: {reason}",
  "panel.updated": "Обновлено {time}",
  "plan.label": "Шаги",
  "plan.count": "{completed} из {total}",
  "plan.progress": "Ход миссии",
  "state.completed": "Сделан",
  "state.in_progress": "В работе",
  "state.pending": "Не начат",
};
