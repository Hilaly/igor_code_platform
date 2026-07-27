/**
 * Поверхность плагина: то, что он импортирует (ADR-0043). Имена импортов — публичный контракт,
 * менять их дороже, чем внутренности.
 *
 * Всё асинхронно (ADR-0011): плагин живёт в своём воркере, и любой вызов к платформе — сообщение.
 */

import { currentPluginHost, type CustomContribution, type PluginLogLevel } from "./host.ts";

export type { CustomContribution, PluginHost, PluginIdentity, PluginLogLevel } from "./host.ts";

/**
 * Язык схем платформы (ADR-0072). Реэкспорт, а не «поставьте zod сами»: два экземпляра zod в одном
 * процессе дают два несовместимых типа схемы, и схема плагина перестала бы подходить платформе.
 */
export { z } from "zod";

/**
 * Точки входа плагина. `activate` вызывается после того, как хост готов; `deactivate` — перед
 * выгрузкой, и у него есть только ограниченное время (супервизор не ждёт вечно).
 */
export type PluginModule = {
  activate: () => void | Promise<void>;
  deactivate?: () => void | Promise<void>;
};

type LogCall = (message: string, fields?: Record<string, unknown>) => Promise<void>;

// Асинхронно и на отсутствии хоста тоже: синхронный бросок из функции, возвращающей обещание,
// прилетел бы автору мимо `catch` вокруг `await`.
const at =
  (level: PluginLogLevel): LogCall =>
  async (message, fields) =>
    currentPluginHost().log(level, message, fields);

/** Источник записи проставляет ядро, а не плагин: подделать чужой нечем (ADR-0021). */
export const log: Record<PluginLogLevel, LogCall> = {
  debug: at("debug"),
  info: at("info"),
  warn: at("warn"),
  error: at("error"),
};

export const contribute = {
  /**
   * Общий вид вклада (ADR-0054). Регистрация во время `activate` применяется одним снимком:
   * наблюдатель видит либо прежний набор, либо новый целиком.
   */
  custom: async (contribution: CustomContribution): Promise<void> =>
    currentPluginHost().contribute(contribution),
};

/** Кто мы, по версии хоста. Полезно в логах самого плагина и в его собственных путях. */
export const identity = (): { id: string; source: string } => currentPluginHost().identity;
