/**
 * Подсказка файлов проекта под набираемым `@файл`.
 *
 * Своего поля ввода у неё нет: запрос человек печатает в самом композере, и второе поле поверх него
 * означало бы два места, куда идёт ввод. Поэтому и клавиатурой она не владеет — стрелки и `Enter`
 * приходят из `textarea`, а список только показывает выбор.
 */

import { RaisedSurface, type ScopedTranslator } from "@sovereign/ui-kit";

export type FileMentionListProps = {
  paths: string[];
  /** Список обрезан пределом: человек, не увидевший файла, должен знать, что искать точнее. */
  truncated: boolean;
  activeIndex: number;
  onChoose: (path: string) => void;
  translator: ScopedTranslator;
};

export function FileMentionList({
  paths,
  truncated,
  activeIndex,
  onChoose,
  translator,
}: FileMentionListProps): React.JSX.Element {
  const { t } = translator;

  return (
    <div className="sessions-mention">
      <RaisedSurface>
        <ul className="sessions-mention-list" role="listbox" aria-label={t("chat.mention.label")}>
          {paths.map((path, index) => (
            <li key={path}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                data-active={index === activeIndex ? "true" : undefined}
                // Фокус остаётся в поле ввода: увести его отсюда значило бы прервать набор.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onChoose(path)}
              >
                {path}
              </button>
            </li>
          ))}
        </ul>
        {truncated ? (
          <p className="sessions-mention-more">{t("chat.mention.truncated")}</p>
        ) : undefined}
      </RaisedSurface>
    </div>
  );
}
