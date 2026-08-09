import { describe, expect, it } from "vitest";

import { hostModuleRegistryKey, hostModuleSpecifiers } from "@sovereign/protocol";

import { registerHostModules } from "./host-modules.ts";

function registry(): Record<string, unknown> {
  const target: Record<string, unknown> = {};
  registerHostModules(target);

  return target[hostModuleRegistryKey] as Record<string, unknown>;
}

describe("registerHostModules", () => {
  it("holds every specifier the plugin build makes external", () => {
    // Полнота проверяется списком из протокола, а не копией: пропущенный модуль — это ошибка в
    // браузере у пользователя, и заметить её иначе можно только живым плагином.
    expect(Object.keys(registry()).sort()).toEqual([...hostModuleSpecifiers].sort());
  });

  it("gives the same React the shell itself renders with", async () => {
    const react = await import("react");

    expect(registry().react).toBe(react);
  });

  it("gives plugins the same browser SDK module the shell uses", async () => {
    const browserSdk = await import("@sovereign/browser-sdk");

    expect(registry()["@sovereign/browser-sdk"]).toBe(browserSdk);
  });

  it("gives a module with exports for every specifier", () => {
    // Заглушка в бандле отдаёт значение реестра целиком, поэтому пустой объект здесь превратился бы
    // в `undefined` на первом же обращении к экспорту — уже внутри чужого кода.
    const empty = Object.entries(registry())
      .filter(([, value]) => Object.keys(value as object).length === 0)
      .map(([specifier]) => specifier);

    expect(empty).toEqual([]);
  });

  it("writes itself under the key the plugin bundle reads", () => {
    const target: Record<string, unknown> = {};
    registerHostModules(target);

    expect(Object.keys(target)).toEqual([hostModuleRegistryKey]);
  });
});
