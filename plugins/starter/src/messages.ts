/**
 * Строки карточки bash-семейства (спека 2026-08-16-bash-tool-call-visual-design.md). Объявляет их
 * воркер вкладом `contribute.localeCatalog`, а браузерная половина ничего отсюда не импортирует:
 * каталог доезжает до неё снимком вкладов (docs/ui-kit.md, «Язык окна»).
 *
 * Неймспейс — id плагина: contribution-registry.ts принимает только `core` или `plugin.id`.
 */

export const messagesNamespace = "starter";

export const englishMessages: Record<string, string> = {
  "tool.status.running": "Running",
  "tool.status.done": "Done",
  "tool.status.failed": "Failed",
  "tool.status.killed": "Killed",
  "tool.stderr": "stderr",
  "tool.noOutput": "(no output)",
  "tool.noNewOutput": "(no new output)",
  "tool.background": "background",
  "tool.timedOut": "Timed out",
  "tool.killedBy": "Killed by {signal}",
  "tool.clamped": "Timeout clamped to {seconds}s",
  "tool.truncated": "Output truncated",
  "tool.stderrTruncated": "Stderr truncated",
  "tool.failure": "Could not read the tool call: {reason}",
};

export const russianMessages: Record<string, string> = {
  "tool.status.running": "Выполняется",
  "tool.status.done": "Готово",
  "tool.status.failed": "Не удалось",
  "tool.status.killed": "Остановлено",
  "tool.stderr": "stderr",
  "tool.noOutput": "(нет вывода)",
  "tool.noNewOutput": "(нет нового вывода)",
  "tool.background": "фон",
  "tool.timedOut": "Таймаут",
  "tool.killedBy": "Остановлен сигналом {signal}",
  "tool.clamped": "Таймаут ограничен {seconds} с",
  "tool.truncated": "Вывод усечён",
  "tool.stderrTruncated": "stderr усечён",
  "tool.failure": "Не удалось прочитать вызов: {reason}",
};
