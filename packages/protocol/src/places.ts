/**
 * Места базовой поставки и правило, по которому место занимает провайдер
 * (docs/ui-extension-model.md).
 *
 * Разрешение живёт в протоколе, а не в браузере, хотя считается именно там: правило одно, а
 * спрашивающих про него будет больше одного — вью плагинов показывает человеку тот же ответ, что
 * рисует место. Разъехавшись, они объясняли бы разное про одно и то же.
 *
 * Демон это разрешение не считает вовсе. Контекст — какой проект сейчас открыт — знает только
 * браузер, а снимок `/api/plugins` один на всё окно и перечисляет объявления всех контекстов сразу.
 */

import {
  projectOfContribution,
  type ComponentContributionRegistration,
  type ContributionRegistration,
  type PlaceContributionRegistration,
  type PlaceCardinality,
} from "./contribution.ts";
import { pluginSourceRank } from "./plugin.ts";

/**
 * Контекст, в котором рисуется место. Нарочно маленький и не повторяющий пропсы вью базовой
 * поставки: пропсы — внутреннее дело `apps/web`, и объявить их публичными значило бы заморозить их
 * форму, тогда как плагин получает данные публичными сервисами.
 *
 * `project` и `subject` разделены не для красоты. `project` — **в контексте какого проекта** место
 * рисуется, и по нему решается, вправе ли вклад из папки проекта его занять; `subject` — что место
 * показывает. Оконное вью настроек проектов показывает проект, но рисуется вне контекста проекта,
 * и слив этих двух вещей в одно поле отдал бы оконное место плагину из папки открытого проекта.
 */
export type PlaceContext = {
  /** Идентификатор записи проекта. У оконного места его нет. */
  project?: string;
  /** Идентификаторы предмета: сессия, провайдер, ключ плагина, вид страницы. */
  subject?: Readonly<Record<string, string>>;
};

export type CorePlace = {
  id: string;
  cardinality: PlaceCardinality;
  replaceable: boolean;
};

/**
 * Места, которые публикует базовая поставка. Перечислены данными, а не прозой: имена мест —
 * публичный контракт (docs/public-contract.md), и по этому списку проверяется, что каждое
 * заменяемое место хост и правда отрисовал.
 *
 * Встроенный провайдер места ядра — узел самого хоста, а не имя экспорта: ядро своё вью пишет
 * рядом и в бандле по имени его не ищет. Поле `builtIn` есть у объявления **плагина**, которому
 * иначе нечем указать на своё вью.
 */
export const corePlaces = [
  /** Открытая сессия целиком: и переписка, и то, что её обрамляет. */
  { id: "core.session.chat", cardinality: "single", replaceable: true },
  /** Экран создания сессии. */
  { id: "core.session.new", cardinality: "single", replaceable: true },
  { id: "core.settings.projects", cardinality: "single", replaceable: true },
  { id: "core.settings.providers", cardinality: "single", replaceable: true },
  { id: "core.settings.plugins", cardinality: "single", replaceable: true },
  /** Секции левой панели под деревом проектов. */
  { id: "core.sidebar.sections", cardinality: "collection", replaceable: false },
  /**
   * Вкладки правой панели. Полосой и выбором открытой вкладки владеет оболочка, поэтому место
   * незаменяемо: вклад приносит содержимое вкладки, а не саму панель.
   */
  { id: "core.panel.tabs", cardinality: "tabs", replaceable: false },
  /** Действия в шапке центральной колонки, после действий самого вью. */
  { id: "core.view.header.actions", cardinality: "action", replaceable: false },
] as const satisfies readonly CorePlace[];

export type CorePlaceId = (typeof corePlaces)[number]["id"];

export function corePlace(placeId: string): CorePlace | undefined {
  return corePlaces.find((place) => place.id === placeId);
}

/**
 * Кто занял заменяемое место. `built-in` — никто: либо вкладов нет, либо все выключены. `disputed`
 * — претендентов с наибольшим рангом больше одного, и тогда не применяется ни один: правило то же,
 * что у спора вкладов в реестре (docs/plugins.md), и по той же причине — молча выбранный победитель
 * зависел бы от порядка обхода.
 */
export type PlaceProviderResolution =
  | { kind: "built-in" }
  | { kind: "plugin"; contribution: ComponentContributionRegistration }
  | { kind: "disputed"; contenders: ComponentContributionRegistration[] };

/**
 * Resolve one place declaration using the same context and identity rules as its components. The
 * browser receives a union of declarations from all project contexts, so ownership must be resolved
 * before looking up the requested place id.
 */
export function resolvePlaceDeclaration(
  placeId: string,
  contributions: readonly ContributionRegistration[],
  context: PlaceContext,
): PlaceContributionRegistration | undefined {
  const places = contributions.filter(
    (registration): registration is PlaceContributionRegistration => registration.kind === "place",
  );

  return registrationsForContext(places, context).find(
    (registration) => registration.id === placeId,
  );
}

/**
 * Вклады, применимые к месту в этом контексте. Отбор по проекту обязателен: снимок перечисляет
 * объявления всех контекстов сразу, поэтому вклад плагина из папки чужого проекта доедет до
 * браузера и должен быть отсеян здесь (docs/plugins.md).
 */
export function componentsForPlace(
  placeId: string,
  contributions: readonly ContributionRegistration[],
  context: PlaceContext,
): ComponentContributionRegistration[] {
  const components = contributions.filter(
    (registration): registration is ComponentContributionRegistration =>
      registration.kind === "component",
  );

  return registrationsForContext(components, context).filter(
    (registration) => registration.placeId === placeId,
  );
}

export function resolvePlaceProvider(
  placeId: string,
  contributions: readonly ContributionRegistration[],
  context: PlaceContext,
): PlaceProviderResolution {
  const applicable = componentsForPlace(placeId, contributions, context);

  if (applicable.length === 0) {
    return { kind: "built-in" };
  }

  const best = Math.max(...applicable.map(registrationRank));
  const leading = applicable.filter((registration) => registrationRank(registration) === best);
  const winner = leading[0];

  if (leading.length > 1 || winner === undefined) {
    return { kind: "disputed", contenders: [...leading].sort(byIdentifier) };
  }

  return { kind: "plugin", contribution: winner };
}

/**
 * Порядок экземпляров в коллекции или в полосе действий: сперва группа, затем `order`, затем
 * идентификатор вклада (docs/ui-extension-model.md). Ранг источника здесь не участвует: вклады не
 * спорят за место, а складываются, и вклад из папки проекта не обязан стоять первым только потому,
 * что он специфичнее.
 */
export function orderPlaceContributions(
  placeId: string,
  contributions: readonly ContributionRegistration[],
  context: PlaceContext,
): ComponentContributionRegistration[] {
  return componentsForPlace(placeId, contributions, context).sort((left, right) => {
    const byGroup = (left.group ?? "").localeCompare(right.group ?? "", "en");

    if (byGroup !== 0) {
      return byGroup;
    }

    const byOrder = (left.order ?? 0) - (right.order ?? 0);

    return byOrder === 0 ? byIdentifier(left, right) : byOrder;
  });
}

function byIdentifier(
  left: ComponentContributionRegistration,
  right: ComponentContributionRegistration,
): number {
  return left.id.localeCompare(right.id, "en");
}

function registrationsForContext<
  T extends PlaceContributionRegistration | ComponentContributionRegistration,
>(registrations: readonly T[], context: PlaceContext): T[] {
  const applicable = registrations.filter((registration) => {
    const project = projectOfContribution(registration);

    return project === undefined || project === context.project;
  });
  const claims = new Map<string, T[]>();

  for (const registration of applicable) {
    const identity = `${registration.kind}:${registration.id}`;
    claims.set(identity, [...(claims.get(identity) ?? []), registration]);
  }

  return [...claims.values()].flatMap((claimants) => {
    const best = Math.max(...claimants.map(registrationRank));
    const leaders = claimants.filter((claimant) => registrationRank(claimant) === best);

    return leaders.length === 1 ? leaders : [];
  });
}

/**
 * Rank source specificity for every contribution type handled by the place resolver. Standalone
 * declarations have no source specificity and therefore share the base rank.
 */
function registrationRank(
  registration: PlaceContributionRegistration | ComponentContributionRegistration,
): number {
  return registration.ownership === "plugin" ? pluginSourceRank(registration.source) : 0;
}
