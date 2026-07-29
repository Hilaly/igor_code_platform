/**
 * Вью провайдеров. Живёт в ядре, как вью проектов и вью плагинов (docs/architecture.md): выбрать
 * модель нужно на пустой платформе, без единого плагина.
 *
 * Своих запросов здесь нет: всё приходит пропами, а раскрытие провайдера уходит наверх. Так вью
 * проверяется без сети — той же дисциплины держатся соседние вью.
 *
 * Кнопок входа здесь нет намеренно: интерактивный вход — операция с диалогом
 * (docs/models-and-providers.md), и приезжает он отдельно. Показаны только объявленные способы
 * входа: кнопка, которая ничего не делает, врёт про возможность.
 */

import type { ModelSummary, ProviderAuthState, ProviderSummary } from "@sovereign/protocol";
import {
  Badge,
  Code,
  CodeBlock,
  EmptyState,
  Heading,
  List,
  ListRow,
  Notice,
  Panel,
  Spinner,
  Text,
  type ScopedTranslator,
} from "@sovereign/ui-kit";

import { configuredCount, type ProviderModelsEntry, type ProvidersState } from "./state.ts";

export type ProvidersViewProps = {
  state: ProvidersState;
  /** Раскрыть или свернуть провайдера. Модели спрашивает владелец состояния, а не вью. */
  onOpen: (providerId: string) => void;
  translator: ScopedTranslator;
};

export function ProvidersView({ state, onOpen, translator }: ProvidersViewProps) {
  const { t } = translator;
  const snapshot = state.snapshot;

  if (snapshot === undefined) {
    return (
      <div className="providers">
        <Heading level={1}>{t("page.providers.title")}</Heading>
        {state.failure === undefined ? (
          <Spinner label={t("state.loading")} />
        ) : (
          <Notice tone="danger" title={t("providers.failed", { reason: state.failure })} />
        )}
      </div>
    );
  }

  const open = snapshot.providers.find((provider) => provider.id === state.openProviderId);

  return (
    <div className="providers">
      <Heading level={1}>{t("page.providers.title")}</Heading>

      {/* Беда с файлом кредов — не отказ маршрута: список приезжает всё равно, а статус у всех
          становится «сказать нечем» (docs/web-api.md). */}
      {snapshot.problem === undefined ? undefined : (
        <Notice tone="warning" title={t("providers.problem.title")}>
          <Text tone="muted">{t("providers.problem.hint")}</Text>
          <CodeBlock>{snapshot.problem}</CodeBlock>
        </Notice>
      )}

      {state.failure === undefined ? undefined : (
        <Notice tone="danger" title={t("providers.failed", { reason: state.failure })} />
      )}

      <Text tone="muted">
        {t("providers.summary", {
          count: configuredCount(snapshot.providers),
          total: snapshot.providers.length,
        })}
      </Text>
      <Text tone="muted">{t("providers.hint")}</Text>

      <Panel>
        {snapshot.providers.length === 0 ? (
          <EmptyState title={t("providers.empty")} />
        ) : (
          <List>
            {snapshot.providers.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                open={provider.id === state.openProviderId}
                onOpen={onOpen}
                translator={translator}
              />
            ))}
          </List>
        )}
      </Panel>

      {open === undefined ? undefined : (
        <ProviderModels provider={open} entry={state.models[open.id]} translator={translator} />
      )}
    </div>
  );
}

type ProviderRowProps = {
  provider: ProviderSummary;
  open: boolean;
  onOpen: (providerId: string) => void;
  translator: ScopedTranslator;
};

function ProviderRow({ provider, open, onOpen, translator }: ProviderRowProps) {
  const { t } = translator;

  // Строка внутри выбираемой строки — это содержимое кнопки, поэтому здесь только `span`:
  // блочные элементы кнопке не принадлежат.
  return (
    <ListRow selected={open} onSelect={() => onOpen(provider.id)}>
      <span className="providers-row">
        <span className="providers-row-facts">
          <Text>{provider.name}</Text>
          <Code>{provider.id}</Code>
          <Text tone="muted">
            {provider.logins.length === 0
              ? t("providers.logins.none")
              : t("providers.logins", {
                  methods: provider.logins.map((login) => login.label).join(", "),
                })}
          </Text>
        </span>

        <span className="providers-row-marks">
          <AuthMark auth={provider.auth} translator={translator} />
          <Text tone="muted">{t("providers.models.count", { count: provider.modelCount })}</Text>
          {provider.dynamic ? <Badge tone="neutral">{t("providers.dynamic")}</Badge> : undefined}
          {provider.custom ? <Badge tone="neutral">{t("providers.custom")}</Badge> : undefined}
        </span>
      </span>
    </ListRow>
  );
}

type AuthMarkProps = {
  auth: ProviderAuthState;
  translator: ScopedTranslator;
};

/**
 * Состояний три, и сводить их к «есть/нет» нельзя: `unknown` значит «файл кредов не читается», а
 * чинится это иначе, чем отсутствие креда (docs/web-api.md).
 */
function AuthMark({ auth, translator }: AuthMarkProps) {
  const { t } = translator;

  if (auth.kind === "configured") {
    return (
      <>
        <Badge tone="success">{t(`providers.auth.${auth.type}`)}</Badge>
        {auth.source === undefined ? undefined : (
          // Кред из окружения тем и виден: выйти из такого провайдера нельзя, и подпись —
          // единственное, по чему человек это поймёт.
          <Text tone="muted">{t("providers.auth.source", { source: auth.source })}</Text>
        )}
      </>
    );
  }

  return (
    <Badge tone={auth.kind === "unknown" ? "warning" : "neutral"}>
      {t(`providers.auth.${auth.kind}`)}
    </Badge>
  );
}

type ProviderModelsProps = {
  provider: ProviderSummary;
  entry: ProviderModelsEntry | undefined;
  translator: ScopedTranslator;
};

function ProviderModels({ provider, entry, translator }: ProviderModelsProps) {
  const { t } = translator;

  return (
    <Panel title={t("providers.models.title", { name: provider.name })}>
      {entry === undefined || entry.kind === "loading" ? (
        <Spinner label={t("state.loading")} />
      ) : entry.kind === "failed" ? (
        <Notice tone="danger" title={t("providers.models.failed", { reason: entry.reason })} />
      ) : entry.models.length === 0 ? (
        <EmptyState title={t("providers.models.empty")} />
      ) : (
        <List>
          {entry.models.map((model) => (
            <ModelRow key={model.id} model={model} translator={translator} />
          ))}
        </List>
      )}
    </Panel>
  );
}

type ModelRowProps = {
  model: ModelSummary;
  translator: ScopedTranslator;
};

function ModelRow({ model, translator }: ModelRowProps) {
  const { t } = translator;

  return (
    <ListRow>
      <div className="providers-model">
        <div className="providers-model-facts">
          <Text>{model.name}</Text>
          <Code>{model.id}</Code>
        </div>

        <div className="providers-model-marks">
          <Text tone="muted">{t("providers.model.context", { count: model.contextWindow })}</Text>
          {/* Цена приходит за миллион токенов — так её считает рантайм. */}
          <Text tone="muted">
            {t("providers.model.cost", { input: model.cost.input, output: model.cost.output })}
          </Text>
        </div>
      </div>
    </ListRow>
  );
}
