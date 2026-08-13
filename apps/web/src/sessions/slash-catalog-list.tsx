/**
 * Каталог команд под набираемым `/`.
 *
 * Своего поля ввода у него нет — по той же причине, что и у подсказки файлов: запрос человек
 * печатает в самом композере, и клавиатурой владеет `textarea`, а список только показывает выбор.
 */

import { RaisedSurface, type ScopedTranslator } from "@sovereign/ui-kit";

import type { SlashEntry } from "./slash-command.ts";

export type SlashCatalogListProps = {
  entries: SlashEntry[];
  activeIndex: number;
  onChoose: (name: string) => void;
  translator: ScopedTranslator;
};

export function SlashCatalogList({
  entries,
  activeIndex,
  onChoose,
  translator,
}: SlashCatalogListProps): React.JSX.Element {
  const { t } = translator;

  return (
    <div className="sessions-mention">
      <RaisedSurface>
        <ul className="sessions-mention-list" role="listbox" aria-label={t("chat.slash.label")}>
          {entries.map((entry, index) => (
            <li key={entry.name}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                data-active={index === activeIndex ? "true" : undefined}
                // Фокус остаётся в поле ввода: увести его отсюда значило бы прервать набор.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChoose(entry.name)}
              >
                <span className="sessions-slash-name">/{entry.name}</span>
                {entry.description === "" ? undefined : (
                  <span className="sessions-slash-description">{entry.description}</span>
                )}
                {/* Скрытый от модели скил помечен: человек должен видеть, что сам он его запускает,
                    а агент до него не дотянется. */}
                {entry.hidden === true ? (
                  <span className="sessions-slash-hidden">{t("chat.slash.hidden")}</span>
                ) : undefined}
              </button>
            </li>
          ))}
        </ul>
      </RaisedSurface>
    </div>
  );
}
