// @vitest-environment jsdom

import type { PluginStatus } from "@sovereign/protocol";
import { describe, expect, it, vi } from "vitest";

import { createPluginModuleCache, type LoadedPluginModule } from "./module-cache.ts";

const running = (revision: string, styles?: string): PluginStatus => ({
  key: "data:themed",
  id: "themed",
  source: "data",
  directory: "/data/plugins/themed",
  state: "running",
  browser: {
    revision,
    entry: `/plugin-assets/data%3Athemed/${revision}/browser.js`,
    ...(styles === undefined ? {} : { styles }),
  },
});

/** Свой документ на тест: листы стилей живут в `head`, и общий документ склеивал бы проверки. */
const freshDocument = (): Document => document.implementation.createHTMLDocument("places");

const sheets = (target: Document): string[] =>
  [...target.head.querySelectorAll("link[data-sovereign-plugin]")].map(
    (link) => link.getAttribute("data-sovereign-plugin") ?? "",
  );

const sheet = (target: Document, revision: string): HTMLLinkElement => {
  const found = target.head.querySelector<HTMLLinkElement>(
    `link[data-sovereign-plugin="data:themed@${revision}"]`,
  );
  expect(found).not.toBeNull();
  return found!;
};

/** Загрузка стилей в jsdom сама не завершается: событие приходится подать руками. */
const loadSheet = (link: HTMLLinkElement): void => {
  link.dispatchEvent(new Event("load"));
};
const failSheet = (link: HTMLLinkElement): void => {
  link.dispatchEvent(new Event("error"));
};

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

describe("createPluginModuleCache", () => {
  it("keeps passive reads separate from loading and versions published changes", async () => {
    const module: LoadedPluginModule = { Panel: () => null };
    const importModule = vi.fn(() => Promise.resolve(module));
    const cache = createPluginModuleCache({ importModule, document: freshDocument() });

    expect(cache.peek(running("r1"))).toBeUndefined();
    expect(importModule).not.toHaveBeenCalled();

    const before = cache.version();
    expect(cache.load(running("r1"))).toEqual({ kind: "loading" });
    expect(cache.version()).toBe(before);

    await settled();

    expect(cache.version()).toBeGreaterThan(before);
    expect(cache.peek(running("r1"))).toEqual({ kind: "loaded", module });
  });

  it("publishes removals without restarting an obsolete revision", async () => {
    const importModule = vi.fn(() => Promise.resolve({}));
    const listener = vi.fn();
    const cache = createPluginModuleCache({ importModule, document: freshDocument() });

    cache.subscribe(listener);
    cache.load(running("r1"));
    await settled();
    const beforeRemoval = cache.version();
    listener.mockClear();

    cache.retain([]);

    expect(cache.version()).toBeGreaterThan(beforeRemoval);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(cache.peek(running("r1"))).toBeUndefined();
    expect(importModule).toHaveBeenCalledTimes(1);
  });

  it("imports the bundle once and keeps the module for later renders", async () => {
    const module: LoadedPluginModule = { Panel: () => null };
    const importModule = vi.fn(() => Promise.resolve(module));
    const cache = createPluginModuleCache({ importModule, document: freshDocument() });

    expect(cache.load(running("r1"))).toEqual({ kind: "loading" });
    await settled();

    expect(cache.load(running("r1"))).toEqual({ kind: "loaded", module });
    expect(cache.load(running("r1"))).toEqual({ kind: "loaded", module });
    expect(importModule).toHaveBeenCalledTimes(1);
  });

  /** Ради правки в плагине перезагружать страницу не нужно: новая ревизия это новый адрес. */
  it("imports again when the revision changed", async () => {
    const importModule = vi.fn((address: string) => Promise.resolve({ address }));
    const cache = createPluginModuleCache({ importModule, document: freshDocument() });

    cache.load(running("r1"));
    await settled();
    cache.load(running("r2"));
    await settled();

    expect(cache.load(running("r2"))).toEqual({
      kind: "loaded",
      module: { address: "/plugin-assets/data%3Athemed/r2/browser.js" },
    });
    expect(importModule).toHaveBeenCalledTimes(2);
  });

  it("tells the subscriber when a bundle settled", async () => {
    const listener = vi.fn();
    const cache = createPluginModuleCache({
      importModule: () => Promise.resolve({}),
      document: freshDocument(),
    });

    cache.subscribe(listener);
    cache.load(running("r1"));
    await settled();

    expect(listener).toHaveBeenCalled();
  });

  it("waits for the stylesheet before it hands the module over", async () => {
    const target = freshDocument();
    const styled = running("r1", "/assets/r1.css");
    const cache = createPluginModuleCache({
      importModule: () => Promise.resolve({}),
      document: target,
    });

    cache.load(styled);
    await settled();

    // Модуль ещё не отдан: первый кадр чужого компонента не должен ехать без оформления.
    expect(cache.load(styled)).toEqual({ kind: "loading" });

    loadSheet(sheet(target, "r1"));
    await settled();

    expect(cache.load(styled).kind).toBe("loaded");
  });

  /** Два листа одного плагина одинаково специфичны, и побеждал бы порядок вставки. */
  it("drops the stylesheet of the previous revision once its own has loaded", async () => {
    const target = freshDocument();
    const cache = createPluginModuleCache({
      importModule: () => Promise.resolve({}),
      document: target,
    });

    cache.load(running("r1", "/assets/r1.css"));
    loadSheet(sheet(target, "r1"));
    await settled();

    expect(sheets(target)).toEqual(["data:themed@r1"]);

    cache.load(running("r2", "/assets/r2.css"));

    // Прежний лист ещё на месте: снятый до загрузки нового, он заставил бы место мигнуть.
    expect(sheets(target)).toEqual(["data:themed@r1", "data:themed@r2"]);

    loadSheet(sheet(target, "r2"));
    await settled();

    expect(sheets(target)).toEqual(["data:themed@r2"]);
  });

  it("keeps the current stylesheet when it loads before an obsolete revision", async () => {
    const target = freshDocument();
    const cache = createPluginModuleCache({
      importModule: () => Promise.resolve({}),
      document: target,
    });

    cache.load(running("r1", "/assets/r1.css"));
    const r1 = sheet(target, "r1");
    cache.load(running("r2", "/assets/r2.css"));
    const r2 = sheet(target, "r2");

    loadSheet(r2);
    await settled();
    loadSheet(r1);
    await settled();

    expect(sheets(target)).toEqual(["data:themed@r2"]);
  });

  it("drops an obsolete stylesheet when it loads before the current revision", async () => {
    const target = freshDocument();
    const cache = createPluginModuleCache({
      importModule: () => Promise.resolve({}),
      document: target,
    });

    cache.load(running("r1", "/assets/r1.css"));
    const r1 = sheet(target, "r1");
    cache.load(running("r2", "/assets/r2.css"));
    const r2 = sheet(target, "r2");

    loadSheet(r1);
    await settled();
    expect(sheets(target)).toEqual(["data:themed@r2"]);

    loadSheet(r2);
    await settled();
    expect(sheets(target)).toEqual(["data:themed@r2"]);
  });

  it("removes a stylesheet that failed to load", async () => {
    const target = freshDocument();
    const styled = running("r1", "/assets/r1.css");
    const cache = createPluginModuleCache({
      importModule: () => Promise.resolve({}),
      document: target,
    });

    cache.load(styled);
    failSheet(sheet(target, "r1"));
    await settled();

    expect(sheets(target)).toEqual([]);
    expect(cache.load(styled).kind).toBe("failed");
  });

  it("removes the stylesheet when the module import fails", async () => {
    const target = freshDocument();
    const imported = deferred<LoadedPluginModule>();
    const styled = running("r1", "/assets/r1.css");
    const cache = createPluginModuleCache({
      importModule: () => imported.promise,
      document: target,
    });

    cache.load(styled);
    loadSheet(sheet(target, "r1"));
    await settled();
    imported.reject(new Error("404 stale revision"));
    await settled();

    expect(sheets(target)).toEqual([]);
    expect(cache.load(styled)).toEqual({
      kind: "failed",
      reason: "404 stale revision",
    });
  });

  it("keeps the current stylesheet when an obsolete stylesheet fails late", async () => {
    const target = freshDocument();
    const cache = createPluginModuleCache({
      importModule: () => Promise.resolve({}),
      document: target,
    });

    cache.load(running("r1", "/assets/r1.css"));
    const r1 = sheet(target, "r1");
    cache.load(running("r2", "/assets/r2.css"));
    const r2 = sheet(target, "r2");
    loadSheet(r2);
    await settled();

    failSheet(r1);
    await settled();

    expect(sheets(target)).toEqual(["data:themed@r2"]);
  });

  it("remembers a refusal instead of asking the network on every render", async () => {
    const importModule = vi.fn(() => Promise.reject(new Error("404 stale revision")));
    const cache = createPluginModuleCache({ importModule, document: freshDocument() });

    cache.load(running("r1"));
    await settled();

    expect(cache.load(running("r1"))).toEqual({
      kind: "failed",
      reason: "404 stale revision",
    });
    expect(importModule).toHaveBeenCalledTimes(1);
  });

  /**
   * Плагин без бандла — это плагин на пересборке, а не отказ. Ответ обязан быть тем же самым
   * объектом: `useSyncExternalStore` сверяет его по ссылке, и новый на каждый вызов означал бы
   * бесконечный цикл перерисовок — так и случилось живьём при правке исходников плагина.
   */
  it("waits with the same answer while the plugin has no bundle", () => {
    const cache = createPluginModuleCache({
      importModule: () => Promise.resolve({}),
      document: freshDocument(),
    });
    const withoutBundle: PluginStatus = { ...running("r1"), browser: undefined };

    expect(cache.load(withoutBundle)).toEqual({ kind: "loading" });
    expect(cache.load(withoutBundle)).toBe(cache.load(withoutBundle));
  });

  /** Та же сверка по ссылке: пока бандл едет, ответ обязан оставаться прежним объектом. */
  it("keeps the same waiting answer while the bundle is on its way", () => {
    const cache = createPluginModuleCache({
      importModule: () => Promise.resolve({}),
      document: freshDocument(),
    });

    expect(cache.load(running("r1"))).toBe(cache.load(running("r1")));
  });

  it("forgets a plugin that left the snapshot, and takes its stylesheet with it", async () => {
    const target = freshDocument();
    const importModule = vi.fn(() => Promise.resolve({}));
    const cache = createPluginModuleCache({ importModule, document: target });

    cache.load(running("r1", "/assets/r1.css"));
    loadSheet(sheet(target, "r1"));
    await settled();

    cache.retain([]);

    expect(sheets(target)).toEqual([]);

    cache.load(running("r1", "/assets/r1.css"));
    loadSheet(sheet(target, "r1"));
    await settled();

    expect(importModule).toHaveBeenCalledTimes(2);
  });

  it("keeps a plugin that is still running at the same revision", async () => {
    const importModule = vi.fn(() => Promise.resolve({}));
    const cache = createPluginModuleCache({ importModule, document: freshDocument() });

    cache.load(running("r1"));
    await settled();
    cache.retain([running("r1")]);

    expect(cache.load(running("r1")).kind).toBe("loaded");
    expect(importModule).toHaveBeenCalledTimes(1);
  });

  it("ignores a late stylesheet load from a forgotten copy of the same revision", async () => {
    const target = freshDocument();
    const module: LoadedPluginModule = { current: true };
    const importModule = vi.fn(() => Promise.resolve(module));
    const styled = running("r1", "/assets/r1.css");
    const cache = createPluginModuleCache({ importModule, document: target });

    cache.load(styled);
    const oldLink = sheet(target, "r1");
    cache.retain([]);
    cache.load(styled);
    const newLink = sheet(target, "r1");

    loadSheet(oldLink);
    await settled();

    expect(newLink.isConnected).toBe(true);
    expect(importModule).not.toHaveBeenCalled();
    expect(cache.load(styled).kind).toBe("loading");

    loadSheet(newLink);
    await settled();

    expect(newLink.isConnected).toBe(true);
    expect(importModule).toHaveBeenCalledTimes(1);
    expect(cache.load(styled)).toEqual({ kind: "loaded", module });
  });

  it("ignores a late stylesheet error from a forgotten copy of the same revision", async () => {
    const target = freshDocument();
    const module: LoadedPluginModule = { current: true };
    const importModule = vi.fn(() => Promise.resolve(module));
    const styled = running("r1", "/assets/r1.css");
    const cache = createPluginModuleCache({ importModule, document: target });

    cache.load(styled);
    const oldLink = sheet(target, "r1");
    cache.retain([]);
    cache.load(styled);
    const newLink = sheet(target, "r1");

    failSheet(oldLink);
    await settled();

    expect(newLink.isConnected).toBe(true);
    expect(importModule).not.toHaveBeenCalled();
    expect(cache.load(styled).kind).toBe("loading");

    loadSheet(newLink);
    await settled();

    expect(newLink.isConnected).toBe(true);
    expect(importModule).toHaveBeenCalledTimes(1);
    expect(cache.load(styled)).toEqual({ kind: "loaded", module });
  });

  it("ignores an import settled by a forgotten copy of the same revision", async () => {
    const target = freshDocument();
    const imports: ReturnType<typeof deferred<LoadedPluginModule>>[] = [];
    const importModule = vi.fn(() => {
      const imported = deferred<LoadedPluginModule>();
      imports.push(imported);
      return imported.promise;
    });
    const styled = running("r1", "/assets/r1.css");
    const cache = createPluginModuleCache({ importModule, document: target });

    cache.load(styled);
    loadSheet(sheet(target, "r1"));
    await settled();
    expect(importModule).toHaveBeenCalledTimes(1);

    cache.retain([]);
    cache.load(styled);
    const newLink = sheet(target, "r1");

    imports[0]?.resolve({ obsolete: true });
    await settled();

    expect(newLink.isConnected).toBe(true);
    expect(cache.load(styled).kind).toBe("loading");

    loadSheet(newLink);
    await settled();
    expect(importModule).toHaveBeenCalledTimes(2);
    const module: LoadedPluginModule = { current: true };
    imports[1]?.resolve(module);
    await settled();

    expect(cache.load(styled)).toEqual({ kind: "loaded", module });
  });

  it("disposes its stylesheets idempotently without touching a new cache", async () => {
    const target = freshDocument();
    const oldImport = vi.fn(() => Promise.resolve({}));
    const oldCache = createPluginModuleCache({ importModule: oldImport, document: target });

    oldCache.load(running("r1", "/assets/r1.css"));
    const oldLink = sheet(target, "r1");
    oldCache.dispose();
    oldCache.dispose();
    expect(sheets(target)).toEqual([]);

    const newImport = vi.fn(() => Promise.resolve({}));
    const newCache = createPluginModuleCache({ importModule: newImport, document: target });
    newCache.load(running("r2", "/assets/r2.css"));
    const newLink = sheet(target, "r2");

    loadSheet(oldLink);
    failSheet(oldLink);
    await settled();

    expect(newLink.isConnected).toBe(true);
    expect(oldImport).not.toHaveBeenCalled();
    expect(newImport).not.toHaveBeenCalled();
  });

  it("does not notify subscribers when an import settles after disposal", async () => {
    const imported = deferred<LoadedPluginModule>();
    const importModule = vi.fn(() => imported.promise);
    const listener = vi.fn();
    const cache = createPluginModuleCache({
      importModule,
      document: freshDocument(),
    });

    cache.subscribe(listener);
    cache.load(running("r1"));
    await settled();
    expect(importModule).toHaveBeenCalledTimes(1);

    cache.dispose();
    imported.resolve({});
    await settled();

    expect(listener).not.toHaveBeenCalled();
  });

  it("stays inert after disposal", () => {
    const importModule = vi.fn(() => Promise.resolve({}));
    const cache = createPluginModuleCache({ importModule, document: freshDocument() });

    cache.dispose();

    expect(cache.load(running("r1"))).toBe(cache.load(running("r1")));
    expect(cache.load(running("r1"))).toEqual({ kind: "loading" });
    expect(importModule).not.toHaveBeenCalled();
  });
});
