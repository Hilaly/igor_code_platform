/**
 * Панель чата: лента записей, идущий турн, ввод и прерывание.
 *
 * Своих запросов здесь нет: всё приходит пропами, а действия уходят наверх — той же дисциплины
 * держатся вью проектов и провайдеров.
 *
 * Записи и поток не смешиваются: сначала идёт дочитанная история, потом отправленные и ещё не
 * начатые турны, и только потом буфер идущего (docs/sessions-and-projects.md). Порядок именно такой,
 * потому что буфер живёт ровно до конца турна, после чего то же самое приезжает записями.
 */

import type {
  SessionContentBlock,
  SessionEntry,
  SessionForkRequest,
  SessionMessage,
  SessionMessageMode,
} from "@sovereign/protocol";
import {
  Badge,
  Button,
  Disclosure,
  EmptyState,
  Markdown,
  Message,
  MessageFeed,
  Notice,
  SegmentedControl,
  Spinner,
  StreamingText,
  Text,
  Textarea,
  ToolCall,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useState } from "react";

import { isBusy, type OpenSession, type StreamedItem } from "./state.ts";

export type ChatViewProps = {
  open: OpenSession;
  onSubmit: (text: string) => void;
  onSendMessage: (message: SessionMessage) => Promise<string | undefined>;
  onInterrupt: () => void;
  onFork: (request: SessionForkRequest) => Promise<void>;
  translator: ScopedTranslator;
};

/**
 * Что делает кнопка отправки у занятой сессии. Турна она запустить не может — сессия занята, — и
 * выбор между тремя очередями заменяет его собой (docs/web-api.md). `append` требует простоя и
 * поэтому доступен отдельной кнопкой рядом с обычным запуском турна.
 */
const busyModes: SessionMessageMode[] = ["steer", "follow-up", "next-turn"];

/** Исход вызова инструмента из записей: результат приезжает отдельной записью, а не внутри вызова. */
type ToolOutcome = { text: string; failed: boolean };

const outcomesOf = (entries: SessionEntry[]): Map<string, ToolOutcome> =>
  new Map(
    entries
      .filter((entry) => entry.kind === "tool-result")
      .map((entry) => [entry.toolCallId, { text: entry.text, failed: entry.failed }]),
  );

export function ChatView(props: ChatViewProps) {
  const { open, onSubmit, onSendMessage, onInterrupt, onFork, translator } = props;
  const { t } = translator;
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<SessionMessageMode>("steer");
  const busy = isBusy(open.summary);
  const outcomes = outcomesOf(open.entries);
  const queues = open.queues;
  const waiting = [
    ...(queues?.steer ?? []),
    ...(queues?.followUp ?? []),
    ...(queues?.nextTurn ?? []),
  ];

  const send = (): void => {
    if (draft.trim() === "") {
      return;
    }

    if (busy) {
      // У занятой сессии турна не запустить: текст уезжает в одну из очередей, и в какую именно —
      // человек выбирает сам, потому что момент доставки у них разный.
      void onSendMessage({ text: draft, mode });
    } else {
      onSubmit(draft);
    }

    setDraft("");
  };

  const shown = open.entries.filter(
    (entry) =>
      entry.kind !== "tool-result" && entry.kind !== "tools-change" && entry.kind !== "other",
  );
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
  const archived = open.summary?.archived === true;

  return (
    <div className="sessions-chat">
      {open.failure === undefined ? undefined : (
        <Notice tone="danger" title={t("chat.turn.failed", { reason: open.failure })} />
      )}

      {open.degradations.map((lost, index) => (
        <Notice
          key={`${lost.kind}:${lost.name}:${String(index)}`}
          tone="warning"
          title={t(`chat.degraded.${lost.kind}`, { name: lost.name })}
        />
      ))}

      {open.loading && empty ? (
        <Spinner label={t("state.loading")} />
      ) : (
        <MessageFeed label={t("chat.feed.label")} busy={busy}>
          {empty ? (
            <EmptyState title={t("chat.empty.title")} hint={t("chat.empty.hint")} />
          ) : undefined}

          {shown.map((entry) => (
            <EntryMessage
              key={entry.id}
              entry={entry}
              outcomes={outcomes}
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
          ))}

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

      {open.stats === undefined ? undefined : (
        <div className="sessions-stats">
          <Text tone="muted">
            {t("chat.stats.tokens", { total: String(open.stats.totalTokens) })}
          </Text>
          <Text tone="muted">
            {t("chat.stats.cost", { cost: open.stats.costTotal.toFixed(4) })}
          </Text>
        </div>
      )}

      {waiting.length === 0 ? undefined : (
        <div className="sessions-queues">
          {waiting.map((text, index) => (
            <Badge key={`${String(index)}:${text}`} tone="accent">
              {text}
            </Badge>
          ))}
        </div>
      )}

      {!archived && busy ? (
        <div className="sessions-modes">
          <SegmentedControl
            options={busyModes.map((option) => ({
              value: option,
              label: t(`chat.mode.${option}`),
            }))}
            value={mode}
            onChange={setMode}
            label={t("chat.mode.label")}
          />
        </div>
      ) : undefined}

      {archived ? undefined : (
        <div className="sessions-composer">
          <Textarea
            value={draft}
            onChange={setDraft}
            onSubmit={send}
            placeholder={t("chat.compose.placeholder")}
            aria-label={t("chat.compose.label")}
            autoGrow
            rows={2}
            maxRows={12}
          />
          <Button tone="accent" onClick={send} disabled={draft.trim() === ""}>
            {busy ? t(`chat.mode.${mode}.send`) : t("chat.send")}
          </Button>
          {!busy ? (
            <Button
              onClick={() => {
                if (draft.trim() === "") {
                  return;
                }

                void onSendMessage({ text: draft, mode: "append" });
                setDraft("");
              }}
              disabled={draft.trim() === ""}
            >
              {t("chat.append")}
            </Button>
          ) : undefined}
          {busy ? (
            <Button tone="danger" onClick={onInterrupt}>
              {t("chat.stop")}
            </Button>
          ) : undefined}
        </div>
      )}
      {!busy ? (
        <div className="sessions-session-actions">
          <Button onClick={() => void onFork({})}>{t("chat.fork.session")}</Button>
        </div>
      ) : undefined}
    </div>
  );
}

function EntryMessage(props: {
  entry: SessionEntry;
  outcomes: Map<string, ToolOutcome>;
  onForkBefore?: () => void;
  onForkAt?: () => void;
  translator: ScopedTranslator;
}) {
  const { entry, outcomes, onForkBefore, onForkAt, translator } = props;
  const { t } = translator;

  if (entry.kind === "model-change") {
    return <Message role="service">{t("chat.model.changed", { model: entry.model })}</Message>;
  }

  if (entry.kind === "thinking-level-change") {
    return (
      <Message role="service">{t("chat.thinking.changed", { level: entry.thinkingLevel })}</Message>
    );
  }

  if (entry.kind !== "message") {
    return undefined;
  }

  return (
    <Message role={entry.role === "user" ? "human" : "agent"}>
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

export function ChatPlaceholder({ translator }: { translator: ScopedTranslator }) {
  const { t } = translator;

  return (
    <div className="sessions-chat">
      <EmptyState title={t("sessions.pick.title")} hint={t("sessions.pick.hint")} />
    </div>
  );
}
