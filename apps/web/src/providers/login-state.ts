/**
 * Состояние диалогов входа в провайдеров и правила их применения. Отдельно от `state.ts`, потому что
 * это другая тема: там каталог провайдеров и моделей, здесь живой диалог с провайдером
 * (docs/models-and-providers.md).
 *
 * Диалог адресуется провайдером, а не попыткой: вход в одного провайдера идёт не больше одного разом
 * — второй отклоняется (docs/web-api.md), — а провайдер известен и вью, и кадру шага, и отказу.
 */

import type {
  LoginAttemptState,
  LoginAttemptsSnapshot,
  LoginConclusion,
  LoginStepFrame,
  ProviderSummary,
} from "@sovereign/protocol";

export type LoginDialog = {
  attempt: LoginAttemptState;
  /**
   * Чем кончилась попытка. Кончившийся диалог остаётся на экране до закрытия человеком: исход входа
   * — это то, ради чего он всё и затевал, и гасить его самим появлением следующего кадра нельзя.
   */
  conclusion?: LoginConclusion;
  /**
   * Попытка кончилась, пока связи не было. Чем именно — сказать нечем: реестр держит только идущие
   * попытки (docs/web-api.md), и выдумывать исход вместо «не знаю» значит врать про вход.
   */
  lost?: boolean;
  /** Вход уже шёл, когда его начали здесь. Показать надо занявшего, а не только текст отказа. */
  taken?: boolean;
  /** Почему последний ответ не уехал. Разбираться с этим человеку. */
  refusal?: string;
};

export type LoginsState = {
  /** По идентификатору провайдера. */
  dialogs: Record<string, LoginDialog>;
  /**
   * Выход, который ничего не изменил: кред пришёл из окружения и платформе не принадлежит. Значение
   * — подпись источника от рантайма, если он её назвал (docs/web-api.md).
   */
  stubborn: Record<string, { source?: string }>;
  /** Почему вход не начался. Диалога в этом случае нет вовсе, вешать причину не на что. */
  failure?: string;
};

export const initialLoginsState: LoginsState = { dialogs: {}, stubborn: {} };

const withDialog = (state: LoginsState, providerId: string, dialog: LoginDialog): LoginsState => ({
  ...state,
  dialogs: { ...state.dialogs, [providerId]: dialog },
});

/** Попытка началась здесь. Прежний диалог этого провайдера уходит: он про кончившийся вход. */
export function applyStarted(state: LoginsState, attempt: LoginAttemptState): LoginsState {
  return withDialog({ ...state, failure: undefined }, attempt.providerId, { attempt });
}

/** Начать не удалось вовсе: диалога нет, и причина живёт отдельно от него. */
export function applyStartFailure(state: LoginsState, reason: string): LoginsState {
  return { ...state, failure: reason };
}

/**
 * В провайдера уже входят. Занявшая попытка кладётся диалогом как есть: если её начала эта же
 * сессия из другой вкладки, отвечать на её вопросы можно прямо здесь — владелец у них один.
 */
export function applyTaken(state: LoginsState, conflict: LoginAttemptState): LoginsState {
  return withDialog({ ...state, failure: undefined }, conflict.providerId, {
    attempt: conflict,
    taken: true,
  });
}

export type LoginStepOutcome = {
  state: LoginsState;
  /**
   * Перечитать идущие попытки. Кадр пришёл про попытку, о которой вкладка не знает, — её начали в
   * другой вкладке той же сессии. Полное состояние лежит в снимке, а в кадре его нет: собирать
   * попытку из первого увиденного шага значило бы потерять всё сказанное до него.
   */
  refetch: boolean;
};

export function applyLoginStep(state: LoginsState, frame: LoginStepFrame): LoginStepOutcome {
  const known = state.dialogs[frame.providerId];

  if (known === undefined || known.attempt.attemptId !== frame.attemptId) {
    return { state, refetch: true };
  }

  const { attempt } = known;

  switch (frame.step.kind) {
    case "prompt":
      return {
        state: withDialog(state, frame.providerId, {
          ...known,
          attempt: { ...attempt, pending: frame.step.prompt },
          refusal: undefined,
        }),
        refetch: false,
      };
    case "notice":
      return {
        state: withDialog(state, frame.providerId, {
          ...known,
          attempt: { ...attempt, notices: [...attempt.notices, frame.step.notice] },
        }),
        refetch: false,
      };
    case "conclusion":
      return {
        state: withDialog(state, frame.providerId, {
          ...known,
          // Вопрос снимается вместе с концом попытки: отвечать на него больше некому.
          attempt: { ...attempt, pending: undefined },
          conclusion: frame.step.conclusion,
        }),
        refetch: false,
      };
  }
}

/**
 * Снимок идущих попыток. Он и есть восстановление диалога после переподключения: кадр мог уехать в
 * разрыв, а в снимке лежит всё сказанное и вопрос, который ждёт ответа (docs/web-api.md).
 */
export function applyAttempts(state: LoginsState, snapshot: LoginAttemptsSnapshot): LoginsState {
  const dialogs: Record<string, LoginDialog> = {};

  for (const [providerId, dialog] of Object.entries(state.dialogs)) {
    const running = snapshot.attempts.find((attempt) => attempt.providerId === providerId);

    // Кончившийся диалог в снимке не встретится никогда — реестр держит только идущие попытки, — а
    // исход человек ещё не прочитал.
    if (running === undefined) {
      dialogs[providerId] =
        dialog.conclusion === undefined ? { ...dialog, lost: true } : { ...dialog };
    }
  }

  for (const attempt of snapshot.attempts) {
    const known = dialogs[attempt.providerId];

    dialogs[attempt.providerId] = {
      // Отказ прошлого ответа снимком не подтверждается и не опровергается: он про запрос, а не про
      // попытку, и переживать переподключение ему незачем.
      ...(known === undefined ? {} : { taken: known.taken }),
      attempt,
    };
  }

  return { ...state, dialogs };
}

/**
 * Ответ уехал. Вопрос снимается здесь, а не по кадру: следующий кадр может и не прийти вовсе —
 * вход на этом заканчивается, — и форма висела бы с ответом, который уже отправлен.
 */
export function applyAnswered(state: LoginsState, providerId: string, stepId: string): LoginsState {
  const known = state.dialogs[providerId];

  if (known === undefined || known.attempt.pending?.stepId !== stepId) {
    return state;
  }

  return withDialog(state, providerId, {
    ...known,
    attempt: { ...known.attempt, pending: undefined },
    refusal: undefined,
  });
}

/**
 * Шаг больше не ждёт ответа. Вопрос снимается: ответить на него нечем, а форма обещала бы обратное.
 * Следующий вопрос приедет кадром.
 */
export function applyStaleAnswer(
  state: LoginsState,
  providerId: string,
  reason: string,
): LoginsState {
  const known = state.dialogs[providerId];

  if (known === undefined) {
    return state;
  }

  return withDialog(state, providerId, {
    ...known,
    attempt: { ...known.attempt, pending: undefined },
    refusal: reason,
  });
}

/**
 * Ответ не дошёл до демона. Вопрос остаётся: причина здесь другая — сеть или сам демон, — и
 * отправить тот же ответ ещё раз имеет смысл.
 */
export function applyAnswerFailure(
  state: LoginsState,
  providerId: string,
  reason: string,
): LoginsState {
  const known = state.dialogs[providerId];

  return known === undefined ? state : withDialog(state, providerId, { ...known, refusal: reason });
}

/**
 * Итог выхода. Провайдер, оставшийся настроенным, — это ловушка «нажал выход, ничего не
 * изменилось»: кред пришёл из окружения, и убрать его платформе нечем (docs/web-api.md).
 */
export function applyLogout(state: LoginsState, summary: ProviderSummary): LoginsState {
  const stubborn = { ...state.stubborn };

  if (summary.auth.kind === "configured") {
    stubborn[summary.id] = summary.auth.source === undefined ? {} : { source: summary.auth.source };
  } else {
    delete stubborn[summary.id];
  }

  return { ...state, stubborn };
}

/** Закрыть диалог, который уже ничего не ждёт. Идущий вход закрывается отменой, а не кнопкой. */
export function closeLoginDialog(state: LoginsState, providerId: string): LoginsState {
  const known = state.dialogs[providerId];

  if (known === undefined || (known.conclusion === undefined && known.lost !== true)) {
    return state;
  }

  const dialogs = { ...state.dialogs };

  delete dialogs[providerId];

  return { ...state, dialogs };
}
