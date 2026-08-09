/**
 * Лента открытой сессии: сохранённые записи, ожидающие турны и идущий буфер.
 *
 * Записи и поток не смешиваются: сначала идёт дочитанная история, потом отправленные и ещё не
 * начатые турны, и только потом буфер идущего (docs/sessions-and-projects.md). Порядок именно такой,
 * потому что буфер живёт ровно до конца турна, после чего то же самое приезжает записями.
 */

import type { SessionContentBlock, SessionEntry, SessionForkRequest } from "@sovereign/protocol";
import {
  Badge,
  Button,
  ClearLabelIcon,
  CopyIcon,
  Dialog,
  Disclosure,
  EmptyState,
  Field,
  ForkBeforeIcon,
  ForkThroughIcon,
  Input,
  Markdown,
  Message,
  MessageFeed,
  Notice,
  SetLabelIcon,
  Spinner,
  StreamingText,
  Text,
  Tooltip,
  ToolCall,
  type ScopedTranslator,
  type TooltipSide,
} from "@sovereign/ui-kit";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { isFeedEntry, type OpenSession, type StreamedItem } from "./state.ts";

export type SessionMessageListProps = {
  open: OpenSession;
  busy: boolean;
  archived: boolean;
  onFork: (request: SessionForkRequest) => Promise<void>;
  onSetLabel: (entryId: string, label: string | null) => Promise<string | undefined>;
  labelRefusal: string | undefined;
  onLabelRefusalChange: (reason: string | undefined) => void;
  translator: ScopedTranslator;
  className?: string;
  before?: ReactNode;
  after?: ReactNode;
};

/** Исход вызова инструмента из записей: результат приезжает отдельной записью, а не внутри вызова. */
type ToolOutcome = { text: string; failed: boolean };

const outcomesOf = (entries: SessionEntry[]): Map<string, ToolOutcome> =>
  new Map(
    entries
      .filter((entry) => entry.kind === "tool-result")
      .map((entry) => [entry.toolCallId, { text: entry.text, failed: entry.failed }]),
  );

function toolSummary(toolName: string, input: unknown): string | undefined {
  void toolName;

  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  for (const key of ["path", "file", "command"]) {
    const value = input[key as keyof typeof input];

    if (typeof value === "string" && value !== "") {
      return value;
    }
  }

  return undefined;
}

export function SessionMessageList(props: SessionMessageListProps): React.JSX.Element {
  const {
    open,
    busy,
    archived,
    onFork,
    onSetLabel,
    labelRefusal,
    onLabelRefusalChange,
    translator,
    className,
    before,
    after,
  } = props;
  const { t } = translator;
  /** Запись, которой правят метку, и черновик метки — как у переименования сессии. */
  const [labelling, setLabelling] = useState<{ entryId: string; label: string } | undefined>(
    undefined,
  );
  const [copiedEntryId, setCopiedEntryId] = useState<string | undefined>(undefined);
  const [copyRefusal, setCopyRefusal] = useState<string | undefined>(undefined);
  const copyConfirmationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyRequest = useRef(0);
  const outcomes = outcomesOf(open.entries);
  const activeEntries = open.entries.filter(({ id }) => open.branchEntryIds.has(id));
  const shown = activeEntries.filter(isFeedEntry);
  const pending = Object.entries(open.pending);
  const live = open.live;
  const liveOrder =
    live?.order.filter((key, index) => {
      const item = live.items[key];

      if (item?.kind !== "message" || item.role !== "user") {
        return true;
      }

      // Первый prompt уже успевает попасть в дерево к моменту, когда UI видит live-буфер.
      // Стиринг же может ещё не попасть в дочитанные записи, поэтому глушить все user-дельты нельзя.
      if (index > 0) {
        return true;
      }

      return !shown.some(
        (entry) =>
          entry.kind === "message" &&
          entry.role === "user" &&
          entry.content.some((block) => block.kind === "text" && block.text === item.text),
      );
    }) ?? [];
  const empty = shown.length === 0 && pending.length === 0 && live === undefined;

  const label = async (entryId: string, next: string | null): Promise<void> => {
    setLabelling(undefined);

    const reason = await onSetLabel(entryId, next);

    onLabelRefusalChange(reason);
  };

  const copy = async (entryId: string, text: string): Promise<void> => {
    const request = ++copyRequest.current;

    if (copyConfirmationTimer.current !== undefined) {
      clearTimeout(copyConfirmationTimer.current);
      copyConfirmationTimer.current = undefined;
    }

    setCopiedEntryId(undefined);
    setCopyRefusal(undefined);

    try {
      await navigator.clipboard.writeText(text);

      if (copyRequest.current !== request) {
        return;
      }

      setCopiedEntryId(entryId);
      copyConfirmationTimer.current = setTimeout(() => {
        if (copyRequest.current !== request) {
          return;
        }

        setCopiedEntryId(undefined);
        copyConfirmationTimer.current = undefined;
      }, 2000);
    } catch (cause) {
      if (copyRequest.current !== request) {
        return;
      }

      setCopiedEntryId(undefined);
      setCopyRefusal(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(
    () => () => {
      copyRequest.current += 1;

      if (copyConfirmationTimer.current !== undefined) {
        clearTimeout(copyConfirmationTimer.current);
      }
    },
    [],
  );

  return (
    <>
      <MessageFeed
        label={t("chat.feed.label")}
        busy={busy}
        className={className}
        before={before}
        after={after}
      >
        {labelRefusal === undefined ? undefined : (
          <Notice tone="danger" title={t("chat.label.refused", { reason: labelRefusal })} />
        )}
        {copyRefusal === undefined ? undefined : (
          <Notice tone="danger" title={t("chat.copy.refused", { reason: copyRefusal })} />
        )}

        {open.loading && empty ? (
          <Spinner label={t("state.loading")} />
        ) : (
          <>
            {empty ? (
              <EmptyState title={t("chat.empty.title")} hint={t("chat.empty.hint")} />
            ) : undefined}

            {shown.map((entry) => {
              const mark = open.labels.get(entry.id);
              const copyText = entry.kind === "message" ? messageText(entry) : undefined;

              return (
                <EntryMessage
                  key={entry.id}
                  entry={entry}
                  outcomes={outcomes}
                  {...(mark === undefined ? {} : { label: mark })}
                  // Метка архивной сессии отклоняется `409`: действия в ней не показываются вовсе, а
                  // у занятой остаются видимыми, но выключенными.
                  {...(archived
                    ? {}
                    : {
                        marking: {
                          busy,
                          onLabel: () => setLabelling({ entryId: entry.id, label: mark ?? "" }),
                          onClearLabel: () => void label(entry.id, null),
                        },
                      })}
                  // До реплики режем только вопрос человека; включить запись можно для любого места
                  // дерева, поэтому `at` доступен и на ответе агента.
                  forking={{
                    busy,
                    onForkAt: () => void onFork({ entryId: entry.id, position: "at" }),
                    ...(entry.kind === "message" && entry.role === "user"
                      ? { onForkBefore: () => void onFork({ entryId: entry.id }) }
                      : {}),
                  }}
                  {...(copyText === undefined
                    ? {}
                    : {
                        copying: {
                          copied: copiedEntryId === entry.id,
                          onCopy: () => void copy(entry.id, copyText),
                        },
                      })}
                  translator={translator}
                />
              );
            })}

            {pending.map(([turnId, text]) => (
              <Message key={turnId} role="human" header={t("chat.turn.queued")}>
                {text}
              </Message>
            ))}

            {liveOrder.map((key) => {
              const item = live?.items[key];

              return item === undefined ? undefined : (
                <LiveMessage key={key} item={item} translator={translator} />
              );
            })}
          </>
        )}
      </MessageFeed>

      <Dialog
        open={labelling !== undefined}
        onClose={() => setLabelling(undefined)}
        title={t("chat.label.title")}
        footer={
          <>
            <Button onClick={() => setLabelling(undefined)}>{t("common.cancel")}</Button>
            <Button
              tone="accent"
              onClick={() => {
                if (labelling === undefined) {
                  return;
                }

                // Пустая метка — снятие: отдельной кнопки «стереть» в диалоге не нужно, а `null`
                // отличается от пустой строки тем, что его понимает демон.
                const next = labelling.label.trim();

                void label(labelling.entryId, next === "" ? null : next);
              }}
            >
              {t("chat.label.confirm")}
            </Button>
          </>
        }
      >
        <Field label={t("chat.label.field")} hint={t("chat.label.hint")}>
          {(control) => (
            <Input
              {...control}
              value={labelling?.label ?? ""}
              onChange={(next) =>
                setLabelling((current) =>
                  current === undefined ? current : { ...current, label: next },
                )
              }
            />
          )}
        </Field>
      </Dialog>
    </>
  );
}

function EntryMessage(props: {
  entry: SessionEntry;
  outcomes: Map<string, ToolOutcome>;
  /** Действующая метка записи, если она есть. Значение уже свёрнуто состоянием. */
  label?: string;
  /** Чем метку правят. Нет вовсе — метку в этой сессии не поставить: она архивная. */
  marking?: { busy: boolean; onLabel: () => void; onClearLabel: () => void };
  forking: { busy: boolean; onForkBefore?: () => void; onForkAt: () => void };
  copying?: { copied: boolean; onCopy: () => void };
  translator: ScopedTranslator;
}) {
  const { entry, outcomes, label, marking, forking, copying, translator } = props;
  const { t } = translator;

  if (entry.kind === "model-change") {
    return <Message role="service">{t("chat.model.changed", { model: entry.model })}</Message>;
  }

  if (entry.kind === "thinking-level-change") {
    return (
      <Message role="service">{t("chat.thinking.changed", { level: entry.thinkingLevel })}</Message>
    );
  }

  // Свёртка контекста и пересказ покинутой ветки — служебные строки, а не реплики: человек обязан
  // видеть, что часть разговора модель больше не видит. Сам пересказ свёрнут — он бывает длинным.
  if (entry.kind === "compaction" || entry.kind === "branch-summary") {
    return (
      <Message role="service">
        {entry.kind === "compaction"
          ? t("chat.compaction", { tokens: String(entry.tokensBefore) })
          : t("chat.branch.summary")}
        <Disclosure summary={t("chat.summary")}>
          <Text tone="muted">{entry.summary}</Text>
        </Disclosure>
      </Message>
    );
  }

  // Запись приложения, которая является репликой. Разметки в ней нет: текст пишет не модель.
  if (entry.kind === "custom-message") {
    return <Message role="service">{entry.text}</Message>;
  }

  if (entry.kind !== "message") {
    return undefined;
  }

  const role = entry.role === "user" ? "human" : "agent";
  const shownTime = formatEntryTimestamp(entry.time);
  const hasEnabledAction = copying !== undefined || !forking.busy || marking?.busy === false;

  return (
    <div className="sessions-entry-message" data-role={role}>
      <Message role={role}>
        {label === undefined ? undefined : <Badge tone="accent">{label}</Badge>}
        {entry.content.map((block, index) => (
          <ContentBlock
            key={`${entry.id}:${String(index)}`}
            block={block}
            outcomes={outcomes}
            translator={translator}
          />
        ))}
      </Message>
      <div
        className="sessions-entry-meta"
        role="group"
        aria-label={t("chat.actions")}
        {...(hasEnabledAction ? {} : { tabIndex: 0 })}
      >
        {shownTime === undefined ? undefined : <time dateTime={entry.time}>{shownTime}</time>}
        {copying === undefined ? undefined : (
          <MessageAction
            label={t(copying.copied ? "chat.copy.done" : "chat.copy")}
            disabled={false}
            onClick={copying.onCopy}
            {...(role === "agent" ? { side: "right" as const } : {})}
          >
            <CopyIcon size="sm" />
          </MessageAction>
        )}
        {forking.onForkBefore === undefined ? undefined : (
          <MessageAction
            label={t("chat.fork.before")}
            disabled={forking.busy}
            onClick={forking.onForkBefore}
          >
            <ForkBeforeIcon size="sm" />
          </MessageAction>
        )}
        <MessageAction
          label={t("chat.fork.at")}
          disabled={forking.busy}
          onClick={forking.onForkAt}
          {...(role === "agent" && copying === undefined
            ? { side: "right" as const }
            : role === "human" && marking === undefined
              ? { side: "left" as const }
              : {})}
        >
          <ForkThroughIcon size="sm" />
        </MessageAction>
        {marking === undefined ? undefined : (
          <>
            <MessageAction
              label={t("chat.label.set")}
              disabled={marking.busy}
              onClick={marking.onLabel}
            >
              <SetLabelIcon size="sm" />
            </MessageAction>
            <MessageAction
              label={t("chat.label.clear")}
              disabled={marking.busy || label === undefined}
              onClick={marking.onClearLabel}
              {...(role === "human" ? { side: "left" as const } : {})}
            >
              <ClearLabelIcon size="sm" />
            </MessageAction>
          </>
        )}
      </div>
    </div>
  );
}

function MessageAction(props: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  side?: TooltipSide;
  children: ReactNode;
}) {
  const { label, disabled, onClick, side, children } = props;

  return (
    <Tooltip content={label} {...(side === undefined ? {} : { side })}>
      <Button size="sm" iconOnly aria-label={label} disabled={disabled} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

function formatEntryTimestamp(time: string): string | undefined {
  const date = new Date(time);

  return Number.isNaN(date.getTime())
    ? undefined
    : new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(date);
}

function messageText(entry: Extract<SessionEntry, { kind: "message" }>): string | undefined {
  const parts = entry.content.flatMap((block) =>
    block.kind === "text" && block.text.trim() !== "" ? [block.text] : [],
  );

  return parts.length === 0 ? undefined : parts.join("\n\n");
}

function ContentBlock(props: {
  block: SessionContentBlock;
  outcomes: Map<string, ToolOutcome>;
  translator: ScopedTranslator;
}) {
  const { block, outcomes, translator } = props;
  const { t } = translator;

  if (block.kind === "text") {
    return <Markdown text={block.text} />;
  }

  if (block.kind === "reasoning") {
    // Свёрнуто: размышления бывают длиннее самого ответа, и разворачивает их тот, кому интересно.
    return (
      <Disclosure summary={t("chat.reasoning")}>
        <Markdown text={block.text} />
      </Disclosure>
    );
  }

  const outcome = outcomes.get(block.toolCallId);
  const status = outcome === undefined ? "running" : outcome.failed ? "failed" : "done";

  return (
    <ToolCall
      icon="◇"
      toolName={block.toolName}
      summary={toolSummary(block.toolName, block.input)}
      status={status}
      statusLabel={t(`chat.tool.${status}`)}
      argumentsText={JSON.stringify(block.input, undefined, 2) ?? ""}
      {...(outcome === undefined
        ? {}
        : { output: outcome.text, outputLabel: t("chat.tool.output") })}
    />
  );
}

function LiveMessage(props: { item: StreamedItem; translator: ScopedTranslator }) {
  const { item, translator } = props;
  const { t } = translator;

  if (item.kind === "tool") {
    // Вывода у идущего вызова нет вовсе: `tool-end` несёт только признак отказа.
    const status = !item.done ? "running" : item.failed === true ? "failed" : "done";

    return (
      <Message role="agent">
        <ToolCall
          icon="◇"
          toolName={item.toolName}
          summary={toolSummary(item.toolName, item.input)}
          status={status}
          statusLabel={t(`chat.tool.${status}`)}
          argumentsText={JSON.stringify(item.input, undefined, 2) ?? ""}
        />
      </Message>
    );
  }

  return (
    <Message role={item.role === "user" ? "human" : "agent"}>
      {item.reasoning === "" ? undefined : (
        <Disclosure summary={t("chat.reasoning")}>
          <Markdown text={item.reasoning} />
        </Disclosure>
      )}
      {item.done ? (
        <Markdown text={item.text} />
      ) : (
        <StreamingText text={item.text} streaming label={t("chat.answer.label")} />
      )}
    </Message>
  );
}
