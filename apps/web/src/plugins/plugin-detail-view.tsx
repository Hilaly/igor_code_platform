import { useId } from "react";

import {
  corePlace,
  projectOfContribution,
  resolvePlaceProvider,
  type PlacedContributionRegistration,
  type ContributionKind,
  type ContributionRegistration,
  type PlaceCardinality,
  type PluginLifecycleState,
  type PluginOwnedPageRegistration,
  type PluginPreferences,
  type PluginsSnapshot,
  type PluginStatus,
} from "@sovereign/protocol";
import {
  Badge,
  Button,
  Code,
  CodeBlock,
  Disclosure,
  EmptyState,
  Heading,
  Notice,
  SettingsRow,
  Spinner,
  Text,
  Toggle,
  type BadgeTone,
  type ScopedTranslator,
} from "@sovereign/ui-kit";

import { pluginPageAddress, routeAddress, type PluginsState } from "./state.ts";

export type PluginDetailViewProps = {
  headingLevel?: 1 | 2;
  state: PluginsState;
  pluginKey: string;
  onBack: () => void;
  onSwitch: (pluginKey: string, preferences: PluginPreferences) => void;
  /** Открыть страницу плагина. Адрес строит маршрутизатор, а не эта разметка. */
  onOpenPage: (pluginId: string, pageId: string) => void;
  translator: ScopedTranslator;
};

const stateTones: Record<PluginLifecycleState, BadgeTone> = {
  discovered: "neutral",
  disabled: "neutral",
  refused: "danger",
  installing: "accent",
  building: "accent",
  starting: "accent",
  running: "success",
  stopping: "neutral",
  stopped: "neutral",
  failed: "danger",
};

type ContributionEntry = { registration: ContributionRegistration; off: boolean };

/**
 * Порядок разделов списка вкладов: сперва то, что человек видит в интерфейсе, затем то, что плагин
 * даёт агенту, и последней — внутренняя механика, до которой доходят реже всего. Внутри вида порядок
 * прежний, по идентификатору.
 *
 * `Record<ContributionKind, number>` не даёт забыть новый вид: без записи здесь сборка падает, а не
 * теряет вклад из списка молча.
 */
const kindOrder = {
  page: 0,
  component: 1,
  command: 2,
  place: 3,
  "color-scheme": 4,
  "locale-catalog": 5,
  tool: 6,
  agent: 7,
  skill: 8,
  hook: 9,
  event: 10,
  route: 11,
  "public-route": 12,
  custom: 13,
} satisfies Record<ContributionKind, number>;

type ContributionGroup = { kind: ContributionKind; entries: ContributionEntry[] };

/**
 * Чем кончилась заявка компонента на место. Человек, поставивший плагин ради замены вью, обязан
 * увидеть, применён вклад или нет, а если нет — по какой причине: молчаливый отказ выглядит как
 * сломанный плагин.
 */
type PlaceClaimOutcome =
  | "switchedOff"
  | "taken"
  | "free"
  | "overridden"
  | "disputed"
  | "added"
  | "incompatible"
  | "waiting"
  | "project";

type PlaceClaim = {
  registration: PlacedContributionRegistration & { placeId: string };
  outcome: PlaceClaimOutcome;
  holder?: string;
};

const claimTones: Record<PlaceClaimOutcome, "success" | "muted" | "warning"> = {
  switchedOff: "muted",
  taken: "success",
  free: "muted",
  overridden: "warning",
  disputed: "warning",
  added: "success",
  incompatible: "warning",
  waiting: "muted",
  project: "muted",
};

export function PluginDetailView({
  state,
  pluginKey,
  onBack,
  onSwitch,
  onOpenPage,
  translator,
}: PluginDetailViewProps) {
  const { t } = translator;
  // Подпись группы называет её список: имя раздела в дереве доступности берётся из видимого текста,
  // а не дублируется вторым, невидимым.
  const groupLabelId = useId();
  const snapshot = state.snapshot;

  if (snapshot === undefined) {
    return (
      <div className="plugin-detail">
        <Button onClick={onBack}>{t("plugins.detail.back")}</Button>
        {state.stale ? (
          <Notice tone="warning" title={t("plugins.stale.title")}>
            {t("plugins.stale.hint")}
          </Notice>
        ) : undefined}
        {state.failure === undefined ? (
          <Spinner label={t("state.loading")} />
        ) : (
          <Notice tone="danger" title={t("plugins.failed", { reason: state.failure })} />
        )}
      </div>
    );
  }

  const status = snapshot.plugins.find((plugin) => plugin.key === pluginKey);
  if (status === undefined) {
    const authoritative = !state.stale && state.failure === undefined;

    return (
      <div className="plugin-detail">
        <Button onClick={onBack}>{t("plugins.detail.back")}</Button>
        {state.stale ? (
          <Notice tone="warning" title={t("plugins.stale.title")}>
            {t("plugins.stale.hint")}
          </Notice>
        ) : undefined}
        {state.failure === undefined ? undefined : (
          <Notice tone="danger" title={t("plugins.failed", { reason: state.failure })} />
        )}
        {authoritative ? (
          <EmptyState title={t("plugins.detail.notfound", { key: pluginKey })} />
        ) : state.failure === undefined ? (
          <Spinner label={t("state.loading")} />
        ) : undefined}
      </div>
    );
  }

  const preferences = snapshot.enablement[status.key];
  const declared = contributionsFor(snapshot, status);
  const claims = placeClaims(declared, snapshot.contributions, [
    ...snapshot.contributions,
    ...snapshot.switchedOffContributions,
  ]);
  const forgotten = (preferences?.disabledContributions ?? []).filter(
    (id) => !declared.some((entry) => entry.registration.id === id),
  );
  const pages = declared.filter(
    (entry): entry is { registration: PluginOwnedPageRegistration; off: boolean } =>
      entry.registration.kind === "page" && entry.registration.ownership === "plugin",
  );

  const switchContribution = (id: string, on: boolean): void => {
    if (preferences === undefined) return;
    const disabled = preferences.disabledContributions.filter((disabledId) => disabledId !== id);
    onSwitch(status.key, {
      ...preferences,
      disabledContributions: on ? disabled : [...disabled, id],
    });
  };

  return (
    <div className="plugin-detail">
      <div className="plugin-detail-back">
        <Button onClick={onBack}>{t("plugins.detail.back")}</Button>
      </div>

      <div className="plugins-notices">
        {state.stale ? (
          <Notice tone="warning" title={t("plugins.stale.title")}>
            {t("plugins.stale.hint")}
          </Notice>
        ) : undefined}
        {state.failure === undefined ? undefined : (
          <Notice tone="danger" title={t("plugins.write.failed", { reason: state.failure })} />
        )}
      </div>

      <section className="plugin-detail-header-card" aria-label={status.id ?? status.key}>
        <SettingsRow label={status.id ?? status.key} description={<Code>{status.key}</Code>}>
          <Toggle
            checked={preferences?.enabled ?? false}
            disabled={preferences === undefined}
            onChange={(enabled) =>
              preferences === undefined
                ? undefined
                : onSwitch(status.key, { ...preferences, enabled })
            }
            label={t("plugins.toggle.plugin")}
            labelDisplay="tooltip"
            {...(preferences === undefined ? { hint: t("plugins.toggle.unavailable") } : {})}
          />
        </SettingsRow>
      </section>

      <section className="plugin-detail-section" aria-label={t("plugins.detail.plugin")}>
        <Heading level={3}>{t("plugins.detail.plugin")}</Heading>
        <div className="plugin-detail-rows">
          <SettingsRow label={t("plugins.detail.lifecycle")}>
            <Badge tone={stateTones[status.state]}>{t(`plugins.state.${status.state}`)}</Badge>
          </SettingsRow>
          <SettingsRow label={t("plugins.detail.source")}>
            <Text>
              {status.source === "builtin" ? t("plugins.source.builtin") : t("plugins.source.data")}
            </Text>
          </SettingsRow>
          <SettingsRow label={t("plugins.detail.path")}>
            <Code>{status.directory}</Code>
          </SettingsRow>
          {status.attempt === undefined ? undefined : (
            <SettingsRow label={t("plugins.detail.attempt")}>
              <Text>{String(status.attempt)}</Text>
            </SettingsRow>
          )}
        </div>
      </section>

      {status.reason === undefined && status.contributionProblems === undefined ? undefined : (
        <Notice
          tone={status.state === "refused" || status.state === "failed" ? "danger" : "warning"}
          title={status.reason === undefined ? t("plugins.problems.title") : t("plugins.reason")}
        >
          {status.reason === undefined ? (
            <ul className="plugins-reasons">
              {status.contributionProblems?.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : (
            <CodeBlock>{status.reason}</CodeBlock>
          )}
        </Notice>
      )}

      <section
        className="plugin-detail-section"
        aria-label={`${t("plugins.detail.contributions")} · ${declared.length}`}
      >
        <Heading level={3}>
          {t("plugins.detail.contributions")} · {declared.length}
        </Heading>
        {declared.length === 0 ? (
          <Text tone="muted">{t("plugins.contributions.none")}</Text>
        ) : (
          groupsByKind(declared).map(({ kind, entries }) => (
            <div className="plugin-detail-kind" key={kind}>
              {/*
                Вид назван один раз на группу, а не значком в каждой строке: у плагина с десятком
                инструментов повторённая подпись «инструмент» занимала место и ничего не различала.
              */}
              <div className="plugin-detail-kind-label" id={`${groupLabelId}-${kind}`}>
                {t(`plugins.kind.${kind}`)} · {entries.length}
              </div>
              <div
                className="plugin-detail-contributions"
                role="list"
                aria-labelledby={`${groupLabelId}-${kind}`}
              >
                {entries.map(({ registration, off }) => (
                  <div role="listitem" key={registration.id}>
                    <SettingsRow
                      label={registration.title ?? registration.declaredId}
                      description={
                        <div className="plugin-detail-contribution-meta">
                          <Code>{registration.id}</Code>
                          {off ? (
                            <Text tone="warning">{t("plugins.contribution.switchedOff")}</Text>
                          ) : undefined}
                        </div>
                      }
                    >
                      <div className="plugin-detail-contribution-controls">
                        <TechnicalData registration={registration} translator={translator} />
                        <Toggle
                          checked={!off}
                          disabled={preferences === undefined}
                          onChange={(on) => switchContribution(registration.id, on)}
                          label={registration.title ?? registration.declaredId}
                          labelDisplay="tooltip"
                        />
                      </div>
                    </SettingsRow>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {pages.length === 0 ? undefined : (
        <section className="plugin-detail-section" aria-label={t("plugins.pages.title")}>
          <Heading level={3}>{t("plugins.pages.title")}</Heading>
          {/*
            Автоматической записи в левой панели у страницы нет: её кладёт туда сам плагин. Здесь —
            гарантия, что объявленная страница видна и достижима, а не только заявлена.
          */}
          <div className="plugin-detail-rows" role="list">
            {pages.map(({ registration, off }) => (
              <div role="listitem" key={registration.id}>
                <SettingsRow
                  label={registration.title}
                  description={<Code>{pluginPageAddress(registration)}</Code>}
                >
                  {off ? (
                    <Text tone="warning">{t("plugins.contribution.switchedOff")}</Text>
                  ) : (
                    <Button
                      tone="secondary"
                      onClick={() => onOpenPage(registration.pluginId, registration.declaredId)}
                    >
                      {t("plugins.pages.open")}
                    </Button>
                  )}
                </SettingsRow>
              </div>
            ))}
          </div>
        </section>
      )}

      {claims.length === 0 ? undefined : (
        <section className="plugin-detail-section">
          <Heading level={3}>{t("plugins.places.title")}</Heading>
          <div className="plugin-detail-rows" role="list">
            {claims.map(({ registration, outcome, holder }) => (
              <div role="listitem" key={registration.id}>
                <SettingsRow
                  label={registration.placeId}
                  description={<Code>{registration.id}</Code>}
                >
                  <Text tone={claimTones[outcome]}>
                    {t(`plugins.places.${outcome}`, holder === undefined ? undefined : { holder })}
                  </Text>
                </SettingsRow>
              </div>
            ))}
          </div>
        </section>
      )}

      {forgotten.length === 0 ? undefined : (
        <Notice tone="info" title={t("plugins.forgotten.title")}>
          <ul className="plugins-reasons">
            {forgotten.map((id) => (
              <li key={id}>
                <Code>{id}</Code>
              </li>
            ))}
          </ul>
          {t("plugins.forgotten.hint")}
        </Notice>
      )}
    </div>
  );
}

/**
 * Кардинальность места: у мест ядра она в таблице протокола, у места плагина — в его объявлении.
 * Места нет вовсе — вклад ждёт, и это не ошибка (docs/ui-extension-model.md).
 */
function cardinalityOf(
  placeId: string,
  contributions: readonly ContributionRegistration[],
): PlaceCardinality | undefined {
  const declared = contributions.find(
    (registration) => registration.kind === "place" && registration.id === placeId,
  );

  return declared?.kind === "place" ? declared.cardinality : corePlace(placeId)?.cardinality;
}

/**
 * Разрешение считается в оконном контексте: он единственный, который вью настроек про себя знает.
 * Вклад из папки проекта поэтому не судится вовсе — про его место здесь честнее сказать, что оно
 * действует только внутри своего проекта, чем судить его чужой меркой.
 */
function placeClaims(
  declared: ContributionEntry[],
  active: readonly ContributionRegistration[],
  known: readonly ContributionRegistration[],
): PlaceClaim[] {
  return declared
    .filter(
      (
        entry,
      ): entry is ContributionEntry & {
        registration: PlacedContributionRegistration & { placeId: string };
      } =>
        entry.registration.kind === "component" ||
        // Команда без места кнопки не просит: показывать её среди занятых мест нечего.
        (entry.registration.kind === "command" && entry.registration.placeId !== undefined),
    )
    .map(({ registration, off }): PlaceClaim => {
      if (off) {
        return { registration, outcome: "switchedOff" };
      }

      if (projectOfContribution(registration) !== undefined) {
        return { registration, outcome: "project" };
      }

      const cardinality = cardinalityOf(registration.placeId, known);

      if (cardinality === undefined) {
        return { registration, outcome: "waiting" };
      }

      if (registration.kind === "command" && cardinality !== "action") {
        return { registration, outcome: "incompatible" };
      }

      // Команда одиночное место занять не может: у неё нет содержимого, и в полосу действий она
      // становится в ряд наравне с компонентами.
      if (cardinality !== "single" || registration.kind === "command") {
        return { registration, outcome: "added" };
      }

      const resolution = resolvePlaceProvider(registration.placeId, active, {});

      if (resolution.kind === "disputed") {
        return { registration, outcome: "disputed" };
      }

      if (resolution.kind === "built-in") {
        return { registration, outcome: "free" };
      }

      return resolution.contribution.id === registration.id
        ? { registration, outcome: "taken" }
        : { registration, outcome: "overridden", holder: resolution.contribution.id };
    });
}

/**
 * Вклады по видам. Пустой группы не бывает: раздел «Маршруты · 0» сказал бы, что плагин их приносит,
 * а он не приносит.
 */
function groupsByKind(declared: ContributionEntry[]): ContributionGroup[] {
  const kinds = [...new Set(declared.map((entry) => entry.registration.kind))].sort(
    (left, right) => kindOrder[left] - kindOrder[right],
  );

  return kinds.map((kind) => ({
    kind,
    entries: declared.filter((entry) => entry.registration.kind === kind),
  }));
}

function contributionsFor(snapshot: PluginsSnapshot, status: PluginStatus): ContributionEntry[] {
  const mine = (registration: ContributionRegistration): boolean =>
    registration.ownership === "plugin" && registration.pluginKey === status.key;
  return [
    ...snapshot.contributions.filter(mine).map((registration) => ({ registration, off: false })),
    ...snapshot.switchedOffContributions
      .filter(mine)
      .map((registration) => ({ registration, off: true })),
  ].sort((left, right) => left.registration.id.localeCompare(right.registration.id));
}

function TechnicalData({
  registration,
  translator,
}: {
  registration: ContributionRegistration;
  translator: ScopedTranslator;
}) {
  const { t } = translator;
  const data =
    registration.kind === "event"
      ? registration.payloadSchema
      : registration.kind === "custom"
        ? registration.payload
        : registration.kind === "tool"
          ? registration.parameters
          : registration.kind === "hook"
            ? { event: registration.event, criticality: registration.criticality }
            : registration.kind === "route" || registration.kind === "public-route"
              ? // Адрес целиком, а не объявленный путь: по нему маршрут и зовут снаружи.
                {
                  method: registration.method,
                  path: registration.path,
                  url: routeAddress(registration),
                }
              : registration.kind === "skill"
                ? {
                    location: registration.location,
                    disableModelInvocation: registration.disableModelInvocation,
                    metadata: registration.metadata,
                  }
                : registration.kind === "color-scheme"
                  ? registration.scheme
                  : registration.kind === "locale-catalog"
                    ? // Сами сообщения не показываются: сотни строк в блоке кода — шум, а не данные.
                      {
                        namespace: registration.namespace,
                        locale: registration.locale,
                        messages: Object.keys(registration.messages).length,
                      }
                    : registration.kind === "place"
                      ? {
                          cardinality: registration.cardinality,
                          replaceable: registration.replaceable,
                          builtIn: registration.builtIn,
                        }
                      : registration.kind === "component"
                        ? {
                            placeId: registration.placeId,
                            export: registration.export,
                            group: registration.group,
                            order: registration.order,
                          }
                        : registration.kind === "command"
                          ? {
                              export: registration.export,
                              placeId: registration.placeId,
                              group: registration.group,
                              order: registration.order,
                            }
                          : registration.kind === "page"
                            ? { export: registration.export }
                            : {
                                model: registration.model,
                                thinkingLevel: registration.thinkingLevel,
                                tools: registration.tools,
                                skills: registration.skills,
                              };
  if (data === undefined) return undefined;
  return (
    <Disclosure
      summary={
        registration.kind === "event" ? t("plugins.payloadSchema") : t("plugins.detail.technical")
      }
    >
      <CodeBlock>{JSON.stringify(data, undefined, 2) ?? "—"}</CodeBlock>
    </Disclosure>
  );
}
