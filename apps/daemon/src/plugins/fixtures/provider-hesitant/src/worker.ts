import { log, providers, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  // Вход начинается и не кончается: на вопрос плагин не отвечает никогда. Так проверяется, что
  // выгрузка такого плагина освобождает провайдера, а не оставляет его занятым навсегда.
  void (async () => {
    try {
      const conclusion = await providers.login({
        providerId: "scripted",
        method: "api_key",
        dialogue: { ask: () => new Promise<string>(() => {}) },
      });

      await log.info("provider-hesitant login ended", { conclusion: conclusion.kind });
    } catch (cause) {
      await log.warn("provider-hesitant login broke", { reason: String(cause) });
    }
  })();

  await log.info("provider-hesitant started a login it will not finish");
};
