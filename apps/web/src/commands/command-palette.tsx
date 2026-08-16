/**
 * Палитра команд. Часть оболочки, а не заменяемое место: оболочка принадлежит ядру и не заменяется
 * (docs/ui-extension-model.md), а палитра — такая же её собственность, как полоса вкладок и границы
 * панелей. Плагину, которому захочется своя, нужны примитивы кита (`CommandList`), а не наша
 * компоновка.
 *
 * Команды ядра и команды плагинов живут в одном списке и ищутся одним полем: для человека это
 * одинаковые действия. Разделены они на группы — «оглавление» отвечает, куда ведёт команда, прежде
 * чем читать сами подписи, — и команды плагина стоят своей группой: их источник виден по имени
 * плагина, а не по неймспейсу идентификатора, которого в палитре не видно.
 */

import { useCommands, type PlaceContext } from "@sovereign/browser-sdk";
import { contributionTitle, useHostCommandCatalog } from "@sovereign/browser-sdk/host";
import {
  CommandList,
  Dialog,
  PluginIcon,
  type CommandListGroup,
  type Translator,
} from "@sovereign/ui-kit";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { coreCommands, type CoreCommandGroup, type CoreCommandHost } from "./core-commands.ts";
import { matchesQuery } from "./match.ts";

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  /** То, чем командам ядра дозволено двигать: навигация и раскладка оболочки. */
  host: CoreCommandHost;
  /** Контекст вызова команд плагинов: тот же, что у полосы действий шапки. */
  context: PlaceContext;
  translator: Translator;
};

/** Порядок групп ядра: сначала работа, потом настройки, потом хром окна. */
const coreGroupOrder: readonly CoreCommandGroup[] = ["session", "settings", "panels"];

/**
 * Аккорд принадлежит ядру и он один. Назначения аккордов командам плагинов в этом срезе нет: это
 * второй реестр споров рядом с существующим и конфликты с браузером и ОС ([backlog.md]).
 *
 * `preventDefault` обязателен: у Cmd/Ctrl+K есть штатное действие в браузере.
 */
export function useCommandPaletteShortcut(onOpen: () => void): void {
  useEffect(() => {
    const listen = (event: KeyboardEvent): void => {
      const platformModifier = event.metaKey !== event.ctrlKey;

      if (event.key.toLowerCase() !== "k" || !platformModifier || event.shiftKey || event.altKey) {
        return;
      }

      event.preventDefault();
      onOpen();
    };

    window.addEventListener("keydown", listen);

    return () => window.removeEventListener("keydown", listen);
  }, [onOpen]);
}

export function CommandPalette({
  open,
  onClose,
  host,
  context,
  translator,
}: CommandPaletteProps): ReactNode {
  const { invoke } = useCommands();
  const catalog = useHostCommandCatalog(context);
  const [query, setQuery] = useState("");

  // Набранное живёт только пока палитра открыта: следующий вызов начинается с чистого поля.
  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  /** Что делает выбранная строка. Держится рядом с группами, чтобы искать команду не по подписи. */
  const runners = useMemo<Map<string, () => void>>(() => {
    const map = new Map<string, () => void>();

    for (const command of coreCommands) {
      map.set(command.id, () => command.run(host));
    }

    for (const { registration } of catalog) {
      map.set(registration.id, () => {
        void invoke(registration.id, context);
      });
    }

    return map;
  }, [catalog, context, host, invoke]);

  const groups = useMemo<readonly CommandListGroup[]>(() => {
    const core = coreGroupOrder.map((group) => ({
      id: `core.${group}`,
      label: translator.t(`commands.group.${group}`),
      items: coreCommands
        .filter((command) => command.group === group)
        .map((command) => ({
          id: command.id,
          label: translator.t(command.titleKey),
          icon: <command.icon size="sm" />,
          disabled: command.available?.(host) === false,
        }))
        .filter((item) => matchesQuery(query, item.label)),
    }));

    // Плагин — своя группа, названная его именем: источник команды виден без чтения идентификатора.
    // Standalone-вклад имени плагина не имеет, и группа у него общая.
    const byPlugin = new Map<string, { label: string; items: CommandListGroup["items"] }>();

    for (const { registration, disabled } of catalog) {
      const label =
        registration.ownership === "plugin"
          ? registration.pluginId
          : translator.t("commands.group.plugins");
      const item = {
        id: registration.id,
        label: contributionTitle(registration, translator),
        icon: <PluginIcon size="sm" />,
        disabled,
      };

      if (!matchesQuery(query, item.label)) {
        continue;
      }

      const bucket = byPlugin.get(label) ?? { label, items: [] };

      byPlugin.set(label, { label, items: [...bucket.items, item] });
    }

    return [
      ...core,
      ...[...byPlugin.entries()].map(([label, bucket]) => ({
        id: `plugin.${label}`,
        label,
        items: bucket.items,
      })),
    ].filter((group) => group.items.length > 0);
  }, [catalog, host, query, translator]);

  const choose = (id: string): void => {
    const run = runners.get(id);

    if (run === undefined) {
      return;
    }

    // Сначала закрыть: команда вправе увести на другую страницу, и палитра поверх неё осталась бы
    // висеть чужим слоем.
    onClose();
    run();
  };

  return (
    <Dialog open={open} onClose={onClose} title={translator.t("commands.title")}>
      <CommandList
        query={query}
        onQueryChange={setQuery}
        groups={groups}
        onChoose={choose}
        searchLabel={translator.t("commands.filter")}
        emptyText={translator.t("commands.empty")}
      />
    </Dialog>
  );
}
