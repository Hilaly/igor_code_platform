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
  LoginKeyTarget,
  ModelSummary,
  ProviderAuthState,
  ProviderAuthType,
  ProviderKeySummary,
  ProviderSummary,
} from "@sovereign/protocol";
import {
  AddIcon,
  Badge,
  Button,
  Code,
  CodeBlock,
  ConfirmDialog,
  EmptyState,
  Input,
  List,
  ListRow,
  Notice,
  SettingsEntityRow,
  SettingsRow,
  Spinner,
  Text,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useMemo, useState, type ReactNode } from "react";

import { ProviderLogin } from "./login-view.tsx";
import { configuredCount, type ProviderModelsEntry, type ProvidersState } from "./state.ts";
import { ShellHeaderActions, useShellHeaderActions } from "../shell/header.tsx";

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
  /** Цель называет ключ, в который ляжет кред: не названа — вход добавит ключ. */
  onLogIn: (providerId: string, method: ProviderAuthType, target?: LoginKeyTarget) => void;
  onAnswer: (providerId: string, stepId: string, value: string) => void;
  onCancelLogin: (providerId: string) => void;
  onCloseLogin: (providerId: string) => void;
  onLogOut: (providerId: string) => void;
  onRenameKey: (providerId: string, keyId: string, label: string) => Promise<void>;
  onSelectKey: (providerId: string, keyId: string) => Promise<void>;
  onRemoveKey: (providerId: string, keyId: string) => Promise<void>;
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
  onRenameKey,
  onSelectKey,
  onRemoveKey,
  translator,
}: ProvidersViewProps) {
  const { t } = translator;
  const snapshot = state.snapshot;

  /**
   * Главное действие каталога стоит в шапке маршрута, как и на странице проектов. На детали одного
   * провайдера его нет: там маршрут занят самим провайдером, и «создать» соседствовало бы с его
   * собственными действиями.
   */
  const createAction = useMemo(
    () => [
      {
        id: "create",
        label: t("providers.user.new"),
        icon: <AddIcon size="sm" />,
        tone: "accent" as const,
        primary: true,
        run: onCreate,
      },
    ],
    [onCreate, t],
  );
  const headerOwnsActions = useShellHeaderActions(
    snapshot === undefined || providerId !== undefined ? undefined : createAction,
  );

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
        <div className="providers-detail-toolbar">
          <Button onClick={onBack}>{t("providers.back")}</Button>
        </div>
        {logins}
        <ProviderHeader
          provider={provider}
          translator={translator}
          actions={
            provider.origin === "user" ? (
              <UserProviderActions
                provider={provider}
                onEdit={onEdit}
                onDelete={onDelete}
                onRefresh={onRefresh}
                translator={translator}
              />
            ) : undefined
          }
        />
        <ProviderAccess
          provider={provider}
          stubborn={state.logins.stubborn[provider.id]}
          busy={state.logins.dialogs[provider.id] !== undefined}
          onLogIn={onLogIn}
          onLogOut={onLogOut}
          translator={translator}
        />
        <ProviderKeys
          provider={provider}
          busy={state.logins.dialogs[provider.id] !== undefined}
          onLogIn={onLogIn}
          onRename={onRenameKey}
          onSelect={onSelectKey}
          onRemove={onRemoveKey}
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
      {/* Вне оболочки шапки нет, и действие обязано остаться на самой странице. */}
      {headerOwnsActions ? undefined : (
        <ShellHeaderActions actions={createAction} moreLabel={t("page.actions.more")} />
      )}

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
      <li>
        <SettingsRow
          label={details.definition.name}
          description={
            <>
              <Code>{details.definition.id}</Code>
              <br />
              <Text tone="muted">{details.conflict}</Text>{" "}
              <Badge tone="warning">{translator.t("providers.user.conflict")}</Badge>
            </>
          }
        >
          <Button tone="danger" disabled={busy} onClick={() => setConfirming(true)}>
            {translator.t("providers.user.delete")}
          </Button>
        </SettingsRow>
      </li>
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
  actions?: ReactNode;
};

/** Шапка страницы провайдера: имя, идентификатор, состояние авторизации. */
function ProviderHeader({ provider, translator, actions }: ProviderHeaderProps) {
  const { t } = translator;

  return (
    <SettingsRow
      label={provider.name}
      description={
        <span className="providers-header-facts">
          <Code>{provider.id}</Code>
          <Text tone="muted">
            {provider.logins.length === 0
              ? t("providers.logins.none")
              : t("providers.logins", {
                  methods: provider.logins.map((login) => login.label).join(", "),
                })}
          </Text>
        </span>
      }
    >
      <div className="providers-header-control">
        <div className="providers-header-marks">
          <AuthMark auth={provider.auth} translator={translator} />
          <Text tone="muted">{t("providers.models.count", { count: provider.modelCount })}</Text>
          {provider.dynamic ? <Badge tone="neutral">{t("providers.dynamic")}</Badge> : undefined}
          {provider.custom ? <Badge tone="neutral">{t("providers.custom")}</Badge> : undefined}
          {provider.origin === "user" ? (
            <Badge tone="neutral">{t("providers.user.badge")}</Badge>
          ) : undefined}
        </div>
        {actions}
      </div>
    </SettingsRow>
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
    <section
      className="providers-detail-rows"
      aria-label={t("providers.access.title", { name: provider.name })}
    >
      <SettingsRow label={t("providers.access.title", { name: provider.name })}>
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
      </SettingsRow>

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

type ProviderKeysProps = {
  provider: ProviderSummary;
  /** Вход в этого провайдера уже идёт: второй отклоняется маршрутом (docs/web-api.md). */
  busy: boolean;
  onLogIn: (providerId: string, method: ProviderAuthType, target?: LoginKeyTarget) => void;
  onRename: (providerId: string, keyId: string, label: string) => Promise<void>;
  onSelect: (providerId: string, keyId: string) => Promise<void>;
  onRemove: (providerId: string, keyId: string) => Promise<void>;
  translator: ScopedTranslator;
};

/**
 * Ключи провайдера. Секции нет вовсе у провайдера без сохранённых ключей: кред из окружения ключом
 * не является, и пустой список рядом с настроенным провайдером читался бы как поломка.
 */
function ProviderKeys({
  provider,
  busy,
  onLogIn,
  onRename,
  onSelect,
  onRemove,
  translator,
}: ProviderKeysProps) {
  const { t } = translator;

  if (provider.keys.length === 0) {
    return undefined;
  }

  return (
    <section
      className="providers-detail-rows"
      aria-label={t("providers.keys.title", { name: provider.name })}
    >
      <SettingsRow
        label={t("providers.keys.title", { name: provider.name })}
        description={<Text tone="muted">{t("providers.keys.hint")}</Text>}
      >
        <List>
          {provider.keys.map((key) => (
            <ProviderKeyRow
              key={key.id}
              providerId={provider.id}
              providerKey={key}
              selected={key.id === provider.selectedKey}
              logins={provider.logins}
              busy={busy}
              onLogIn={onLogIn}
              onRename={onRename}
              onSelect={onSelect}
              onRemove={onRemove}
              translator={translator}
            />
          ))}
        </List>
      </SettingsRow>
    </section>
  );
}

type ProviderKeyRowProps = {
  providerId: string;
  providerKey: ProviderKeySummary;
  selected: boolean;
  logins: ProviderSummary["logins"];
  busy: boolean;
  onLogIn: (providerId: string, method: ProviderAuthType, target?: LoginKeyTarget) => void;
  onRename: (providerId: string, keyId: string, label: string) => Promise<void>;
  onSelect: (providerId: string, keyId: string) => Promise<void>;
  onRemove: (providerId: string, keyId: string) => Promise<void>;
  translator: ScopedTranslator;
};

function ProviderKeyRow({
  providerId,
  providerKey,
  selected,
  logins,
  busy,
  onLogIn,
  onRename,
  onSelect,
  onRemove,
  translator,
}: ProviderKeyRowProps) {
  const { t } = translator;
  const [renaming, setRenaming] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const name = providerKey.label === "" ? t("providers.key.unnamed") : providerKey.label;
  /**
   * Заменить кред можно только тем же способом, каким он заведён: у ключа api_key нет OAuth-шагов, и
   * кнопка, ведущая в чужой диалог, обещала бы не то.
   */
  const replaceWith = logins.find((login) => login.type === providerKey.type);

  const run = (change: () => Promise<void>): void => {
    setPending(true);
    void change()
      .catch(() => undefined)
      .finally(() => setPending(false));
  };

  return (
    <ListRow>
      <div className="providers-key">
        <div className="providers-key-facts">
          <Text>{name}</Text>
          <Code>{providerKey.id}</Code>
          {providerKey.type === undefined ? (
            // Кред правили руками и разобрать его не вышло. Ключ из списка не пропадает: иначе
            // чинить было бы нечего (docs/models-and-providers.md).
            <Badge tone="warning">{t("providers.key.unreadable")}</Badge>
          ) : (
            <Badge tone="neutral">{t(`providers.auth.${providerKey.type}`)}</Badge>
          )}
          {selected ? <Badge tone="success">{t("providers.key.selected")}</Badge> : undefined}
        </div>

        {renaming === undefined ? (
          <div className="providers-key-actions">
            {selected ? undefined : (
              <Button
                disabled={pending}
                onClick={() => run(() => onSelect(providerId, providerKey.id))}
              >
                {t("providers.key.select")}
              </Button>
            )}
            <Button disabled={pending} onClick={() => setRenaming(providerKey.label)}>
              {t("providers.key.rename")}
            </Button>
            {replaceWith === undefined ? undefined : (
              <Button
                disabled={busy || pending}
                onClick={() =>
                  onLogIn(providerId, replaceWith.type, {
                    kind: "existing",
                    keyId: providerKey.id,
                  })
                }
              >
                {t("providers.key.replace")}
              </Button>
            )}
            <Button tone="danger" disabled={pending} onClick={() => setConfirming(true)}>
              {t("providers.key.remove")}
            </Button>
          </div>
        ) : (
          <div className="providers-key-actions">
            <Input
              value={renaming}
              onChange={setRenaming}
              disabled={pending}
              aria-label={t("providers.key.rename.label", { id: providerKey.id })}
            />
            <Button
              tone="accent"
              disabled={pending}
              onClick={() =>
                run(() =>
                  onRename(providerId, providerKey.id, renaming).then(() => setRenaming(undefined)),
                )
              }
            >
              {t("providers.key.rename.save")}
            </Button>
            <Button disabled={pending} onClick={() => setRenaming(undefined)}>
              {t("providers.key.rename.cancel")}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("providers.key.remove.title", { name })}
        description={t("providers.key.remove.hint")}
        confirmLabel={t("providers.key.remove")}
        cancelLabel={t("providers.user.cancel")}
        destructive
        pending={pending}
        onConfirm={() =>
          run(() => onRemove(providerId, providerKey.id).then(() => setConfirming(false)))
        }
      />
    </ListRow>
  );
}

type ProviderRowProps = {
  provider: ProviderSummary;
  onSelect: () => void;
  translator: ScopedTranslator;
};

function ProviderRow({ provider, onSelect, translator }: ProviderRowProps) {
  const { t } = translator;

  return (
    <li>
      <SettingsEntityRow
        label={provider.name}
        description={
          <>
            <Code>{provider.id}</Code>
            <br />
            <Text tone="muted">
              {provider.logins.length === 0
                ? t("providers.logins.none")
                : t("providers.logins", {
                    methods: provider.logins.map((login) => login.label).join(", "),
                  })}
            </Text>
          </>
        }
        meta={
          <>
            <AuthMark auth={provider.auth} translator={translator} />
            <Text tone="muted">{t("providers.models.count", { count: provider.modelCount })}</Text>
            {provider.dynamic ? <Badge tone="neutral">{t("providers.dynamic")}</Badge> : undefined}
            {provider.custom ? <Badge tone="neutral">{t("providers.custom")}</Badge> : undefined}
          </>
        }
        onSelect={onSelect}
        selectLabel={t("providers.open", { name: provider.name })}
      />
    </li>
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
    <section
      className="providers-detail-rows"
      aria-label={t("providers.models.title", { name: provider.name })}
    >
      <SettingsRow label={t("providers.models.title", { name: provider.name })}>
        <div className="providers-models-control">
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
        </div>
      </SettingsRow>
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
