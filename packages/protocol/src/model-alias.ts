/**
 * Алиасы моделей (docs/model-routing.md).
 *
 * Алиас — имя, за которым стоит список совместимых моделей. Сессия с алиасом ходит первой из них, а
 * после отказа берётся за следующую; ключи внутри каждой модели перебираются как обычно.
 *
 * **Алиас виден системе как модель провайдера `alias`.** Поэтому своей формы ссылки на модель у него
 * нет: `alias/opus-5` разбирается тем же `parseModelReference`, что и `anthropic/claude-opus-4-5`,
 * и ни протокол сессий, ни пикер моделей о нём знать не обязаны.
 */

export const modelAliasesPath = "/api/model-aliases";
export const modelAliasPathPattern = `${modelAliasesPath}/:aliasId`;

/** Идентификатор провайдера, под которым живут алиасы. Занят платформой и не отдаётся плагинам. */
export const aliasProviderId = "alias";

export function modelAliasPath(aliasId: string): string {
  return `${modelAliasesPath}/${encodeURIComponent(aliasId)}`;
}

/** Кандидат алиаса: конкретная модель конкретного провайдера. */
export type ModelAliasCandidate = {
  providerId: string;
  modelId: string;
};

export type ModelAlias = {
  /** Имя после `alias/`. Строчный безопасный идентификатор, как у пользовательского провайдера. */
  id: string;
  name: string;
  /** Порядок обхода задаёт человек: первый кандидат — предпочтительный. */
  candidates: ModelAliasCandidate[];
};

export type ModelAliasesSnapshot = {
  aliases: ModelAlias[];
  /** Беда с файлом определений. Пишущие маршруты по ней отказывают. */
  problem?: string;
};

export type ModelAliasDeleted = { id: string };

export type ModelAliasParseResult =
  | { kind: "parsed"; value: ModelAlias; diagnostics: string[] }
  | { kind: "rejected"; diagnostics: string[] };

const aliasKeys = ["id", "name", "candidates"];

export function parseModelAliasDraft(raw: unknown, label = "alias"): ModelAliasParseResult {
  const fields = objectOf(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = Object.keys(fields)
    .filter((key) => !aliasKeys.includes(key))
    .map((key) => `${label}.${key} is not recognised`);
  const id = textOf(fields["id"]);
  const name = textOf(fields["name"]);

  if (id === undefined || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    diagnostics.push(`${label}.id must be a lowercase alias identifier`);
  }

  if (name === undefined) {
    diagnostics.push(`${label}.name must be a non-empty name`);
  }

  const candidates = parseCandidates(fields["candidates"], `${label}.candidates`, diagnostics);

  if (
    id === undefined ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(id) ||
    name === undefined ||
    candidates === undefined
  ) {
    return { kind: "rejected", diagnostics };
  }

  return { kind: "parsed", value: { id, name, candidates }, diagnostics };
}

function parseCandidates(
  raw: unknown,
  label: string,
  diagnostics: string[],
): ModelAliasCandidate[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    diagnostics.push(`${label} must name at least one model`);

    return undefined;
  }

  const candidates: ModelAliasCandidate[] = [];

  for (let index = 0; index < raw.length; index += 1) {
    const fields = objectOf(raw[index]);
    const providerId = textOf(fields?.["providerId"]);
    const modelId = textOf(fields?.["modelId"]);

    if (providerId === undefined || modelId === undefined) {
      diagnostics.push(`${label}[${String(index)}] must name a provider and a model`);

      return undefined;
    }

    // Алиас из алиасов — цикл, и разорвать его нечем: обход кандидатов пошёл бы по кругу.
    if (providerId === aliasProviderId) {
      diagnostics.push(`${label}[${String(index)}] must not name another alias`);

      return undefined;
    }

    if (candidates.some((one) => one.providerId === providerId && one.modelId === modelId)) {
      diagnostics.push(`${label}[${String(index)}] is named twice`);

      return undefined;
    }

    candidates.push({ providerId, modelId });
  }

  return candidates;
}

function objectOf(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

function textOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }

  const value = raw.trim();

  return value === "" ? undefined : value;
}
