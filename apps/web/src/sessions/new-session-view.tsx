/**
 * Экран создания сессии. Прежде был модалом (`new-session-dialog.tsx`), но у модала фиксированная
 * ширина, и список моделей в нём не помещался; адресуемый экран решает и это, и рабочую кнопку «назад»,
 * и перезагрузку (docs/sessions-and-projects.md).
 *
 * Поле провайдера убрано: модель и reasoning выбираются каскадным `NextTurnPicker` композера.
 * Дефолты модели и уровня размышлений берутся из агента, а не захардкожены: агент и
 * есть тот, кто знает свои умолчания. Первый текст уезжает вместе с созданием одним действием
 * человека, но двумя запросами — `POST /sessions`, а затем `POST .../turns`. Контракт от этого не
 * меняется: `SessionDraft` остаётся четырёхполевным, текст в нём не появляется.
 */

import {
  parseModelReference,
  type Project,
  type ProviderSummary,
  type SessionDraft,
  type ThinkingLevel,
  type TurnRequest,
} from "@sovereign/protocol";
import {
  Button,
  Link,
  NextTurnPicker,
  Notice,
  RaisedSurface,
  Select,
  SendIcon,
  Spinner,
  Text,
  Textarea,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useEffect, useState } from "react";

import { modelPickerGroups, selectedModel } from "./model-options.ts";
import type { ModelsEntry } from "./state.ts";
import type { ProjectAgentsState } from "./use-sessions.ts";

export type NewSessionViewProps = {
  projects?: Project[];
  projectAgents: ProjectAgentsState;
  providers?: ProviderSummary[];
  models: Record<string, ModelsEntry>;
  /** Проект из страницы проекта. Прямой адрес формы оставляет выбор пустым. */
  initialProjectId?: string;
  /** Подготовить проекты и провайдеров. Зовётся на mount экрана, как прежде по открытию диалога. */
  onPrepareDraft: () => void;
  onSelectProject: (projectId: string) => void;
  /** Модели одного провайдера. Все сразу не спрашиваем: их больше тысячи (docs/web-api.md). */
  onPickProvider: (providerId: string) => void;
  /** Создать сессию. Возвращает идентификатор новой сессии или причину отказа. */
  onCreate: (draft: SessionDraft) => Promise<{ sessionId: string } | { reason: string }>;
  /** Отправить первый турн в только что созданную сессию. */
  onSubmit: (sessionId: string, request: TurnRequest) => void;
  /** Уйти в открытый чат новой сессии. Зовётся после создания, до отправки турна. */
  onNavigate: (sessionId: string) => void;
  translator: ScopedTranslator;
};

type GreetingKey =
  | "sessions.new.greeting.morning"
  | "sessions.new.greeting.afternoon"
  | "sessions.new.greeting.evening"
  | "sessions.new.greeting.night";

function greetingKey(hour: number): GreetingKey {
  if (hour >= 5 && hour < 12) return "sessions.new.greeting.morning";
  if (hour >= 12 && hour < 18) return "sessions.new.greeting.afternoon";
  if (hour >= 18 && hour < 23) return "sessions.new.greeting.evening";
  return "sessions.new.greeting.night";
}

export function NewSessionView(props: NewSessionViewProps) {
  const { projects, projectAgents, providers, models, translator } = props;
  const { t } = translator;

  const [projectId, setProjectId] = useState(props.initialProjectId ?? "");
  const [agentId, setAgentId] = useState("");
  const [modelRef, setModelRef] = useState<string | undefined>(undefined);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  const [firstMessage, setFirstMessage] = useState("");
  const [greeting] = useState<GreetingKey>(() => greetingKey(new Date().getHours()));
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  // Подготовка черновика — на mount, как раньше по открытию диалога. Данные живут в контроллере
  // сессий и переживают уход с экрана и возврат; запрос на mount лишь гарантирует их наличие.
  useEffect(() => {
    props.onPrepareDraft();

    if (props.initialProjectId !== undefined) {
      props.onSelectProject(props.initialProjectId);
    }

    return () => props.onSelectProject("");
    // Одноразовый: сам `onPrepareDraft` мемоизован контроллером, а зависимость от props избыточна.
  }, []);

  const agents =
    projectAgents.projectId === projectId && !projectAgents.loading
      ? projectAgents.agents
      : undefined;
  const project = projects?.find((candidate) => candidate.id === projectId);

  const pickProject = (id: string): void => {
    setProjectId(id);
    setAgentId("");
    setModelRef(undefined);
    setThinkingLevel("medium");
    setRefusal(undefined);
    props.onSelectProject(id);
  };

  const agent = agents?.find((candidate) => candidate.id === agentId);

  // Снимок проектов меняется на живой системе: архивный, удалённый или ставший недоступным проект
  // исчезает из вариантов. Сбрасываем его через тот же путь, что ручную смену, чтобы контроллер
  // отменил проектный запрос, а зависимые поля не сохранили устаревший черновик.
  useEffect(() => {
    if (projects !== undefined && projectId !== "" && project === undefined) {
      setProjectId("");
      setAgentId("");
      setModelRef(undefined);
      setThinkingLevel("medium");
      setRefusal(undefined);
      props.onSelectProject("");
    }
  }, [project, projectId, projects, props.onSelectProject]);

  // Hot reload вклада может убрать выбранного агента без смены проекта. Зависимые значения тогда
  // уже не принадлежат действующему выбору и не должны оставить черновик готовым к отправке.
  useEffect(() => {
    if (agents !== undefined && agentId !== "" && agent === undefined) {
      setAgentId("");
      setModelRef(undefined);
      setThinkingLevel("medium");
    }
  }, [agent, agentId, agents]);

  // Дефолты берутся из агента в момент его выбора: повторный выбор того же агента их не сбрасывает.
  const pickAgent = (id: string): void => {
    setAgentId(id);

    const chosen = agents?.find((candidate) => candidate.id === id);

    // Умолчания принадлежат выбранному агенту: значения прошлого агента не должны протекать в
    // новый черновик. Если уровень не задан, сохраняется исторический fallback формы `medium`.
    setThinkingLevel(chosen?.thinkingLevel ?? "medium");

    if (chosen?.model !== undefined) {
      const parsed = parseModelReference(chosen.model);

      if (parsed !== undefined) {
        setModelRef(chosen.model);
        props.onPickProvider(parsed.providerId);
        return;
      }
    }

    setModelRef(undefined);
  };

  const groups = modelPickerGroups(providers, models, modelRef);

  // Выбранная модель определяет, доступен ли уровень размышлений: модель без reasoning его не
  // примет, и отправить его нельзя. Берём выбранную по ссылке — она одна на весь пикер.
  const chosenModel = selectedModel(modelRef, models);
  const reasoning = chosenModel === undefined || chosenModel.reasoning;

  // Стартовый экран создаёт разговор только вместе с первым турном. Модель не обязательна: агент
  // может предоставить свой default, который демон применит после создания.
  const ready = project !== undefined && agent !== undefined && firstMessage.trim() !== "";

  const create = (): void => {
    const text = firstMessage.trim();

    if (!ready || busy || text === "") {
      return;
    }

    setBusy(true);
    setRefusal(undefined);

    void props
      .onCreate({
        projectId,
        agentId,
        ...(modelRef === undefined ? {} : { model: modelRef }),
        thinkingLevel: reasoning ? thinkingLevel : "off",
      })
      .then((outcome) => {
        setBusy(false);

        if ("reason" in outcome) {
          setRefusal(outcome.reason);
          return;
        }

        // Сессия создана — уходим в её чат. Первый текст, если он есть, уезжает туда же, но уже
        // турном: контракт `SessionDraft` текст не несёт, и ломать его ради одного экрана не стоит.
        props.onNavigate(outcome.sessionId);

        props.onSubmit(outcome.sessionId, { text });
      });
  };

  return (
    <section className="new-session" aria-label={t("sessions.new.title")}>
      <header className="new-session-greeting" data-testid="new-session-greeting">
        <Text>{t(greeting)}</Text>
      </header>

      {refusal === undefined ? undefined : (
        <Notice tone="danger" title={t("sessions.new.refused", { reason: refusal })} />
      )}

      {projects === undefined || providers === undefined ? (
        <Spinner label={t("state.loading")} />
      ) : undefined}

      {projects?.length === 0 ? (
        <Notice tone="warning" title={t("sessions.new.no-project")} />
      ) : undefined}

      {projectId !== "" && projectAgents.projectId === projectId && projectAgents.loading ? (
        <Spinner label={t("sessions.new.agents.loading")} />
      ) : undefined}

      {projectId !== "" &&
      projectAgents.projectId === projectId &&
      projectAgents.failure !== undefined ? (
        <Notice
          tone="danger"
          title={t("sessions.new.agents.failed", { reason: projectAgents.failure })}
        />
      ) : undefined}

      {projectId !== "" &&
      projectAgents.projectId === projectId &&
      !projectAgents.loading &&
      projectAgents.failure === undefined &&
      agents?.length === 0 ? (
        <Notice
          tone="warning"
          title={t("sessions.new.agents.empty", {
            project: projects?.find(({ id }) => id === projectId)?.name ?? projectId,
          })}
        >
          <Link href="/plugins">{t("nav.plugins")}</Link>
        </Notice>
      ) : undefined}

      {providers?.length === 0 ? (
        <Notice tone="warning" title={t("sessions.new.no-provider")}>
          <Link href="/providers">{t("nav.providers")}</Link>
        </Notice>
      ) : undefined}

      <div className="new-session-project-agent">
        <div className="new-session-project-control">
          <Select
            label={t("sessions.new.project")}
            value={projectId}
            onChange={pickProject}
            options={(projects ?? []).map((project) => ({
              value: project.id,
              label: `${project.name} — ${project.folder}`,
            }))}
            placeholder={t("common.choose")}
          />
        </div>

        <div className="new-session-agent-control">
          <Select
            label={t("sessions.new.agent")}
            value={agentId}
            onChange={pickAgent}
            disabled={
              projectId === "" ||
              projectAgents.projectId !== projectId ||
              projectAgents.loading ||
              projectAgents.failure !== undefined
            }
            options={(agents ?? []).map((candidate) => ({
              value: candidate.id,
              label: candidate.title ?? candidate.id,
            }))}
            placeholder={t("common.choose")}
          />
        </div>
      </div>

      {projectId === "" ? <Text tone="muted">{t("sessions.new.agent.disabled")}</Text> : undefined}

      <div className="new-session-composer">
        <RaisedSurface>
          <div className="sessions-composer">
            <Textarea
              value={firstMessage}
              onChange={setFirstMessage}
              onSubmit={create}
              placeholder={t("chat.compose.placeholder")}
              aria-label={t("chat.compose.label")}
              autoGrow
              rows={2}
              maxRows={12}
              disabled={busy}
            />
            <div className="sessions-composer-toolbar">
              <div className="sessions-composer-actions">
                <NextTurnPicker
                  model={modelRef ?? ""}
                  modelGroups={groups}
                  onModelChange={setModelRef}
                  onExpandModelGroup={props.onPickProvider}
                  thinkingLevel={thinkingLevel}
                  reasoningSupported={reasoning}
                  onThinkingLevelChange={setThinkingLevel}
                  modelLabel={t("sessions.new.model")}
                  reasoningLabel={t("sessions.new.thinking")}
                  triggerLabel={t("chat.nextTurn.settings")}
                  placeholder={t("common.choose")}
                  emptyText={t("state.empty")}
                  translator={translator}
                  disabled={busy}
                />
                <Button
                  iconOnly
                  aria-label={t("chat.send")}
                  onClick={create}
                  tone="secondary"
                  disabled={!ready || busy}
                >
                  <SendIcon />
                </Button>
              </div>
            </div>
          </div>
        </RaisedSurface>
      </div>

      {agent?.description === undefined ? undefined : <Text tone="muted">{agent.description}</Text>}
    </section>
  );
}
