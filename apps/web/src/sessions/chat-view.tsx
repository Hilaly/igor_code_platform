/**
 * Панель чата: координация ленты, дерева, состояния сессии, ввода и действий.
 *
 * Своих запросов здесь нет: всё приходит пропами, а действия уходят наверх — той же дисциплины
 * держатся вью проектов и провайдеров.
 */

import type {
  Project,
  ProviderSummary,
  SessionForkRequest,
  SessionMessage,
  SessionNavigateRequest,
  ThinkingLevel,
  TurnRequest,
} from "@sovereign/protocol";
import { parseModelReference } from "@sovereign/protocol";
import {
  Badge,
  CompactIcon,
  ConfirmDialog,
  EmptyState,
  EntryTreeIcon,
  Field,
  ForkThroughIcon,
  Input,
  Notice,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { NavigationOutcome } from "./api.ts";
import { EntryTreeDrawer } from "./entry-tree.tsx";
import { MessageComposer, type ComposerDraftReplacement } from "./message-composer.tsx";
import { modelPickerGroups, selectedModel } from "./model-options.ts";
import { SessionMessageList } from "./session-message-list.tsx";
import { isBusy, type ModelsEntry, type OpenSession } from "./state.ts";
import { useShellHeader } from "../shell/header.tsx";

export type ChatViewProps = {
  open: OpenSession;
  /** Проект сессии: полоса шапки называет его по имени, а путь на диске держит в подсказке. */
  project?: Project;
  providers?: ProviderSummary[];
  models: Record<string, ModelsEntry>;
  onPrepareModels: () => void;
  onLoadModels: (providerId: string) => void;
  onSubmit: (request: TurnRequest) => Promise<string | undefined>;
  onSendMessage: (message: SessionMessage) => Promise<string | undefined>;
  onDiagnostic?: (diagnostic: string) => void;
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

export function ChatView(props: ChatViewProps) {
  const {
    open,
    project,
    providers,
    models,
    onPrepareModels,
    onLoadModels,
    onSubmit,
    onSendMessage,
    onDiagnostic,
    onInterrupt,
    onFork,
    onCompact,
    onSetLabel,
    translator,
  } = props;
  const { t } = translator;
  const [draftReplacement, setDraftReplacement] = useState<ComposerDraftReplacement | undefined>(
    undefined,
  );
  const draftReplacementSequence = useRef(0);
  const [model, setModel] = useState(open.summary?.model ?? "");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(
    open.summary?.thinkingLevel ?? "off",
  );
  const overridesHydratedFor = useRef(open.summary === undefined ? undefined : open.id);
  const modelPrepared = useRef(false);
  const thinkingLevelPrepared = useRef(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [instructions, setInstructions] = useState("");
  /**
   * Отказ последнего действия. Живёт во вью, а не в состоянии сессии: это исход нажатия, а не
   * свойство сессии, — так же показывает свой отказ диалог создания.
   */
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);
  const busy = isBusy(open.summary);
  const agentAvailable = open.summary?.agentAvailable !== false;
  const sessionQueues = open.queues;
  const waiting = useMemo(
    () => [
      ...(sessionQueues?.steer ?? []),
      ...(sessionQueues?.followUp ?? []),
      ...(sessionQueues?.nextTurn ?? []),
    ],
    [sessionQueues?.followUp, sessionQueues?.nextTurn, sessionQueues?.steer],
  );
  const reasoningSupported = selectedModel(model, models)?.reasoning !== false;

  const compact = async (): Promise<void> => {
    setCompacting(false);

    // Обновление contribution может убрать сохранённого агента, пока подтверждение уже открыто.
    // Кнопка ниже выключается сразу новым кадром, а эта проверка не выпускает устаревшее событие.
    if (!agentAvailable) {
      return;
    }

    const asked = instructions.trim();
    const reason = await onCompact(asked === "" ? undefined : asked);

    setInstructions("");
    setRefusal(reason === undefined ? undefined : { what: "compact", reason });
  };
  const archived = open.summary?.archived === true;

  useEffect(() => {
    setDraftReplacement(undefined);
    setModel(open.summary?.model ?? "");
    setThinkingLevel(open.summary?.thinkingLevel ?? "off");
    overridesHydratedFor.current = open.summary === undefined ? undefined : open.id;
    modelPrepared.current = false;
    thinkingLevelPrepared.current = false;
  }, [open.id]);

  useEffect(() => {
    if (open.summary !== undefined && overridesHydratedFor.current !== open.id) {
      if (!modelPrepared.current) {
        setModel(open.summary.model);
      }
      if (!thinkingLevelPrepared.current) {
        setThinkingLevel(open.summary.thinkingLevel);
      }
      overridesHydratedFor.current = open.id;
    }
  }, [open.id, open.summary]);

  useEffect(() => {
    onPrepareModels();
  }, [onPrepareModels]);

  useEffect(() => {
    const current = open.summary?.model;
    const parsed = current === undefined ? undefined : parseModelReference(current);

    if (parsed !== undefined) {
      onLoadModels(parsed.providerId);
    }
  }, [onLoadModels, open.id, open.summary?.model]);

  const prepareModel = (nextModel: string): void => {
    modelPrepared.current = true;
    setModel(nextModel);
  };

  const prepareThinkingLevel = (nextLevel: ThinkingLevel): void => {
    thinkingLevelPrepared.current = true;
    setThinkingLevel(nextLevel);
  };

  useEffect(() => {
    if (!agentAvailable) {
      setCompacting(false);
    }
  }, [agentAvailable]);

  /**
   * Главного действия у чата в полосе нет: оно живёт в композере («отправить»), а форк, компакция и
   * дерево записей — редкие ходы. Все три уезжают в меню «ещё», и полоса остаётся заголовком сессии,
   * а не рядом из трёх подписей, который на узком экране переносился второй строкой.
   */
  const headerActions = useMemo(
    () => [
      ...(busy
        ? []
        : [
            {
              id: "fork",
              label: t("chat.fork.session"),
              icon: <ForkThroughIcon size="sm" />,
              run: () => void onFork({}),
            },
          ]),
      ...(archived
        ? []
        : [
            {
              id: "compact",
              label: t("chat.compact"),
              icon: <CompactIcon size="sm" />,
              disabled: busy || !agentAvailable,
              ...(busy ? { title: t("chat.busy.hint") } : {}),
              run: () => setCompacting(true),
            },
          ]),
      {
        id: "tree",
        label: t("chat.tree.open"),
        icon: <EntryTreeIcon size="sm" />,
        run: () => setTreeOpen(true),
      },
    ],
    [agentAvailable, archived, busy, onFork, t],
  );

  const currentModel = model === "" ? undefined : model;
  /**
   * В полосе стоит имя проекта, а путь на диске ушёл в подсказку: путь длинный, съедал всю полосу и
   * первым обрезался многоточием — то есть занимал место, ничего не сообщая. Имя проекта человек и
   * держит в голове, а путь нужен изредка и точно. Проект может ещё не приехать снимком — тогда до
   * его подхода честнее показать путь, чем пустое место.
   */
  const projectLabel =
    project === undefined
      ? open.summary?.folder
      : project.ephemeral
        ? t("projects.ephemeral")
        : project.name;
  const meta =
    [
      currentModel,
      open.summary?.phase === undefined ? undefined : t(`sessions.phase.${open.summary.phase}`),
    ]
      .filter(Boolean)
      .join(" · ") || undefined;
  const context = useMemo(() => {
    if (projectLabel === undefined) {
      return meta;
    }

    return (
      <>
        <span title={open.summary?.folder}>{projectLabel}</span>
        {meta === undefined ? undefined : ` · ${meta}`}
      </>
    );
  }, [meta, open.summary?.folder, projectLabel]);
  useShellHeader({
    title: open.summary?.title ?? t("sessions.new.title"),
    context,
    actions: headerActions,
  });

  const notices = useMemo(
    () => (
      <>
        {open.failure === undefined ? undefined : (
          <Notice tone="danger" title={t("chat.turn.failed", { reason: open.failure })} />
        )}
        {agentAvailable ? undefined : (
          <Notice
            tone="warning"
            title={t("chat.agent.missing", { agent: open.summary?.agentId ?? "" })}
          />
        )}
        {refusal?.what !== "compact" ? undefined : (
          <Notice tone="danger" title={t("chat.compact.refused", { reason: refusal.reason })} />
        )}
        {open.degradations.map((lost, index) => (
          <Notice
            key={`${lost.kind}:${lost.name}:${String(index)}`}
            tone="warning"
            title={t(`chat.degraded.${lost.kind}`, { name: lost.name })}
          />
        ))}
      </>
    ),
    [agentAvailable, open.degradations, open.failure, open.summary?.agentId, refusal, t],
  );

  const queueBadges = useMemo(
    () =>
      waiting.length === 0 ? undefined : (
        <div className="sessions-queues">
          {waiting.map((text, index) => (
            <Badge key={`${String(index)}:${text}`} tone="accent">
              {text}
            </Badge>
          ))}
        </div>
      ),
    [t, waiting],
  );
  const handleLabelRefusalChange = useCallback((reason: string | undefined): void => {
    setRefusal(reason === undefined ? undefined : { what: "label", reason });
  }, []);

  return (
    <section className="sessions-chat">
      <EntryTreeDrawer
        open={treeOpen}
        onClose={() => setTreeOpen(false)}
        entries={open.entries}
        labels={open.labels}
        {...(open.leafId === undefined ? {} : { leafId: open.leafId })}
        busy={busy}
        archived={archived}
        harnessAvailable={agentAvailable}
        onNavigate={props.onNavigate}
        onSetLabel={onSetLabel}
        onEditorText={(text) => {
          draftReplacementSequence.current += 1;
          setDraftReplacement({
            sessionId: open.id,
            sequence: draftReplacementSequence.current,
            text,
          });
        }}
        translator={translator}
      />

      <SessionMessageList
        className="sessions-chat-scroll"
        before={notices}
        after={queueBadges}
        open={open}
        busy={busy}
        archived={archived}
        onFork={onFork}
        onSetLabel={onSetLabel}
        labelRefusal={refusal?.what === "label" ? refusal.reason : undefined}
        onLabelRefusalChange={handleLabelRefusalChange}
        translator={translator}
      />

      <div className="sessions-chat-bottom">
        {archived ? undefined : (
          <MessageComposer
            sessionId={open.id}
            {...(draftReplacement === undefined ? {} : { draftReplacement })}
            busy={busy}
            disabled={!agentAvailable}
            model={model}
            modelGroups={modelPickerGroups(providers, models, model)}
            onModelChange={prepareModel}
            onExpandModelGroup={onLoadModels}
            thinkingLevel={thinkingLevel}
            reasoningSupported={reasoningSupported}
            onThinkingLevelChange={prepareThinkingLevel}
            onSubmit={onSubmit}
            onSendMessage={onSendMessage}
            onInterrupt={onInterrupt}
            onError={(error: unknown) => {
              onDiagnostic?.(
                `the message composer acceptance failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }}
            context={open.context}
            stats={open.stats}
            translator={translator}
          />
        )}
      </div>

      <ConfirmDialog
        open={compacting && agentAvailable}
        onClose={() => setCompacting(false)}
        title={t("chat.compact.title")}
        description={t("chat.compact.hint")}
        confirmLabel={t("chat.compact.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => void compact()}
        pending={!agentAvailable}
      >
        <Field label={t("chat.compact.instructions")} hint={t("chat.compact.instructions.hint")}>
          {(control) => <Input {...control} value={instructions} onChange={setInstructions} />}
        </Field>
      </ConfirmDialog>
    </section>
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
