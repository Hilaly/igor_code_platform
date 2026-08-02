/**
 * Проводник по файловой системе в модальном слое. Выбранный абсолютный путь возвращается наверх, а
 * листинг каталога приезжает пропом: пикер ничего не знает ни про `readdir`, ни про права — он
 * только рисует то, что ему дали, и сообщает клики. Так плагин собирает такой же пикер для своих
 * нужд, а тест кита не требует живой файловой системы (docs/ui-kit.md).
 *
 * Три жеста, и они не сводятся к одному: одинарный клик по записи делает её кандидатом
 * (`onValueChange`), двойной клик по папке переходит в неё (`onNavigate`), а кнопка «Выбрать»
 * подтверждает кандидата (`onSelect`) и закрывает пикер. Свести их в один клик — значит закрыть
 * пикер от случайного нажатия или не дать открыть папку, не выбранную как результат.
 */

import { Button } from "./button.tsx";
import { Dialog } from "./dialog.tsx";
import { List, ListRow } from "./list.tsx";
import { Text } from "./text.tsx";
import styles from "./file-picker.module.css";

export type FilePickerEntry = {
  name: string;
  kind: "file" | "directory";
};

export type FilePickerProps = {
  open: boolean;
  /** Абсолютный путь открытого в пикере каталога. Его листинг — в `entries`. */
  cwd: string;
  /** Кандидат на выбор: абсолютный путь или пустая строка, если ничего не подсвечено. */
  value: string;
  /** Дети текущего каталога в порядке, каком дал демон. */
  entries: FilePickerEntry[];
  /** Ошибка чтения каталога пришла снаружи — пикер показывает её вместо списка. */
  error?: string;
  /** Переход в каталог: двойной клик по папке или «…». Абсолютный путь передаёт вызывающий. */
  onNavigate: (directory: string) => void;
  /** Клик по записи сделал её кандидатом. Calling side кладёт путь в `value`. */
  onValueChange: (path: string) => void;
  /** Подтверждение кандидата: кладёт `value` и закрывает пикер. */
  onSelect: (path: string) => void;
  onClose: () => void;
  /** Строки — пропами: кит не знает про переводчик (docs/ui-kit.md). */
  title: string;
  upLabel: string;
  emptyLabel: string;
  confirmLabel: string;
  cancelLabel: string;
};

export function FilePicker({
  open,
  cwd,
  value,
  entries,
  error,
  onNavigate,
  onValueChange,
  onSelect,
  onClose,
  title,
  upLabel,
  emptyLabel,
  confirmLabel,
  cancelLabel,
}: FilePickerProps) {
  // К родителю от текущего пути: последний сегмент долой. У корня родителя нет — «наверх» молчит.
  const parent = parentOf(cwd);
  const canConfirm = value !== "";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>{cancelLabel}</Button>
          <Button
            tone="accent"
            disabled={!canConfirm}
            onClick={() => {
              if (canConfirm) {
                onSelect(value);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.path}>
        <Button
          size="sm"
          disabled={parent === undefined}
          onClick={parent === undefined ? undefined : () => onNavigate(parent)}
          aria-label={upLabel}
          title={upLabel}
        >
          …
        </Button>
        <Text tone="muted">{cwd}</Text>
      </div>

      {error !== undefined ? (
        <Text tone="danger">{error}</Text>
      ) : entries.length === 0 ? (
        <Text tone="muted">{emptyLabel}</Text>
      ) : (
        <List>
          {entries.map((entry) => {
            const path = joinPath(cwd, entry.name);
            const selected = path === value;

            return (
              <ListRow
                key={entry.name}
                selected={selected}
                onSelect={() => onValueChange(path)}
                onDoubleClick={entry.kind === "directory" ? () => onNavigate(path) : undefined}
              >
                <span className={styles.entry}>
                  <span aria-hidden>{entry.kind === "directory" ? "▸" : "•"}</span>
                  <Text>{entry.name}</Text>
                </span>
              </ListRow>
            );
          })}
        </List>
      )}
    </Dialog>
  );
}

/**
 * Родитель каталога: всё до последнего разделителя. `/` и пустая строка не имеют родителя — «наверх»
 * на корне молчит. Путь даёт демон, пикер только режет его по тому разделителю, что в нём уже есть.
 */
function parentOf(cwd: string): string | undefined {
  if (cwd === "" || cwd === "/") {
    return undefined;
  }

  const trimmed = cwd.endsWith("/") || cwd.endsWith("\\") ? cwd.slice(0, -1) : cwd;
  const slash = trimmed.lastIndexOf("/");
  const backslash = trimmed.lastIndexOf("\\");
  const index = Math.max(slash, backslash);

  if (index <= 0) {
    return slash === 0 || backslash === 0 ? undefined : "/";
  }

  return trimmed.slice(0, index);
}

/**
 * Соединение каталога и имени записи в путь. Разделитель берётся из `cwd`: путь даёт демон, и пикер
 * следует его соглашению, не навязывая своего. Для UNC- и POSIX-корня не лепит лишний разделитель.
 */
function joinPath(cwd: string, name: string): string {
  if (cwd === "" || cwd === "/" || cwd === "\\") {
    return `${cwd}${name}`;
  }

  const separator = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  const prefix = cwd.endsWith(separator) ? cwd : `${cwd}${separator}`;

  return `${prefix}${name}`;
}
