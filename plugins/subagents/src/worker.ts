/**
 * Плагин субагентов: агент поручает кусок работы подчинённой сессии и получает её ответ
 * (docs/subagents.md).
 *
 * Субагент — обычная **скрытая** сессия платформы, а не свой рантайм: у неё те же инструменты, тот
 * же выбор агента и модели и то же дерево, которое человек может открыть и прочитать.
 */

import { contribute, events, log, type PluginModule } from "@sovereign/sdk";

import { contributeTools } from "./tools.ts";
import { contributeRoutes } from "./routes.ts";
import { englishMessages, messagesNamespace, russianMessages } from "./messages.ts";
import { listRecords } from "./registry.ts";
import { reconcile } from "./lifecycle.ts";

/**
 * Событие ядра «перечитай список сессий» (docs/event-bus.md). Полного имени в SDK нет — имена
 * событий ядра там не объявлены, — поэтому строка написана здесь, рядом с единственным местом,
 * которое её читает.
 */
const sessionsChanged = "core.sessions.changed";

/**
 * Обходы не наслаиваются: событие приходит на каждое изменение любой сессии, и параллельные обходы
 * доложили бы родителю об одном итоге дважды.
 */
let sweeping = Promise.resolve();

const sweep = (): Promise<void> => {
  sweeping = sweeping
    .then(async () => {
      await reconcile(await listRecords(), new Date().toISOString());
    })
    .catch(async (cause: unknown) => {
      // Сорвавшийся обход не снимает подписку: следующее событие попробует снова.
      await log.warn("a sweep over the subagents failed", {
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    });

  return sweeping;
};

export const activate: PluginModule["activate"] = async () => {
  await contributeTools();
  await contributeRoutes();

  await contribute.localeCatalog({
    id: "messages-en",
    namespace: messagesNamespace,
    locale: "en",
    messages: englishMessages,
  });
  await contribute.localeCatalog({
    id: "messages-ru",
    namespace: messagesNamespace,
    locale: "ru",
    messages: russianMessages,
  });

  await contribute.component({
    id: "panel",
    title: "Subagents",
    placeId: "core.panel.tabs",
    export: "SubagentsPanel",
  });

  await events.subscribe(sessionsChanged, () => void sweep());

  // Память воркера теряется при перезагрузке плагина, а субагент к этому моменту мог закончить.
  // Без этого обхода запись навсегда осталась бы идущей, а родитель — не позванным.
  await sweep();

  await log.info("the subagents plugin is active");
};
