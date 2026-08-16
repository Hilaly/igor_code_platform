/**
 * Starter — первый встроенный плагин платформы (docs/plugins.md).
 *
 * Он существует не для примера: агент из коробки — это вклад плагина, а не встроенная в ядро
 * сущность (docs/architecture.md). Значит выключить его можно тем же переключателем, что и любой
 * другой, а заменить — одноимённым плагином из директории данных.
 *
 * Сюда же переехал bash из рантайма (docs/bash-tool.md): инструмент исполнения команд теперь —
 * вклад плагина, и его тоже можно выключить или заменить, не трогая ядро.
 */

import { contribute, log, toolCallPlaceId, type PluginModule } from "@sovereign/sdk";

import { killAllJobs, killJobsOfSession } from "./bash.ts";
import { englishMessages, messagesNamespace, russianMessages } from "./messages.ts";
import { contributeBashTools } from "./tools.ts";

export const activate: PluginModule["activate"] = async () => {
  await contributeBashTools();

  // Строки карточки — каталоги, а не зашитый текст (спека 2026-08-16-bash-tool-call-visual-design.md).
  await contribute.localeCatalog({
    id: "bash-messages-en",
    namespace: messagesNamespace,
    locale: "en",
    messages: englishMessages,
  });
  await contribute.localeCatalog({
    id: "bash-messages-ru",
    namespace: messagesNamespace,
    locale: "ru",
    messages: russianMessages,
  });

  // Один export на всё семейство: место разрешается по точному имени тула (спека 2026-08-09).
  for (const [id, toolName] of [
    ["starter-bash-tool-call", "bash"],
    ["starter-job-output-tool-call", "job-output"],
    ["starter-job-kill-tool-call", "job-kill"],
  ] as const) {
    await contribute.component({ id, placeId: toolCallPlaceId(toolName), export: "BashToolCall" });
  }

  // Фоновые задания живут с сессией (docs/bash-tool.md): закрытая сессия уносит свои задания.
  await contribute.hook({
    id: "bash-jobs-session-close",
    event: "session_closed",
    handler: async (payload) => {
      killJobsOfSession(payload.sessionId);
    },
  });

  await log.info("the starter plugin is active");
};

export const deactivate: PluginModule["deactivate"] = async () => {
  // Воркер сейчас будет снят: деревья, оставшиеся без SIGKILL, осиротели бы (docs/bash-tool.md).
  killAllJobs();
};
