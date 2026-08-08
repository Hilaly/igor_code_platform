/**
 * Запросы конфига демона: снимок и запись документа целиком. Источник истины — `config.json` за
 * демоном (docs/data-directory.md); форма своей копии не держит, а спрашивает и пишет.
 */

import { configPath, type Config } from "@sovereign/protocol";

export async function fetchConfig(signal?: AbortSignal): Promise<Config> {
  const response = await fetch(configPath, signal === undefined ? {} : { signal });

  if (!response.ok) {
    throw new Error(`the daemon answered ${response.status}`);
  }

  return (await response.json()) as Config;
}

/**
 * Записывает конфиг целиком: тело — то же, что лежит в файле (docs/web-api.md). `400` означает
 * негодное значение, `409` — что файл на диске правил кто-то ещё, `500` — что файловая система
 * отказала в записи; ничто из этого не чинится повтором запроса, поэтому причина уходит наверх.
 */
export async function writeConfig(config: Config): Promise<Config> {
  const response = await fetch(configPath, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const failure = (await response.json()) as { error?: string };

    throw new Error(failure.error ?? `the daemon answered ${response.status}`);
  }

  return (await response.json()) as Config;
}
