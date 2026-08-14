import type { PluginStatus, Project, ProviderSummary, Session } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { describe, expect, it } from "vitest";

import type { Page } from "../router.ts";
import { describePage } from "./page.tsx";

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (message) => {
    throw new Error(message);
  },
});

describe("route header descriptions", () => {
  it.each<[Page, string]>([
    [{ kind: "home" as const }, "Оболочка поднялась"],
    [{ kind: "session-archive" as const }, "Архивные сессии"],
    [{ kind: "new-session" as const }, "Новая сессия"],
    [{ kind: "new-provider" as const }, "Новый провайдер"],
    [{ kind: "settings", section: "appearance" as const }, "Внешний вид"],
    [{ kind: "unknown", path: "/missing" }, "Нет такой страницы"],
  ])("uses a stable localized fallback for %j", (page, title) => {
    expect(describePage(page, translator)).toEqual({ title });
  });

  it("does not invent context while data is unavailable", () => {
    expect(describePage({ kind: "session", sessionId: "0199" }, translator)).toEqual({
      title: "Сессии",
      context: undefined,
    });
    expect(describePage({ kind: "edit-provider", providerId: "local" }, translator)).toEqual({
      title: "Редактирование local",
      context: undefined,
    });
    expect(describePage({ kind: "settings-project", projectId: "p1" }, translator)).toEqual({
      title: "Проекты",
      context: undefined,
    });
    expect(describePage({ kind: "settings-plugin", pluginKey: "p1" }, translator)).toEqual({
      title: "Плагины",
      context: undefined,
    });
  });

  it("uses only context carried by the route or loaded data", () => {
    const session: Session = {
      id: "0199",
      projectId: "project-1",
      folder: "/code/platform",
      agentId: "starter.generic",
      agentAvailable: true,
      model: "anthropic/claude-opus-4-5",
      thinkingLevel: "high",
      phase: "idle",
      title: "План релиза",
      archived: false,
      hidden: false,
      createdAt: "2026-08-05T00:00:00.000Z",
    };
    const project: Project = {
      id: "project-1",
      name: "Sovereign",
      folder: "/code/platform",
      folderKey: "/code/platform",
      archived: false,
      availability: "available",
      sessionCount: 1,
      ephemeral: false,
      createdAt: "2026-08-05T00:00:00.000Z",
    };
    const provider: ProviderSummary = {
      id: "local",
      name: "Local gateway",
      baseUrl: "http://localhost:11434",
      logins: [],
      auth: { kind: "unconfigured" },
      dynamic: false,
      custom: false,
      origin: "user",
      modelCount: 0,
    };
    const plugin: PluginStatus = {
      key: "data:hello",
      id: "hello",
      source: "data",
      directory: "/plugins/hello",
      state: "running",
    };

    // Без проекта путь — единственное, что известно про сессию; с проектом полоса называет его по
    // имени, а путь уходит в подсказку у вью чата.
    expect(describePage({ kind: "session", sessionId: "0199" }, translator, { session })).toEqual({
      title: "Сессии",
      context: "/code/platform",
    });
    expect(
      describePage({ kind: "session", sessionId: "0199" }, translator, { session, project }),
    ).toEqual({ title: "Сессии", context: "Sovereign" });
    expect(
      describePage({ kind: "session", sessionId: "0199" }, translator, {
        session,
        project: { ...project, ephemeral: true },
      }),
    ).toEqual({ title: "Сессии", context: "Быстрая работа" });
    expect(
      describePage({ kind: "edit-provider", providerId: "local" }, translator, { provider }),
    ).toEqual({ title: "Local gateway", context: "http://localhost:11434" });
    expect(
      describePage({ kind: "settings-project", projectId: "project-1" }, translator, { project }),
    ).toEqual({ title: "Sovereign", context: "/code/platform" });
    expect(
      describePage({ kind: "settings-plugin", pluginKey: "data:hello" }, translator, { plugin }),
    ).toEqual({ title: "hello", context: "data:hello" });
    expect(
      describePage({ kind: "plugin", pluginId: "demo", pageId: "main", rest: "" }, translator),
    ).toEqual({ title: "Эта страница принадлежит плагину", context: "demo/main" });
  });
});
