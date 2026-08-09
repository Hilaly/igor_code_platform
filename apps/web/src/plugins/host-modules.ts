/**
 * Реестр singleton-зависимостей хоста для бандлов плагинов (docs/ui-extension-model.md). Сборка в
 * демоне не кладёт эти модули в бандл, а подставляет заглушку, читающую `globalThis` по ключу
 * `hostModuleRegistryKey`, — так плагин получает **тот же самый** экземпляр React, что и оболочка.
 *
 * Обычный глобальный объект, а не import map: карта зависела бы от конвейера сборки фронтенда и
 * жила бы отдельно для dev и прода, а тут одна и та же строка работает в обоих режимах.
 */

import * as browserSdk from "@sovereign/browser-sdk";
import * as uiKit from "@sovereign/ui-kit";
import * as react from "react";
import * as reactJsxRuntime from "react/jsx-runtime";
import * as reactDom from "react-dom";
import * as reactDomClient from "react-dom/client";

import { hostModuleRegistryKey, hostModuleSpecifiers } from "@sovereign/protocol";

/**
 * `react/jsx-dev-runtime` намеренно указывает на боевой рантайм: браузерный код плагина собирается
 * с `jsx: "automatic"` в продовом режиме, и второй модуль здесь был бы обещанием, которого сборка
 * всё равно не выполняет.
 */
const hostModules: Record<(typeof hostModuleSpecifiers)[number], unknown> = {
  react,
  "react-dom": reactDom,
  "react-dom/client": reactDomClient,
  "react/jsx-runtime": reactJsxRuntime,
  "react/jsx-dev-runtime": reactJsxRuntime,
  "@sovereign/ui-kit": uiKit,
  "@sovereign/browser-sdk": browserSdk,
};

/**
 * Зовётся до первого `import()` бандла плагина. Заглушка в бандле читает реестр в момент загрузки
 * модуля, поэтому «до» здесь буквальное, а не «когда-нибудь при старте».
 *
 * Куда писать — параметр: проверке нужен свой объект, а не общий `globalThis`, из которого запись
 * потом не убрать.
 */
export function registerHostModules(
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): void {
  target[hostModuleRegistryKey] = hostModules;
}
