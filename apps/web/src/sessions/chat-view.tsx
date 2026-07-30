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

import type { SessionContentBlock, SessionEntry } from "@sovereign/protocol";
import {
  Button,
  Disclosure,
  EmptyState,
  Markdown,
  Message,
  MessageFeed,
  Notice,
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
  onInterrupt: () => void;
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

export function ChatView({ open, onSubmit, onInterrupt, translator }: ChatViewProps) {
  const { t } = translator;
  const [draft, setDraft] = useState("");
  const busy = isBusy(open.summary);
  const outcomes = outcomesOf(open.entries);

  const send = (): void => {
    if (draft.trim() === "") {
      return;
    }

    onSubmit(draft);
    setDraft("");
  };

  const shown = open.entries.filter(
    (entry) =>
      entry.kind !== "tool-result" && entry.kind !== "tools-change" && entry.kind !== "other",
  );
  const pending = Object.entries(open.pending);
  const live = open.live;
  const empty = shown.length === 0 && pending.length === 0 && live === undefined;

  return (
    <div className="sessions-chat">
      {open.failure === undefined ? undefined : (
        <Notice tone="danger" title={t("chat.turn.failed", { reason: open.failure })} />
      )}

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
              translator={translator}
            />
          ))}

          {pending.map(([turnId, text]) => (
            <Message key={turnId} role="human" header={t("chat.turn.queued")}>
              {text}
            </Message>
          ))}

          {live?.order.map((key) => {
            const item = live.items[key];

            return item === undefined ? undefined : (
              <LiveMessage key={key} item={item} translator={translator} />
            );
          })}
        </MessageFeed>
      )}

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
        {busy ? (
          <Button tone="danger" onClick={onInterrupt}>
            {t("chat.stop")}
          </Button>
        ) : (
          <Button tone="accent" onClick={send} disabled={draft.trim() === ""}>
            {t("chat.send")}
          </Button>
        )}
      </div>
    </div>
  );
}

function EntryMessage(props: {
  entry: SessionEntry;
  outcomes: Map<string, ToolOutcome>;
  translator: ScopedTranslator;
}) {
  const { entry, outcomes, translator } = props;
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
