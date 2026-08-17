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
import { sweep } from "./lifecycle.ts";

/**
 * Событие ядра «перечитай список сессий» (docs/event-bus.md). Полного имени в SDK нет — имена
 * событий ядра там не объявлены, — поэтому строка написана здесь, рядом с единственным местом,
 * которое её читает.
 */
const sessionsChanged = "core.sessions.changed";

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

  // Событие приходит на каждое изменение любой сессии, а обход всегда читает все записи: стоящему
  // в очереди второй такой же ничего не добавит, поэтому обходы по шине схлопываются.
  await events.subscribe(sessionsChanged, () => void sweep({ coalesce: true }));

  // Память воркера теряется при перезагрузке плагина, а субагент к этому моменту мог закончить.
  // Без этого обхода запись навсегда осталась бы идущей, а родитель — не позванным. Только этот
  // обход разбирает и записи `starting`: вызова, который их поставил, больше не существует.
  await sweep({ afterReload: true });

  await log.info("the subagents plugin is active");
};
