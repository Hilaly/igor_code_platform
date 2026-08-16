/**
 * Редактор алиасов моделей (docs/model-routing.md).
 *
 * Стоит на странице списка провайдеров, а не на странице провайдера `alias`: первого алиаса ещё нет,
 * и провайдера, на страницу которого можно зайти, тоже — заводить его было бы негде.
 *
 * Кандидат вводится ссылкой `providerId/modelId` — той же, что человек видит в списке моделей
 * провайдера. Своего пикера моделей здесь нет: он потребовал бы списка всех моделей всех
 * провайдеров разом, а их больше тысячи ([backlog.md](backlog.md)).
 */

import { modelReference, parseModelReference, type ModelAlias } from "@sovereign/protocol";
import {
  Badge,
  Button,
  Code,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  List,
  ListRow,
  Notice,
  SettingsRow,
  Text,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useState } from "react";

export type AliasEditorProps = {
  aliases: ModelAlias[] | undefined;
  /** Беда с файлом определений: пишущие маршруты по ней отказывают. */
  problem?: string;
  onSave: (alias: ModelAlias, existing: boolean) => Promise<void>;
  onRemove: (aliasId: string) => Promise<void>;
  translator: ScopedTranslator;
};

/** Черновик формы: кандидаты живут строками, пока человек их правит. */
type Draft = { id: string; name: string; candidates: string[]; existing: boolean };

const emptyDraft = (): Draft => ({ id: "", name: "", candidates: [""], existing: false });

const draftOf = (alias: ModelAlias): Draft => ({
  id: alias.id,
  name: alias.name,
  candidates: alias.candidates.map((candidate) =>
    modelReference(candidate.providerId, candidate.modelId),
  ),
  existing: true,
});

export function AliasEditor({ aliases, problem, onSave, onRemove, translator }: AliasEditorProps) {
  const { t } = translator;
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ModelAlias | undefined>(undefined);

  const run = (change: () => Promise<void>, done: () => void): void => {
    setBusy(true);
    setFailure(undefined);
    void change()
      .then(done)
      .catch((cause: unknown) => setFailure(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="providers-detail-rows" aria-label={t("aliases.title")}>
      <SettingsRow
        label={t("aliases.title")}
        description={<Text tone="muted">{t("aliases.hint")}</Text>}
      >
        <div className="providers-access">
          <Button
            tone="accent"
            disabled={busy || problem !== undefined || draft !== undefined}
            onClick={() => setDraft(emptyDraft())}
          >
            {t("aliases.new")}
          </Button>
        </div>
      </SettingsRow>

      {problem === undefined ? undefined : (
        <Notice tone="warning" title={t("aliases.problem")}>
          <Text tone="muted">{problem}</Text>
        </Notice>
      )}
      {failure === undefined ? undefined : <Notice tone="danger" title={failure} />}

      {draft === undefined ? undefined : (
        <AliasForm
          draft={draft}
          busy={busy}
          onChange={setDraft}
          onCancel={() => {
            setDraft(undefined);
            setFailure(undefined);
          }}
          onSubmit={(alias) =>
            run(
              () => onSave(alias, draft.existing),
              () => setDraft(undefined),
            )
          }
          translator={translator}
        />
      )}

      {aliases === undefined || aliases.length === 0 ? (
        problem === undefined ? (
          <EmptyState title={t("aliases.empty")} />
        ) : undefined
      ) : (
        <List>
          {aliases.map((alias) => (
            <ListRow key={alias.id}>
              <div className="providers-key">
                <div className="providers-key-facts">
                  <Text>{alias.name}</Text>
                  <Code>{modelReference("alias", alias.id)}</Code>
                  {alias.candidates.map((candidate) => (
                    <Badge key={`${candidate.providerId}/${candidate.modelId}`} tone="neutral">
                      {modelReference(candidate.providerId, candidate.modelId)}
                    </Badge>
                  ))}
                </div>
                <div className="providers-key-actions">
                  <Button disabled={busy} onClick={() => setDraft(draftOf(alias))}>
                    {t("aliases.edit")}
                  </Button>
                  <Button tone="danger" disabled={busy} onClick={() => setRemoving(alias)}>
                    {t("aliases.remove")}
                  </Button>
                </div>
              </div>
            </ListRow>
          ))}
        </List>
      )}

      <ConfirmDialog
        open={removing !== undefined}
        onClose={() => setRemoving(undefined)}
        title={t("aliases.remove.title", { name: removing?.name ?? "" })}
        description={t("aliases.remove.hint")}
        confirmLabel={t("aliases.remove")}
        cancelLabel={t("providers.user.cancel")}
        destructive
        pending={busy}
        onConfirm={() => {
          const alias = removing;

          if (alias !== undefined) {
            run(
              () => onRemove(alias.id),
              () => setRemoving(undefined),
            );
          }
        }}
      />
    </section>
  );
}

type AliasFormProps = {
  draft: Draft;
  busy: boolean;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSubmit: (alias: ModelAlias) => void;
  translator: ScopedTranslator;
};

function AliasForm({ draft, busy, onChange, onCancel, onSubmit, translator }: AliasFormProps) {
  const { t } = translator;
  const candidates = draft.candidates.map(parseModelReference);
  // Пустая строка — ещё не заполненный кандидат, а не ошибка: ругаться на неё, пока человек печатает,
  // значит ругаться раньше времени.
  const filled = draft.candidates.filter((one) => one.trim() !== "");
  const parsed = filled.map(parseModelReference);
  const ready =
    draft.id.trim() !== "" &&
    draft.name.trim() !== "" &&
    parsed.length > 0 &&
    parsed.every((one) => one !== undefined);

  const move = (index: number, by: number): void => {
    const next = [...draft.candidates];
    const moved = next[index];
    const target = next[index + by];

    if (moved === undefined || target === undefined) {
      return;
    }

    next[index] = target;
    next[index + by] = moved;
    onChange({ ...draft, candidates: next });
  };

  return (
    <div className="provider-form-rows">
      <Field label={t("aliases.id")} hint={t("aliases.id.hint")}>
        {() => (
          <Input
            value={draft.id}
            onChange={(id) => onChange({ ...draft, id })}
            // Идентификатор — часть ссылки на модель в сессиях: менять его у готового алиаса нельзя.
            disabled={busy || draft.existing}
            aria-label={t("aliases.id")}
          />
        )}
      </Field>
      <Field label={t("aliases.name")}>
        {() => (
          <Input
            value={draft.name}
            onChange={(name) => onChange({ ...draft, name })}
            disabled={busy}
            aria-label={t("aliases.name")}
          />
        )}
      </Field>

      <div className="provider-form-section-label">
        <Text>{t("aliases.candidates")}</Text>
        <Text tone="muted">{t("aliases.candidates.hint")}</Text>
      </div>

      {draft.candidates.map((candidate, index) => (
        <div className="providers-key-actions" key={`candidate-${String(index)}`}>
          <Input
            value={candidate}
            onChange={(value) =>
              onChange({
                ...draft,
                candidates: draft.candidates.map((one, at) => (at === index ? value : one)),
              })
            }
            disabled={busy}
            invalid={candidate.trim() !== "" && candidates[index] === undefined}
            placeholder="anthropic/claude-opus-4-5"
            aria-label={t("aliases.candidate", { number: index + 1 })}
          />
          <Button
            disabled={busy || index === 0}
            onClick={() => move(index, -1)}
            aria-label={t("aliases.candidate.up", { number: index + 1 })}
          >
            ↑
          </Button>
          <Button
            disabled={busy || index === draft.candidates.length - 1}
            onClick={() => move(index, 1)}
            aria-label={t("aliases.candidate.down", { number: index + 1 })}
          >
            ↓
          </Button>
          <Button
            disabled={busy || draft.candidates.length === 1}
            onClick={() =>
              onChange({
                ...draft,
                candidates: draft.candidates.filter((_one, at) => at !== index),
              })
            }
            aria-label={t("aliases.candidate.remove", { number: index + 1 })}
          >
            ×
          </Button>
        </div>
      ))}

      <div className="provider-form-actions">
        <Button
          disabled={busy}
          onClick={() => onChange({ ...draft, candidates: [...draft.candidates, ""] })}
        >
          {t("aliases.candidate.add")}
        </Button>
      </div>

      <div className="provider-form-actions">
        <Button
          tone="accent"
          disabled={busy || !ready}
          onClick={() =>
            onSubmit({
              id: draft.id.trim(),
              name: draft.name.trim(),
              candidates: parsed.flatMap((one) =>
                one === undefined ? [] : [{ providerId: one.providerId, modelId: one.modelId }],
              ),
            })
          }
        >
          {t("aliases.save")}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          {t("providers.user.cancel")}
        </Button>
      </div>
    </div>
  );
}
