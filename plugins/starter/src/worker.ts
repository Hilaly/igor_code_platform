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

import { contribute, log, type PluginModule } from "@sovereign/sdk";

import { killAllJobs, killJobsOfSession } from "./bash.ts";
import { contributeBashTools } from "./tools.ts";

export const activate: PluginModule["activate"] = async () => {
  await contributeBashTools();

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
