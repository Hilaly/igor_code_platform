/**
 * Окружение, из которого провайдер вправе взять кред: переменные и наличие файлов
 * (`ANTHROPIC_API_KEY`, `~/.aws/credentials`, ADC-файл gcloud).
 *
 * Порт, а не прямое чтение `process.env`, ровно по одной причине: без него ambient-кред нельзя
 * проверить тестом, а именно он даёт самую дешёвую сквозную проверку среза.
 *
 * **Мы отсюда читаем и никогда сюда не пишем.** Правило «всё состояние внутри директории данных»
 * это не нарушает: за её пределы платформа не записывает ничего (docs/data-directory.md).
 */

import { defaultProviderAuthContext } from "@earendil-works/pi-ai";
import type { AuthContext } from "@earendil-works/pi-ai";

export type Environment = {
  read: (name: string) => Promise<string | undefined>;
  /** Поддерживает ведущий `~`: провайдеры спрашивают именно так. */
  fileExists: (path: string) => Promise<boolean>;
};

/** Настоящее окружение процесса: переменные из `process.env`, файлы через `node:fs`. */
export function processEnvironment(): Environment {
  const context = defaultProviderAuthContext();

  return { read: (name) => context.env(name), fileExists: (path) => context.fileExists(path) };
}

export function toRuntimeAuthContext(environment: Environment): AuthContext {
  return {
    env: (name) => environment.read(name),
    fileExists: (path) => environment.fileExists(path),
  };
}
