/**
 * Строки плагина. Объявляет их воркер вкладом `contribute.localeCatalog`, а браузерная половина
 * ничего отсюда не импортирует: каталог доезжает до неё снимком, и переводчик собирает хост
 * (docs/ui-kit.md). Заголовок вкладки платформа ищет здесь же — по ключу `component.<id>.title`.
 */

export const messagesNamespace = "mission";

export const englishMessages: Record<string, string> = {
  "component.panel.title": "Mission",
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
  "component.panel.title": "Миссия",
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
