/**
 * Экран создания сессии. Прежде был модалом (`new-session-dialog.tsx`), но у модала фиксированная
 * ширина, и список моделей в нём не помещался; адресуемый экран решает и это, и рабочую кнопку «назад»,
 * и перезагрузку (docs/sessions-and-projects.md).
 *
 * Поле провайдера убрано: модель выбирается одной двойной выборкой через `ModelPicker` — провайдер
 * → его модели. Дефолты модели и уровня размышлений берутся из агента, а не захардкожены: агент и
 * есть тот, кто знает свои умолчания. Первый текст уезжает вместе с созданием одним действием
 * человека, но двумя запросами — `POST /sessions`, а затем `POST .../turns`. Контракт от этого не
 * меняется: `SessionDraft` остаётся четырёхполевным, текст в нём не появляется.
 */

import {
  modelReference,
  parseModelReference,
  thinkingLevels,
  type ModelSummary,
  type Project,
  type ProviderSummary,
  type SessionDraft,
  type ThinkingLevel,
} from "@sovereign/protocol";
import {
  Button,
  Field,
  Form,
  Heading,
  Link,
  ModelPicker,
  type ModelPickerGroup,
  Notice,
  Select,
  Spinner,
  Text,
  Textarea,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useEffect, useState } from "react";

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
  onSubmit: (sessionId: string, text: string) => void;
  /** Уйти в открытый чат новой сессии. Зовётся после создания, до отправки турна. */
  onNavigate: (sessionId: string) => void;
  translator: ScopedTranslator;
};

export function NewSessionView(props: NewSessionViewProps) {
  const { projects, projectAgents, providers, models, translator } = props;
  const { t } = translator;

  const [projectId, setProjectId] = useState(props.initialProjectId ?? "");
  const [agentId, setAgentId] = useState("");
  const [modelRef, setModelRef] = useState<string | undefined>(undefined);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  const [firstMessage, setFirstMessage] = useState("");
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

  // Группы для ModelPicker: провайдер → его модели. Опции — составная ссылка `providerId/modelId`,
  // как на проводе; человекочитаемое имя — доп. строкой, чтобы опознать модель по каталогу тоже.
  const groups: ModelPickerGroup[] = (providers ?? []).map((provider) => {
    const entry = models[provider.id];

    return {
      id: provider.id,
      label: provider.name,
      loading: entry?.kind === "loading",
      failureReason: entry?.kind === "failed" ? entry.reason : undefined,
      options:
        entry?.kind === "ready"
          ? entry.models.map((model: ModelSummary) => ({
              value: modelReference(provider.id, model.id),
              label: modelReference(provider.id, model.id),
              description: model.name,
            }))
          : [],
    };
  });

  // Выбранная модель определяет, доступен ли уровень размышлений: модель без reasoning его не
  // примет, и отправить его нельзя. Берём выбранную по ссылке — она одна на весь пикер.
  const parsedRef = modelRef === undefined ? undefined : parseModelReference(modelRef);
  const chosenEntry = parsedRef === undefined ? undefined : models[parsedRef.providerId];
  let chosenModel: ModelSummary | undefined;
  if (chosenEntry?.kind === "ready" && parsedRef !== undefined) {
    chosenModel = chosenEntry.models.find((candidate) => candidate.id === parsedRef.modelId);
  }
  const reasoning = chosenModel === undefined || chosenModel.reasoning;

  // Готовность — проект и агент. Модель НЕ обязательна: у агента может быть дефолт, и тогда демон
  // возьмёт её сам. Первый текст необязателен тоже: создать пустую сессию — законное действие.
  const ready = project !== undefined && agent !== undefined;

  const create = (): void => {
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

        const trimmed = firstMessage.trim();

        if (trimmed !== "") {
          props.onSubmit(outcome.sessionId, trimmed);
        }
      });
  };

  return (
    <section className="new-session" aria-label={t("sessions.new.title")}>
      <header className="new-session-head">
        <Heading level={1}>{t("sessions.new.title")}</Heading>
        <Text>{t("sessions.new.hint")}</Text>
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

      <div className="new-session-form-region">
        <Form onSubmit={create} disabled={!ready || busy}>
          <div className="new-session-form">
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

            {projectId === "" ? (
              <Text tone="muted">{t("sessions.new.agent.disabled")}</Text>
            ) : undefined}

            <ModelPicker
              label={t("sessions.new.model")}
              groups={groups}
              value={modelRef}
              onChange={setModelRef}
              onExpandGroup={props.onPickProvider}
              placeholder={t("common.choose")}
              emptyText={t("state.empty")}
            />

            <Select
              label={t("sessions.new.thinking")}
              value={reasoning ? thinkingLevel : "off"}
              onChange={(value) => setThinkingLevel(value as ThinkingLevel)}
              disabled={!reasoning}
              options={thinkingLevels.map((level) => ({
                value: level,
                label: t(`thinking.${level}`),
              }))}
              placeholder={t("common.choose")}
            />

            <Field label={t("sessions.new.first-message")}>
              {(control) => (
                <Textarea
                  {...control}
                  value={firstMessage}
                  onChange={setFirstMessage}
                  placeholder={t("sessions.new.first-message")}
                  autoGrow
                  rows={3}
                  maxRows={12}
                />
              )}
            </Field>
          </div>

          <div className="new-session-actions">
            <Button type="submit" tone="accent" disabled={!ready} busy={busy}>
              {t("sessions.new.create")}
            </Button>
          </div>
        </Form>
      </div>

      {agent?.description === undefined ? undefined : <Text tone="muted">{agent.description}</Text>}
    </section>
  );
}
