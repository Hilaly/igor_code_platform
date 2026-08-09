/**
 * Вклад, зарегистрированный в реестре (docs/plugins.md), — то, чем плагин расширяет платформу. Реестр
 * живёт в демоне, а его результат уходит и в снимок состояния, и в события шины, поэтому форма
 * записи — контракт.
 *
 * Это не то, что объявил плагин: объявленное описывает SDK. Здесь — то, что ядро приняло, с
 * неймспейсом плагина в идентификаторе и с именем плагина рядом.
 */

import type { HookCriticality } from "./hook.ts";
import { projectOfPluginSource, type PluginSource } from "./plugin.ts";
import type { ThinkingLevel } from "./session.ts";
import type { AgentSkillSelection, AgentToolSelection } from "./tool-pattern.ts";

/**
 * Схема в виде данных — то, что отдаёт `z.toJSONSchema()`: нагрузка события и аргументы инструмента
 * описываются одинаково. Сама схема сюда попасть не может: в ней функции, а между воркером и ядром
 * ходит структурное клонирование (docs/event-bus.md).
 */
export type PayloadSchema = Record<string, unknown>;

export type ContributionOwnership =
  | {
      ownership: "plugin";
      pluginKey: string;
      pluginId: string;
      source: PluginSource;
    }
  | {
      ownership: "standalone";
      /** Точный ключ нативного или межклиентского корня. */
      source: string;
      scope: "user" | "project";
      projectId?: string;
    };

/**
 * Какому проекту принадлежит вклад; у вклада всего узла — никакому. Владения два, и признак проекта
 * у них записан по-разному (источник плагина против явной области standalone-корня), поэтому вопрос
 * задаётся функцией: иначе каждый спрашивающий воспроизводил бы обе ветки, а забыть одну легко.
 *
 * Снимок `/api/plugins` — каталог **объявлений**, а не решение одного контекста: в нём лежат и
 * проектные вклады, иначе их нечем было бы показать и включить. Значит спрашивать обязан всякий, кто
 * применяет вклад не в контексте проекта.
 */
export function projectOfContribution(ownership: ContributionOwnership): string | undefined {
  return ownership.ownership === "plugin"
    ? projectOfPluginSource(ownership.source)
    : ownership.projectId;
}

export type RegistrationCommon = ContributionOwnership & {
  /** С неймспейсом: `<pluginId>.<объявленный>` (docs/ui-extension-model.md, docs/event-bus.md). */
  id: string;
  declaredId: string;
  title?: string;
  description?: string;
};

/** Общий вид: платформа о нагрузке ничего не знает и ничего с ней не делает. */
export type CustomContributionRegistration = RegistrationCommon & {
  kind: "custom";
  payload?: unknown;
};

/** Событие шины, объявленное плагином (docs/event-bus.md). Идентификатор вклада — имя события. */
export type EventContributionRegistration = RegistrationCommon & {
  kind: "event";
  payloadSchema: PayloadSchema;
};

/**
 * Агент: инструкции плюс отбор инструментов (docs/plugins.md). Модель и уровень ризонинга —
 * умолчания, а не запрет: при создании сессии их переопределяют.
 *
 * Проверить отбор при регистрации нельзя — шаблон вправе не совпасть ни с одним инструментом,
 * потому что набор собирается на каждый турн и зависит от того, какие плагины сейчас включены.
 * Поэтому «агент, у которого не осталось ни одного инструмента» — законное состояние.
 */
export type AgentContributionRegistration = RegistrationCommon & {
  kind: "agent";
  instructions: string;
  tools: AgentToolSelection;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  skills: AgentSkillSelection;
};

/** Скил из файла: реестр хранит разобранные метаданные, но не текст Markdown. */
export type SkillContributionRegistration = RegistrationCommon & {
  kind: "skill";
  name: string;
  location: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  disableModelInvocation: boolean;
};

/**
 * Инструмент, которым пользуется модель (docs/plugins.md). Аргументы описаны схемой-данными, как
 * нагрузка события: ручку инструмента собирает рантайм, а ядру она остаётся непрозрачной.
 *
 * **Имя, которым инструмент зовёт модель, — это `declaredId`**, а не отдельное поле: имена
 * инструментов у провайдеров ограничены `[A-Za-z0-9_-]`, поэтому неймспейс с точкой в имя не ставят,
 * а второе имя рядом с идентификатором было бы вторым способом сказать то же. Спор одноимённых
 * инструментов разных плагинов разрешает сборка набора (docs/hooks.md).
 *
 * Группы и порядка здесь нет: группой служит идентификатор плагина, а порядок внутри неё задаёт имя.
 */
export type ToolContributionRegistration = RegistrationCommon & {
  kind: "tool";
  /**
   * Что читает модель. Обязательно, в отличие от общего необязательного описания вклада: без
   * описания инструмент модели бесполезен.
   */
  description: string;
  parameters: PayloadSchema;
};

/**
 * Подписка на хук (docs/hooks.md). Порядка подписка не объявляет: он считается по рангу источника
 * плагина, затем по идентификатору вклада — иначе число, назначаемое автором себе сам, превратилось
 * бы в гонку.
 */
export type HookSubscriptionContributionRegistration = RegistrationCommon & {
  kind: "hook";
  /** Имя события Pi или хука платформы. Незнакомое отсеивается при регистрации. */
  event: string;
  criticality: HookCriticality;
};

/**
 * Методы, которыми плагин объявляет свой маршрут. Список тот же, что у таблицы маршрутов ядра: на
 * `OPTIONS` платформа не отвечает вовсе (docs/web-api.md), а `PATCH` не понадобился ни одному
 * маршруту ядра — вид сообщения появится вместе со своим потребителем.
 */
export const pluginRouteMethods = ["GET", "POST", "PUT", "DELETE"] as const;

export type PluginRouteMethod = (typeof pluginRouteMethods)[number];

export function isPluginRouteMethod(value: unknown): value is PluginRouteMethod {
  return pluginRouteMethods.includes(value as PluginRouteMethod);
}

/**
 * Префикс адреса маршрутов плагина. Под `/api`, потому что `/p/<id плагина>/...` целиком отдан
 * браузерным страницам плагина (docs/ui-extension-model.md): когда демон начнёт отдавать интерфейс
 * сам, `GET /p/hello/board` стало бы неразрешимым — один адрес просят и таблица маршрутов, и
 * страница, а различить их по форме нельзя.
 *
 * Затенения маршрутами ядра нет и быть не может: `p` не второй сегмент ни у одного из них, что
 * стережёт тест, а диспетчер сравнивает сегменты буквально и требует равного их числа
 * (docs/web-api.md).
 */
export const pluginRoutePrefix = "/api/p";

/**
 * Адрес маршрута плагина. Считается в одном месте на всю платформу: демон строит по нему таблицу, а
 * интерфейс показывает человеку — разойдясь, они заставили бы искать настоящий адрес глазами.
 *
 * Пустой путь — сам плагин, и это законный адрес.
 */
export function pluginRouteAddress(pluginId: string, path: string): string {
  return path === ""
    ? `${pluginRoutePrefix}/${pluginId}`
    : `${pluginRoutePrefix}/${pluginId}/${path}`;
}

/**
 * HTTP-маршрут плагина (docs/web-api.md). Адрес — `/api/p/<id плагина>/<path>`; идентификатор
 * плагина, а не его ключ: адрес попадает во внешние системы, и `project%3Ab7Kq%3Ahello` в вебхуке не
 * наберёт руками никто. Перекрытие при этом уже разрешено реестром — вклад один, победитель один.
 *
 * **`path` — не идентификатор вклада.** Идентификатором вклад переключается человеком и живёт в
 * `preferences.json`, а путь — часть внешнего адреса: связать их значило бы менять адрес при
 * переименовании вклада.
 *
 * Публичный маршрут — **отдельный вид**, а не флаг у обычного: разница между защищённым сессией и
 * открытым наружу маршрутом слишком велика для булева поля, которое легко скопировать из чужого
 * примера вместе со значением (docs/web-api.md, «Почему так»).
 */
type RouteRegistrationCommon = RegistrationCommon & {
  method: PluginRouteMethod;
  /** Без ведущего слэша, сегментами; сегмент вида `:имя` попадает в параметры запроса. */
  path: string;
};

export type RouteContributionRegistration = RouteRegistrationCommon & { kind: "route" };

export type PublicRouteContributionRegistration = RouteRegistrationCommon & {
  kind: "public-route";
};

/**
 * Цветовая схема, приехавшая от плагина (docs/ui-kit.md). Схема — **данные**: ни одной функции она
 * не предоставляет, поэтому браузерного кода плагину для неё не нужно вовсе.
 *
 * Форма нарочно структурная, без знания о палитре. Какие ключи в палитре обязательны и какой мажор
 * контракта токенов действует, знает кит, а он зависит от протокола — обратный импорт был бы циклом.
 * Отсюда разделение: **демон проверяет форму, кит проверяет контракт.** Схема с верной формой, но
 * чужим мажором или неполной палитрой доезжает до браузера и отвергается там, с диагностикой.
 */
export type ColorSchemeDocument = {
  /** Мажор контракта токенов кита, на который схема рассчитана. */
  tokenContract: number;
  /** Палитры по имени варианта; какие варианты и ключи обязательны — знает кит. */
  variants: Record<string, Record<string, string>>;
  /** Точечные переопределения ролей: имена ролей тоже принадлежат киту. */
  roleOverrides?: Record<string, string>;
};

/**
 * Своего имени у схемы нет: имя, которым её выбирают, — это `id` вклада с неймспейсом
 * (`themed.midnight`), он же стоит в `preferences.json`. Второе имя рядом с идентификатором было бы
 * вторым способом сказать то же — тот же довод, которым у инструмента отвергнуто отдельное поле
 * имени, — и переключение вклада и выбор схемы работают одним ключом.
 */
export type ColorSchemeContributionRegistration = RegistrationCommon & {
  kind: "color-scheme";
  scheme: ColorSchemeDocument;
};

/**
 * Неймспейс каталога сообщений, принадлежащий ядру (docs/ui-kit.md). Живёт в протоколе, а не в ките,
 * потому что по нему принимает решение демон: занять этот неймспейс своим вкладом плагин не может, но
 * **прислать для него каталог** может — так на платформе появляется новый язык интерфейса.
 */
export const coreCatalogNamespace = "core";

/**
 * Каталог сообщений, приехавший от плагина (docs/ui-kit.md). Как и цветовая схема, это **данные**:
 * браузерного кода плагину для него не нужно вовсе.
 *
 * Неймспейс — либо `core`, либо идентификатор самого плагина. Чужой запрещён: разрешить его потом
 * можно, никого не сломав, а запретить потом — нельзя.
 */
export type LocaleCatalogContributionRegistration = RegistrationCommon & {
  kind: "locale-catalog";
  namespace: string;
  /** Канонический тег локали: годность тега знает `Intl`, а не наш шаблон. */
  locale: string;
  messages: Record<string, string>;
};

/**
 * Кардинальность места (docs/ui-extension-model.md): сколько экземпляров в нём живёт и как они
 * складываются. Заменяемым бывает только одиночное: у коллекции и действия вклады не спорят, а
 * выстраиваются в ряд.
 *
 * Вкладки отделены от коллекции по механической причине: у коллекции отрисованы все экземпляры
 * сразу, у вкладок — ровно один, а остальные существуют подписями. Оставь такое место коллекцией — и
 * любой рисующий её честно, по контракту, выложит все вкладки стопкой.
 */
export const placeCardinalities = ["single", "collection", "action", "tabs"] as const;

export type PlaceCardinality = (typeof placeCardinalities)[number];

export function isPlaceCardinality(value: unknown): value is PlaceCardinality {
  return placeCardinalities.includes(value as PlaceCardinality);
}

/**
 * Объявление места (docs/ui-extension-model.md). Место заводят одинаково и ядро, и плагин: иначе
 * «плагин расширяет интерфейс другого плагина» осталось бы словами.
 *
 * **Кардинальность и заменяемость — поля, а не отдельные виды вклада.** Три вида вместо трёх
 * значений поля заставили бы автора выбирать вид по свойству места, а не по тому, что он делает,
 * и добавление четвёртой кардинальности ломало бы `everyKind` у всех потребителей разом.
 */
export type PlaceContributionRegistration = RegistrationCommon & {
  kind: "place";
  cardinality: PlaceCardinality;
  /** Только у `single`: коллекцию и действие занять целиком нельзя. */
  replaceable: boolean;
  /**
   * Имя экспорта встроенного провайдера в браузерном бандле владельца места. Обязательно у
   * заменяемого места: заменять нечего, если под заменой ничего нет (docs/ui-extension-model.md).
   */
  builtIn?: string;
};

/**
 * Вклад-компонент: заявка плагина на место (docs/ui-extension-model.md). Экземпляром он становится
 * в браузере, когда место отрисовано, — реестр про экземпляры не знает и знать не может.
 *
 * Место может ещё не существовать: вклад в него не ошибка, он ждёт. Поэтому существование `placeId`
 * при регистрации не проверяется — порядок появления плагинов не определён.
 *
 * Условия видимости у вклада нет: компонент решает это сам, вернув `null`. Предикат пришлось бы
 * пронести через границу воркера структурным клонированием, а функции она не переносит; в браузере
 * же компонент и предикат исполняются в одном realm, и второй способ сказать то же был бы лишним.
 */
export type ComponentContributionRegistration = RegistrationCommon & {
  kind: "component";
  /** Идентификатор места с неймспейсом: место чужое, поэтому неймспейс в нём чужой. */
  placeId: string;
  /** Имя экспорта в браузерном бандле плагина. */
  export: string;
  /** Порядок в коллекции: сперва группа, затем `order`, затем идентификатор вклада. */
  group?: string;
  order?: number;
};

/**
 * Вклад-команда: именованное действие плагина (docs/ui-extension-model.md). От компонента отличается
 * тем, что у него нет содержимого — есть только исполнение, поэтому одну команду зовут и кнопкой, и
 * палитрой, и чужой плагин по идентификатору.
 *
 * Заголовок обязателен, в отличие от общего `title`: команда представлена в интерфейсе только им, и
 * рисуется она **до** загрузки бандла — иначе полоса действий прыгала бы по мере загрузки плагинов.
 *
 * Поля `handler` нет намеренно: наличие `export` уже означает «обработчик в браузерном бандле», ровно
 * как `builtIn` у места. Появится воркерный обработчик — `export` станет необязательным, и это
 * дополняющее изменение, а не второй способ сказать то же.
 */
export type CommandContributionRegistration = RegistrationCommon & {
  kind: "command";
  title: string;
  /** Имя экспорта в браузерном бандле плагина: дескриптор команды. */
  export: string;
  /** Место кардинальности «действие», куда хост поставит кнопку. Не сказано — кнопки нет. */
  placeId?: string;
  group?: string;
  order?: number;
};

/**
 * Вклад-страница: плагин занимает целую страницу на своём адресе `/p/<pluginId>/<pageId>/*`
 * (docs/ui-extension-model.md). Полей `path` и `route` у объявления нет намеренно: адрес выведен из
 * идентификаторов, которые уже есть, а право назвать путь самому было бы вторым способом занять
 * чужой адрес — со своим спором и своей диагностикой.
 *
 * Адресом служит `declaredId`, а не `id` с неймспейсом: `pluginId` в адресе уже стоит отдельным
 * сегментом, и неймспейс дал бы `/p/placed/placed.log`. Спор об идентификаторе и перекрытие копии
 * по рангу источника при этом считаются по `id`, как у всех вкладов.
 *
 * Заголовок обязателен по той же причине, что у команды: страница представлена ссылкой и шапкой
 * **до** загрузки бандла.
 */
export type PageContributionRegistration = RegistrationCommon & {
  kind: "page";
  title: string;
  /** Имя экспорта в браузерном бандле плагина. */
  export: string;
};

export type ContributionRegistration =
  | CustomContributionRegistration
  | EventContributionRegistration
  | AgentContributionRegistration
  | SkillContributionRegistration
  | ToolContributionRegistration
  | HookSubscriptionContributionRegistration
  | RouteContributionRegistration
  | PublicRouteContributionRegistration
  | ColorSchemeContributionRegistration
  | LocaleCatalogContributionRegistration
  | PlaceContributionRegistration
  | ComponentContributionRegistration
  | CommandContributionRegistration
  | PageContributionRegistration;

export type ContributionKind = ContributionRegistration["kind"];

/**
 * Вклады, которые хост расставляет по местам. Порядок у них общий: кнопка команды стоит в той же
 * полосе, что и компонент, и два ряда, сложенные по разным правилам, прыгали бы друг относительно
 * друга.
 */
export type PlacedContributionRegistration =
  ComponentContributionRegistration | CommandContributionRegistration;

/**
 * Все виды, перечисленные явно. `Record<ContributionKind, true>` требует каждого ключа и не терпит
 * лишнего, поэтому вид, добавленный в union и забытый здесь, ломает сборку, а не находится глазами.
 */
const everyKind = {
  custom: true,
  event: true,
  agent: true,
  skill: true,
  tool: true,
  hook: true,
  route: true,
  "public-route": true,
  "color-scheme": true,
  "locale-catalog": true,
  place: true,
  component: true,
  command: true,
  page: true,
} satisfies Record<ContributionKind, true>;

/**
 * Виды списком: типа в рантайме нет, а перебрать виды нужно — например, чтобы проверить, что у
 * каждого есть подпись в каталоге интерфейса.
 */
export const contributionKinds = Object.keys(everyKind) as readonly ContributionKind[];

/**
 * Спор между вкладами с одинаковым идентификатором и одинаковым рангом источника: не применяется ни
 * один (docs/plugins.md). Претенденты — плагины или standalone-корни. Форма — контракт, потому что
 * спор уходит в снимок: диагностика обязана быть заметной в интерфейсе, а не строкой в журнале.
 */
export type ContributionConflict = {
  id: string;
  source: string;
  /** Ключи плагинов, претендующих на идентификатор. */
  plugins: string[];
  /** Ключи standalone-корней, претендующих на короткий идентификатор. */
  standaloneRoots?: string[];
};
