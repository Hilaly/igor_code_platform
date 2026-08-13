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
  SessionUpdate,
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

import { fetchProjectFiles, type NavigationOutcome } from "./api.ts";
import { carriesImages } from "./image-input.ts";
import { EntryTreeDrawer } from "./entry-tree.tsx";
import { MessageComposer, type ComposerDraftReplacement } from "./message-composer.tsx";
import { modelPickerGroups, selectedModel } from "./model-options.ts";
import { SessionMessageList } from "./session-message-list.tsx";
import type { SlashInvocation } from "./slash-command.ts";
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
  /** Переименовать или убрать в архив. Возвращает причину отказа. */
  onUpdateSession: (update: SessionUpdate) => Promise<string | undefined>;
  onNavigate: (request: SessionNavigateRequest) => Promise<NavigationOutcome>;
  translator: ScopedTranslator;
};

/** Что именно отказались сделать: у каждого действия своё сообщение об отказе. */
type Refusal = { what: "compact" | "label" | "command"; reason: string };

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
    onUpdateSession,
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

  /**
   * Встроенная команда сессии из композера. Ни одна не заводит нового поведения — каждая зовёт то,
   * что панель уже умеет по нажатию, и потому отказ у них тот же самый.
   */
  const runCommand = async (invocation: SlashInvocation): Promise<string | undefined> => {
    if (invocation.name === "compact") {
      return onCompact(invocation.arguments === "" ? undefined : invocation.arguments);
    }

    if (invocation.name === "fork") {
      await onFork({});

      return undefined;
    }

    if (invocation.name === "rename") {
      // Безымянная сессия законна, но снимает имя явная кнопка, а не команда без аргумента: человек,
      // набравший `/rename` и промахнувшийся мимо имени, хотел назвать её, а не обезличить.
      return invocation.arguments === ""
        ? t("chat.slash.rename.empty")
        : onUpdateSession({ title: invocation.arguments, archived: false });
    }

    if (invocation.name === "archive") {
      return onUpdateSession({
        ...(open.summary?.title === undefined ? {} : { title: open.summary.title }),
        archived: true,
      });
    }

    return t("chat.slash.unknown", { name: invocation.name });
  };

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
        {refusal?.what !== "command" ? undefined : (
          <Notice tone="danger" title={t("chat.slash.refused", { reason: refusal.reason })} />
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
          {waiting.map((message, index) => (
            <Badge key={`${String(index)}:${message.text}`} tone="accent">
              {/* Сообщение из одних картинок текста не имеет, и пустой бейдж молчал бы о том, что
                  в очереди вообще что-то стоит. */}
              {message.text === ""
                ? t("chat.queued.images", { count: String(message.images?.length ?? 0) })
                : message.text}
            </Badge>
          ))}
        </div>
      ),
    [t, waiting],
  );
  /**
   * Приём перетащенного отдаёт композер: черновик принадлежит ему, а зона drop — всей панели.
   * Ссылка, а не состояние: смена обработчика не должна перерисовывать ленту.
   */
  /**
   * Поиск файлов для `@файл`. Без проекта его нет вовсе, и подсказка не открывается: искать негде, а
   * `@` остаётся обычным символом.
   */
  const projectId = open.summary?.projectId;
  const searchFiles = useMemo(
    () =>
      projectId === undefined
        ? undefined
        : async (query: string, signal: AbortSignal) => fetchProjectFiles(projectId, query, signal),
    [projectId],
  );
  const acceptDrop = useRef<((transfer: DataTransfer) => void) | undefined>(undefined);
  const takeDropTarget = useCallback((drop: (transfer: DataTransfer) => void): void => {
    acceptDrop.current = drop;
  }, []);
  const handleLabelRefusalChange = useCallback((reason: string | undefined): void => {
    setRefusal(reason === undefined ? undefined : { what: "label", reason });
  }, []);

  return (
    <section
      className="sessions-chat"
      onDragOver={(event) => {
        // Без этого браузер уходит открывать файл вместо того, чтобы отдать его нам.
        if (carriesImages(event.dataTransfer)) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        // Перетащили не картинку — страница ведёт себя как прежде: ломать чужой drop незачем.
        if (!carriesImages(event.dataTransfer)) {
          return;
        }

        event.preventDefault();
        acceptDrop.current?.(event.dataTransfer);
      }}
    >
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
            onDropTarget={takeDropTarget}
            {...(searchFiles === undefined ? {} : { onSearchFiles: searchFiles })}
            {...(open.commands === undefined ? {} : { commands: open.commands })}
            onRunCommand={async (invocation) => {
              const reason = await runCommand(invocation);

              setRefusal(reason === undefined ? undefined : { what: "command", reason });

              return reason;
            }}
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
