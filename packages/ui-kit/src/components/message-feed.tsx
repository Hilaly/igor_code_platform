/**
 * Лента переписки и одна реплика в ней. Два экспорта в одном файле — как `List` и `ListRow`: строка
 * вне своей ленты бессмысленна, и разносить их по файлам значило бы прятать эту связь.
 *
 * Лента объявлена живой областью один раз на всю переписку. Внутри реплик живых областей больше нет
 * — иначе скринридер читал бы приходящий ответ дважды.
 */

import { useEffect, useRef, type ReactNode } from "react";

import styles from "./message-feed.module.css";

/** Промах в пикселях, который всё ещё считается низом: трекпад редко останавливается на границе. */
export const stickToBottomSlack = 48;

export type FeedMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/**
 * Прилипать ли к низу. Вынесено из компонента чистой функцией: в `jsdom` раскладки нет, и проверить
 * решение на настоящей прокрутке нечем (docs/ui-kit.md).
 */
export function shouldStickToBottom({
  scrollTop,
  scrollHeight,
  clientHeight,
}: FeedMetrics): boolean {
  return scrollHeight - scrollTop - clientHeight <= stickToBottomSlack;
}

export type MessageFeedProps = {
  /** Имя области, уже переведённое. */
  label: string;
  /** Турн идёт. Берётся из фазы сессии, а не из дельт: турн из очереди дельт не даёт вовсе. */
  busy?: boolean;
  children: ReactNode;
};

export function MessageFeed({ label, busy = false, children }: MessageFeedProps) {
  const container = useRef<HTMLDivElement>(null);
  /**
   * Читающий у низа, пока не доказано обратное: новая сессия открывается пустой, и первая же реплика
   * должна оказаться на виду.
   */
  const sticking = useRef(true);

  useEffect(() => {
    const element = container.current;

    if (element === null || !sticking.current) {
      return;
    }

    element.scrollTop = element.scrollHeight;
  }, [children]);

  return (
    <div
      className={styles.feed}
      ref={container}
      role="log"
      aria-live="polite"
      aria-label={label}
      aria-busy={busy}
      onScroll={(event) => {
        sticking.current = shouldStickToBottom(event.currentTarget);
      }}
    >
      {children}
    </div>
  );
}

export type MessageRole = "human" | "agent" | "service";

export type MessageProps = {
  role: MessageRole;
  /** Служебная шапка: время, имя модели. Форматирует её вызывающий — кит не знает ни локали, ни часового пояса. */
  header?: ReactNode;
  children: ReactNode;
};

export function Message({ role, header, children }: MessageProps) {
  return (
    <div className={styles.message} data-role={role}>
      {header === undefined ? undefined : <div className={styles.header}>{header}</div>}
      <div className={styles.body}>{children}</div>
    </div>
  );
}
