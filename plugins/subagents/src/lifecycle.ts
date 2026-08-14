/**
 * Жизненный цикл субагента: как узнаётся, что он закончил, и как результат доезжает до родителя
 * (docs/subagents.md).
 *
 * Завершение ловится **фазой**, а не хуком `turn_finished`: хук срабатывает только на удачном
 * турне, а сорвавшийся и прерванный субагент обязан доехать до родителя так же. Фаза `idle` у
 * записи, которую мы сами перевели в работу, значит «отработал» при любом из трёх исходов.
 */

import { log, sessions, type Session, type SessionEntry } from "@sovereign/sdk";

import { readRecord, writeRecord, type SubagentRecord } from "./registry.ts";

/**
 * Свести последнее сообщение агента в текст. Именно последнее, а не вся ветка: родителю нужен
 * ответ, а не пересказ разговора, и остальное он всегда может прочитать сам.
 */
export function lastAgentText(entries: readonly SessionEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (entry?.kind !== "message" || entry.role !== "agent") {
      continue;
    }

    const text = entry.content
      .flatMap((block) => (block.kind === "text" ? [block.text] : []))
      .join("\n")
      .trim();

    if (text.length > 0) {
      return text;
    }
  }

  return undefined;
}

/** Что родитель прочитает, когда субагент закончил. */
export function notification(record: SubagentRecord): string {
  const head = `Subagent ${record.sessionId} (${record.description}) ${verdict(record)}.`;

  if (record.state === "finished") {
    return `${head}\n\n${record.lastResponse ?? "It answered with no text."}`;
  }

  return record.failure === undefined ? head : `${head}\n\n${record.failure}`;
}

function verdict(record: SubagentRecord): string {
  if (record.state === "stopped") {
    return "was stopped";
  }

  return record.state === "failed" ? "failed" : "finished";
}

/**
 * Довести запись до конца: прочитать итог и позвать родителя. Зовётся и по событию шины, и при
 * реконсиляции после перезагрузки воркера — второго кода на это нет намеренно.
 *
 * `stopped` доходит сюда тоже: прерванный субагент успел что-то сказать, и молчать о нём значит
 * оставить родителя ждать ответа, которого не будет.
 */
export async function finish(record: SubagentRecord, now: string): Promise<SubagentRecord> {
  const settled: SubagentRecord = {
    ...record,
    state: record.state === "stopped" ? "stopped" : "finished",
    finishedAt: now,
    notified: false,
  };

  try {
    const branch = await sessions.branch(record.sessionId);
    const text = lastAgentText(branch.entries);

    if (text !== undefined) {
      settled.lastResponse = text;
    }
  } catch (cause) {
    // Ветку не прочитать — субагент всё равно закончил: без итога родителю уедет причина, а не
    // тишина. Причина попадает и в запись, и в журнал.
    settled.state = "failed";
    settled.failure = describe(cause);
    await log.warn("reading the branch of a subagent failed", {
      sessionId: record.sessionId,
      reason: settled.failure,
    });
  }

  await writeRecord(settled);

  return deliver(settled);
}

/**
 * Позвать родителя и запомнить, что позвали.
 *
 * Способ выбирается по фазе родителя. Идущему турну — `follow-up`: обе очереди рантайма
 * вычитываются только изнутри идущего турна, и дозапись осталась бы непрочитанной. Простаивающему —
 * обычный `prompt`, то есть уведомление начинает новый турн: иначе родитель узнал бы о результате
 * только тогда, когда его о чём-нибудь спросит человек.
 *
 * Фаза может смениться между чтением списка и вызовом, а родитель, стоящий в очереди за слотом,
 * не принимает **ни того, ни другого**: турн ещё не идёт, а простоем это уже не считается. Поэтому
 * недоставленное уведомление не теряется — оно остаётся в записи и уезжает со следующим обходом.
 */
export async function deliver(record: SubagentRecord): Promise<SubagentRecord> {
  const text = notification(record);

  try {
    const parent = (await sessions.list(record.projectId)).find(
      (session) => session.id === record.parentSessionId,
    );

    if (parent === undefined) {
      // Родителя стёрли или заархивировали. Ждать больше нечего: работа субагента записана и
      // видна в панели, а звать некого.
      await log.warn("the parent session of a subagent is gone", {
        sessionId: record.sessionId,
        parentSessionId: record.parentSessionId,
      });

      return await settle({ ...record, notified: true });
    }

    if (parent.phase === "idle") {
      await sessions.prompt({ sessionId: parent.id, text });
    } else {
      await sessions.message(parent.id, { text, mode: "follow-up" });
    }

    return await settle({ ...record, notified: true });
  } catch (cause) {
    // Отказ по занятости — обычное состояние, а не сбой: попробуем ещё раз со следующим событием
    // шины. Причина остаётся в журнале, чтобы застрявшее уведомление было видно.
    await log.debug("telling the parent session about a subagent did not go through", {
      sessionId: record.sessionId,
      parentSessionId: record.parentSessionId,
      reason: describe(cause),
    });

    return record;
  }
}

async function settle(record: SubagentRecord): Promise<SubagentRecord> {
  await writeRecord(record);

  return record;
}

/**
 * Пройтись по записям: идущие, чьи сессии простаивают, довести до конца; законченные, о которых
 * родитель ещё не узнал, — дослать.
 *
 * Простой — надёжный признак конца: `sessions.prompt` возвращает уже непростойную фазу, поэтому
 * окна «задание принято, но сессия ещё `idle`» не существует.
 */
export async function reconcile(records: readonly SubagentRecord[], now: string): Promise<void> {
  const byProject = new Map<string, Session[]>();
  const listed = async (projectId: string): Promise<Session[]> => {
    const known = byProject.get(projectId);

    if (known !== undefined) {
      return known;
    }

    const fresh = await sessions.list(projectId);
    byProject.set(projectId, fresh);

    return fresh;
  };

  for (const record of records) {
    if (record.state !== "running") {
      if (record.notified !== true) {
        await deliver(record);
      }

      continue;
    }

    const session = (await listed(record.projectId)).find((one) => one.id === record.sessionId);

    if (session === undefined) {
      // Сессию стёрли под нами. Запись остаётся, но идущей она числиться не вправе.
      await deliver(
        await settle({
          ...record,
          state: "failed",
          finishedAt: now,
          failure: "the session of the subagent is gone",
          notified: false,
        }),
      );

      continue;
    }

    if (session.phase !== "idle") {
      continue;
    }

    // Читаем запись заново: между списком и этим местом её мог обновить параллельный обход, и
    // повторное уведомление родителя было бы вторым сообщением об одном и том же.
    const current = await readRecord(record.sessionId);

    if (current?.state === "running") {
      await finish(current, now);
    }
  }
}

export function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
