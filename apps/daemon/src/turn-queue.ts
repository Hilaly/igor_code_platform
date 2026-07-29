/**
 * Очередь походов к модели (docs/architecture.md).
 *
 * Слот выдаётся на **любой** поход, а не только на `prompt`: компакция и суммаризация ветки тоже
 * тратят деньги и тоже упираются в лимит частоты запросов у провайдера. Поэтому вид работы у
 * очереди есть с самого начала — срез, который добавит компакцию, добавит вызывающее место и ни
 * строчки здесь.
 *
 * Ожидание в очереди — наблюдаемое состояние сессии, а не пауза внутри вызова: человек обязан
 * видеть, что турн принят, но ещё не начат.
 */

export type TurnKind = "turn" | "compaction" | "branch-summary";

export type TurnJob = {
  sessionId: string;
  kind: TurnKind;
  /**
   * Идентификатор турна выдаёт очередь и отдаёт его работе аргументом: он же уезжает в ответ на
   * запуск и в дельты потока, и родись он позже старта — первые дельты приехали бы без него.
   */
  run: (turnId: string) => Promise<void>;
};

export type TurnPlace = {
  turnId: string;
  /** Состояние на момент постановки. Дальше оно меняется, и спрашивать надо у очереди. */
  state: "queued" | "running";
  /**
   * Снять работу с очереди. `false` — снимать нечего: она уже идёт либо уже снята. Идущую работу
   * очередь не прерывает: прерывание — дело рантайма, а слот освободится сам.
   */
  cancel: () => boolean;
};

export type TurnQueue = {
  submit: (job: TurnJob) => TurnPlace;
  stateOf: (sessionId: string) => "idle" | "queued" | "running";
  size: () => { running: number; queued: number };
};

export type CreateTurnQueueOptions = {
  /**
   * Предел спрашивается функцией, а не берётся числом: правка `config.json` применяется живьём
   * (docs/data-directory.md), и пересоздавать очередь ради неё не надо.
   */
  limit: () => number;
  /** Наблюдаемое состояние сессии изменилось: поставлена, начата или закончена. */
  onChange?: (sessionId: string) => void;
  /** Работа отказала. Очередь на этом не останавливается — слот освобождается и на отказе. */
  onFailure?: (sessionId: string, reason: unknown) => void;
  /** Подменяется тестом: идентификаторы турнов уезжают наружу в ответе маршрута. */
  createTurnId?: () => string;
};

type Waiting = {
  job: TurnJob;
  turnId: string;
  cancelled: boolean;
};

export function createTurnQueue(options: CreateTurnQueueOptions): TurnQueue {
  const waiting: Waiting[] = [];
  const running = new Set<string>();

  let turns = 0;

  const createTurnId =
    options.createTurnId ??
    (() => {
      turns += 1;

      return `turn-${String(turns)}`;
    });

  const drain = (): void => {
    while (waiting.length > 0 && running.size < options.limit()) {
      const next = waiting.shift();

      if (next === undefined || next.cancelled) {
        continue;
      }

      start(next.job, next.turnId);
    }
  };

  const start = (job: TurnJob, turnId: string): void => {
    running.add(job.sessionId);
    options.onChange?.(job.sessionId);

    void (async () => {
      try {
        await job.run(turnId);
      } catch (cause) {
        options.onFailure?.(job.sessionId, cause);
      } finally {
        running.delete(job.sessionId);
        options.onChange?.(job.sessionId);
        drain();
      }
    })();
  };

  return {
    submit: (job) => {
      const turnId = createTurnId();
      const place: Waiting = { job, turnId, cancelled: false };

      // Работа встаёт в хвост даже когда место есть: очередь разбирается по порядку постановки, и
      // «место освободилось» не повод пропустить вперёд того, кто пришёл позже.
      waiting.push(place);
      drain();

      if (!waiting.includes(place)) {
        return { turnId, state: "running", cancel: () => false };
      }

      options.onChange?.(job.sessionId);

      return {
        turnId,
        state: "queued",
        cancel: () => {
          if (place.cancelled || !waiting.includes(place)) {
            return false;
          }

          place.cancelled = true;
          waiting.splice(waiting.indexOf(place), 1);
          options.onChange?.(job.sessionId);

          return true;
        },
      };
    },
    stateOf: (sessionId) => {
      if (running.has(sessionId)) {
        return "running";
      }

      return waiting.some((entry) => entry.job.sessionId === sessionId) ? "queued" : "idle";
    },
    size: () => ({ running: running.size, queued: waiting.length }),
  };
}
