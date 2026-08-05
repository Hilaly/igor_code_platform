/**
 * Шов между рантаймом и сведением ответов (docs/hooks.md). Рантайм зовёт хуки, но правила слияния
 * живут здесь, и он о них не знает; аудитория — проект сессии, потому что подписка плагина проекта не
 * касается чужого проекта.
 *
 * Хук разрешения приезжает сюда своим методом, а не событием Pi: у `tool_call` нет ни сессии, ни
 * проекта, ни папки, и дописать их в событие рантайма нельзя.
 */

import type { RuntimeHookSeam } from "@sovereign/agent-runtime-pi";

import type { HookDispatcher } from "./hook-dispatch.ts";

/** Имя хука платформы, которым спрашивается разрешение на вызов инструмента. */
export const permissionHookName = "permission_request";

export function createRuntimeHookSeam(dispatcher: HookDispatcher): RuntimeHookSeam {
  return {
    for: (session) => {
      const audience = { projectId: session.projectId };

      return {
        subscribed: (event) => dispatcher.subscribed(event, audience),
        observe: (event, payload) => dispatcher.observe(event, payload, audience),
        decide: (event, payload) => dispatcher.decide(event, payload, audience),
        rewrite: async (event, payload) => {
          const rewritten = await dispatcher.rewrite(event, payload, audience);

          return {
            patch: rewritten.patch,
            ...(rewritten.aborted === undefined ? {} : { aborted: rewritten.aborted }),
          };
        },
        permission: (call) =>
          dispatcher.decide(
            permissionHookName,
            {
              sessionId: session.sessionId,
              projectId: session.projectId,
              folder: session.folder,
              tool: call.tool,
              arguments: call.arguments,
            },
            audience,
          ),
      };
    },
  };
}
