/**
 * Базовый агент — первый встроенный плагин платформы (docs/plugins.md).
 *
 * Он существует не для примера: агент из коробки — это вклад плагина, а не встроенная в ядро
 * сущность (docs/architecture.md). Значит выключить его можно тем же переключателем, что и любой
 * другой, а заменить — одноимённым плагином из директории данных.
 */

import { contribute, log, type PluginModule } from "@sovereign/sdk";

import { instructions } from "./instructions.ts";

export const activate: PluginModule["activate"] = async () => {
  await contribute.agent({
    id: "agent",
    title: "Base agent",
    description: "Reads and changes files in the project folder, and runs shell commands",
    instructions,
    // Всё, что собрало ядро. Отбирать нечего: это агент по умолчанию, и урезанный набор здесь был бы
    // решением за пользователя, которое он не просил.
    tools: { include: ["*"] },
  });

  await log.info("the base agent is contributed");
};
