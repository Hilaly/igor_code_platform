import { contribute, log, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  // Идентификатор с пробелом и заглавными буквами реестр не примет (docs/plugins.md). Плагин при этом
  // обязан подняться: кривой вклад — не отказ плагина, а причина, которую видно в интерфейсе.
  await contribute.custom({ id: "Board Panel", title: "Board panel" });
  await contribute.custom({ id: "board", title: "Board" });
  await log.info("problem is up");
};
