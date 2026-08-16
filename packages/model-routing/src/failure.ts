/**
 * Кто виноват в отказе провайдера (docs/model-routing.md).
 *
 * **Единственное место в системе, знающее про коды ответов LLM-провайдеров.** Разбросанные по коду
 * `429` и `401` означали бы, что правило перехода на следующий ключ живёт в трёх местах сразу.
 *
 * Разбирается **текст ошибки, а не код ответа**: провалившийся запрос до `onResponse` рантайма не
 * доходит вовсе — SDK провайдера бросает исключение раньше, — и наружу отказ приезжает строкой
 * (docs/runtime-checks.md). Клиенты Anthropic и OpenAI начинают её кодом ответа, и это то, на что
 * здесь можно опереться.
 */

/** Что стало с ключом. */
export type KeyVerdict =
  /** Ключ жив, но занят: лимит запросов. Ждать до названного момента. */
  | { kind: "cooling"; forMs: number }
  /** Ключом ходить нельзя, пока человек не вмешается: не принят, просрочен, кончились деньги. */
  | { kind: "refused"; reason: string };

/**
 * Кого винить в отказе.
 *
 * `none` — виноватого назвать нечем: отмена, обрыв, незнакомая ошибка. Перебирать по такому отказу
 * ключи значило бы сжечь весь набор на своей же опечатке, поэтому турн падает, как падал раньше.
 */
export type FailureVerdict =
  | { blame: "key"; verdict: KeyVerdict }
  | { blame: "model"; reason: string }
  | { blame: "none"; reason: string };

/** Сколько ждать после лимита, если провайдер не сказал иного. */
export const defaultCoolingMs = 60_000;

const refusedPhrases = [
  "invalid x-api-key",
  "invalid api key",
  "incorrect api key",
  "authentication_error",
  "authentication error",
  "unauthorized",
  "permission_error",
  "insufficient_quota",
  "credit balance",
  "billing",
];

const coolingPhrases = ["rate limit", "rate_limit", "too many requests", "quota exceeded"];

const abortPhrases = ["aborted", "abort", "cancelled", "canceled"];

export type Failure = {
  /** Текст отказа, как его отдал рантайм. */
  message?: string;
  /** Код ответа, если он известен помимо текста. */
  status?: number;
  /** Сколько провайдер просил подождать. */
  retryAfterMs?: number;
};

export function classifyFailure(failure: Failure): FailureVerdict {
  const message = failure.message ?? "";
  const lowered = message.toLowerCase();
  const status = failure.status ?? statusFrom(message);

  // Отмена — не отказ провайдера: её сделал человек, и пробовать следующий ключ нечего.
  if (abortPhrases.some((phrase) => lowered.includes(phrase))) {
    return { blame: "none", reason: message === "" ? "the turn was aborted" : message };
  }

  if (status === 429) {
    return {
      blame: "key",
      verdict: { kind: "cooling", forMs: failure.retryAfterMs ?? defaultCoolingMs },
    };
  }

  if (status === 401 || status === 403 || status === 402) {
    return { blame: "key", verdict: { kind: "refused", reason: message } };
  }

  if (status !== undefined) {
    // Всё остальное с кодом — провайдер или модель: неизвестная модель, негодный запрос, авария на
    // той стороне. Ключ здесь ни при чём, и менять его бессмысленно.
    return { blame: "model", reason: message };
  }

  if (coolingPhrases.some((phrase) => lowered.includes(phrase))) {
    return {
      blame: "key",
      verdict: { kind: "cooling", forMs: failure.retryAfterMs ?? defaultCoolingMs },
    };
  }

  if (refusedPhrases.some((phrase) => lowered.includes(phrase))) {
    return { blame: "key", verdict: { kind: "refused", reason: message } };
  }

  // Кода нет и знакомых слов нет. Гадать по незнакомой строке — значит однажды перебрать все ключи
  // из-за оборванного сокета или собственной опечатки.
  return { blame: "none", reason: message === "" ? "the provider request failed" : message };
}

/**
 * Код ответа в начале строки — так пишут ошибку клиенты Anthropic и OpenAI: `429 {"type":"error"…}`.
 * Искать три цифры по всей строке нельзя: в теле ошибки их сколько угодно.
 */
function statusFrom(message: string): number | undefined {
  const leading = /^\s*(?:HTTP\s+)?([1-5]\d\d)\b/i.exec(message);

  if (leading !== null) {
    return Number(leading[1]);
  }

  const named = /\bstatus(?:\s+code)?[:=\s]\s*([1-5]\d\d)\b/i.exec(message);

  return named === null ? undefined : Number(named[1]);
}
