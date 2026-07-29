import { log, providers, type LoginNotice, type PluginModule } from "@sovereign/sdk";

const heard: string[] = [];

export const activate: PluginModule["activate"] = async () => {
  const conclusion = await providers.login({
    providerId: "scripted",
    method: "api_key",
    dialogue: {
      tell: (notice: LoginNotice) => {
        heard.push(notice.kind);
      },
      // Ответ на вопрос — то, ради чего диалог существует: вопрос без отвечающего висит вечно.
      ask: (prompt) => `ответ на ${prompt.kind}`,
    },
  });

  const before = await providers.status("scripted");
  await providers.logout("scripted");
  const after = await providers.status("scripted");

  await log.info("provider-guest finished a login", {
    conclusion: conclusion.kind,
    heard,
    before: before?.kind,
    after: after?.kind,
  });
};
