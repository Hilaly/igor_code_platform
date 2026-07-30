/**
 * Сессия агента на проводе (docs/sessions-and-projects.md). Контракт лежит здесь, а не в демоне:
 * по этим же полям интерфейс рисует ленту сообщений, а SDK отдаёт ту же поверхность плагинам.
 *
 * Типов рантайма здесь нет и не будет: пакет импортируется браузером, а Pi живёт в
 * `@sovereign/agent-runtime-pi` (docs/architecture.md). Наружу уезжает перевод, а не записи Pi.
 */

import type { PluginSource } from "./plugin.ts";
import type { SettingsParseResult } from "./settings.ts";

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
  /** Проект, в папке которого идёт работа. Привязка выражена папкой (docs/sessions-and-projects.md). */
  projectId: string;
  folder: string;
  agentId: string;
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

/** Тело создания сессии. */
export type SessionDraft = {
  projectId: string;
  agentId: string;
  /** Не названа — берётся у агента; у агента нет — отказ с названной причиной. */
  model?: string;
  thinkingLevel?: ThinkingLevel;
};

/** Тело запуска турна. Переопределения действуют с этого турна и пишутся в дерево сессии. */
export type TurnRequest = {
  text: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
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
  mode: SessionMessageMode;
};

/** Ответ приёма сообщения. Фазы здесь нет: турна оно не запускает. */
export type SessionMessageAccepted = {
  sessionId: string;
  mode: SessionMessageMode;
};

/**
 * Очереди сообщений, ждущих своего момента. Отдаются наружу, потому что написавший стиринг обязан
 * видеть, что тот принят и ждёт, а не пропал.
 */
export type SessionQueues = {
  steer: string[];
  followUp: string[];
  nextTurn: string[];
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
  | { kind: "reasoning"; text: string }
  | { kind: "tool-call"; toolCallId: string; toolName: string; input: unknown };

/**
 * Запись дерева сессии в терминах контракта. Дерево ведёт рантайм, поэтому запись, которую этот срез
 * не переводит, приезжает как `other` с типом рантайма: молчаливая потеря записи сделала бы ленту
 * сообщений неполной без всякого следа.
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
  | { kind: "other"; type: string }
);

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
  | { kind: "message-end"; messageId: string }
  | { kind: "tool-start"; toolCallId: string; toolName: string; input: unknown }
  | { kind: "tool-end"; toolCallId: string; failed: boolean }
  | { kind: "turn-end" }
  | { kind: "turn-aborted" }
  | { kind: "turn-failed"; reason: string }
  | { kind: "queues"; queues: SessionQueues };

/** Агент глазами интерфейса: то, из чего выбирают при создании сессии. */
export type AgentSummary = {
  id: string;
  title?: string;
  description?: string;
  pluginKey: string;
  source: PluginSource;
  /** Модель по умолчанию. Её может не быть: тогда модель называют при создании сессии. */
  model?: string;
  thinkingLevel?: ThinkingLevel;
  skills: string[];
};

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
const turnKeys = ["text", "model", "thinkingLevel"];
const updateKeys = ["title", "archived"];
const forkKeys = ["entryId", "position"];
const messageKeys = ["text", "mode"];

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
  const text = trimmedText(fields["text"]);

  if (text === undefined) {
    diagnostics.push(`${label}.text must be a non-empty message`);

    return { kind: "rejected", diagnostics };
  }

  const overrides = parseOverrides(fields, label, diagnostics);

  if (overrides === undefined) {
    return { kind: "rejected", diagnostics };
  }

  return { kind: "parsed", value: { text, ...overrides }, diagnostics };
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
  const text = trimmedText(fields["text"]);

  if (text === undefined) {
    diagnostics.push(`${label}.text must be a non-empty message`);

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

  return { kind: "parsed", value: { text, mode }, diagnostics };
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
