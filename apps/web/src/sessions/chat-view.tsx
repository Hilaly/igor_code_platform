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
  SessionContextUsage,
  SessionEntry,
  SessionForkRequest,
  SessionMessage,
  SessionMessageMode,
  SessionNavigateRequest,
} from "@sovereign/protocol";
import {
  Badge,
  Button,
  ConfirmDialog,
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
  Progress,
  SegmentedControl,
  Spinner,
  StreamingText,
  Text,
  Textarea,
  ToolCall,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useState } from "react";

import type { NavigationOutcome } from "./api.ts";
import { EntryTreeDrawer } from "./entry-tree.tsx";
import { isBusy, isFeedEntry, type OpenSession, type StreamedItem } from "./state.ts";

export type ChatViewProps = {
  open: OpenSession;
  onSubmit: (text: string) => void;
  onSendMessage: (message: SessionMessage) => Promise<string | undefined>;
  onInterrupt: () => void;
  onFork: (request: SessionForkRequest) => Promise<void>;
  /** Свернуть контекст руками. Возвращает причину отказа — её показывает вью, а не диагностика. */
  onCompact: (instructions?: string) => Promise<string | undefined>;
  /** Пометить запись или снять метку (`null`). Возвращает причину отказа. */
  onSetLabel: (entryId: string, label: string | null) => Promise<string | undefined>;
  onNavigate: (request: SessionNavigateRequest) => Promise<NavigationOutcome>;
  translator: ScopedTranslator;
};

/** Что именно отказались сделать: у компакции и метки разные сообщения об отказе. */
type Refusal = { what: "compact" | "label"; reason: string };

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
  const { open, onSubmit, onSendMessage, onInterrupt, onFork, onCompact, onSetLabel, translator } =
    props;
  const { t } = translator;
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<SessionMessageMode>("steer");
  const [treeOpen, setTreeOpen] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [instructions, setInstructions] = useState("");
  /** Запись, которой правят метку, и черновик метки — как у переименования сессии. */
  const [labelling, setLabelling] = useState<{ entryId: string; label: string } | undefined>(
    undefined,
  );
  /**
   * Отказ последнего действия. Живёт во вью, а не в состоянии сессии: это исход нажатия, а не
   * свойство сессии, — так же показывает свой отказ диалог создания.
   */
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);
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

  const compact = async (): Promise<void> => {
    setCompacting(false);

    const asked = instructions.trim();
    const reason = await onCompact(asked === "" ? undefined : asked);

    setInstructions("");
    setRefusal(reason === undefined ? undefined : { what: "compact", reason });
  };

  const label = async (entryId: string, next: string | null): Promise<void> => {
    setLabelling(undefined);

    const reason = await onSetLabel(entryId, next);

    setRefusal(reason === undefined ? undefined : { what: "label", reason });
  };

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
  const archived = open.summary?.archived === true;

  return (
    <div className="sessions-chat">
      <div className="sessions-chat-head">
        <Button
          onClick={() => {
            setTreeOpen(true);
          }}
        >
          {t("chat.tree.open")}
        </Button>
      </div>

      <EntryTreeDrawer
        open={treeOpen}
        onClose={() => setTreeOpen(false)}
        entries={open.entries}
        labels={open.labels}
        {...(open.leafId === undefined ? {} : { leafId: open.leafId })}
        busy={busy}
        archived={archived}
        onNavigate={props.onNavigate}
        onSetLabel={onSetLabel}
        onEditorText={setDraft}
        translator={translator}
      />

      {open.failure === undefined ? undefined : (
        <Notice tone="danger" title={t("chat.turn.failed", { reason: open.failure })} />
      )}

      {refusal === undefined ? undefined : (
        <Notice
          tone="danger"
          title={t(`chat.${refusal.what}.refused`, { reason: refusal.reason })}
        />
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

      {open.context === undefined ? undefined : (
        <ContextGauge context={open.context} translator={translator} />
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
      <div className="sessions-session-actions">
        {busy ? undefined : (
          <Button onClick={() => void onFork({})}>{t("chat.fork.session")}</Button>
        )}
        {/*
         * Архивной сессии компакции не предлагается вовсе: сервер отклонит её `409`, и кнопка
         * обещала бы невозможное (docs/sessions-and-projects.md). Занятой она показана выключенной —
         * занятость проходит сама, и контрол, исчезающий на время турна, хуже выключенного.
         */}
        {archived ? undefined : (
          <Button
            onClick={() => setCompacting(true)}
            disabled={busy}
            {...(busy ? { title: t("chat.busy.hint") } : {})}
          >
            {t("chat.compact")}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={compacting}
        onClose={() => setCompacting(false)}
        title={t("chat.compact.title")}
        description={t("chat.compact.hint")}
        confirmLabel={t("chat.compact.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void compact()}
      >
        <Field label={t("chat.compact.instructions")} hint={t("chat.compact.instructions.hint")}>
          {(control) => <Input {...control} value={instructions} onChange={setInstructions} />}
        </Field>
      </ConfirmDialog>

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
    </div>
  );
}

/**
 * Заполнение контекста. Проценты показываются только когда известно окно модели: без него доли не
 * существует вовсе, и рисовать полосу «из неизвестно чего» значит выдумывать число.
 *
 * Порог автокомпакции виден двумя способами сразу — подписью и цветом полосы, когда он перейдён.
 * `threshold === 0` значит «автопорог выключен», и помечать тогда нечего.
 */
function ContextGauge(props: { context: SessionContextUsage; translator: ScopedTranslator }) {
  const { context, translator } = props;
  const { t } = translator;
  const window = context.contextWindow;
  const share = window === undefined || window <= 0 ? undefined : context.tokens / window;
  const percent = (value: number): string => String(Math.round(value * 100));

  return (
    <div className="sessions-context">
      <Text tone="muted">
        {share === undefined
          ? t("chat.context.tokens", { tokens: String(context.tokens) })
          : t("chat.context.used", {
              tokens: String(context.tokens),
              window: String(window),
              percent: percent(share),
            })}
      </Text>
      {share === undefined ? undefined : (
        <Progress
          value={share}
          label={t("chat.context.label")}
          tone={context.threshold > 0 && share >= context.threshold ? "warning" : "accent"}
        />
      )}
      {share === undefined || context.threshold === 0 ? undefined : (
        <Text tone="muted">
          {t("chat.context.threshold", { percent: percent(context.threshold) })}
        </Text>
      )}
    </div>
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

export function ChatPlaceholder({ translator }: { translator: ScopedTranslator }) {
  const { t } = translator;

  return (
    <div className="sessions-chat">
      <EmptyState title={t("sessions.pick.title")} hint={t("sessions.pick.hint")} />
    </div>
  );
}
