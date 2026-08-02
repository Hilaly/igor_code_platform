import { log, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  await log.info("crashes-on-deactivate is up");
};

/**
 * Воркер умирает сам по себе, не отвечая на `deactivate`. До правки stop() честно ждал
 * deactivateTimeout; теперь `exit` внутри stop() резолвит промис сразу. Это путь «упал, не дойдя
 * до ответа» — единственный, на котором старый код задерживал выгрузку.
 */
export const deactivate: PluginModule["deactivate"] = async () => {
  await log.info("crashes-on-deactivate is going down");
  process.exit(0);
};
