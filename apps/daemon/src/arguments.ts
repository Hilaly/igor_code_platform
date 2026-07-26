/**
 * Аргументы запуска демона (ADR-0034): путь к директории данных — позиционным, порт — флагом
 * `--port`. Оба необязательны, у каждого значение по умолчанию в коде.
 *
 * Разбор — чистая функция без `process.exit` и без вывода: печатать и завершаться решает `main.ts`,
 * иначе разбор нечем проверить тестом.
 */

export const defaultDataDirectory = "~/.sovereign_platform";

/** Совпадает с прокси Vite в `apps/web/vite.config.ts` — dev-режим работает без аргументов. */
export const defaultPort = 8787;

export type LaunchOptions = {
  /** Путь как его передали: разворот `~` и приведение к абсолютному — дело `data-directory.ts`. */
  dataDirectory: string;
  port: number;
};

export type ParsedArguments =
  | { kind: "run"; options: LaunchOptions }
  | { kind: "help"; text: string }
  | { kind: "error"; message: string };

const usage = `sovereign — the platform daemon.

Usage: sovereign [<data-directory>] [--port <port>]

Arguments:
  <data-directory>  where the platform keeps all of its state
                    (default: ${defaultDataDirectory})

Options:
  --port <port>     port of the web API, 1-65535 (default: ${defaultPort})
  --help            show this message

The directory and the port are deployment parameters: they are not read from config.json,
and changing the port means a restart with another argument.`;

const maximumPort = 65535;

export function parseArguments(argv: string[]): ParsedArguments {
  const rest = [...argv];
  let dataDirectory: string | undefined;
  let port: number | undefined;

  while (rest.length > 0) {
    const argument = rest.shift();

    if (argument === undefined) {
      break;
    }

    if (argument === "") {
      return { kind: "error", message: "An empty argument is not a path." };
    }

    if (argument === "--help") {
      return { kind: "help", text: usage };
    }

    if (argument === "--port" || argument.startsWith("--port=")) {
      const value = argument === "--port" ? rest.shift() : argument.slice("--port=".length);

      if (value === undefined) {
        return { kind: "error", message: "Option --port requires a value." };
      }

      const parsed = parsePort(value);

      if (parsed === undefined) {
        return {
          kind: "error",
          message: `Option --port expects an integer from 1 to ${maximumPort}, got: ${value}`,
        };
      }

      port = parsed;
      continue;
    }

    if (argument.startsWith("-")) {
      return { kind: "error", message: `Unknown option: ${argument}` };
    }

    if (dataDirectory !== undefined) {
      return {
        kind: "error",
        message: `Unexpected argument: ${argument}. The data directory is the only positional one.`,
      };
    }

    dataDirectory = argument;
  }

  return {
    kind: "run",
    options: {
      dataDirectory: dataDirectory ?? defaultDataDirectory,
      port: port ?? defaultPort,
    },
  };
}

/**
 * Своя проверка вместо `Number`: тот принимает `8787.0`, `0x2253` и `8.7e3`, а порт — это целое
 * из десятичных цифр. Опечатка должна стать отказом старта, а не молча другим портом.
 */
function parsePort(value: string): number | undefined {
  if (!/^[0-9]+$/.test(value)) {
    return undefined;
  }

  const port = Number(value);

  return port >= 1 && port <= maximumPort ? port : undefined;
}
