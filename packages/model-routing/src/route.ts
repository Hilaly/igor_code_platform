/**
 * Порядок обхода: чем сессия попробует ходить и в каком порядке (docs/model-routing.md).
 *
 * Попытка — это пара «кандидат и ключ». Кандидатов задаёт вызывающий: сегодня их один — модель
 * сессии, — а с алиасами их будет столько, сколько человек назвал.
 *
 * **Липкость держится тем, что порядок пересчитывается, а не запоминается.** Сессия хранит только
 * текущую попытку; следующая берётся из свежего порядка, поэтому добавленный ключ виден сразу, а
 * удалённый исчезает сам.
 */

export type Candidate = { providerId: string; modelId: string };

export type Attempt = { candidate: Candidate; keyId: string | undefined };

export type PlanRouteInput = {
  /** Кандидаты в порядке, который задал человек. */
  candidates: readonly Candidate[];
  /** Ключи провайдера по порядку пригодности. Пустой список — провайдер ходит кредом окружения. */
  keysOf: (providerId: string) => readonly string[];
  /** С чего начать, если это ещё возможно: ключ сессии, которым она уже ходит. */
  sticky?: Attempt;
};

/**
 * Полный порядок попыток. Считается целиком, а не по одной: следующую попытку выбирают по тому же
 * правилу, что и первую, и два правила на один вопрос разъезжаются при первой же правке.
 *
 * Провайдер без сохранённых ключей даёт попытку с `keyId: undefined` — это кред из окружения, и он
 * такой же законный способ ходить, как ключ из набора.
 */
export function planRoute(input: PlanRouteInput): Attempt[] {
  const attempts: Attempt[] = [];
  const seen = new Set<string>();
  const add = (attempt: Attempt): void => {
    const mark = `${attempt.candidate.providerId}/${attempt.candidate.modelId} ${attempt.keyId ?? ""}`;

    if (seen.has(mark)) {
      return;
    }

    seen.add(mark);
    attempts.push(attempt);
  };

  if (input.sticky !== undefined && stillPossible(input, input.sticky)) {
    add(input.sticky);
  }

  for (const candidate of input.candidates) {
    const keys = input.keysOf(candidate.providerId);

    if (keys.length === 0) {
      add({ candidate, keyId: undefined });

      continue;
    }

    for (const keyId of keys) {
      add({ candidate, keyId });
    }
  }

  return attempts;
}

/** Попытка сессии годится, пока её кандидат в списке, а ключ — среди пригодных. */
function stillPossible(input: PlanRouteInput, attempt: Attempt): boolean {
  const known = input.candidates.some(
    (candidate) =>
      candidate.providerId === attempt.candidate.providerId &&
      candidate.modelId === attempt.candidate.modelId,
  );

  if (!known) {
    return false;
  }

  const keys = input.keysOf(attempt.candidate.providerId);

  return attempt.keyId === undefined ? keys.length === 0 : keys.includes(attempt.keyId);
}

/** Одна и та же попытка? Сравнение по значению: попытки собираются заново на каждый запрос. */
export function sameAttempt(first: Attempt | undefined, second: Attempt | undefined): boolean {
  if (first === undefined || second === undefined) {
    return first === second;
  }

  return (
    first.candidate.providerId === second.candidate.providerId &&
    first.candidate.modelId === second.candidate.modelId &&
    first.keyId === second.keyId
  );
}
