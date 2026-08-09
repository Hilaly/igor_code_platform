/**
 * Текст, который ещё едет. Разбирает Markdown на каждом обновлении и ставит каретку, пока дельты
 * идут. Незакрытые конструкции могут временно перестраивать дерево; это сознательно включённый
 * эксперимент для проверки на реальных ответах (docs/ui-kit.md, «Почему так»).
 */

import { Markdown } from "./markdown.tsx";
import styles from "./streaming-text.module.css";

export type StreamingTextProps = {
  text: string;
  /** Дельты ещё идут. Влияет и на каретку, и на `aria-busy`: озвучить это надо не меньше, чем показать. */
  streaming: boolean;
  /** Имя области, уже переведённое. Без него у области нет имени, и это нормально: имя даёт лента. */
  label?: string;
};

export function StreamingText({ text, streaming, label }: StreamingTextProps) {
  return (
    <div className={styles.root} aria-busy={streaming} aria-label={label}>
      <Markdown text={text} />
      {streaming ? <span className={styles.caret} aria-hidden="true" /> : undefined}
    </div>
  );
}
