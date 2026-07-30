/**
 * Текст, который ещё едет. Показывает ответ модели плоским — без разбора размётки — и ставит
 * каретку, пока дельты идут.
 *
 * Почему это не проп `Markdown`: дельта приходит на каждый токен, и разбор размётки на каждом кадре
 * не только дорог, но и заставляет ответ прыгать — незакрытый ограждённый блок меняет дерево
 * целиком (docs/ui-kit.md, «Почему так»). Дописанное сообщение показывает `Markdown`.
 */

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
      {text}
      {streaming ? <span className={styles.caret} aria-hidden="true" /> : undefined}
    </div>
  );
}
