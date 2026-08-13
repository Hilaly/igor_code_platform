/**
 * Сессия агента на проводе (docs/sessions-and-projects.md). Контракт лежит здесь, а не в демоне:
 * по этим же полям интерфейс рисует ленту сообщений, а SDK отдаёт ту же поверхность плагинам.
 *
 * Типов рантайма здесь нет и не будет: пакет импортируется браузером, а Pi живёт в
 * `@sovereign/agent-runtime-pi` (docs/architecture.md). Наружу уезжает перевод, а не записи Pi.
 */

import type { PluginSource } from "./plugin.ts";
import type { SettingsParseResult } from "./settings.ts";
import type { AgentSkillSelection } from "./tool-pattern.ts";

export const sessionsPath = "/api/sessions";

/** Какие агенты включены. Отдельно от снимка плагинов: агент — сущность, а не вид вклада. */
export const agentsPath = "/api/agents";

/** Шаблоны для таблицы маршрутов демона. */
export const sessionPathPattern = `${sessionsPath}/:sessionId`;
export const sessionEntriesPathPattern = `${sessionsPath}/:sessionId/entries`;
export const sessionTurnsPathPattern = `${sessionsPath}/:sessionId/turns`;
export const sessionForkPathPattern = `${sessionsPath}/:sessionId/fork`;
export const sessionMessagesPathPattern = `${sessionsPath}/:sessionId/messages`;
export const sessionStatsPathPattern = `${sessionsPath}/:sessionId/stats`;
export const sessionBranchPathPattern = `${sessionsPath}/:sessionId/branch`;
export const sessionCompactPathPattern = `${sessionsPath}/:sessionId/compact`;
export const sessionNavigatePathPattern = `${sessionsPath}/:sessionId/navigate`;
export const sessionContextPathPattern = `${sessionsPath}/:sessionId/context`;
export const sessionCommandsPathPattern = `${sessionsPath}/:sessionId/commands`;
export const sessionEntryLabelPathPattern = `${sessionsPath}/:sessionId/entries/:entryId/label`;

/** Параметр фильтра списка: сессии одного проекта. */
export const sessionProjectParameter = "projectId";

/**
 * Параметр фильтра списка: архивные вместо действующих. Фильтр, а не второй список рядом с
 * действующими, как у проектов: сессий на проект бывают десятки, и оба списка в одном ответе
 * заставили бы клиента возить архив, которого он не показывает.
 */
export const sessionArchivedParameter = "archived";

/** Курсор чтения записей: сколько записей клиент уже видел. */
export const sessionEntriesAfterParameter = "after";

/**
 * От какой записи читать ветку. Без него ветка читается от текущего листа — то есть это тот
 * разговор, который увидит модель на следующем турне.
 */
export const sessionBranchFromParameter = "from";

export function sessionPath(sessionId: string): string {
  return `${sessionsPath}/${encodeURIComponent(sessionId)}`;
}

export function sessionEntriesPath(sessionId: string): string {
  return `${sessionPath(sessionId)}/entries`;
}

export function sessionTurnsPath(sessionId: string): string {
  return `${sessionPath(sessionId)}/turns`;
}

export function sessionForkPath(sessionId: string): string {
  return `${sessionPath(sessionId)}/fork`;
}

export function sessionMessagesPath(sessionId: string): string {
  return `${sessionPath(sessionId)}/messages`;
}

export function sessionStatsPath(sessionId: string): string {
  return `${sessionPath(sessionId)}/stats`;
}

export function sessionBranchPath(sessionId: string, from?: string): string {
  const base = `${sessionPath(sessionId)}/branch`;

  return from === undefined
    ? base
    : `${base}?${sessionBranchFromParameter}=${encodeURIComponent(from)}`;
}

export function sessionCompactPath(sessionId: string): string {
  return `${sessionPath(sessionId)}/compact`;
}

export function sessionNavigatePath(sessionId: string): string {
  return `${sessionPath(sessionId)}/navigate`;
}

export function sessionContextPath(sessionId: string): string {
  return `${sessionPath(sessionId)}/context`;
}

export function sessionCommandsPath(sessionId: string): string {
  return `${sessionPath(sessionId)}/commands`;
}

export function sessionEntryLabelPath(sessionId: string, entryId: string): string {
  return `${sessionEntriesPath(sessionId)}/${encodeURIComponent(entryId)}/label`;
}

/**
 * Уровень ризонинга. Значения совпадают с рантаймом, но список наш: рантайм переименует уровень —
 * поменяется перевод в `@sovereign/agent-runtime-pi`, а не публичный контракт.
 */
export const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingLevel = (typeof thinkingLevels)[number];

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return thinkingLevels.includes(value as ThinkingLevel);
}

/**
 * Состояние сессии. Наш союз, а не фазы Pi: фаза у harness приватная и читать её снаружи нечем,
 * а `queued` рантайму вовсе неизвестно — он ещё не начинал и считает себя простаивающим
 * (docs/architecture.md).
 *
 * Перечислены все состояния сразу, включая недостижимые в срезе 9a: расширение возможного выхода —
 * ломающее изменение (docs/public-contract.md), и добавлять их по одному значило бы ломать контракт
 * каждым следующим срезом.
 */
export const sessionPhases = [
  "idle",
  "queued",
  "turn",
  "compaction",
  "branch-summary",
  "retry",
] as const;

export type SessionPhase = (typeof sessionPhases)[number];

export type Session = {
  id: string;
  /** Идентичность проекта для разрешения вкладов и принадлежности сессии. */
  projectId: string;
  /** Рабочий контекст рантайма и файловых инструментов; не заменяет идентичность проекта. */
  folder: string;
  agentId: string;
  /** Есть ли сохранённый агент в текущем разрешённом наборе именно этого проекта. */
  agentAvailable: boolean;
  model: string;
  thinkingLevel: ThinkingLevel;
  phase: SessionPhase;
  /** Имя, данное человеком. Его может не быть: сессия называется не при создании, а когда захочется. */
  title?: string;
  /**
   * Архивная сессия убрана с глаз, но цела и читается по прямому адресу. Архивация требует простоя
   * (docs/sessions-and-projects.md).
   */
  archived: boolean;
  createdAt: string;
};

export type SessionsSnapshot = {
  sessions: Session[];
  /** Файлы сессий, которые прочитать не вышло. Одна битая сессия не отменяет остальные. */
  problems?: string[];
};

/**
 * Что человек вправе приложить к сообщению. Список закрыт: это те форматы, которые провайдеры
 * принимают одинаково, а не всё, что умеет показать браузер (docs/sessions-and-projects.md).
 */
export const sessionImageMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type SessionImageMimeType = (typeof sessionImageMimeTypes)[number];

export function isSessionImageMimeType(value: unknown): value is SessionImageMimeType {
  return sessionImageMimeTypes.includes(value as SessionImageMimeType);
}

/**
 * Изображение, приложенное к сообщению.
 *
 * `data` — чистый base64 без `data:` prefix. Data URL — форма браузерного рендера, а не провода: он
 * повторяет тип, который уже назван рядом, и на проводе это две записи одного факта, способные
 * разойтись.
 */
export type SessionImage = {
  mimeType: SessionImageMimeType;
  data: string;
};

/**
 * Сколько байт весит изображение после декодирования. Считается арифметикой по длине base64, без
 * самого декодирования: предел применяют и демон, и браузер, и обоим незачем ради счёта поднимать в
 * память лишнюю копию. Значение верно для canonical base64 — то есть ровно для того, что пропускает
 * `parseTurnRequest`.
 */
export function sessionImageBytes(image: SessionImage): number {
  const padding = image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0;

  return (image.data.length / 4) * 3 - padding;
}

/** Тело создания сессии. */
export type SessionDraft = {
  projectId: string;
  agentId: string;
  /** Не названа — берётся у агента; у агента нет — отказ с названной причиной. */
  model?: string;
  thinkingLevel?: ThinkingLevel;
};

/** Переопределения турна. Действуют с этого турна и пишутся в дерево сессии. */
export type TurnOverrides = {
  model?: string;
  thinkingLevel?: ThinkingLevel;
};

/**
 * Турн, начатый репликой человека.
 *
 * `text` бывает пустым ровно тогда, когда есть хотя бы одно изображение: скриншот без единого слова —
 * законная просьба. Пустого сообщения без того и другого не бывает.
 */
export type SaidTurnRequest = TurnOverrides & {
  text: string;
  images?: SessionImage[];
  skill?: never;
  template?: never;
  instructions?: never;
  arguments?: never;
};

/**
 * Турн, начатый явно названным скилом (docs/sessions-and-projects.md). Модель получает инструкции
 * скила целиком — не ссылку на них, — поэтому вместе с текстовой репликой такой турн не едет:
 * это две разные операции, а не одна с двумя началами.
 */
export type SkillTurnRequest = TurnOverrides & {
  skill: string;
  /** Что человек дописал к запуску. Уезжает после инструкций скила. */
  instructions?: string;
  text?: never;
  images?: never;
  template?: never;
  arguments?: never;
};

/**
 * Турн, начатый шаблоном промпта (docs/file-resources.md). Аргументы едут одной строкой, как их
 * набрал человек: правила кавычек принадлежат рантайму, который их и подставляет, а второй разбор
 * на проводе разошёлся бы с ним на первой же строке с кавычками.
 */
export type TemplateTurnRequest = TurnOverrides & {
  template: string;
  arguments?: string;
  text?: never;
  images?: never;
  skill?: never;
  instructions?: never;
};

/** Тело запуска турна: реплика человека, явно названный скил либо шаблон промпта. */
export type TurnRequest = SaidTurnRequest | SkillTurnRequest | TemplateTurnRequest;

/**
 * Скил в каталоге команд сессии. Отбор агента уже применён: браузер показывает то, что запустится,
 * и не повторяет серверный расчёт применимости.
 */
export type SessionSkillSummary = {
  name: string;
  description: string;
  /**
   * Скил, скрытый от модели (`disable-model-invocation`). Его нет в каталоге системного prompt,
   * и запустить его может только человек — поэтому в каталоге команд он есть.
   */
  hidden: boolean;
};

/**
 * Имена, принадлежащие командам ядра над сессией (docs/sessions-and-projects.md). Закрытый список,
 * и он живёт в контракте, а не в браузере: шаблон, занявший такое имя, не должен запускаться ни
 * из композера, ни из SDK — иначе одно и то же `/compact` значило бы разное в разных проектах.
 */
export const coreSessionCommandNames = ["compact", "fork", "rename", "archive"] as const;

export type CoreSessionCommandName = (typeof coreSessionCommandNames)[number];

export function isCoreSessionCommandName(value: string): value is CoreSessionCommandName {
  return (coreSessionCommandNames as readonly string[]).includes(value);
}

/**
 * Шаблон промпта в каталоге команд сессии. Имя без префикса: шаблоны и команды ядра делят одно
 * пространство имён, и занявший имя команды ядра шаблон в каталог не попадает
 * (docs/file-resources.md).
 */
export type SessionTemplateSummary = {
  name: string;
  description: string;
  scope: "user" | "project";
};

/** Каталог команд сессии: то, что предлагает композер по `/`. */
export type SessionCommands = {
  skills: SessionSkillSummary[];
  templates: SessionTemplateSummary[];
};

/**
 * Ответ на запуск турна. Фаза здесь не украшение: при исчерпанном пределе турн принят, но ещё не
 * начат, и запустивший обязан увидеть это сразу (docs/architecture.md).
 */
export type TurnAccepted = {
  sessionId: string;
  turnId: string;
  phase: SessionPhase;
};

/** Ответ прерывания. `false` — прерывать было нечего, и это не ошибка. */
export type TurnInterrupted = {
  sessionId: string;
  interrupted: boolean;
};

/**
 * Тело изменения сессии: переименование, архивация и восстановление — одна запись целой записи, как
 * у проекта. `title` при этом необязателен, потому что безымянная сессия — норма: тело без него
 * снимает имя, а не отказывает.
 */
export type SessionUpdate = {
  title?: string;
  archived: boolean;
};

/** Ответ безвозвратного удаления. */
export type SessionDeleted = {
  id: string;
};

/**
 * Тело форка. Без `entryId` форк берёт сессию целиком.
 *
 * `position` — где резать: `before` оставляет всё **до** записи, `at` — включая её. Умолчание
 * `before` работает только по сообщению человека: «переспросить иначе» — единственный смысл, в
 * котором отрезать ответ модели вместе с вопросом осмысленно (docs/agent-runtime-contract.md).
 */
export type SessionForkRequest = {
  entryId?: string;
  position?: "before" | "at";
};

/**
 * Куда встаёт сообщение, отправленное не турном.
 *
 * - `steer` — вклинить в идущий турн, модель увидит его следующим шагом;
 * - `follow-up` — дождаться конца текущего турна и продолжить им же;
 * - `next-turn` — лечь в начало следующего турна; переживает прерывание;
 * - `append` — просто дописать в дерево, никого не будя.
 *
 * Один маршрут с полем вместо четырёх: расширять `POST .../turns` нельзя — он значит «запусти турн»
 * и требует простоя, а `steer` требует ровно обратного (docs/web-api.md).
 */
export const sessionMessageModes = ["steer", "follow-up", "next-turn", "append"] as const;

export type SessionMessageMode = (typeof sessionMessageModes)[number];

export function isSessionMessageMode(value: unknown): value is SessionMessageMode {
  return sessionMessageModes.includes(value as SessionMessageMode);
}

export type SessionMessage = {
  text: string;
  images?: SessionImage[];
  mode: SessionMessageMode;
};

/** Ответ приёма сообщения. Фазы здесь нет: турна оно не запускает. */
export type SessionMessageAccepted = {
  sessionId: string;
  mode: SessionMessageMode;
};

/**
 * Сообщение, ждущее своего момента. Не строка: у ждущего сообщения бывают изображения, а очередь из
 * одних текстов показала бы человеку не то, что он отправил.
 */
export type SessionQueuedMessage = {
  text: string;
  images?: SessionImage[];
};

/**
 * Очереди сообщений, ждущих своего момента. Отдаются наружу, потому что написавший стиринг обязан
 * видеть, что тот принят и ждёт, а не пропал.
 */
export type SessionQueues = {
  steer: SessionQueuedMessage[];
  followUp: SessionQueuedMessage[];
  nextTurn: SessionQueuedMessage[];
};

/**
 * Счёт токенов и денег. Считается по **всему файлу сессии**, включая брошенные ветки: вопрос, на
 * который она отвечает, — «сколько я за эту сессию заплатил», а заплачено и за брошенное тоже.
 */
export type SessionStats = {
  sessionId: string;
  messageCount: number;
  cachedTokens: number;
  uncachedTokens: number;
  totalTokens: number;
  costTotal: number;
};

/**
 * Кусок сообщения. Вызов инструмента — блок внутри сообщения, а не отдельная запись: модель
 * выдаёт его тем же ответом, что и текст, и разорви мы их — лента потеряла бы порядок, в котором
 * агент рассуждал и действовал.
 */
export type SessionContentBlock =
  | { kind: "text"; text: string }
  /** Изображение внутри сообщения. Порядок блоков сохраняется: он и есть порядок, в котором писали. */
  | { kind: "image"; mimeType: SessionImageMimeType; data: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool-call"; toolCallId: string; toolName: string; input: unknown };

/**
 * Запись дерева сессии в терминах контракта.
 *
 * **Разобраны все одиннадцать типов записей рантайма** — решение владельца продукта по срезу 10b.
 * `other` остаётся только под то, чего рантайм ещё не умеет: обновление Pi, принёсшее новый тип
 * записи, обязано доехать до клиента хоть чем-то, а не пропасть. Молчаливая потеря записи сделала бы
 * ленту неполной без всякого следа.
 *
 * `parentId` — публичное поле: из него строится дерево. Его нет только у корня ветки; у остальных
 * записей он есть всегда.
 */
export type SessionEntry = {
  id: string;
  parentId?: string;
  time: string;
} & (
  | { kind: "message"; role: "user" | "agent"; content: SessionContentBlock[] }
  | { kind: "tool-result"; toolCallId: string; toolName: string; text: string; failed: boolean }
  | { kind: "model-change"; model: string }
  | { kind: "thinking-level-change"; thinkingLevel: ThinkingLevel }
  | { kind: "tools-change"; toolNames: string[] }
  /**
   * Контекст свёрнут в пересказ. `firstKeptEntryId` — с какой записи хвост оставлен как есть; его
   * может не быть, когда свёрнута вся ветка. `fromHook` различает пересказ, сделанный рантаймом, и
   * подсунутый хуком — а платформа подсовывает свой всегда (docs/sessions-and-projects.md).
   */
  | {
      kind: "compaction";
      summary: string;
      tokensBefore: number;
      firstKeptEntryId?: string;
      fromHook: boolean;
    }
  /** Пересказ покинутой ветки, записанный при переходе к другой записи дерева. */
  | { kind: "branch-summary"; fromId: string; summary: string; fromHook: boolean }
  /**
   * Метка на записи. Отсутствие `label` — снятая метка, а не пустая: рантайм пишет снятие такой же
   * записью, и действующее значение — это свёртка всех записей `label` по `targetId`.
   */
  | { kind: "label"; targetId: string; label?: string }
  /** Сессию назвали. Отсутствие `name` — имя сняли. */
  | { kind: "session-name"; name?: string }
  /** Лист дерева переставлен. Отсутствие `targetId` — дерево вернули в пустое состояние. */
  | { kind: "leaf"; targetId?: string }
  /** Запись приложения, модели не показанная. Сюда платформа кладёт своё — например деградацию. */
  | { kind: "custom"; type: string; data?: unknown }
  /** Запись приложения, которая **является** сообщением в разговоре. */
  | { kind: "custom-message"; type: string; text: string; display: boolean }
  | { kind: "other"; type: string }
);

/**
 * Действующие метки ветки: свёртка записей `label` по `targetId`. Считается там же, где читаются
 * записи, чтобы каждый потребитель не повторял свёртку — и не расходился с соседом в том, что
 * значит метка, снятая и поставленная заново.
 */
export function foldEntryLabels(entries: readonly SessionEntry[]): Map<string, string> {
  const labels = new Map<string, string>();

  for (const entry of entries) {
    if (entry.kind !== "label") {
      continue;
    }

    if (entry.label === undefined) {
      labels.delete(entry.targetId);
    } else {
      labels.set(entry.targetId, entry.label);
    }
  }

  return labels;
}

/**
 * Ссылка на модель на проводе: `<провайдер>/<модель>`. Идентификатор модели сам вправе содержать
 * `/` (так устроены каталоги вроде OpenRouter), поэтому режется по **первому** разделителю —
 * в идентификаторе провайдера `/` не бывает.
 */
export function modelReference(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

export function parseModelReference(
  reference: string,
): { providerId: string; modelId: string } | undefined {
  const boundary = reference.indexOf("/");

  if (boundary <= 0 || boundary === reference.length - 1) {
    return undefined;
  }

  return {
    providerId: reference.slice(0, boundary),
    modelId: reference.slice(boundary + 1),
  };
}

export type SessionEntriesPage = {
  sessionId: string;
  entries: SessionEntry[];
  /** Сколько записей клиент теперь видел: значение курсора для следующего запроса. */
  seen: number;
};

/**
 * Ветка дерева: путь от записи вверх до корня, в хронологическом порядке. Курсора у неё нет
 * намеренно — ветка читается целиком: она и так обрезана последней компакцией, а страница ветки
 * означала бы, что клиент склеивает путь по кускам и обязан помнить, где он его оборвал.
 *
 * `leafId` — лист **сессии**, а не конец возвращённой ветки: по нему клиент отличает ветку, в
 * которой сессия сейчас работает, от осмотренной чужой.
 */
export type SessionBranch = {
  sessionId: string;
  entries: SessionEntry[];
  leafId?: string;
};

/**
 * Насколько заполнен контекст. Считается по действующей ветке, а не по файлу целиком, — этим и
 * отличается от `SessionStats`: та отвечает «сколько заплачено», эта — «сколько ещё влезет».
 *
 * `contextWindow` берётся у модели сессии; его может не быть, если модель недоступна — тогда доли
 * не существует, и показывать проценты не из чего.
 */
export type SessionContextUsage = {
  sessionId: string;
  tokens: number;
  contextWindow?: number;
  /** Доля окна, после которой компакция запускается сама. `0` — автопорог выключен. */
  threshold: number;
};

/** Тело компакции. Инструкции необязательны: без них рантайм пересказывает по своему промпту. */
export type SessionCompactRequest = {
  instructions?: string;
};

/**
 * Ответ на запуск компакции. Как и у турна, здесь фаза: компакция идёт через ту же очередь походов
 * к модели, и при исчерпанном пределе она принята, но ещё не начата (docs/architecture.md).
 */
export type SessionCompactAccepted = {
  sessionId: string;
  phase: SessionPhase;
};

/**
 * Тело перехода к записи дерева.
 *
 * `summarize` заказывает пересказ покидаемой ветки — это запрос к модели, и он занимает слот в
 * очереди. `replaceInstructions` относится к `instructions`: заменить промпт пересказа целиком, а не
 * дописать к нему.
 */
export type SessionNavigateRequest = {
  entryId: string;
  summarize?: boolean;
  instructions?: string;
  replaceInstructions?: boolean;
};

/**
 * Ответ перехода.
 *
 * `editorText` появляется, когда целью была реплика человека: рантайм в этом случае ставит листом
 * её **родителя** и возвращает текст, чтобы человек переспросил иначе. Пустой `leafId` — дерево
 * вернулось в пустое состояние.
 */
export type SessionNavigated = {
  sessionId: string;
  leafId?: string;
  editorText?: string;
  summarized: boolean;
};

/** Тело простановки метки. `null` снимает метку; отличать «снять» от «не трогать» обязан отправитель. */
export type SessionLabelUpdate = {
  label: string | null;
};

/** Ответ простановки метки. Без `label` — метка снята. */
export type SessionEntryLabelled = {
  sessionId: string;
  entryId: string;
  label?: string;
};

/**
 * Живой ход турна. Едет отдельным классом кадра SSE, а не шиной (docs/web-api.md): на один ответ
 * модели дельт сотни, а событие шины доставляется каждому подписчику, включая воркеры плагинов.
 *
 * Идентификатор сообщения здесь синтетический и живёт ровно один турн: запись дерева получает свой
 * идентификатор только в момент, когда она дописана, то есть уже после последней дельты.
 */
export type SessionDelta =
  | { kind: "phase"; phase: SessionPhase }
  | { kind: "message-start"; messageId: string; role: "user" | "agent" }
  | { kind: "message-delta"; messageId: string; channel: "text" | "reasoning"; text: string }
  /**
   * Изображения сообщения человека. Отдельным кадром, а не полем `message-start`: сообщение человека
   * не стримится, и у него уже есть одна текстовая дельта — картинки приезжают такой же одной,
   * сохраняя порядок «текст, затем изображения», в котором их складывает рантайм. У ответа модели
   * этого кадра не бывает.
   */
  | { kind: "message-images"; messageId: string; images: SessionImage[] }
  | { kind: "message-end"; messageId: string }
  | { kind: "tool-start"; toolCallId: string; toolName: string; input: unknown }
  | { kind: "tool-end"; toolCallId: string; failed: boolean }
  | { kind: "turn-end" }
  | { kind: "turn-aborted" }
  | { kind: "turn-failed"; reason: string }
  | { kind: "queues"; queues: SessionQueues };

type AgentSummaryCommon = {
  id: string;
  title?: string;
  description?: string;
  /** Модель по умолчанию. Её может не быть: тогда модель называют при создании сессии. */
  model?: string;
  thinkingLevel?: ThinkingLevel;
  skills: AgentSkillSelection;
};

/** Агент глазами интерфейса: то, из чего выбирают при создании сессии. */
export type AgentSummary = AgentSummaryCommon &
  (
    | {
        ownership: "plugin";
        pluginKey: string;
        source: PluginSource;
      }
    | {
        ownership: "standalone";
        pluginKey?: never;
        source: string;
        scope: "user" | "project";
        projectId?: string;
      }
  );

/** Ноль агентов — законный ответ, а не отказ: единственный плагин с агентом могли выключить. */
export type AgentsSnapshot = { agents: AgentSummary[] };

/**
 * Форма идентификатора сессии. Проверяется отдельной функцией, потому что идентификатор едет в имя
 * файла (docs/data-directory.md): проверка обязана случиться раньше, чем путь будет сложен.
 */
const sessionIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && sessionIdPattern.test(value);
}

const draftKeys = ["projectId", "agentId", "model", "thinkingLevel"];
const turnKeys = [
  "text",
  "images",
  "skill",
  "instructions",
  "template",
  "arguments",
  "model",
  "thinkingLevel",
];
const updateKeys = ["title", "archived"];
const forkKeys = ["entryId", "position"];
const messageKeys = ["text", "images", "mode"];
const imageKeys = ["mimeType", "data"];
const compactKeys = ["instructions"];
const navigateKeys = ["entryId", "summarize", "instructions", "replaceInstructions"];
const labelKeys = ["label"];

export function parseSessionDraft(
  raw: unknown,
  label = "session",
): SettingsParseResult<SessionDraft> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, draftKeys);
  const projectId = trimmedText(fields["projectId"]);

  if (projectId === undefined) {
    diagnostics.push(`${label}.projectId must be a non-empty project identifier`);

    return { kind: "rejected", diagnostics };
  }

  const agentId = trimmedText(fields["agentId"]);

  if (agentId === undefined) {
    diagnostics.push(`${label}.agentId must be a non-empty agent identifier`);

    return { kind: "rejected", diagnostics };
  }

  const overrides = parseOverrides(fields, label, diagnostics);

  if (overrides === undefined) {
    return { kind: "rejected", diagnostics };
  }

  return { kind: "parsed", value: { projectId, agentId, ...overrides }, diagnostics };
}

export function parseTurnRequest(raw: unknown, label = "turn"): SettingsParseResult<TurnRequest> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, turnKeys);

  // Тело называет ровно одну операцию. Реплика рядом со скилом — не «скил с подписью», а два
  // начала одного турна: угадать за отправителя, какое из них он имел в виду, нечем.
  const named = ["text", "images", "skill", "template"].filter((key) => fields[key] !== undefined);
  const operations = new Set(named.map((key) => (key === "images" ? "text" : key)));

  if (operations.size > 1) {
    diagnostics.push(
      `${label} names more than one operation (${named.join(", ")}): it must name one`,
    );

    return { kind: "rejected", diagnostics };
  }

  // Хвост принадлежит своей ветке. Молча его выбросить значило бы соврать отправителю про
  // отправленное — ровно как выброшенная картинка.
  const companions: Record<string, string> = { instructions: "skill", arguments: "template" };

  for (const [companion, owner] of Object.entries(companions)) {
    if (fields[companion] !== undefined && fields[owner] === undefined) {
      diagnostics.push(`${label}.${companion} belongs to ${label}.${owner}: name it or drop it`);

      return { kind: "rejected", diagnostics };
    }
  }

  const overrides = parseOverrides(fields, label, diagnostics);

  if (overrides === undefined) {
    return { kind: "rejected", diagnostics };
  }

  if (fields["skill"] !== undefined) {
    const skill = trimmedText(fields["skill"]);

    if (skill === undefined) {
      diagnostics.push(`${label}.skill must be a non-empty skill name`);

      return { kind: "rejected", diagnostics };
    }

    const instructions = optionalText(fields, "instructions", label, diagnostics);

    if (instructions === undefined) {
      return { kind: "rejected", diagnostics };
    }

    return {
      kind: "parsed",
      value: { skill, ...instructions, ...overrides },
      diagnostics,
    };
  }

  if (fields["template"] !== undefined) {
    const template = trimmedText(fields["template"]);

    if (template === undefined) {
      diagnostics.push(`${label}.template must be a non-empty template name`);

      return { kind: "rejected", diagnostics };
    }

    const args = optionalText(fields, "arguments", label, diagnostics);

    if (args === undefined) {
      return { kind: "rejected", diagnostics };
    }

    return { kind: "parsed", value: { template, ...args, ...overrides }, diagnostics };
  }

  const said = parseSaidMessage(fields, label, diagnostics);

  if (said === undefined) {
    return { kind: "rejected", diagnostics };
  }

  return { kind: "parsed", value: { ...said, ...overrides }, diagnostics };
}

/**
 * Необязательный хвост ветки: либо непустой текст, либо его нет. `undefined` — отказ, потому что
 * названный пустым хвост это противоречие, а не «хвоста нет».
 */
function optionalText<Key extends string>(
  fields: Record<string, unknown>,
  key: Key,
  label: string,
  diagnostics: string[],
): Partial<Record<Key, string>> | undefined {
  const raw = fields[key];

  if (raw === undefined) {
    return {};
  }

  const text = trimmedText(raw);

  if (text === undefined) {
    diagnostics.push(`${label}.${key} must be a non-empty text, or absent`);

    return undefined;
  }

  return { [key]: text } as Record<Key, string>;
}

export function parseSessionUpdate(
  raw: unknown,
  label = "session",
): SettingsParseResult<SessionUpdate> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, updateKeys);
  const archived = fields["archived"];

  // `archived` обязателен: запись заменяет запись целиком, и тело без него разархивировало бы
  // сессию человеку, который менял только имя. `title` необязателен — безымянная сессия законна.
  if (typeof archived !== "boolean") {
    diagnostics.push(`${label}.archived must be a boolean, got ${JSON.stringify(archived)}`);

    return { kind: "rejected", diagnostics };
  }

  const rawTitle = fields["title"];

  if (rawTitle !== undefined && trimmedText(rawTitle) === undefined) {
    diagnostics.push(`${label}.title must be a non-empty name, or absent to clear it`);

    return { kind: "rejected", diagnostics };
  }

  return {
    kind: "parsed",
    value: {
      ...(rawTitle === undefined ? {} : { title: trimmedText(rawTitle) as string }),
      archived,
    },
    diagnostics,
  };
}

export function parseSessionForkRequest(
  raw: unknown,
  label = "fork",
): SettingsParseResult<SessionForkRequest> {
  // Пустое тело — законный форк сессии целиком, поэтому отсутствующее тело равно пустому объекту.
  const fields = raw === undefined || raw === null ? {} : asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, forkKeys);
  const rawEntryId = fields["entryId"];
  const entryId = rawEntryId === undefined ? undefined : trimmedText(rawEntryId);

  if (rawEntryId !== undefined && entryId === undefined) {
    diagnostics.push(`${label}.entryId must be a non-empty entry identifier`);

    return { kind: "rejected", diagnostics };
  }

  const position = fields["position"];

  if (position !== undefined && position !== "before" && position !== "at") {
    diagnostics.push(
      `${label}.position must be one of before, at, got ${JSON.stringify(position)}`,
    );

    return { kind: "rejected", diagnostics };
  }

  if (position !== undefined && entryId === undefined) {
    diagnostics.push(`${label}.position needs ${label}.entryId: there is nothing to cut at`);

    return { kind: "rejected", diagnostics };
  }

  return {
    kind: "parsed",
    value: {
      ...(entryId === undefined ? {} : { entryId }),
      ...(position === undefined ? {} : { position }),
    },
    diagnostics,
  };
}

export function parseSessionMessage(
  raw: unknown,
  label = "message",
): SettingsParseResult<SessionMessage> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, messageKeys);
  const said = parseSaidMessage(fields, label, diagnostics);

  if (said === undefined) {
    return { kind: "rejected", diagnostics };
  }

  const mode = fields["mode"];

  // Умолчания у режима нет намеренно: у четырёх режимов разные предусловия по занятости сессии, и
  // угаданный за отправителя режим отличался бы от задуманного молча.
  if (!isSessionMessageMode(mode)) {
    diagnostics.push(
      `${label}.mode must be one of ${sessionMessageModes.join(", ")}, got ${JSON.stringify(mode)}`,
    );

    return { kind: "rejected", diagnostics };
  }

  return { kind: "parsed", value: { ...said, mode }, diagnostics };
}

export function parseSessionCompactRequest(
  raw: unknown,
  label = "compaction",
): SettingsParseResult<SessionCompactRequest> {
  // Пустое тело — законная компакция по промпту рантайма, поэтому отсутствующее равно пустому.
  const fields = raw === undefined || raw === null ? {} : asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, compactKeys);
  const rawInstructions = fields["instructions"];
  const instructions = rawInstructions === undefined ? undefined : trimmedText(rawInstructions);

  if (rawInstructions !== undefined && instructions === undefined) {
    diagnostics.push(`${label}.instructions must be a non-empty text, or absent`);

    return { kind: "rejected", diagnostics };
  }

  return {
    kind: "parsed",
    value: { ...(instructions === undefined ? {} : { instructions }) },
    diagnostics,
  };
}

export function parseSessionNavigateRequest(
  raw: unknown,
  label = "navigation",
): SettingsParseResult<SessionNavigateRequest> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, navigateKeys);
  const entryId = trimmedText(fields["entryId"]);

  // Умолчания у цели нет: «перейти неизвестно куда» — не операция. Форк себе такое позволяет,
  // потому что форк без записи значит «вся сессия», а у перехода такого смысла не существует.
  if (entryId === undefined) {
    diagnostics.push(`${label}.entryId must be a non-empty entry identifier`);

    return { kind: "rejected", diagnostics };
  }

  const summarize = fields["summarize"];

  if (summarize !== undefined && typeof summarize !== "boolean") {
    diagnostics.push(`${label}.summarize must be a boolean, got ${JSON.stringify(summarize)}`);

    return { kind: "rejected", diagnostics };
  }

  const replaceInstructions = fields["replaceInstructions"];

  if (replaceInstructions !== undefined && typeof replaceInstructions !== "boolean") {
    diagnostics.push(
      `${label}.replaceInstructions must be a boolean, got ${JSON.stringify(replaceInstructions)}`,
    );

    return { kind: "rejected", diagnostics };
  }

  const rawInstructions = fields["instructions"];
  const instructions = rawInstructions === undefined ? undefined : trimmedText(rawInstructions);

  if (rawInstructions !== undefined && instructions === undefined) {
    diagnostics.push(`${label}.instructions must be a non-empty text, or absent`);

    return { kind: "rejected", diagnostics };
  }

  // Инструкции без пересказа никуда не поедут: пересказывать нечего. Отказ вместо тихого игнора —
  // иначе отправитель уверен, что его промпт применён.
  if (instructions !== undefined && summarize !== true) {
    diagnostics.push(
      `${label}.instructions needs ${label}.summarize: there is nothing to instruct`,
    );

    return { kind: "rejected", diagnostics };
  }

  if (replaceInstructions !== undefined && instructions === undefined) {
    diagnostics.push(
      `${label}.replaceInstructions needs ${label}.instructions: there is nothing to replace with`,
    );

    return { kind: "rejected", diagnostics };
  }

  return {
    kind: "parsed",
    value: {
      entryId,
      ...(summarize === undefined ? {} : { summarize }),
      ...(instructions === undefined ? {} : { instructions }),
      ...(replaceInstructions === undefined ? {} : { replaceInstructions }),
    },
    diagnostics,
  };
}

export function parseSessionLabelUpdate(
  raw: unknown,
  label = "label",
): SettingsParseResult<SessionLabelUpdate> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, labelKeys);
  const value = fields["label"];

  // `null` — это снятие, и оно обязано быть написано явно. Отсутствующий ключ значил бы «не трогать»,
  // а «не трогать» у записи, которая заменяет запись целиком, — не операция.
  if (value === null) {
    return { kind: "parsed", value: { label: null }, diagnostics };
  }

  const text = trimmedText(value);

  if (text === undefined) {
    diagnostics.push(`${label}.label must be a non-empty text, or null to clear it`);

    return { kind: "rejected", diagnostics };
  }

  return { kind: "parsed", value: { label: text }, diagnostics };
}

/**
 * Что сказал человек: текст и приложенные изображения. Общий разбор у турна и у сообщения — иначе
 * стиринг с картинкой и турн с картинкой разошлись бы в том, что считается пустым сообщением.
 */
function parseSaidMessage(
  fields: Record<string, unknown>,
  label: string,
  diagnostics: string[],
): { text: string; images?: SessionImage[] } | undefined {
  const images = parseSessionImages(fields["images"], label, diagnostics);

  if (images === undefined) {
    return undefined;
  }

  const text = trimmedText(fields["text"]);

  // Текст обязателен ровно до тех пор, пока нечего показать вместо него.
  if (text === undefined && images.length === 0) {
    diagnostics.push(
      `${label}.text must be a non-empty message, or ${label}.images must not be empty`,
    );

    return undefined;
  }

  return {
    text: text ?? "",
    ...(images.length === 0 ? {} : { images }),
  };
}

/**
 * Разбор приложенных изображений. Пределы размера здесь не проверяются: они живут в `config.json`, а
 * этот пакет читает и браузер, у которого файла настроек нет. Проверяется форма — то, что верно
 * всегда и везде.
 */
function parseSessionImages(
  raw: unknown,
  label: string,
  diagnostics: string[],
): SessionImage[] | undefined {
  if (raw === undefined) {
    return [];
  }

  if (!Array.isArray(raw)) {
    diagnostics.push(`${label}.images must be a list of images`);

    return undefined;
  }

  // Пустой список — не «сообщение без картинок», а противоречие: ключ назвали, приложить забыли.
  if (raw.length === 0) {
    diagnostics.push(`${label}.images must not be empty when it is named at all`);

    return undefined;
  }

  const images: SessionImage[] = [];

  for (const [index, one] of raw.entries()) {
    const at = `${label}.images[${String(index)}]`;
    const image = asObject(one);

    if (image === undefined) {
      diagnostics.push(`${at} must be an object`);

      return undefined;
    }

    diagnostics.push(...diagnoseUnknownKeys(at, image, imageKeys));

    const mimeType = image["mimeType"];

    if (!isSessionImageMimeType(mimeType)) {
      diagnostics.push(
        `${at}.mimeType must be one of ${sessionImageMimeTypes.join(", ")}, got ${JSON.stringify(mimeType)}`,
      );

      return undefined;
    }

    const data = image["data"];

    if (typeof data !== "string" || !isCanonicalBase64(data)) {
      diagnostics.push(`${at}.data must be canonical base64 without a data: prefix`);

      return undefined;
    }

    if (!startsAsDeclared(data, mimeType)) {
      diagnostics.push(`${at}.data does not start the way ${mimeType} must`);

      return undefined;
    }

    images.push({ mimeType, data });
  }

  return images;
}

/**
 * Строгий base64: без пробелов, без переносов, без `data:` и без лишних битов в хвосте. Строгость
 * здесь не придирка — она делает счёт байтов по длине строки точным, а значит и предел размера
 * честным.
 */
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0 || !base64Pattern.test(value)) {
    return false;
  }

  // Обратная сборка ловит хвостовые биты, которые декодер прощает, а канонический base64 — нет.
  return Buffer.from(value, "base64").toString("base64") === value;
}

/**
 * Первые байты обязаны соответствовать объявленному типу. Иначе `image/png` с содержимым архива
 * доезжает до провайдера и возвращается его невнятной ошибкой вместо нашей внятной.
 */
const formatSignatures: Record<SessionImageMimeType, number[][]> = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/gif": [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  ],
  // У WebP между `RIFF` и `WEBP` лежит длина файла, поэтому проверяются два куска, а не один.
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
};

function startsAsDeclared(data: string, mimeType: SessionImageMimeType): boolean {
  const bytes = Buffer.from(data, "base64");
  const matched = formatSignatures[mimeType].some((signature) =>
    signature.every((byte, index) => bytes[index] === byte),
  );

  if (!matched) {
    return false;
  }

  return mimeType !== "image/webp" || bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

/** Модель и уровень ризонинга разбираются одинаково и в теле создания, и в теле турна. */
function parseOverrides(
  fields: Record<string, unknown>,
  label: string,
  diagnostics: string[],
): { model?: string; thinkingLevel?: ThinkingLevel } | undefined {
  const model = fields["model"];

  if (model !== undefined && trimmedText(model) === undefined) {
    diagnostics.push(`${label}.model must be a non-empty model identifier`);

    return undefined;
  }

  const thinkingLevel = fields["thinkingLevel"];

  if (thinkingLevel !== undefined && !isThinkingLevel(thinkingLevel)) {
    diagnostics.push(
      `${label}.thinkingLevel must be one of ${thinkingLevels.join(", ")}, got ${JSON.stringify(thinkingLevel)}`,
    );

    return undefined;
  }

  return {
    ...(model === undefined ? {} : { model: trimmedText(model) as string }),
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
  };
}

/** Пробелы по краям — опечатка ввода, а не часть значения. */
function trimmedText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

function asObject(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

function diagnoseUnknownKeys(
  label: string,
  fields: Record<string, unknown>,
  known: string[],
): string[] {
  return Object.keys(fields)
    .filter((key) => !known.includes(key))
    .map((key) => `${label}: unknown key ${JSON.stringify(key)} is ignored`);
}
