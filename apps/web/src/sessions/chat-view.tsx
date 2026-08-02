/**
 * Панель чата: координация ленты, дерева, состояния сессии, ввода и действий.
 *
 * Своих запросов здесь нет: всё приходит пропами, а действия уходят наверх — той же дисциплины
 * держатся вью проектов и провайдеров.
 */

import type {
  SessionContextUsage,
  SessionForkRequest,
  SessionMessage,
  SessionNavigateRequest,
} from "@sovereign/protocol";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Notice,
  Progress,
  Text,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useState } from "react";

import type { NavigationOutcome } from "./api.ts";
import { EntryTreeDrawer } from "./entry-tree.tsx";
import { MessageComposer } from "./message-composer.tsx";
import { SessionMessageList } from "./session-message-list.tsx";
import { isBusy, type OpenSession } from "./state.ts";

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

export function ChatView(props: ChatViewProps) {
  const { open, onSubmit, onSendMessage, onInterrupt, onFork, onCompact, onSetLabel, translator } =
    props;
  const { t } = translator;
  const [draft, setDraft] = useState("");
  const [treeOpen, setTreeOpen] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [instructions, setInstructions] = useState("");
  /**
   * Отказ последней компакции. Живёт во вью, а не в состоянии сессии: это исход нажатия, а не
   * свойство сессии, — так же показывает свой отказ диалог создания.
   */
  const [compactionRefusal, setCompactionRefusal] = useState<string | undefined>(undefined);
  const busy = isBusy(open.summary);
  const queues = open.queues;
  const waiting = [
    ...(queues?.steer ?? []),
    ...(queues?.followUp ?? []),
    ...(queues?.nextTurn ?? []),
  ];

  const compact = async (): Promise<void> => {
    setCompacting(false);

    const asked = instructions.trim();
    const reason = await onCompact(asked === "" ? undefined : asked);

    setInstructions("");
    setCompactionRefusal(reason);
  };
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

      {compactionRefusal === undefined ? undefined : (
        <Notice tone="danger" title={t("chat.compact.refused", { reason: compactionRefusal })} />
      )}

      {open.degradations.map((lost, index) => (
        <Notice
          key={`${lost.kind}:${lost.name}:${String(index)}`}
          tone="warning"
          title={t(`chat.degraded.${lost.kind}`, { name: lost.name })}
        />
      ))}

      <SessionMessageList
        open={open}
        busy={busy}
        archived={archived}
        onFork={onFork}
        onSetLabel={onSetLabel}
        translator={translator}
      />

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

      {archived ? undefined : (
        <MessageComposer
          draft={draft}
          onDraftChange={setDraft}
          busy={busy}
          onSubmit={onSubmit}
          onSendMessage={onSendMessage}
          onInterrupt={onInterrupt}
          translator={translator}
        />
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

export function ChatPlaceholder({ translator }: { translator: ScopedTranslator }) {
  const { t } = translator;

  return (
    <div className="sessions-chat">
      <EmptyState title={t("sessions.pick.title")} hint={t("sessions.pick.hint")} />
    </div>
  );
}
