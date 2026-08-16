/**
 * Инструменты управления субагентами (docs/subagents.md). Семь штук: запустить, посмотреть, из чего
 * выбирать агентов и модели, прочитать итог, дописать задание, остановить.
 *
 * Запуск **фоновый**. Ждать субагента внутри вызова нельзя: инструмент плагина мерится своим
 * таймаутом, а ожидающий вызов вдобавок держит слот турна родителя, которых на всю платформу
 * четыре. Поэтому `subagent-spawn` возвращается сразу, а итог доезжает до родителя сам.
 */

import { contribute, providers, sessions, thinkingLevels, z } from "@sovereign/sdk";
import type { ModelSummary, ProviderSummary } from "@sovereign/sdk";

import { answerOf, launch, stop } from "./lifecycle.ts";
import { listRecords, readRecord, type SubagentRecord } from "./registry.ts";
import { isWorking } from "./state.ts";

const thinkingLevel = z.enum(thinkingLevels);

/** Строка списка: то же, что показывает панель, но плоским текстом для модели. */
function line(record: SubagentRecord): string {
  const parts = [
    `${record.sessionId} [${record.state}]`,
    record.description,
    `agent=${record.agentId}`,
    `model=${record.model}`,
    `thinking=${record.thinkingLevel}`,
  ];

  if (record.lastResponse !== undefined) {
    parts.push(`last: ${excerpt(record.lastResponse)}`);
  }

  if (record.failure !== undefined) {
    parts.push(`failure: ${record.failure}`);
  }

  return parts.join(" | ");
}

/** Шапка провайдера: выбор идёт по провайдеру не меньше, чем по модели, и голове нужен якорь. */
function providerLine(provider: ProviderSummary, count: number): string {
  return `${provider.id} (${provider.name}, ${count} models):`;
}

/** Строка модели: то, что subagent-spawn принимает в `model`, плюс то, что влияет на выбор. */
function modelLine(model: ModelSummary): string {
  const parts = [
    model.id,
    model.name,
    `context=${model.contextWindow}`,
    `maxTokens=${model.maxTokens}`,
    `reasoning=${model.reasoning ? "yes" : "no"}`,
  ];

  if (model.input.includes("image")) {
    parts.push("image input");
  }

  return parts.join(" | ");
}

function excerpt(text: string, limit = 160): string {
  const flat = text.replace(/\s+/gu, " ").trim();

  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/** Ошибка инструмента — исход рядом с текстом, а не исключение: турн от неё не обрывается. */
const failed = (content: string) => ({ content, isError: true });

export async function contributeTools(): Promise<void> {
  await contribute.tool({
    id: "subagent-spawn",
    title: "Start a subagent",
    description:
      "Start a subagent: a separate agent session that works on one task on its own and reports back. " +
      "Returns immediately — the answer of the subagent arrives on its own when it is done, so do not " +
      "poll for it. Give the subagent everything it needs in the prompt: it does not see this conversation.",
    parameters: z.object({
      description: z
        .string()
        .min(1)
        .describe("A short label for the task, three to five words. Shown to the human."),
      prompt: z
        .string()
        .min(1)
        .describe(
          "The task itself. Self-contained: the subagent sees nothing of this conversation.",
        ),
      agent: z
        .string()
        .optional()
        .describe("Which agent works on it. Omitted — the same agent as the calling session."),
      model: z
        .string()
        .optional()
        .describe("`<provider>/<model>`. Omitted — the default of the chosen agent."),
      thinkingLevel: thinkingLevel
        .optional()
        .describe(
          "How much the subagent reasons: one of off, minimal, low, medium, high, xhigh, max. " +
            "Omitted — the agent's own default, as subagent-types shows it; if the agent names " +
            "none, high.",
        ),
    }),
    invoke: async (given, invocation) => {
      const parent = (await sessions.list(invocation.projectId)).find(
        (session) => session.id === invocation.sessionId,
      );

      if (parent === undefined) {
        return failed(`the calling session ${invocation.sessionId} is not in its own project`);
      }

      const agentId = given.agent ?? parent.agentId;
      // Каталог спрашивается по проекту: агент, поставленный плагином из папки проекта, в базовый
      // набор не попадает, и без проекта здесь не нашёлся бы даже агент самой вызывающей сессии.
      const agents = await sessions.agents(invocation.projectId);
      const agent = agents.find((one) => one.id === agentId);

      if (agent === undefined) {
        return failed(`there is no agent ${agentId}; call subagent-types to see what is available`);
      }

      const created = await sessions.create({
        projectId: invocation.projectId,
        agentId,
        hidden: true,
        ...pick("model", given.model ?? agent.model),
        // Фолбэк уровня: названное вызывающим, затем дефолт агента, затем `high`. `off` здесь не
        // годится: субагент, запущенный без слова про ризонинг, молча терял бы его целиком.
        ...pick("thinkingLevel", given.thinkingLevel ?? agent.thinkingLevel ?? "high"),
      });

      // Отказ подписчика на `before_session_start` — исход по делу, а не сбой: он уезжает модели
      // текстом вместе с автором запрета (docs/hooks.md).
      if (created.kind === "refused") {
        return failed(
          `starting the subagent was refused: ${created.refusals
            .map((refusal) => `${refusal.contributionId}: ${refusal.reason}`)
            .join("; ")}`,
        );
      }

      const record: SubagentRecord = {
        sessionId: created.session.id,
        parentSessionId: invocation.sessionId,
        projectId: invocation.projectId,
        agentId,
        model: created.session.model,
        thinkingLevel: created.session.thinkingLevel,
        description: given.description,
        prompt: given.prompt,
        state: "starting",
        startedAt: new Date().toISOString(),
      };

      // Запись до задания: если `prompt` сорвётся, субагент уже виден и его можно довести руками.
      const started = await launch(record, given.prompt);

      if (started.kind === "failed") {
        return failed(
          `the subagent ${created.session.id} was created but did not start: ${started.reason}`,
        );
      }

      return (
        `Started subagent ${created.session.id} (${given.description}) on ${agentId}, ` +
        `model ${created.session.model}, thinking ${created.session.thinkingLevel}. ` +
        `Its answer will arrive on its own — carry on with your work and do not wait for it.`
      );
    },
  });

  await contribute.tool({
    id: "subagent-types",
    title: "List the agents a subagent can run as",
    description:
      "List the agents available to subagents, with their default model and reasoning level. " +
      "Call this before subagent-spawn when the task suits a specialised agent.",
    parameters: z.object({}),
    invoke: async (_given, invocation) => {
      const agents = await sessions.agents(invocation.projectId);

      if (agents.length === 0) {
        return "No agent is available.";
      }

      return agents
        .map((agent) => {
          const parts = [agent.id];

          if (agent.title !== undefined) {
            parts.push(agent.title);
          }

          if (agent.description !== undefined) {
            parts.push(agent.description);
          }

          parts.push(`model=${agent.model ?? "(none)"}`);
          parts.push(`thinking=${agent.thinkingLevel ?? "(none)"}`);

          return parts.join(" | ");
        })
        .join("\n");
    },
  });

  await contribute.tool({
    id: "subagent-models",
    title: "List the models a subagent can run on",
    description:
      "List the models that subagent-spawn accepts in its model parameter, as `<provider>/<model>` " +
      "values with context window, output limit and reasoning flag. Only signed-in providers are " +
      "listed: a model of a provider nobody signed in to cannot run. Narrow to one provider with " +
      "the provider option.",
    parameters: z.object({
      provider: z
        .string()
        .min(1)
        .optional()
        .describe("Only the models of this one provider, by its id (for example `zai`)."),
    }),
    invoke: async (given) => {
      const catalogue = await providers.list();
      // Настроенные — значит «может работать»: у остальных моделей сколько угодно, но ни один турн
      // на них не пойдёт, и список для выбора они не наполняют.
      const signedIn = catalogue.filter((one) => one.auth.kind === "configured");

      if (given.provider !== undefined) {
        const named = catalogue.find((one) => one.id === given.provider);

        if (named === undefined) {
          return failed(
            `there is no provider ${given.provider}; the signed-in providers are ` +
              (signedIn.length === 0 ? "none" : signedIn.map((one) => one.id).join(", ")),
          );
        }

        if (named.auth.kind !== "configured") {
          return failed(
            `the provider ${given.provider} is not signed in, so its models cannot run`,
          );
        }

        const models = await providers.models(named.id);

        if (models === undefined) {
          return failed(modelsOfFailure(named.id));
        }

        return [providerLine(named, models.length), ...models.map(modelLine)].join("\n");
      }

      if (signedIn.length === 0) {
        return "No provider is signed in, so there is no model to choose from.";
      }

      const sections: string[] = [];

      for (const provider of signedIn) {
        const models = await providers.models(provider.id);

        if (models === undefined) {
          return failed(modelsOfFailure(provider.id));
        }

        sections.push([providerLine(provider, models.length), ...models.map(modelLine)].join("\n"));
      }

      return sections.join("\n\n");
    },
  });

  await contribute.tool({
    id: "subagent-list",
    title: "List subagents",
    description:
      "List the subagents started from this session: what each is doing, how it went and an excerpt " +
      "of its last answer.",
    parameters: z.object({
      all: z
        .boolean()
        .optional()
        .describe("List subagents of every session, not only of this one. Defaults to false."),
    }),
    invoke: async (given, invocation) => {
      const records = (await listRecords()).filter(
        (record) => given.all === true || record.parentSessionId === invocation.sessionId,
      );

      return records.length === 0
        ? "No subagent has been started yet."
        : records.map(line).join("\n");
    },
  });

  await contribute.tool({
    id: "subagent-output",
    title: "Read what a subagent answered",
    description:
      "Read the full answer of one subagent. Use it when the excerpt in subagent-list is not enough " +
      "or when a subagent is still working and you want to see how far it got.",
    parameters: z.object({
      sessionId: z.string().min(1).describe("The subagent, by the identifier spawn returned."),
    }),
    invoke: async (given) => {
      const record = await readRecord(given.sessionId);

      if (record === undefined) {
        return failed(`there is no subagent ${given.sessionId}`);
      }

      if (record.lastResponse !== undefined) {
        return record.lastResponse;
      }

      // Итога ещё нет: субагент либо работает, либо кончился, не сказав ни слова. Читаем ветку
      // сейчас — то, что он успел сказать, полезнее отписки «пока ничего».
      const branch = await sessions.branch(given.sessionId);
      const said = answerOf(record, branch.entries);

      if (said !== undefined) {
        return said;
      }

      return record.state === "running"
        ? `The subagent ${given.sessionId} is still working and has not answered yet.`
        : `The subagent ${given.sessionId} ${record.state} without answering. ${record.failure ?? ""}`.trim();
    },
  });

  await contribute.tool({
    id: "subagent-message",
    title: "Send a subagent another message",
    description:
      "Send a message to a subagent. A working subagent is steered — the message reaches it inside " +
      "its current turn. A finished subagent takes it as a new task and reports back again.",
    parameters: z.object({
      sessionId: z.string().min(1).describe("The subagent, by the identifier spawn returned."),
      text: z.string().min(1).describe("What to tell it."),
    }),
    invoke: async (given) => {
      const record = await readRecord(given.sessionId);

      if (record === undefined) {
        return failed(`there is no subagent ${given.sessionId}`);
      }

      if (isWorking(record.state)) {
        await sessions.message(given.sessionId, { text: given.text, mode: "steer" });

        return `Steered the subagent ${given.sessionId}. Its answer will arrive on its own.`;
      }

      // Законченный субагент берёт второе задание обычным турном, без единого перехода файла:
      // ровно ради этого сессия скрытая, а не архивная. Итог прошлого задания стирается: старый
      // ответ рядом с новой работой вводил бы в заблуждение и панель, и модель.
      const restarted = await launch(
        {
          sessionId: record.sessionId,
          parentSessionId: record.parentSessionId,
          projectId: record.projectId,
          agentId: record.agentId,
          model: record.model,
          thinkingLevel: record.thinkingLevel,
          description: record.description,
          prompt: given.text,
          state: "starting",
          startedAt: new Date().toISOString(),
        },
        given.text,
      );

      if (restarted.kind === "failed") {
        return failed(
          `the subagent ${given.sessionId} did not take the new task: ${restarted.reason}`,
        );
      }

      return `Gave the subagent ${given.sessionId} a new task. Its answer will arrive on its own.`;
    },
  });

  await contribute.tool({
    id: "subagent-stop",
    title: "Stop a subagent",
    description:
      "Stop a working subagent. What it already said stays readable, and its session stays alive: " +
      "subagent-message can give it another task.",
    parameters: z.object({
      sessionId: z.string().min(1).describe("The subagent, by the identifier spawn returned."),
    }),
    invoke: async (given) => {
      // Остановка идёт очередью жизненного цикла: прерывание возвращает сессию в простой, и обход,
      // разбуженный этим же событием, тоже считает субагента отработавшим.
      const outcome = await stop(given.sessionId);

      if (outcome.kind === "unknown") {
        return failed(`there is no subagent ${given.sessionId}`);
      }

      if (outcome.kind === "already") {
        return `The subagent ${given.sessionId} had already ${outcome.state}.`;
      }

      return outcome.interrupted
        ? `Stopped the subagent ${given.sessionId}.`
        : `The subagent ${given.sessionId} had already stopped working.`;
    },
  });
}

/** Каталог назвал провайдера, а моделей не дал — это расхождение платформы, а не «пусто». */
const modelsOfFailure = (providerId: string) =>
  `the platform named the provider ${providerId} but gave no model list`;

/** Необязательное поле кладётся только когда оно есть: `undefined` в теле — это не «не сказано». */
function pick<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Record<Key, Value> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}
