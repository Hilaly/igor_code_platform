/**
 * Мир для тестов плагина: шов SDK плюс подставная платформа сессий. Отдельным файлом, а не внутри
 * теста, потому что все три набора тестов начинают с одного и того же — сессий, которые где-то
 * есть, и записей, которые где-то лежат.
 */

import { installTestHost, type PluginTestHost } from "@sovereign/sdk/testing";
import type {
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

export type World = {
  host: PluginTestHost;
  sessions: Map<string, FakeSession>;
  /** Что платформа сделала с сессиями, в порядке вызова: по этому виден способ уведомления. */
  calls: SessionRequest[];
  /** Следующий идентификатор созданной сессии. */
  nextId: string[];
  /** Отказать созданию сессии подписчиком на `before_session_start`. */
  refuseCreate?: string;
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

export function agentMessage(id: string, text: string): SessionEntry {
  return {
    id,
    time: "2026-08-14T09:00:00.000Z",
    kind: "message",
    role: "agent",
    content: [{ kind: "text", text }],
  };
}

export function installWorld(sessions: FakeSession[] = []): World {
  const host = installTestHost({ id: "subagents", source: "builtin" });
  const known = new Map(sessions.map((one) => [one.id, one]));
  const world: World = {
    host,
    sessions: known,
    calls: [],
    nextId: ["s-new"],
    restore: () => host.restore(),
  };

  host.answerSessions((request): SessionResponse => {
    world.calls.push(request);

    return answer(world, request);
  });

  return world;
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

function answer(world: World, request: SessionRequest): SessionResponse {
  if (request.kind === "agent-list") {
    return {
      kind: "agent-list",
      agents: [
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

    return {
      kind: "session-prompt",
      accepted: { sessionId: target.id, turnId: "t1", phase: "turn" },
    };
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

    return { kind: "session-abort", interrupted };
  }

  if (request.kind === "session-branch") {
    const target = world.sessions.get(request.sessionId);

    return target === undefined
      ? { kind: "failed", reason: `there is no session ${request.sessionId}` }
      : { kind: "session-branch", branch: { sessionId: target.id, entries: target.entries } };
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
