/**
 * Вызов инструмента в ленте чата: имя, состояние, аргументы и — когда он уже есть — вывод.
 *
 * Свёрнут по умолчанию. Разворачивать нечего в тот момент, когда вызов только начался: аргументы
 * интересны, когда что-то пошло не так, а исход виден и без разворачивания — значком в подписи.
 */

import type { ReactNode } from "react";

import { Badge, type BadgeTone } from "./badge.tsx";
import { Code, CodeBlock } from "./code.tsx";
import { Disclosure } from "./disclosure.tsx";
import styles from "./tool-call.module.css";

export type ToolCallStatus = "running" | "done" | "failed";

const tones: Record<ToolCallStatus, BadgeTone> = {
  running: "accent",
  done: "neutral",
  failed: "danger",
};

const statusSigns: Record<ToolCallStatus, string> = {
  running: "●",
  done: "✓",
  failed: "×",
};

export type ToolCallProps = {
  /** Необязательный знак типа инструмента; его форму выбирает вызывающий. */
  icon?: ReactNode;
  toolName: string;
  /** Короткое техническое описание цели вызова, например путь к файлу. */
  summary?: string;
  /** Уже отформатированная длительность выполнения. */
  duration?: string;
  status: ToolCallStatus;
  /** Подпись состояния, уже переведённая. */
  statusLabel: string;
  /**
   * Аргументы строкой. Сериализует их вызывающий: в контракте это `unknown`, и решать, как показать
   * чужую структуру, — дело вью, а не примитива.
   */
  argumentsText: string;
  /** Вывод инструмента. В потоке его нет вовсе, он появляется после дочитывания записей сессии. */
  output?: string;
  /** Подпись над выводом, уже переведённая. */
  outputLabel?: string;
};

export function ToolCall({
  icon,
  toolName,
  summary,
  duration,
  status,
  statusLabel,
  argumentsText,
  output,
  outputLabel,
}: ToolCallProps) {
  return (
    <div className={styles.root} data-status={status}>
      <Disclosure
        summary={
          <span className={styles.summary}>
            {icon === undefined ? undefined : <span className={styles.icon}>{icon}</span>}
            <span className={styles.identity}>
              <Code>{toolName}</Code>
              {summary === undefined ? undefined : (
                <span className={styles.description} aria-label={summary} title={summary}>
                  {summary}
                </span>
              )}
            </span>
            <span className={styles.outcome}>
              {duration === undefined ? undefined : <Code>{duration}</Code>}
              <span className={styles.statusSign} aria-hidden="true">
                {statusSigns[status]}
              </span>
              <Badge tone={tones[status]}>{statusLabel}</Badge>
            </span>
          </span>
        }
      >
        <CodeBlock>{argumentsText}</CodeBlock>
        {output === undefined ? undefined : (
          <>
            {outputLabel === undefined ? undefined : (
              <div className={styles.outputLabel}>{outputLabel}</div>
            )}
            <CodeBlock>{output}</CodeBlock>
          </>
        )}
      </Disclosure>
    </div>
  );
}
