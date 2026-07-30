/**
 * Диалог создания сессии. Четыре поля черновика — проект, агент, модель, уровень размышлений —
 * спрашиваются целиком: модель и уровень у агента бывают не заданы, и отказ «у агента нет модели по
 * умолчанию» вылезал бы после нажатия, а не до (docs/web-api.md).
 *
 * Модель выбирается каскадом провайдер → модель: моделей на все провайдеры больше тысячи, и
 * спрашиваются они по одному провайдеру.
 */

import {
  modelReference,
  thinkingLevels,
  type AgentSummary,
  type ModelSummary,
  type Project,
  type ProviderSummary,
  type SessionDraft,
  type ThinkingLevel,
} from "@sovereign/protocol";
import {
  Button,
  Combobox,
  Dialog,
  Link,
  Notice,
  Select,
  Spinner,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useState } from "react";

import type { ModelsEntry } from "./state.ts";

export type NewSessionDialogProps = {
  open: boolean;
  projects?: Project[];
  agents?: AgentSummary[];
  providers?: ProviderSummary[];
  models: Record<string, ModelsEntry>;
  onPickProvider: (providerId: string) => void;
  onCreate: (draft: SessionDraft) => Promise<string | undefined>;
  onClose: () => void;
  translator: ScopedTranslator;
};

export function NewSessionDialog(props: NewSessionDialogProps) {
  const { open, projects, agents, providers, models, translator } = props;
  const { t } = translator;

  const [projectId, setProjectId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const entry = models[providerId];
  const known: ModelSummary[] = entry?.kind === "ready" ? entry.models : [];
  const model = known.find(({ id }) => id === modelId);
  // Модель без размышлений не принимает уровень: показывать выбор, который ничего не значит, нельзя.
  const reasoning = model === undefined || model.reasoning;
  const ready = projectId !== "" && agentId !== "" && providerId !== "" && modelId !== "";

  const pickProvider = (picked: string): void => {
    setProviderId(picked);
    setModelId("");
    props.onPickProvider(picked);
  };

  const create = (): void => {
    setBusy(true);

    void props
      .onCreate({
        projectId,
        agentId,
        model: modelReference(providerId, modelId),
        thinkingLevel: reasoning ? thinkingLevel : "off",
      })
      .then((reason) => {
        setBusy(false);
        setRefusal(reason);
      });
  };

  return (
    <Dialog
      open={open}
      onClose={props.onClose}
      title={t("sessions.new")}
      footer={
        <>
          <Button onClick={props.onClose}>{t("common.cancel")}</Button>
          <Button tone="accent" onClick={create} disabled={!ready} busy={busy}>
            {t("sessions.new.create")}
          </Button>
        </>
      }
    >
      <div className="sessions-form">
        {refusal === undefined ? undefined : (
          <Notice tone="danger" title={t("sessions.new.refused", { reason: refusal })} />
        )}

        {projects === undefined || agents === undefined || providers === undefined ? (
          <Spinner label={t("state.loading")} />
        ) : undefined}

        {projects?.length === 0 ? (
          <Notice tone="warning" title={t("sessions.new.no-project")} />
        ) : undefined}

        {agents?.length === 0 ? (
          <Notice tone="warning" title={t("sessions.new.no-agent")}>
            <Link href="/plugins">{t("nav.plugins")}</Link>
          </Notice>
        ) : undefined}

        {providers?.length === 0 ? (
          <Notice tone="warning" title={t("sessions.new.no-provider")}>
            <Link href="/providers">{t("nav.providers")}</Link>
          </Notice>
        ) : undefined}

        {/* Обвязки `Field` здесь нет: `Select` рисует подпись сам, и вторая была бы дубликатом. */}
        <Select
          label={t("sessions.new.project")}
          value={projectId}
          onChange={setProjectId}
          options={(projects ?? []).map((project) => ({
            value: project.id,
            label: `${project.name} — ${project.folder}`,
          }))}
        />

        <Select
          label={t("sessions.new.agent")}
          value={agentId}
          onChange={setAgentId}
          options={(agents ?? []).map((agent) => ({
            value: agent.id,
            label: agent.title ?? agent.id,
          }))}
        />

        <Select
          label={t("sessions.new.provider")}
          value={providerId}
          onChange={pickProvider}
          options={(providers ?? []).map((provider) => ({
            value: provider.id,
            label: provider.name,
          }))}
        />

        {entry?.kind === "failed" ? (
          <Notice tone="danger" title={t("sessions.new.models.failed", { reason: entry.reason })} />
        ) : undefined}

        {/* У `Combobox` подпись только для скринридера, поэтому видимая стоит рядом. */}
        <div className="sessions-form-field">
          <span className="sessions-form-label">{t("sessions.new.model")}</span>
          <Combobox
            label={t("sessions.new.model")}
            value={modelId}
            onChange={setModelId}
            disabled={entry?.kind !== "ready"}
            emptyText={t("state.empty")}
            options={known.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
          />
        </div>

        <Select
          label={t("sessions.new.thinking")}
          value={reasoning ? thinkingLevel : "off"}
          onChange={(value) => setThinkingLevel(value as ThinkingLevel)}
          disabled={!reasoning}
          options={thinkingLevels.map((level) => ({
            value: level,
            label: t(`thinking.${level}`),
          }))}
        />
      </div>
    </Dialog>
  );
}
