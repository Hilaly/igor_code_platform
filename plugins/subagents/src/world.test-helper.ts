/**
 * Мир для тестов плагина: шов SDK плюс подставная платформа сессий. Отдельным файлом, а не внутри
 * теста, потому что все три набора тестов начинают с одного и того же — сессий, которые где-то
 * есть, и записей, которые где-то лежат.
 */

import { installTestHost, type PluginTestHost } from "@sovereign/sdk/testing";
import type {
  AgentSummary,
  ModelSummary,
  ProviderRequest,
  ProviderResponse,
  ProviderSummary,
  Session,
  SessionEntry,
  SessionRequest,
  SessionResponse,
  ThinkingLevel,
} from "@sovereign/sdk";

export type FakeSession = {
  id: string;
  projectId: string;
  agentId: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  phase: Session["phase"];
  hidden: boolean;
  entries: SessionEntry[];
};

/** Провайдер мира: модели — короткими записями, остальное — умолчания как у настоящих. */
export type FakeModel = string | { id: string; input?: string[]; reasoning?: boolean };

export type FakeProvider = {
  id: string;
  name?: string;
  signedIn: boolean;
  models: FakeModel[];
  /** Каталог назвал провайдера, а список моделей не дал: проверка расхождения платформы. */
  noModelList?: boolean;
};

export type World = {
  host: PluginTestHost;
  sessions: Map<string, FakeSession>;
  /** Провайдеры каталога: подписка субагентов на модели спрашивает именно их. */
  providers: FakeProvider[];
  /** Что платформа сделала с сессиями, в порядке вызова: по этому виден способ уведомления. */
  calls: SessionRequest[];
  /** Следующий идентификатор созданной сессии. */
  nextId: string[];
  /** Отказать созданию сессии подписчиком на `before_session_start`. */
  refuseCreate?: string;
  /**
   * Турн, кончившийся раньше, чем `prompt` вернулся: сессия отвечает и сразу простаивает. Так
   * проверяется самое узкое место жизненного цикла — событие о конце работы проходит мимо записи,
   * которая ещё числится запускающейся.
   */
  answerAtOnce?: string;
  /**
   * Что делает платформа, вернув сессию в простой прерыванием. У настоящей это публикация
   * `core.sessions.changed`, то есть чужой обход прямо посреди остановки.
   */
  onAbort?: () => void;
  /**
   * Сколько платформа думает над чтением ветки. Настоящая ходит за ней через границу воркера, и
   * чужой обход успевает пройти свои шаги целиком, пока итог ещё не записан.
   */
  branchDelayMilliseconds?: number;
  /**
   * Сколько платформа думает над приёмом задания субагентом. Настоящая ходит за ним через границу
   * воркера, и остановка руками успевает прийти целиком, пока запуск ещё не кончился. Только
   * скрытым сессиям: уведомление родителя тем же вызовом задерживать незачем.
   */
  promptDelayMilliseconds?: number;
  restore: () => void;
};

export function session(overrides: Partial<FakeSession> & { id: string }): FakeSession {
  return {
    projectId: "p1",
    agentId: "starter.generic",
    model: "scripted/one",
    thinkingLevel: "off",
    phase: "idle",
    hidden: false,
    entries: [],
    ...overrides,
  };
}

/** Ответ агента. Время по умолчанию — сейчас: запись субагента заводится тем же часами. */
export function agentMessage(
  id: string,
  text: string,
  time = new Date().toISOString(),
): SessionEntry {
  return {
    id,
    time,
    kind: "message",
    role: "agent",
    content: [{ kind: "text", text }],
  };
}

export function installWorld(
  sessions: FakeSession[] = [],
  catalogue: FakeProvider[] = [
    { id: "scripted", name: "Scripted", signedIn: true, models: ["scripted/one", "scripted/two"] },
    {
      id: "example-vendor",
      name: "Example Vendor",
      signedIn: false,
      models: ["example-vendor/big"],
    },
  ],
): World {
  const host = installTestHost({ id: "subagents", source: "builtin" });
  const known = new Map(sessions.map((one) => [one.id, one]));
  const world: World = {
    host,
    sessions: known,
    providers: catalogue,
    calls: [],
    nextId: ["s-new"],
    restore: () => host.restore(),
  };

  host.answerSessions((request): SessionResponse | Promise<SessionResponse> => {
    world.calls.push(request);

    return answer(world, request);
  });

  host.answerProviders((request): ProviderResponse | Promise<ProviderResponse> => {
    return answerProvider(world, request);
  });

  return world;
}

function describeProvider(one: FakeProvider): ProviderSummary {
  return {
    id: one.id,
    name: one.name ?? one.id,
    logins: [],
    auth: one.signedIn ? { kind: "configured", type: "api_key" } : { kind: "unconfigured" },
    keys: one.signedIn ? [{ id: "key-1", label: "", type: "api_key" }] : [],
    ...(one.signedIn ? { selectedKey: "key-1" } : {}),
    dynamic: false,
    custom: false,
    origin: "builtin",
    modelCount: one.models.length,
  };
}

function describeModel(providerId: string, entry: FakeModel): ModelSummary {
  const id = typeof entry === "string" ? entry : entry.id;
  const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  const details = typeof entry === "string" ? undefined : entry;

  return {
    id,
    name: bare,
    providerId,
    contextWindow: 128_000,
    maxTokens: 8_192,
    reasoning: details?.reasoning ?? true,
    input: details?.input ?? ["text"],
    cost: { input: 1, output: 2 },
  };
}

function answerProvider(
  world: World,
  request: ProviderRequest,
): ProviderResponse | Promise<ProviderResponse> {
  if (request.kind === "list") {
    return { kind: "list", providers: world.providers.map(describeProvider) };
  }

  if (request.kind === "models") {
    const named = world.providers.find((one) => one.id === request.providerId);

    return {
      kind: "models",
      // `undefined` здесь — «провайдера нет», а расхождение каталога проверяется флагом.
      models:
        named === undefined || named.noModelList === true
          ? undefined
          : named.models.map((entry) => describeModel(named.id, entry)),
    };
  }

  return { kind: "failed", reason: `the test world does not answer ${request.kind}` };
}

function describeSession(one: FakeSession): Session {
  return {
    id: one.id,
    projectId: one.projectId,
    folder: "/tmp/project",
    agentId: one.agentId,
    agentAvailable: true,
    model: one.model,
    thinkingLevel: one.thinkingLevel,
    phase: one.phase,
    archived: false,
    hidden: one.hidden,
    createdAt: "2026-08-14T09:00:00.000Z",
  };
}

function answer(world: World, request: SessionRequest): SessionResponse | Promise<SessionResponse> {
  if (request.kind === "agent-list") {
    const base: AgentSummary[] = [
      {
        id: "starter.generic",
        ownership: "plugin",
        pluginKey: "builtin:starter",
        source: "builtin",
        model: "scripted/one",
        thinkingLevel: "medium",
        skills: { include: [], exclude: [] },
      },
      {
        id: "starter.reviewer",
        ownership: "plugin",
        pluginKey: "builtin:starter",
        source: "builtin",
        model: "scripted/two",
        thinkingLevel: "high",
        skills: { include: [], exclude: [] },
      },
      // Без собственного уровня: проверка фолбэка `subagent-spawn` на `high`.
      {
        id: "starter.nothinking",
        ownership: "plugin",
        pluginKey: "builtin:starter",
        source: "builtin",
        model: "scripted/one",
        skills: { include: [], exclude: [] },
      },
    ];

    // Как у платформы: агент из папки проекта есть только в каталоге, спрошенном по проекту.
    return {
      kind: "agent-list",
      agents:
        request.projectId === undefined
          ? base
          : [
              ...base,
              {
                id: "local.specialist",
                ownership: "plugin",
                pluginKey: `project:${request.projectId}:local`,
                source: `project:${request.projectId}`,
                model: "scripted/four",
                thinkingLevel: "low",
                skills: { include: [], exclude: [] },
              },
            ],
    };
  }

  if (request.kind === "session-list") {
    return {
      kind: "session-list",
      sessions: [...world.sessions.values()]
        .filter((one) => request.projectId === undefined || one.projectId === request.projectId)
        .map(describeSession),
    };
  }

  if (request.kind === "session-create") {
    if (world.refuseCreate !== undefined) {
      return {
        kind: "session-create",
        outcome: {
          kind: "refused",
          refusals: [{ contributionId: "guard.no-subagents", reason: world.refuseCreate }],
        },
      };
    }

    const id = world.nextId.shift() ?? "s-new";
    const created = session({
      id,
      projectId: request.draft.projectId,
      agentId: request.draft.agentId,
      ...(request.draft.model === undefined ? {} : { model: request.draft.model }),
      ...(request.draft.thinkingLevel === undefined
        ? {}
        : { thinkingLevel: request.draft.thinkingLevel }),
      hidden: request.draft.hidden === true,
    });

    world.sessions.set(id, created);

    return {
      kind: "session-create",
      outcome: { kind: "created", session: describeSession(created) },
    };
  }

  if (request.kind === "session-prompt") {
    const target = world.sessions.get(request.turn.sessionId);

    if (target === undefined) {
      return { kind: "failed", reason: `there is no session ${request.turn.sessionId}` };
    }

    // Как у настоящей платформы: занятая сессия турна не принимает вовсе, а принятый турн
    // возвращает уже непростойную фазу.
    if (target.phase !== "idle") {
      return { kind: "failed", reason: "the session is busy" };
    }

    target.phase = "turn";

    if (world.answerAtOnce !== undefined && target.hidden) {
      target.entries.push(
        agentMessage(`e${String(target.entries.length + 1)}`, world.answerAtOnce),
      );
      target.phase = "idle";
    }

    const accepted: SessionResponse = {
      kind: "session-prompt",
      accepted: { sessionId: target.id, turnId: "t1", phase: "turn" },
    };

    return world.promptDelayMilliseconds === undefined || !target.hidden
      ? accepted
      : new Promise((resolve) =>
          setTimeout(() => resolve(accepted), world.promptDelayMilliseconds),
        );
  }

  if (request.kind === "session-message") {
    const target = world.sessions.get(request.sessionId);

    // Стиринг и догоняющее требуют **идущего** турна: сессия, стоящая в очереди за слотом, для
    // рантайма ещё простаивает, и он отказывает ровно так же.
    if (target === undefined || (target.phase !== "turn" && target.phase !== "retry")) {
      return { kind: "failed", reason: "the session is idle" };
    }

    return {
      kind: "session-message",
      accepted: { sessionId: request.sessionId, mode: request.message.mode },
    };
  }

  if (request.kind === "session-abort") {
    const target = world.sessions.get(request.sessionId);
    const interrupted = target !== undefined && target.phase !== "idle";

    if (target !== undefined) {
      target.phase = "idle";
    }

    world.onAbort?.();

    return { kind: "session-abort", interrupted };
  }

  if (request.kind === "session-branch") {
    const target = world.sessions.get(request.sessionId);
    const response: SessionResponse =
      target === undefined
        ? { kind: "failed", reason: `there is no session ${request.sessionId}` }
        : { kind: "session-branch", branch: { sessionId: target.id, entries: target.entries } };

    return world.branchDelayMilliseconds === undefined
      ? response
      : new Promise((resolve) =>
          setTimeout(() => resolve(response), world.branchDelayMilliseconds),
        );
  }

  if (request.kind === "session-stats") {
    return {
      kind: "session-stats",
      stats: {
        sessionId: request.sessionId,
        messageCount: 2,
        cachedTokens: 0,
        uncachedTokens: 10,
        totalTokens: 10,
        costTotal: 0.01,
      },
    };
  }

  return { kind: "failed", reason: `the test world does not answer ${request.kind}` };
}
