/**
 * События рантайма как точки вмешательства (docs/hooks.md): полный список имён и правило слияния
 * каждого. Живёт в пакете реализации, потому что это знание о Pi; наружу уходят имена и вид слияния,
 * а не типы рантайма.
 *
 * Классификация **пришпилена к типам Pi**: два присваивания ниже ломают сборку, если мы назвали
 * наблюдательным событие, у которого Pi ждёт результат, или наоборот. Список имён так же ломает
 * сборку, если у Pi появилось или исчезло событие.
 */

import type { AgentEvent, AgentHarnessEventResultMap } from "@earendil-works/pi-agent-core";
import type { HookMergeKind } from "@sovereign/protocol";

/** Имена всех 32 событий: 22 у harness плюс 10 у цикла агента. */
export type RuntimeHookName = keyof AgentHarnessEventResultMap | AgentEvent["type"];

/**
 * Перехватывающие — те, у которых в карте результатов Pi есть что вернуть. Считается из карты, а не
 * перечисляется: список из восьми имён разошёлся бы с рантаймом при первом же обновлении.
 */
type InterceptingHookName = {
  [Name in keyof AgentHarnessEventResultMap]: AgentHarnessEventResultMap[Name] extends undefined
    ? never
    : Name;
}[keyof AgentHarnessEventResultMap];

type ObservingHookName = Exclude<RuntimeHookName, InterceptingHookName>;

export const runtimeHookKinds = {
  // Восемь перехватывающих. `tool_call` — решающий, а не перезаписывающий: он не переписывает
  // данные, а запрещает действие (docs/hooks.md).
  before_agent_start: "rewriting",
  context: "rewriting",
  before_provider_request: "rewriting",
  before_provider_payload: "rewriting",
  tool_call: "deciding",
  tool_result: "rewriting",
  session_before_compact: "rewriting",
  session_before_tree: "rewriting",

  // Четырнадцать уведомительных у harness.
  after_provider_response: "observing",
  session_compact: "observing",
  session_tree: "observing",
  retry_scheduled: "observing",
  retry_attempt_start: "observing",
  retry_finished: "observing",
  model_update: "observing",
  thinking_level_update: "observing",
  resources_update: "observing",
  tools_update: "observing",
  queue_update: "observing",
  save_point: "observing",
  abort: "observing",
  settled: "observing",

  // Десять событий цикла агента: возвращаемого значения у них нет по устройству Pi.
  agent_start: "observing",
  agent_end: "observing",
  turn_start: "observing",
  turn_end: "observing",
  message_start: "observing",
  message_update: "observing",
  message_end: "observing",
  tool_execution_start: "observing",
  tool_execution_update: "observing",
  tool_execution_end: "observing",
} as const satisfies Record<RuntimeHookName, HookMergeKind>;

/** Расхождение классификации с картой результатов Pi ловится здесь, а не в рантайме. */
const interceptingAreNotObserving: Record<InterceptingHookName, "rewriting" | "deciding"> =
  runtimeHookKinds;
const observingReturnNothing: Record<ObservingHookName, "observing"> = runtimeHookKinds;

void interceptingAreNotObserving;
void observingReturnNothing;

export const runtimeHookNames = Object.keys(runtimeHookKinds) as RuntimeHookName[];

export function isRuntimeHookName(value: unknown): value is RuntimeHookName {
  return typeof value === "string" && value in runtimeHookKinds;
}

/**
 * Событие, у которого есть возвращаемое значение. Обработчик такого события ядро зовёт и **ждёт**;
 * остальные уходят наблюдением, и их не ждут (docs/hooks.md).
 */
export function isInterceptingHookName(value: unknown): boolean {
  return isRuntimeHookName(value) && runtimeHookKinds[value] !== "observing";
}
