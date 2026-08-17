/**
 * Жизненный цикл субагента: как узнаётся, что он закончил, и куда попадает его итог
 * (docs/subagents.md).
 *
 * Завершение ловится **фазой**, а не хуком `turn_finished`: хук срабатывает только на удачном
 * турне, а сорвавшийся и прерванный субагент обязан быть записан так же. Фаза `idle` у записи,
 * которую мы сами перевели в работу, значит «отработал» при любом из трёх исходов.
 *
 * **Итог никуда не рассылается.** Он ложится в запись, и там его читают: родитель — инструментами
 * `subagent-list` и `subagent-output`, человек — панелью. Ни сообщения, ни турна родителю плагин
 * не заводит.
 */

import { log, sessions, type Session, type SessionEntry } from "@sovereign/sdk";

import { listRecords, readRecord, writeRecord, type SubagentRecord } from "./registry.ts";
import { isWorking, type SubagentState } from "./state.ts";

/**
 * Очередь всего, что пишет записи субагентов. Одна на плагин: событие шины приходит на каждое
 * изменение любой сессии, и параллельные обходы подвели бы итог одной работе дважды, перечитав
 * ветку и переписав ответ поверх уже подведённого. По той же причине через неё идут остановка
 * руками и запуск: три записи запуска только тогда и значат что-то, когда между ними ту же запись
 * не переписал никто.
 */
let queue: Promise<void> = Promise.resolve();

function serialize<Value>(work: () => Promise<Value>): Promise<Value> {
  const done = queue.then(work);

  // Сорвавшаяся работа не рвёт очередь: следующему в ней своя причина не мешает.
  queue = done.then(
    () => undefined,
    () => undefined,
  );

  return done;
}

/** Дождаться, пока очередь опустеет. Нужно тому, кто обязан видеть итог: тесту и остановке. */
export function settled(): Promise<void> {
  return serialize(async () => undefined);
}

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

/**
 * Ответ на **текущее** задание: последнее сказанное агентом не раньше, чем задание началось.
 *
 * Сессия субагента переживает своё задание: законченному дают второе тем же турном, и вся прошлая
 * работа остаётся в той же ветке. Без отсечки по времени сорвавшееся второе задание вернуло бы
 * родителю ответ на первое — как свежий.
 */
export function answerOf(
  record: SubagentRecord,
  entries: readonly SessionEntry[],
): string | undefined {
  return lastAgentText(entries.filter((entry) => entry.time >= record.startedAt));
}

/**
 * Турн кончился, не сказав ни слова. Провал похода к модели в файл сессии не пишется вовсе, поэтому
 * отличить его от молчаливого турна плагину нечем — и выдавать молчание за удачный итог нельзя.
 */
const wordless =
  "It ended its turn without saying anything. A turn that fails leaves no trace in the session file, " +
  "so this may be a model or provider failure rather than a silent answer: read its work in the " +
  "Subagents panel, or give it the task again.";

/**
 * Довести запись до конца: прочитать итог и записать его. Зовётся и по событию шины, и при
 * реконсиляции после перезагрузки воркера — второго кода на это нет намеренно.
 *
 * `stopped` доходит сюда тоже: прерванный субагент успел что-то сказать, и терять сказанное значит
 * оставить спрашивающего без ответа, который на самом деле есть.
 */
export async function finish(record: SubagentRecord, now: string): Promise<SubagentRecord> {
  const settled: SubagentRecord = {
    ...record,
    state: record.state === "stopped" ? "stopped" : "finished",
    finishedAt: now,
  };

  try {
    const branch = await sessions.branch(record.sessionId);
    const text = answerOf(record, branch.entries);

    if (text !== undefined) {
      settled.lastResponse = text;
    } else if (settled.state === "finished") {
      // Прерванный молчит по понятной причине, а доработавший — нет: молчание это либо провал
      // похода к модели, либо турн без ответа, и различить их нечем. Выдавать его за удачный
      // итог значило бы врать о результате работы, за которую заплачено.
      settled.state = "failed";
      settled.failure = wordless;
    }
  } catch (cause) {
    // Ветку не прочитать — субагент всё равно закончил: в записи окажется причина, а не тишина.
    // Причина попадает и в запись, и в журнал.
    settled.state = "failed";
    settled.failure = describe(cause);
    await log.warn("reading the branch of a subagent failed", {
      sessionId: record.sessionId,
      reason: settled.failure,
    });
  }

  await writeRecord(settled);

  return settled;
}

/**
 * Запустить работу субагента и взять запись на сопровождение.
 *
 * Порядок записей — не украшение: он единственное, что отличает субагента, который вот-вот начнёт,
 * от субагента, который уже кончил.
 *
 * 1. **`starting` до задания.** Событие «сессии изменились» приходит уже на создание сессии, и
 *    обход, заставший запись `running` рядом с ещё простаивающей сессией, объявил бы субагента
 *    отработавшим до того, как тот начал, — а настоящий турн пошёл бы дальше без присмотра.
 * 2. **`running` после того, как платформа задание приняла.**
 * 3. **Обход сразу за этим.** Быстрый турн мог кончиться, пока мы писали `running`, и его событие
 *    прошло мимо записи, которая тогда ещё числилась запускающейся. Второго события может не быть
 *    вовсе, и без этого обхода субагент остался бы идущим навсегда.
 *
 * Все три шага идут **одной очередью** с обходом и остановкой. Порядок записей защищает от чужого
 * обхода только тогда, когда никто не пишет ту же запись между ними: остановка, пришедшая посреди
 * `prompt`, довела бы субагента до конца, а продолжившийся запуск вернул бы запись в `running`
 * поверх итога — и она числилась бы идущей, уже кончившись.
 */
export function launch(
  record: SubagentRecord,
  text: string,
): Promise<{ kind: "started" } | { kind: "failed"; reason: string }> {
  return serialize(async () => {
    await writeRecord({ ...record, state: "starting" });

    try {
      await sessions.prompt({ sessionId: record.sessionId, text });
    } catch (cause) {
      const reason = describe(cause);

      await writeRecord({
        ...record,
        state: "failed",
        finishedAt: new Date().toISOString(),
        failure: reason,
      });

      return { kind: "failed", reason };
    }

    await writeRecord({ ...record, state: "running" });

    // Обход встаёт в очередь **за** этим запуском, а не внутрь него: ждать его здесь значило бы
    // ждать самого себя.
    void sweep();

    return { kind: "started" };
  });
}

/** Исход остановки: чего именно остановили и было ли что останавливать. */
export type StopOutcome =
  | { kind: "unknown" }
  | { kind: "already"; state: SubagentState }
  | { kind: "stopped"; interrupted: boolean };

/**
 * Остановить субагента и довести его запись до конца.
 *
 * Идёт той же очередью, что и обход, и перечитывает запись внутри неё: прерывание возвращает сессию
 * в простой, и обход, разбуженный этим же событием, тоже считает субагента отработавшим. Вдвоём и
 * без этой проверки они подвели бы итог дважды, и второй перечитал бы ветку поверх первого.
 */
export function stop(sessionId: string): Promise<StopOutcome> {
  return serialize(async () => {
    const record = await readRecord(sessionId);

    if (record === undefined) {
      return { kind: "unknown" };
    }

    if (!isWorking(record.state)) {
      return { kind: "already", state: record.state };
    }

    const interrupted = await sessions.abort(sessionId);

    // Прерванный доводится тем же кодом, что и доработавший: в записи остаётся то, что субагент
    // успел сказать. Прерывать было нечего — сессия уже простаивает, и это тоже конец работы.
    await finish({ ...record, state: "stopped" }, new Date().toISOString());

    return { kind: "stopped", interrupted };
  });
}

/**
 * Обход, уже поставленный в очередь и ещё не начатый. Событие «сессии изменились» приходит на
 * **каждое** изменение любой сессии, а обход всегда читает все записи заново — значит второй такой
 * же обход рядом с первым не узнает ничего нового, а работу сделает всю.
 */
let pending: Promise<void> | undefined;

export type SweepOptions = ReconcileOptions & {
  /**
   * Схлопывать со стоящим в очереди обходом. Просит об этом только подписка на шину: её обход
   * ничем не примечателен и легко заменяется чужим. Обход после запуска схлопывать нельзя — ему
   * нужен свой, идущий **после** трёх записей запуска, а стоящий в очереди прошёл бы до них.
   */
  coalesce?: boolean;
};

/**
 * Обойти записи одной очередью. Сорвавшийся обход не снимает подписку и не роняет вызвавшего:
 * следующее событие шины попробует снова.
 */
export function sweep(options: SweepOptions = {}): Promise<void> {
  const coalesce = options.coalesce === true;

  if (coalesce && pending !== undefined) {
    return pending;
  }

  const run = serialize(async () => {
    // Флаг снимается **в начале** тела, а не в конце: обход, уже начавший читать записи, изменения
    // после себя не увидит, и следующему событию нужен свой собственный.
    if (coalesce) {
      pending = undefined;
    }

    try {
      await reconcile(await listRecords(), new Date().toISOString(), options);
    } catch (cause) {
      await log.warn("a sweep over the subagents failed", { reason: describe(cause) });
    }
  });

  if (coalesce) {
    pending = run;
  }

  return run;
}

export type ReconcileOptions = {
  /**
   * Обход сразу после перезагрузки воркера. Только он вправе судить о записи `starting`: вызова,
   * который её поставил, к этому моменту не существует — память воркера потеряна вместе с ним.
   */
  afterReload?: boolean;
};

/**
 * Пройтись по записям: идущие, чьи сессии простаивают, довести до конца. Законченные обход не
 * трогает вовсе — досылать их итог больше некуда, он уже лежит в записи.
 *
 * Простой значит «отработал» только у записи, запуск которой платформа подтвердила: `sessions.prompt`
 * возвращается уже с непростойной фазой, поэтому окна «задание принято, но сессия ещё `idle`» не
 * существует. Окно до самого `prompt` закрывает состояние `starting`.
 */
export async function reconcile(
  records: readonly SubagentRecord[],
  now: string,
  options: ReconcileOptions = {},
): Promise<void> {
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

  // Запускающаяся запись — дело того вызова, который её поставил, и трогать её обход не вправе.
  // После перезагрузки воркера такого вызова уже нет, и разбирать её больше некому.
  const judges = (state: SubagentState): boolean =>
    state === "running" || (state === "starting" && options.afterReload === true);

  for (const record of records) {
    if (!judges(record.state)) {
      continue;
    }

    const session = (await listed(record.projectId)).find((one) => one.id === record.sessionId);

    if (session === undefined) {
      // Сессию стёрли под нами. Запись остаётся, но идущей она числиться не вправе.
      await writeRecord({
        ...record,
        state: "failed",
        finishedAt: now,
        failure: "the session of the subagent is gone",
      });

      continue;
    }

    if (session.phase !== "idle") {
      // Задание, отправленное до перезагрузки, доехало: сессия работает, значит и запись работает.
      if (record.state === "starting") {
        await writeRecord({ ...record, state: "running" });
      }

      continue;
    }

    // Читаем запись заново: между списком и этим местом её мог обновить запуск или остановка, и
    // второе подведение итога переписало бы уже подведённый.
    const current = await readRecord(record.sessionId);

    if (current !== undefined && judges(current.state)) {
      await finish(current, now);
    }
  }
}

export function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
