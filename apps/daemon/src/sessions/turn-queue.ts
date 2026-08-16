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
 *
 * **Полос две.** Общий предел один на всех — он про деньги и частоту запросов у провайдера, — но
 * агентские сессии вправе занять только часть его слотов, и остаток человеку гарантирован. Порядок
 * внутри полосы прежний: кто пришёл раньше, тот и стартует раньше, обгона нет.
 */

export type TurnKind = "turn" | "compaction" | "branch-summary";

/**
 * Чья это работа. `agent` — сессия, заведённая не человеком, а другим агентом: субагент. Полоса
 * читается из признака сессии вызывающим, а не выводится здесь: очередь про сессии ничего не знает.
 */
export type TurnLane = "interactive" | "agent";

export type TurnJob = {
  sessionId: string;
  kind: TurnKind;
  lane: TurnLane;
  /**
   * Идентификатор турна выдаёт очередь и отдаёт его работе аргументом: он же уезжает в ответ на
   * запуск и в дельты потока, и родись он позже старта — первые дельты приехали бы без него.
   */
  /** `queued` отличает немедленный старт от работы, которая успела подождать за чужим слотом. */
  run: (turnId: string, queued: boolean) => Promise<void>;
};

export type TurnPlace = {
  kind: "accepted";
  turnId: string;
  /** Состояние на момент постановки. Дальше оно меняется, и спрашивать надо у очереди. */
  state: "queued" | "running";
  /**
   * Снять работу с очереди. `false` — снимать нечего: она уже идёт либо уже снята. Идущую работу
   * очередь не прерывает: прерывание — дело рантайма, а слот освободится сам.
   */
  cancel: () => boolean;
};

/** У сессии уже есть работа в очереди или занявшая слот — вторую не ставим и не подменяем первую. */
export type TurnRefusal = { kind: "busy" };

export type TurnReservation = {
  kind: "accepted";
  turnId: string;
  /** Запустить зарезервированную работу после подготовки сессии. Полоса названа при резервировании. */
  start: (job: Omit<TurnJob, "sessionId" | "lane">) => TurnPlace | undefined;
  /** Отказаться от reservation после неуспешной подготовки. */
  release: () => void;
  /** Отменили ли reservation, пока вызывающий готовил работу. */
  cancelled: () => boolean;
  /** Отмечает reservation отменённым или снимает поставленный turn; идущий turn не прерывает. */
  cancel: () => boolean;
};

export type TurnQueue = {
  /** Атомарно занять sessionId до асинхронной подготовки turn. */
  reserve: (sessionId: string, lane: TurnLane) => TurnReservation | TurnRefusal;
  submit: (job: TurnJob) => TurnPlace | TurnRefusal;
  stateOf: (sessionId: string) => "idle" | "queued" | "running";
  size: () => { running: number; queued: number; agentRunning: number; agentQueued: number };
};

export type CreateTurnQueueOptions = {
  /**
   * Предел спрашивается функцией, а не берётся числом: правка `config.json` применяется живьём
   * (docs/data-directory.md), и пересоздавать очередь ради неё не надо.
   */
  limit: () => number;
  /**
   * Сколько слотов из общего предела вправе занять агентская полоса. Спрашивается тем же способом и
   * по той же причине. Выше общего предела не поднимает: полоса — доля от него, а не второй предел.
   */
  agentLimit: () => number;
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
  /** Значение — полоса идущей работы: по нему считается занятое агентами. */
  const running = new Map<string, TurnLane>();
  const reserved = new Set<string>();

  let turns = 0;

  const createTurnId =
    options.createTurnId ??
    (() => {
      turns += 1;

      return `turn-${String(turns)}`;
    });

  /** Доля агентов не бывает больше общего предела: полоса — часть его, а не второй предел. */
  const agentLimit = (): number => Math.min(options.agentLimit(), options.limit());

  const busyInLane = (lane: TurnLane): number => {
    let count = 0;

    for (const one of running.values()) {
      if (one === lane) {
        count += 1;
      }
    }

    return count;
  };

  const roomFor = (lane: TurnLane): boolean =>
    running.size < options.limit() && (lane !== "agent" || busyInLane("agent") < agentLimit());

  /**
   * Взять из очереди всё, чьей полосе есть место.
   *
   * Берётся не голова, а **первая работа своей полосы**: голова очереди может быть агентской при
   * забитой агентской полосе, и человек, стоящий за ней, ждал бы ровно того, ради чего полосы и
   * заведены. Порядок внутри полосы это не нарушает — обгоняется только чужая.
   */
  const drain = (): void => {
    for (let index = 0; index < waiting.length; ) {
      const next = waiting[index];

      if (next === undefined || next.cancelled) {
        waiting.splice(index, 1);
        continue;
      }

      if (!roomFor(next.job.lane)) {
        index += 1;
        continue;
      }

      waiting.splice(index, 1);
      start(next.job, next.turnId, true);
    }
  };

  const start = (job: TurnJob, turnId: string, queued: boolean): void => {
    running.set(job.sessionId, job.lane);
    options.onChange?.(job.sessionId);

    void (async () => {
      try {
        await job.run(turnId, queued);
      } catch (cause) {
        options.onFailure?.(job.sessionId, cause);
      } finally {
        running.delete(job.sessionId);
        options.onChange?.(job.sessionId);
        drain();
      }
    })();
  };

  const reserve = (sessionId: string, lane: TurnLane): TurnReservation | TurnRefusal => {
    if (
      running.has(sessionId) ||
      waiting.some((entry) => entry.job.sessionId === sessionId) ||
      reserved.has(sessionId)
    ) {
      return { kind: "busy" };
    }

    const turnId = createTurnId();
    let started = false;
    let cancelled = false;
    let released = false;
    let place: Waiting | undefined;

    reserved.add(sessionId);

    const release = (): void => {
      if (!released) {
        released = true;
        reserved.delete(sessionId);
      }
    };

    const cancel = (): boolean => {
      if (cancelled) {
        return false;
      }

      const queued = place !== undefined && waiting.includes(place);

      if (started && !queued) {
        return false;
      }

      cancelled = true;

      if (place !== undefined) {
        place.cancelled = true;
        waiting.splice(waiting.indexOf(place), 1);
        release();
        options.onChange?.(sessionId);
      }

      // До `start` reservation остаётся за сессией: асинхронная подготовка обязана заметить
      // отмену и закончиться отказом, прежде чем следующий запрос сможет занять sessionId.
      return true;
    };

    return {
      kind: "accepted",
      turnId,
      start: (job) => {
        if (cancelled || started) {
          release();

          return undefined;
        }

        started = true;
        place = {
          job: {
            ...job,
            sessionId,
            lane,
            run: async (activeTurnId, queued) => {
              try {
                await job.run(activeTurnId, queued);
              } finally {
                release();
              }
            },
          },
          turnId,
          cancelled: false,
        };

        drain();

        // Своя полоса пуста и место в ней есть — стартуем сразу. Ждущие чужой полосы не помеха:
        // они всё равно не взяли бы этот слот.
        if (!waiting.some((entry) => entry.job.lane === lane) && roomFor(lane)) {
          start(place.job, turnId, false);
        } else {
          waiting.push(place);
          options.onChange?.(sessionId);
        }

        drain();

        return {
          kind: "accepted",
          turnId,
          state: waiting.includes(place) ? "queued" : "running",
          cancel,
        };
      },
      release,
      cancelled: () => cancelled,
      cancel,
    };
  };

  return {
    reserve,
    submit: (job) => {
      const reservation = reserve(job.sessionId, job.lane);

      if (reservation.kind === "busy") {
        return reservation;
      }

      // Между синхронными `reserve` и `start` отменить reservation некому.
      return reservation.start({ kind: job.kind, run: job.run }) as TurnPlace;
    },
    stateOf: (sessionId) => {
      if (running.has(sessionId)) {
        return "running";
      }

      return waiting.some((entry) => entry.job.sessionId === sessionId) ? "queued" : "idle";
    },
    size: () => ({
      running: running.size,
      queued: waiting.length,
      agentRunning: busyInLane("agent"),
      agentQueued: waiting.filter((entry) => entry.job.lane === "agent").length,
    }),
  };
}
