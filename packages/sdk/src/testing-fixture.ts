/** Плагин размером с тест: он проверяет, что шов работает для настоящего кода плагина. */

import { contribute, log, type PluginModule } from "./index.ts";

export const activate: PluginModule["activate"] = async () => {
  await log.info("hello is up");
  await contribute.custom({ id: "board", title: "Board" });
};
