/**
 * Вью алиасов моделей (docs/model-routing.md). Свой раздел настроек, а не кусок страницы
 * провайдеров: алиас — не провайдер, входить в него нечем, и стоя посреди каталога он читался как
 * его часть.
 *
 * Своих запросов здесь нет: всё приходит пропами, а нажатия уходят наверх — та же дисциплина, что у
 * соседних вью.
 *
 * Кандидат выбирается пикером моделей, тем же, что стоит в композере: список моделей провайдера
 * спрашивается по раскрытию его группы, потому что всех моделей всех провайдеров больше тысячи и
 * разом их не читает никто.
 */

import {
  aliasProviderId,
  modelReference,
  parseModelReference,
  type ModelAlias,
  type ProviderSummary,
} from "@sovereign/protocol";
import {
  AddIcon,
  Badge,
  Button,
  Code,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  List,
  ListRow,
  ModelPicker,
  Notice,
  Text,
  type ModelPickerGroup,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useMemo, useState } from "react";

import { modelPickerGroups } from "../providers/model-options.ts";
import type { ProviderModelsEntry } from "../providers/state.ts";
import { ShellHeaderActions, useShellHeaderActions } from "../shell/header.tsx";

export type AliasesViewProps = {
  aliases: ModelAlias[] | undefined;
  /** Беда с файлом определений: пишущие маршруты по ней отказывают. */
  problem?: string;
  /** Каталог, из которого выбирается кандидат. `undefined` — снимок ещё не приехал. */
  providers: ProviderSummary[] | undefined;
  models: Record<string, ProviderModelsEntry>;
  /** Раскрыли группу провайдера — спросить его модели. Идемпотентно: повторный зов безвреден. */
  onExpandProvider: (providerId: string) => void;
  onSave: (alias: ModelAlias, existing: boolean) => Promise<void>;
  onRemove: (aliasId: string) => Promise<void>;
  translator: ScopedTranslator;
};

/** Черновик формы: пустой кандидат — ещё не выбранная строка, а не ошибка. */
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

export function AliasesView({
  aliases,
  problem,
  providers,
  models,
  onExpandProvider,
  onSave,
  onRemove,
  translator,
}: AliasesViewProps) {
  const { t } = translator;
  const [draft, setDraft] = useState<Draft | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ModelAlias | undefined>(undefined);

  const editable = !busy && problem === undefined;
  const createAction = useMemo(
    () => [
      {
        id: "create",
        label: t("aliases.new"),
        icon: <AddIcon size="sm" />,
        tone: "accent" as const,
        primary: true,
        disabled: !editable || draft !== undefined,
        expanded: draft !== undefined,
        run: () => setDraft(emptyDraft()),
      },
    ],
    [draft, editable, t],
  );
  const headerOwnsActions = useShellHeaderActions(createAction);

  const run = (change: () => Promise<void>, done: () => void): void => {
    setBusy(true);
    setFailure(undefined);
    void change()
      .then(done)
      .catch((cause: unknown) => setFailure(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <section className="aliases" aria-label={t("aliases.title")}>
      {/* Вне оболочки шапки нет, и действие обязано остаться на самой странице. */}
      {headerOwnsActions ? undefined : (
        <ShellHeaderActions actions={createAction} moreLabel={t("page.actions.more")} />
      )}

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
          providers={providers}
          models={models}
          onExpandProvider={onExpandProvider}
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
              <div className="aliases-row">
                <div className="aliases-facts">
                  <Text>{alias.name}</Text>
                  <Code>{modelReference(aliasProviderId, alias.id)}</Code>
                  {alias.candidates.map((candidate) => (
                    <Badge key={`${candidate.providerId}/${candidate.modelId}`} tone="neutral">
                      {modelReference(candidate.providerId, candidate.modelId)}
                    </Badge>
                  ))}
                </div>
                <div className="aliases-actions">
                  <Button disabled={!editable} onClick={() => setDraft(draftOf(alias))}>
                    {t("aliases.edit")}
                  </Button>
                  <Button tone="danger" disabled={!editable} onClick={() => setRemoving(alias)}>
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
        cancelLabel={t("aliases.cancel")}
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
  providers: ProviderSummary[] | undefined;
  models: Record<string, ProviderModelsEntry>;
  onExpandProvider: (providerId: string) => void;
  onChange: (draft: Draft) => void;
  onCancel: () => void;
  onSubmit: (alias: ModelAlias) => void;
  translator: ScopedTranslator;
};

function AliasForm({
  draft,
  busy,
  providers,
  models,
  onExpandProvider,
  onChange,
  onCancel,
  onSubmit,
  translator,
}: AliasFormProps) {
  const { t } = translator;
  const chosen = draft.candidates.filter((candidate) => candidate !== "");
  const ready = draft.id.trim() !== "" && draft.name.trim() !== "" && chosen.length > 0;

  // Алиас из алиасов запрещён разбором: цикл разорвать нечем (docs/model-routing.md). Поэтому
  // провайдера `alias` в пикере нет вовсе — кнопка, ведущая в отказ, обещала бы не то.
  const catalogue = useMemo(
    () => providers?.filter((provider) => provider.id !== aliasProviderId),
    [providers],
  );

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
    <div className="aliases-form">
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

      <div className="aliases-form-label">
        <Text>{t("aliases.candidates")}</Text>
        <Text tone="muted">{t("aliases.candidates.hint")}</Text>
      </div>

      {draft.candidates.map((candidate, index) => (
        <div className="aliases-candidate" key={`candidate-${String(index)}`}>
          <ModelPicker
            groups={candidateGroups(catalogue, models, candidate, chosen)}
            value={candidate === "" ? undefined : candidate}
            onChange={(value) =>
              onChange({
                ...draft,
                candidates: draft.candidates.map((one, at) => (at === index ? value : one)),
              })
            }
            onExpandGroup={onExpandProvider}
            label={t("aliases.candidate", { number: index + 1 })}
            placeholder={t("common.choose")}
            emptyText={t("state.empty")}
            disabled={busy}
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

      <div className="aliases-form-actions">
        <Button
          disabled={busy}
          onClick={() => onChange({ ...draft, candidates: [...draft.candidates, ""] })}
        >
          {t("aliases.candidate.add")}
        </Button>
      </div>

      <div className="aliases-form-actions">
        <Button
          tone="accent"
          disabled={busy || !ready}
          onClick={() =>
            onSubmit({
              id: draft.id.trim(),
              name: draft.name.trim(),
              candidates: chosen.flatMap((reference) => {
                const parsed = parseModelReference(reference);

                return parsed === undefined
                  ? []
                  : [{ providerId: parsed.providerId, modelId: parsed.modelId }];
              }),
            })
          }
        >
          {t("aliases.save")}
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          {t("aliases.cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Группы пикера для одной строки кандидата. Выбранное в соседних строках выключено: тот же список
 * дважды алиасу не нужен, и разбор такой алиас всё равно отклоняет (docs/model-routing.md).
 */
function candidateGroups(
  providers: ProviderSummary[] | undefined,
  models: Record<string, ProviderModelsEntry>,
  candidate: string,
  chosen: string[],
): ModelPickerGroup[] {
  const taken = new Set(chosen.filter((one) => one !== candidate));

  return modelPickerGroups(providers, models, candidate === "" ? undefined : candidate).map(
    (group) => ({
      ...group,
      options: group.options.map((option) =>
        taken.has(option.value) ? { ...option, disabled: true } : option,
      ),
    }),
  );
}
