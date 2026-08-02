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
  Dialog,
  Disclosure,
  EmptyState,
  Field,
  Input,
  Markdown,
  Menu,
  Message,
  MessageFeed,
  Notice,
  Spinner,
  StreamingText,
  Text,
  ToolCall,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useState } from "react";

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
};

/** Исход вызова инструмента из записей: результат приезжает отдельной записью, а не внутри вызова. */
type ToolOutcome = { text: string; failed: boolean };

const outcomesOf = (entries: SessionEntry[]): Map<string, ToolOutcome> =>
  new Map(
    entries
      .filter((entry) => entry.kind === "tool-result")
      .map((entry) => [entry.toolCallId, { text: entry.text, failed: entry.failed }]),
  );

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
  } = props;
  const { t } = translator;
  /** Запись, которой правят метку, и черновик метки — как у переименования сессии. */
  const [labelling, setLabelling] = useState<{ entryId: string; label: string } | undefined>(
    undefined,
  );
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

  return (
    <>
      {labelRefusal === undefined ? undefined : (
        <Notice tone="danger" title={t("chat.label.refused", { reason: labelRefusal })} />
      )}

      {open.loading && empty ? (
        <Spinner label={t("state.loading")} />
      ) : (
        <MessageFeed label={t("chat.feed.label")} busy={busy}>
          {empty ? (
            <EmptyState title={t("chat.empty.title")} hint={t("chat.empty.hint")} />
          ) : undefined}

          {shown.map((entry) => {
            const mark = open.labels.get(entry.id);

            return (
              <EntryMessage
                key={entry.id}
                entry={entry}
                outcomes={outcomes}
                {...(mark === undefined ? {} : { label: mark })}
                // Метка архивной сессии отклоняется `409`: меню в ней не показывается вовсе, а у
                // занятой остаётся видимым, но выключенным.
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
                {...(!busy
                  ? {
                      onForkAt: () => void onFork({ entryId: entry.id, position: "at" }),
                      ...(entry.kind === "message" && entry.role === "user"
                        ? { onForkBefore: () => void onFork({ entryId: entry.id }) }
                        : {}),
                    }
                  : {})}
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
        </MessageFeed>
      )}

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
  onForkBefore?: () => void;
  onForkAt?: () => void;
  translator: ScopedTranslator;
}) {
  const { entry, outcomes, label, marking, onForkBefore, onForkAt, translator } = props;
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

  return (
    <Message role={entry.role === "user" ? "human" : "agent"}>
      {label === undefined ? undefined : <Badge tone="accent">{label}</Badge>}
      {entry.content.map((block, index) => (
        <ContentBlock
          key={`${entry.id}:${String(index)}`}
          block={block}
          outcomes={outcomes}
          translator={translator}
        />
      ))}
      {onForkBefore === undefined ? undefined : (
        <Button onClick={onForkBefore}>{t("chat.fork.before")}</Button>
      )}
      {onForkAt === undefined ? undefined : <Button onClick={onForkAt}>{t("chat.fork.at")}</Button>}
      {marking === undefined ? undefined : (
        <Menu
          label={t("chat.label.menu")}
          trigger="…"
          triggerLabel={t("chat.label.menu")}
          compact
          items={[
            {
              id: "label",
              label: t("chat.label.set"),
              disabled: marking.busy,
              onSelect: marking.onLabel,
            },
            {
              id: "clear",
              label: t("chat.label.clear"),
              // Снимать нечего, пока метки нет: пункт остаётся видимым, но выключен.
              disabled: marking.busy || label === undefined,
              onSelect: marking.onClearLabel,
            },
          ]}
        />
      )}
    </Message>
  );
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
        <Text tone="muted">{block.text}</Text>
      </Disclosure>
    );
  }

  const outcome = outcomes.get(block.toolCallId);
  const status = outcome === undefined ? "running" : outcome.failed ? "failed" : "done";

  return (
    <ToolCall
      toolName={block.toolName}
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
      <ToolCall
        toolName={item.toolName}
        status={status}
        statusLabel={t(`chat.tool.${status}`)}
        argumentsText={JSON.stringify(item.input, undefined, 2) ?? ""}
      />
    );
  }

  return (
    <Message role={item.role === "user" ? "human" : "agent"}>
      {item.reasoning === "" ? undefined : (
        <Disclosure summary={t("chat.reasoning")}>
          <Text tone="muted">{item.reasoning}</Text>
        </Disclosure>
      )}
      {/*
       * Дописанное сообщение показывается размёткой, идущее — плоским текстом: разбор markdown на
       * каждой дельте заставлял бы ответ прыгать на каждом токене (docs/ui-kit.md).
       */}
      {item.done ? (
        <Markdown text={item.text} />
      ) : (
        <StreamingText text={item.text} streaming label={t("chat.answer.label")} />
      )}
    </Message>
  );
}
