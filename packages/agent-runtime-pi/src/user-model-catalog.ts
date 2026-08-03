import type { Api, Model } from "@earendil-works/pi-ai";
import {
  defaultModelsUrl,
  type CustomProviderApi,
  type UserProviderDefinition,
} from "@sovereign/protocol";

const maximumCatalogBytes = 1_048_576;
const maximumPages = 100;
const requestTimeoutMs = 15_000;

export function mergeDiscoveredModels(
  definition: UserProviderDefinition,
  discoveredIds: readonly string[],
): Model<Api>[] {
  const manual = new Set(definition.manualModels.map((model) => model.id));
  const disabled = new Set(definition.disabledModelIds);
  const unique = [...new Set(discoveredIds.map((id) => id.trim()).filter(Boolean))];

  return unique
    .filter((id) => !manual.has(id) && !disabled.has(id))
    .map((id) => {
      const override = definition.modelOverrides[id] ?? {};
      const values = { ...definition.modelDefaults, ...override };

      return {
        id,
        name: override.name ?? id,
        api: definition.api,
        provider: definition.id,
        baseUrl: definition.baseUrl,
        reasoning: values.reasoning,
        input: [...values.input],
        cost: {
          input: values.cost.input,
          output: values.cost.output,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: values.contextWindow,
        maxTokens: values.maxTokens,
      };
    });
}

export async function fetchUserModelIds(
  definition: UserProviderDefinition,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (definition.modelsEndpoint.kind === "disabled") return [];

  const initial =
    definition.modelsEndpoint.kind === "custom"
      ? definition.modelsEndpoint.url
      : defaultModelsUrl(definition.api, definition.baseUrl);
  const ids: string[] = [];
  let next: string | undefined = initial;

  for (let page = 0; next !== undefined && page < maximumPages; page += 1) {
    const response = await fetchCatalogPage(next, definition.api, apiKey, signal);
    ids.push(...response.ids);
    next = response.next;
  }

  if (next !== undefined) throw new Error("model catalog has too many pages");
  return [...new Set(ids)];
}

type CatalogPage = { ids: string[]; next?: string };

async function fetchCatalogPage(
  url: string,
  api: CustomProviderApi,
  apiKey: string,
  parentSignal?: AbortSignal,
): Promise<CatalogPage> {
  const timeout = AbortSignal.timeout(requestTimeoutMs);
  const signal = parentSignal === undefined ? timeout : AbortSignal.any([parentSignal, timeout]);
  const response = await fetch(url, { headers: catalogHeaders(api, apiKey), signal });

  if (!response.ok) throw new Error(`model catalog returned HTTP ${response.status}`);
  const raw = await readBoundedJson(response);

  return parsePage(raw, api, url);
}

function catalogHeaders(api: CustomProviderApi, apiKey: string): Record<string, string> {
  if (api === "anthropic-messages") {
    return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  }
  if (api === "google-generative-ai") return { "x-goog-api-key": apiKey };
  return { authorization: `Bearer ${apiKey}` };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("model catalog returned an empty response");
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumCatalogBytes) {
      await reader.cancel();
      throw new Error("model catalog response is too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("model catalog returned invalid JSON");
  }
}

function parsePage(raw: unknown, api: CustomProviderApi, requestUrl: string): CatalogPage {
  const fields = objectOf(raw);
  if (api === "google-generative-ai") {
    const models = fields?.["models"];
    if (!Array.isArray(models))
      throw new Error("model catalog returned an invalid Google envelope");
    const ids = models.map((entry) => {
      const name = objectOf(entry)?.["name"];
      if (typeof name !== "string" || name.trim() === "") {
        throw new Error("model catalog returned an invalid model entry");
      }
      return name.startsWith("models/") ? name.slice("models/".length) : name;
    });
    const token = fields?.["nextPageToken"];
    return {
      ids,
      ...(typeof token === "string" && token !== ""
        ? { next: withSearchParameter(requestUrl, "pageToken", token) }
        : {}),
    };
  }

  const data = fields?.["data"];
  if (!Array.isArray(data)) throw new Error("model catalog returned an invalid data envelope");
  const ids = data.map((entry) => {
    const id = objectOf(entry)?.["id"];
    if (typeof id !== "string" || id.trim() === "") {
      throw new Error("model catalog returned an invalid model entry");
    }
    return id;
  });
  const hasMore = fields?.["has_more"];
  if (hasMore !== true) return { ids };
  const lastId = fields?.["last_id"];
  if (typeof lastId !== "string" || lastId === "") {
    throw new Error("model catalog pagination is invalid");
  }
  return { ids, next: withSearchParameter(requestUrl, "after_id", lastId) };
}

function withSearchParameter(raw: string, name: string, value: string): string {
  const url = new URL(raw);
  url.searchParams.set(name, value);
  return url.toString();
}

function objectOf(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}
