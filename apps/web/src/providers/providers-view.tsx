/**
 * Вью провайдеров. Живёт в ядре, как вью проектов и вью плагинов (docs/architecture.md): выбрать
 * модель нужно на пустой платформе, без единого плагина.
 *
 * Своих запросов здесь нет: всё приходит пропами, а нажатия уходят наверх. Так вью проверяется без
 * сети — той же дисциплины держатся соседние вью.
 *
 * Два режима по адресу: голый `/providers` — список карточек; `/providers/<id>` — страница одного
 * провайдера, где вход и модели живут. Вход спрятан в панель списка раньше, и жест раскрытия строки
 * не срабатывал; теперь карточка целиком уводит на страницу (docs/models-and-providers.md).
 *
 * Кнопки входа показаны только на объявленные провайдером способы (`logins`): кнопка, которая
 * ничего не делает, врёт про возможность. Сам диалог входа рисует `login-view.tsx`.
 */

import { modelReference } from "@sovereign/protocol";
import type {
  ModelSummary,
  ProviderAuthState,
  ProviderAuthType,
  ProviderSummary,
} from "@sovereign/protocol";
import {
  Badge,
  Button,
  Code,
  CodeBlock,
  ConfirmDialog,
  EmptyState,
  Heading,
  List,
  ListRow,
  Notice,
  Spinner,
  Text,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useState } from "react";

import { ProviderLogin } from "./login-view.tsx";
import { configuredCount, type ProviderModelsEntry, type ProvidersState } from "./state.ts";

export type ProvidersViewProps = {
  /** Внутри страницы настроек заголовок раздела уже `h1`; самостоятельное вью по умолчанию владеет им. */
  headingLevel?: 1 | 2;
  state: ProvidersState;
  /** Какой провайдер открыт страницей. `undefined` — список. Источник истины — адрес. */
  providerId: string | undefined;
  /** Клик по карточке в списке — переход на страницу провайдера. */
  onOpen: (providerId: string) => void;
  onCreate: () => void;
  onEdit: (providerId: string) => void;
  onDelete: (providerId: string) => Promise<void>;
  onRefresh: (providerId: string) => Promise<void>;
  actionFailure?: string;
  /** «← все провайдера» со страницы деталей — назад к списку. */
  onBack: () => void;
  onLogIn: (providerId: string, method: ProviderAuthType) => void;
  onAnswer: (providerId: string, stepId: string, value: string) => void;
  onCancelLogin: (providerId: string) => void;
  onCloseLogin: (providerId: string) => void;
  onLogOut: (providerId: string) => void;
  translator: ScopedTranslator;
};

export function ProvidersView({
  state,
  providerId,
  onOpen,
  onCreate,
  onEdit,
  onDelete,
  onRefresh,
  actionFailure,
  onBack,
  onLogIn,
  onAnswer,
  onCancelLogin,
  onCloseLogin,
  onLogOut,
  translator,
}: ProvidersViewProps) {
  const { t } = translator;
  const snapshot = state.snapshot;
  const conflictingUserProviders =
    state.userProviders?.providers.filter(
      (details) =>
        details.conflict !== undefined &&
        !snapshot?.providers.some((provider) => provider.id === details.definition.id),
    ) ?? [];
  const dialogs = Object.entries(state.logins.dialogs);
  /** Имя провайдера из снимка; провайдера может там и не быть — тогда говорит идентификатор. */
  const nameOf = (providerId: string): string =>
    snapshot?.providers.find((provider) => provider.id === providerId)?.name ?? providerId;

  // Диалоги показываются раньше списка и независимо от него: вход мог начаться до того, как список
  // приехал, а бросить наполовину пройденный диалог из-за отказа чужого запроса нельзя.
  const logins = (
    <>
      {state.logins.failure === undefined ? undefined : (
        <Notice
          tone="danger"
          title={t("providers.login.start.failed", { reason: state.logins.failure })}
        />
      )}
      {dialogs.map(([dialogProviderId, dialog]) => (
        <ProviderLogin
          key={dialogProviderId}
          providerId={dialogProviderId}
          name={nameOf(dialogProviderId)}
          dialog={dialog}
          onAnswer={onAnswer}
          onCancel={onCancelLogin}
          onClose={onCloseLogin}
          translator={translator}
        />
      ))}
    </>
  );

  if (snapshot === undefined) {
    return (
      <div className="providers">
        {logins}
        {actionFailure ? <Notice tone="danger" title={actionFailure} /> : undefined}
        {state.failure === undefined ? (
          <Spinner label={t("state.loading")} />
        ) : (
          <Notice tone="danger" title={t("providers.failed", { reason: state.failure })} />
        )}
      </div>
    );
  }

  // Страница одного провайдера: список исчезает, детали получают всё место. Адрес — источник
  // истины, поэтому провайдер ищется в снимке, а отдельного поля «раскрыт» в состоянии нет.
  if (providerId !== undefined) {
    const provider = snapshot.providers.find((candidate) => candidate.id === providerId);

    if (provider === undefined) {
      // Идентификатор не валидируется форматом маршрута — «нет такого» говорит вью по снимку:
      // провайдер мог исчезнуть в новой версии рантайма, и мягкое «нет такого» с возвратом к списку
      // честнее, чем страница «неизвестный адрес».
      return (
        <div className="providers">
          {logins}
          <Button onClick={onBack}>{t("providers.back")}</Button>
          <EmptyState title={t("providers.notfound", { id: providerId })} />
        </div>
      );
    }

    return (
      <div className="providers">
        <Button onClick={onBack}>{t("providers.back")}</Button>
        <Text>{provider.name}</Text>
        {logins}
        <ProviderHeader provider={provider} translator={translator} />
        {provider.origin === "user" ? (
          <UserProviderActions
            provider={provider}
            onEdit={onEdit}
            onDelete={onDelete}
            onRefresh={onRefresh}
            translator={translator}
          />
        ) : undefined}
        <ProviderAccess
          provider={provider}
          stubborn={state.logins.stubborn[provider.id]}
          busy={state.logins.dialogs[provider.id] !== undefined}
          onLogIn={onLogIn}
          onLogOut={onLogOut}
          translator={translator}
        />
        <ProviderModels
          provider={provider}
          entry={state.models[provider.id]}
          translator={translator}
        />
      </div>
    );
  }

  return (
    <div className="providers">
      <Button tone="accent" onClick={onCreate}>
        + {t("providers.user.new")}
      </Button>

      {/* Беда с файлом кредов — не отказ маршрута: список приезжает всё равно, а статус у всех
          становится «сказать нечем» (docs/web-api.md). */}
      {snapshot.problem === undefined ? undefined : (
        <Notice tone="warning" title={t("providers.problem.title")}>
          <Text tone="muted">{t("providers.problem.hint")}</Text>
          <CodeBlock>{snapshot.problem}</CodeBlock>
        </Notice>
      )}
      {state.userProviders?.problem === undefined ? undefined : (
        <Notice tone="warning" title={t("providers.user.problem.title")}>
          <CodeBlock>{state.userProviders.problem}</CodeBlock>
        </Notice>
      )}

      {state.failure === undefined ? undefined : (
        <Notice tone="danger" title={t("providers.failed", { reason: state.failure })} />
      )}
      {actionFailure ? <Notice tone="danger" title={actionFailure} /> : undefined}

      {logins}

      <Text tone="muted">
        {t("providers.summary", {
          count: configuredCount(snapshot.providers),
          total: snapshot.providers.length,
        })}
      </Text>
      <Text tone="muted">{t("providers.hint")}</Text>

      {snapshot.providers.length === 0 && conflictingUserProviders.length === 0 ? (
        <EmptyState title={t("providers.empty")} />
      ) : (
        <List>
          {snapshot.providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              translator={translator}
              onSelect={() => onOpen(provider.id)}
            />
          ))}
          {conflictingUserProviders.map((details) => (
            <ConflictingUserProviderRow
              key={details.definition.id}
              details={details}
              onDelete={onDelete}
              translator={translator}
            />
          ))}
        </List>
      )}
    </div>
  );
}

function ConflictingUserProviderRow({
  details,
  onDelete,
  translator,
}: {
  details: import("@sovereign/protocol").UserProviderDetails;
  onDelete: (id: string) => Promise<void>;
  translator: ScopedTranslator;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <ListRow
        actions={
          <Button tone="danger" disabled={busy} onClick={() => setConfirming(true)}>
            {translator.t("providers.user.delete")}
          </Button>
        }
      >
        <span className="providers-row">
          <span className="providers-row-facts">
            <Text>{details.definition.name}</Text>
            <Code>{details.definition.id}</Code>
            <Text tone="muted">{details.conflict}</Text>
          </span>
          <Badge tone="warning">{translator.t("providers.user.conflict")}</Badge>
        </span>
      </ListRow>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={translator.t("providers.user.delete.title", { name: details.definition.name })}
        description={translator.t("providers.user.delete.hint")}
        confirmLabel={translator.t("providers.user.delete")}
        cancelLabel={translator.t("providers.user.cancel")}
        destructive
        pending={busy}
        onConfirm={() => {
          setBusy(true);
          void onDelete(details.definition.id)
            .then(() => setConfirming(false))
            .catch(() => undefined)
            .finally(() => setBusy(false));
        }}
      />
    </>
  );
}

function UserProviderActions({
  provider,
  onEdit,
  onDelete,
  onRefresh,
  translator,
}: {
  provider: ProviderSummary;
  onEdit: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onRefresh: (id: string) => Promise<void>;
  translator: ScopedTranslator;
}) {
  const { t } = translator;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="providers-actions">
      <Button onClick={() => onEdit(provider.id)}>{t("providers.user.edit.action")}</Button>
      {provider.dynamic ? (
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onRefresh(provider.id)
              .catch(() => undefined)
              .finally(() => setBusy(false));
          }}
        >
          {t("providers.user.refresh")}
        </Button>
      ) : undefined}
      <Button tone="danger" onClick={() => setConfirming(true)}>
        {t("providers.user.delete")}
      </Button>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("providers.user.delete.title", { name: provider.name })}
        description={t("providers.user.delete.hint")}
        confirmLabel={t("providers.user.delete")}
        cancelLabel={t("providers.user.cancel")}
        destructive
        pending={busy}
        onConfirm={() => {
          setBusy(true);
          void onDelete(provider.id)
            .then(() => setConfirming(false))
            .catch(() => undefined)
            .finally(() => setBusy(false));
        }}
      />
    </div>
  );
}

type ProviderHeaderProps = {
  provider: ProviderSummary;
  translator: ScopedTranslator;
};

/** Шапка страницы провайдера: имя, идентификатор, состояние авторизации. */
function ProviderHeader({ provider, translator }: ProviderHeaderProps) {
  const { t } = translator;

  return (
    <div className="providers-header">
      <div className="providers-header-facts">
        <Code>{provider.id}</Code>
        <Text tone="muted">
          {provider.logins.length === 0
            ? t("providers.logins.none")
            : t("providers.logins", {
                methods: provider.logins.map((login) => login.label).join(", "),
              })}
        </Text>
      </div>
      <div className="providers-header-marks">
        <AuthMark auth={provider.auth} translator={translator} />
        <Text tone="muted">{t("providers.models.count", { count: provider.modelCount })}</Text>
        {provider.dynamic ? <Badge tone="neutral">{t("providers.dynamic")}</Badge> : undefined}
        {provider.custom ? <Badge tone="neutral">{t("providers.custom")}</Badge> : undefined}
        {provider.origin === "user" ? (
          <Badge tone="neutral">{t("providers.user.badge")}</Badge>
        ) : undefined}
      </div>
    </div>
  );
}

type ProviderAccessProps = {
  provider: ProviderSummary;
  /** Выход по этому провайдеру уже нажимали, и он ничего не изменил. */
  stubborn: { source?: string } | undefined;
  /** Вход в этого провайдера уже идёт: второй отклоняется маршрутом (docs/web-api.md). */
  busy: boolean;
  onLogIn: (providerId: string, method: ProviderAuthType) => void;
  onLogOut: (providerId: string) => void;
  translator: ScopedTranslator;
};

/**
 * Вход и выход на странице провайдера. Раньше кнопки стояли в раскрывающейся панели под строкой
 * списка, и жест раскрытия не срабатывал; теперь у них своя страница (docs/models-and-providers.md).
 */
function ProviderAccess({
  provider,
  stubborn,
  busy,
  onLogIn,
  onLogOut,
  translator,
}: ProviderAccessProps) {
  const { t } = translator;

  return (
    <section className="providers-section">
      <Heading level={3}>{t("providers.access.title", { name: provider.name })}</Heading>
      <div className="providers-access">
        {provider.logins.length === 0 ? (
          <Text tone="muted">{t("providers.logins.none")}</Text>
        ) : (
          provider.logins.map((login) => (
            <Button
              key={login.type}
              tone="accent"
              disabled={busy}
              onClick={() => onLogIn(provider.id, login.type)}
            >
              {login.label}
            </Button>
          ))
        )}

        {provider.auth.kind === "configured" ? (
          <Button tone="danger" onClick={() => onLogOut(provider.id)}>
            {t("providers.logout")}
          </Button>
        ) : undefined}
      </div>

      {stubborn === undefined ? undefined : (
        // Ловушка «нажал выход, ничего не изменилось»: кред из окружения платформе не принадлежит, и
        // убрать его нечем (docs/web-api.md).
        <Notice tone="warning" title={t("providers.logout.stubborn")}>
          <Text tone="muted">
            {stubborn.source === undefined
              ? t("providers.logout.stubborn.hint")
              : t("providers.logout.stubborn.source", { source: stubborn.source })}
          </Text>
        </Notice>
      )}
    </section>
  );
}

type ProviderRowProps = {
  provider: ProviderSummary;
  onSelect: () => void;
  translator: ScopedTranslator;
};

function ProviderRow({ provider, onSelect, translator }: ProviderRowProps) {
  const { t } = translator;

  // Строка внутри выбираемой строки — это содержимое кнопки, поэтому здесь только `span`:
  // блочные элементы кнопке не принадлежат.
  return (
    <ListRow onSelect={onSelect}>
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
    <section className="providers-section">
      <Heading level={3}>{t("providers.models.title", { name: provider.name })}</Heading>
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
    </section>
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
          <Code>{modelReference(model.providerId, model.id)}</Code>
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
