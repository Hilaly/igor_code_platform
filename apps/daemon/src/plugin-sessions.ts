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
  SessionEntriesPage as PluginSessionEntriesPage,
  SessionRequest,
  SessionResponse,
} from "@sovereign/sdk";
import type { AgentSummary, Session, SessionEntriesPage } from "@sovereign/protocol";

import type { PluginRequest } from "./plugin-wire.ts";
import type { SessionService } from "./sessions.ts";

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
  sessions: Pick<SessionService, "agents" | "list" | "create" | "entries" | "prompt" | "abort">;
};

export type PluginSessions = {
  answer: (request: SessionRequest) => Promise<SessionResponse>;
};

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
            sessions: sessions.list(request.projectId).map(sessionForPlugin),
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
      }
    },
  };
}
