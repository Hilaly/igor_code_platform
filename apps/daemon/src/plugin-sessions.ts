/**
 * Мост сессий агента между воркером плагина и ядром (docs/sessions-and-projects.md).
 *
 * Вторая — и последняя — пара «запрос-ответ» в канале плагина. Односторонность канала остаётся
 * правилом: исключение сделано там же, где и у провайдеров, — операция без ответа бессмысленна
 * (docs/plugins.md).
 *
 * **Служба та же, что у веб-API.** Второй экземпляр означал бы вторые сессии: плагин создал бы
 * сессию, которой человек не видит.
 */

import type {
  AgentSummary as PluginAgentSummary,
  Session as PluginSession,
  SessionBranch as PluginSessionBranch,
  SessionCompactAccepted as PluginSessionCompactAccepted,
  SessionCompactRequest as PluginSessionCompactRequest,
  SessionContextUsage as PluginSessionContextUsage,
  SessionEntriesPage as PluginSessionEntriesPage,
  SessionEntryLabelled as PluginSessionEntryLabelled,
  SessionLabelUpdate as PluginSessionLabelUpdate,
  SessionMessage as PluginSessionMessage,
  SessionNavigated as PluginSessionNavigated,
  SessionNavigateRequest as PluginSessionNavigateRequest,
  SessionRequest,
  SessionResponse,
  SessionStats as PluginSessionStats,
  SessionUpdate as PluginSessionUpdate,
} from "@sovereign/sdk";
import type {
  AgentSummary,
  Session,
  SessionBranch,
  SessionCompactAccepted,
  SessionCompactRequest,
  SessionContextUsage,
  SessionEntriesPage,
  SessionEntryLabelled,
  SessionLabelUpdate,
  SessionMessage,
  SessionNavigated,
  SessionNavigateRequest,
  SessionStats,
  SessionUpdate,
} from "@sovereign/protocol";

import type { PluginRequest } from "./plugin-wire.ts";
import type { SessionService } from "./sessions/public.ts";

/**
 * Копии типов в SDK обязаны совпадать с протоколом до поля, и ловится это здесь: присваивание идёт
 * в обе стороны, поэтому разъехавшиеся копии перестают компилироваться (`plugin-providers.ts`).
 */
function sameShape<Left, Right>(bothWays: {
  forward: (value: Left) => Right;
  backward: (value: Right) => Left;
}): (value: Left) => Right {
  return bothWays.forward;
}

const sessionForPlugin = sameShape<Session, PluginSession>({
  forward: (session) => session,
  backward: (session) => session,
});

const pageForPlugin = sameShape<SessionEntriesPage, PluginSessionEntriesPage>({
  forward: (page) => page,
  backward: (page) => page,
});

const statsForPlugin = sameShape<SessionStats, PluginSessionStats>({
  forward: (stats) => stats,
  backward: (stats) => stats,
});

// Тождество по ветке заодно сверяет и `SessionEntry`: он едет внутри неё, и разъехавшийся союз
// записей перестаёт присваиваться в обе стороны.
const branchForPlugin = sameShape<SessionBranch, PluginSessionBranch>({
  forward: (branch) => branch,
  backward: (branch) => branch,
});

const contextForPlugin = sameShape<SessionContextUsage, PluginSessionContextUsage>({
  forward: (usage) => usage,
  backward: (usage) => usage,
});

const compactionForPlugin = sameShape<SessionCompactAccepted, PluginSessionCompactAccepted>({
  forward: (accepted) => accepted,
  backward: (accepted) => accepted,
});

const navigationForPlugin = sameShape<SessionNavigated, PluginSessionNavigated>({
  forward: (navigated) => navigated,
  backward: (navigated) => navigated,
});

const labelForPlugin = sameShape<SessionEntryLabelled, PluginSessionEntryLabelled>({
  forward: (labelled) => labelled,
  backward: (labelled) => labelled,
});

// Тела едут в обратную сторону — от плагина к платформе, — поэтому и тождество здесь обратное.
const updateFromPlugin = sameShape<PluginSessionUpdate, SessionUpdate>({
  forward: (update) => update,
  backward: (update) => update,
});

const messageFromPlugin = sameShape<PluginSessionMessage, SessionMessage>({
  forward: (message) => message,
  backward: (message) => message,
});

const compactionFromPlugin = sameShape<PluginSessionCompactRequest, SessionCompactRequest>({
  forward: (request) => request,
  backward: (request) => request,
});

const navigationFromPlugin = sameShape<PluginSessionNavigateRequest, SessionNavigateRequest>({
  forward: (request) => request,
  backward: (request) => request,
});

const labelFromPlugin = sameShape<PluginSessionLabelUpdate, SessionLabelUpdate>({
  forward: (update) => update,
  backward: (update) => update,
});

const agentForPlugin = sameShape<AgentSummary, PluginAgentSummary>({
  forward: (agent) => agent,
  backward: (agent) => ({ ...agent, source: agent.source as AgentSummary["source"] }),
});

/**
 * Каналов «запрос-ответ» два, а вид сообщения на проводе один: разводит их вид самого запроса.
 * Виды не пересекаются по построению — у сессий они начинаются с `session-` или `agent-`.
 */
export function isSessionRequest(request: PluginRequest): request is SessionRequest {
  return request.kind.startsWith("session-") || request.kind.startsWith("agent-");
}

export type PluginSessionsOptions = {
  sessions: Pick<
    SessionService,
    | "agents"
    | "list"
    | "create"
    | "entries"
    | "prompt"
    | "abort"
    | "fork"
    | "update"
    | "remove"
    | "message"
    | "stats"
    | "branch"
    | "contextUsage"
    | "compact"
    | "navigate"
    | "labelEntry"
  >;
};

export type PluginSessions = {
  answer: (request: SessionRequest) => Promise<SessionResponse>;
};

/** Отказ одной строкой. «Нет такой сессии» — отдельный текст: это не состояние, а отсутствие. */
function refusal(
  outcome: { kind: "unknown" } | { kind: "refused"; reason: string },
  sessionId: string,
): string {
  return outcome.kind === "unknown" ? `no session ${sessionId}` : outcome.reason;
}

export function createPluginSessions(options: PluginSessionsOptions): PluginSessions {
  const { sessions } = options;

  return {
    answer: async (request) => {
      switch (request.kind) {
        case "agent-list":
          return { kind: "agent-list", agents: sessions.agents().map(agentForPlugin) };
        case "session-list":
          return {
            kind: "session-list",
            sessions: sessions.list(request.projectId, request.archived).map(sessionForPlugin),
          };
        case "session-create": {
          const created = await sessions.create(request.draft);

          if (created.kind === "created") {
            return { kind: "session-create", session: sessionForPlugin(created.session) };
          }

          return {
            kind: "failed",
            reason:
              created.kind === "unknown-project"
                ? `no project ${request.draft.projectId}`
                : created.reason,
          };
        }
        case "session-entries": {
          const page = await sessions.entries(request.sessionId, request.after);

          return page === undefined
            ? { kind: "failed", reason: `no session ${request.sessionId}` }
            : { kind: "session-entries", page: pageForPlugin(page) };
        }
        case "session-prompt": {
          const accepted = await sessions.prompt(request.turn);

          if (accepted.kind === "accepted") {
            return { kind: "session-prompt", accepted: accepted.turn };
          }

          return {
            kind: "failed",
            reason:
              accepted.kind === "unknown"
                ? `no session ${request.turn.sessionId}`
                : accepted.reason,
          };
        }
        case "session-abort":
          return { kind: "session-abort", interrupted: await sessions.abort(request.sessionId) };
        case "session-fork": {
          const forked = await sessions.fork(request.sessionId, request.request);

          return forked.kind === "done"
            ? { kind: "session-fork", session: sessionForPlugin(forked.session) }
            : { kind: "failed", reason: refusal(forked, request.sessionId) };
        }
        case "session-update": {
          const written = await sessions.update(
            request.sessionId,
            updateFromPlugin(request.update),
          );

          return written.kind === "done"
            ? { kind: "session-update", session: sessionForPlugin(written.session) }
            : { kind: "failed", reason: refusal(written, request.sessionId) };
        }
        case "session-remove": {
          const removed = await sessions.remove(request.sessionId);

          return removed.kind === "removed"
            ? { kind: "session-remove" }
            : { kind: "failed", reason: refusal(removed, request.sessionId) };
        }
        case "session-message": {
          const accepted = await sessions.message(
            request.sessionId,
            messageFromPlugin(request.message),
          );

          return accepted.kind === "accepted"
            ? { kind: "session-message", accepted: accepted.accepted }
            : { kind: "failed", reason: refusal(accepted, request.sessionId) };
        }
        case "session-stats": {
          const counted = await sessions.stats(request.sessionId);

          return counted === undefined
            ? { kind: "failed", reason: `no session ${request.sessionId}` }
            : { kind: "session-stats", stats: statsForPlugin(counted) };
        }
        case "session-branch": {
          const found = await sessions.branch(request.sessionId, request.from);

          return found === undefined
            ? { kind: "failed", reason: `no session ${request.sessionId}` }
            : { kind: "session-branch", branch: branchForPlugin(found) };
        }
        case "session-context": {
          const counted = await sessions.contextUsage(request.sessionId);

          return counted === undefined
            ? { kind: "failed", reason: `no session ${request.sessionId}` }
            : { kind: "session-context", usage: contextForPlugin(counted) };
        }
        case "session-compact": {
          const accepted = await sessions.compact(
            request.sessionId,
            compactionFromPlugin(request.request),
          );

          return accepted.kind === "accepted"
            ? { kind: "session-compact", accepted: compactionForPlugin(accepted.accepted) }
            : { kind: "failed", reason: refusal(accepted, request.sessionId) };
        }
        case "session-navigate": {
          const moved = await sessions.navigate(
            request.sessionId,
            navigationFromPlugin(request.request),
          );

          return moved.kind === "done"
            ? { kind: "session-navigate", navigated: navigationForPlugin(moved.navigated) }
            : { kind: "failed", reason: refusal(moved, request.sessionId) };
        }
        case "session-label": {
          const written = await sessions.labelEntry(
            request.sessionId,
            request.entryId,
            labelFromPlugin(request.update),
          );

          return written.kind === "done"
            ? { kind: "session-label", labelled: labelForPlugin(written.labelled) }
            : { kind: "failed", reason: refusal(written, request.sessionId) };
        }
      }
    },
  };
}
