/**
 * Контракт веб-API. Единственный источник правды об этих типах: и демон, и веб-интерфейс
 * импортируют их отсюда, поэтому расхождение между сервером и клиентом ловится компилятором.
 */

export * from "./authentication.ts";
export * from "./contribution.ts";
export * from "./event-stream.ts";
export * from "./events.ts";
export * from "./file-resource.ts";
export * from "./filesystem.ts";
export * from "./health.ts";
export * from "./log.ts";
export * from "./plugin-lifecycle.ts";
export * from "./plugin-preferences.ts";
export * from "./plugin.ts";
export * from "./plugins-snapshot.ts";
export * from "./preferences-api.ts";
export * from "./project.ts";
export * from "./provider-login.ts";
export * from "./provider.ts";
export * from "./session.ts";
export * from "./settings.ts";
export * from "./tool-pattern.ts";
