/**
 * Палитра команд. Часть оболочки, а не заменяемое место: оболочка принадлежит ядру и не заменяется
 * (docs/ui-extension-model.md), а палитра — такая же её собственность, как полоса вкладок и границы
 * панелей. Плагину, которому захочется своя, нужны примитивы кита, а не наша компоновка.
 *
 * Команды ядра и команды плагинов показаны **одним списком**: для человека это одинаковые действия, а
 * разница источников видна во вью плагинов.
 */

import { useCommands, type PlaceContext } from "@sovereign/browser-sdk";
import { useHostCommandCatalog } from "@sovereign/browser-sdk/host";
import { Dialog, Input, List, ListRow, type Translator } from "@sovereign/ui-kit";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { coreCommands, type CoreCommandHost } from "./core-commands.ts";

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  /** То, чем командам ядра дозволено двигать: навигация и раскладка оболочки. */
  host: CoreCommandHost;
  /** Контекст вызова команд плагинов: тот же, что у полосы действий шапки. */
  context: PlaceContext;
  translator: Translator;
};

type PaletteEntry = {
  id: string;
  title: string;
  disabled: boolean;
  run: () => void;
};

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

      if (
        event.key.toLowerCase() !== "k" ||
        !platformModifier ||
        event.shiftKey ||
        event.altKey
      ) {
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
  const [filter, setFilter] = useState("");

  // Набранное живёт только пока палитра открыта: следующий вызов начинается с чистого поля.
  useEffect(() => {
    if (!open) {
      setFilter("");
    }
  }, [open]);

  const entries = useMemo<PaletteEntry[]>(
    () => [
      ...coreCommands.map((command) => ({
        id: command.id,
        title: translator.t(command.titleKey),
        disabled: command.available?.(host) === false,
        run: () => command.run(host),
      })),
      ...catalog.map(({ registration, disabled }) => ({
        id: registration.id,
        title: registration.title,
        disabled,
        run: () => {
          void invoke(registration.id, context);
        },
      })),
    ],
    [catalog, context, host, invoke, translator],
  );

  const needle = filter.trim().toLocaleLowerCase();
  const shown = entries.filter((entry) => entry.title.toLocaleLowerCase().includes(needle));

  const choose = (entry: PaletteEntry): void => {
    if (entry.disabled) {
      return;
    }

    // Сначала закрыть: команда вправе увести на другую страницу, и палитра поверх неё осталась бы
    // висеть чужим слоем.
    onClose();
    entry.run();
  };

  return (
    <Dialog open={open} onClose={onClose} title={translator.t("commands.title")}>
      <Input
        value={filter}
        onChange={setFilter}
        type="search"
        aria-label={translator.t("commands.filter")}
        placeholder={translator.t("commands.filter")}
        onKeyDown={(event) => {
          if (event.key !== "Enter") {
            return;
          }

          event.preventDefault();

          const first = shown.find((entry) => !entry.disabled);

          if (first !== undefined) {
            choose(first);
          }
        }}
      />
      {shown.length === 0 ? (
        <p>{translator.t("commands.empty")}</p>
      ) : (
        <List>
          {/*
            Недоступная команда остаётся видимой строкой, но выбрать её нечем: строка без `onSelect`
            — обычный элемент списка, а не кнопка. Прятать её нельзя, иначе список менял бы состав
            под руками, и «показать панель» пропадала бы ровно тогда, когда её ищут.
          */}
          {shown.map((entry) => (
            <ListRow key={entry.id} {...(entry.disabled ? {} : { onSelect: () => choose(entry) })}>
              {entry.title}
            </ListRow>
          ))}
        </List>
      )}
    </Dialog>
  );
}
