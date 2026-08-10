/**
 * Starter — первый встроенный плагин платформы (docs/plugins.md).
 *
 * Он существует не для примера: агент из коробки — это вклад плагина, а не встроенная в ядро
 * сущность (docs/architecture.md). Значит выключить его можно тем же переключателем, что и любой
 * другой, а заменить — одноимённым плагином из директории данных.
 */

import { log, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  await log.info("the starter plugin is active");
};
