/**
 * Загрузчик браузерного бандла плагина (docs/ui-extension-model.md). Демон собрал его в срезе
 * 12b-1 и отдаёт по неизменяемому адресу с ревизией; здесь этот адрес превращается в модуль.
 *
 * Кеш обязателен, а не полезен: место перерисовывается на каждое изменение снимка плагинов, а
 * снимок приезжает на любое изменение любого плагина. `import()` прямо из отрисовки без кеша бил бы
 * по сети на каждом кадре. Ключ кеша — ключ плагина вместе с ревизией: новая сборка это новый
 * адрес, поэтому смена ревизии сама по себе означает новый `import()`, и перезагружать страницу
 * ради правки в плагине не нужно.
 */

import type { PluginStatus } from "@sovereign/protocol";
import type {
  LoadedPluginModule,
  PluginModuleCache,
  PluginModuleLoad,
} from "@sovereign/browser-sdk/host";

export type {
  LoadedPluginModule,
  PluginModuleCache,
  PluginModuleLoad,
} from "@sovereign/browser-sdk/host";

type Entry = { revision: string; load: PluginModuleLoad };

/**
 * Как модуль импортируется и куда попадает таблица стилей. Параметрами, а не напрямую: `import()`
 * по вычисленному адресу в jsdom не работает, а проверять кеш живым браузером — значит не
 * проверять его вовсе.
 */
export type PluginModuleCacheOptions = {
  importModule?: (address: string) => Promise<LoadedPluginModule>;
  document?: Document;
};

/**
 * Ответ «бандла ещё нет» один на всех и постоянный. Постоянный — потому что `moduleOf` зовётся из
 * отрисовки через `useSyncExternalStore`, а тот сверяет ответы по ссылке: новый объект на каждый
 * вызов означает бесконечный цикл перерисовок.
 */
export const pendingModule: PluginModuleLoad = { kind: "loading" };

const stylesheetAttribute = "data-sovereign-plugin";

const stylesheetKey = (pluginKey: string, revision: string): string => `${pluginKey}@${revision}`;

export function createPluginModuleCache(options: PluginModuleCacheOptions = {}): PluginModuleCache {
  const importModule =
    options.importModule ??
    ((address: string) => import(/* @vite-ignore */ address) as Promise<LoadedPluginModule>);
  const target = options.document ?? document;
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  const ownedStylesheets = new Set<HTMLLinkElement>();
  let disposed = false;

  const removeStylesheet = (link: HTMLLinkElement): void => {
    ownedStylesheets.delete(link);
    link.remove();
  };

  const removeStylesheets = (pluginKey: string, keep?: HTMLLinkElement): void => {
    const prefix = stylesheetKey(pluginKey, "");

    for (const link of [...ownedStylesheets]) {
      if (link !== keep && (link.getAttribute(stylesheetAttribute) ?? "").startsWith(prefix)) {
        removeStylesheet(link);
      }
    }
  };

  const isCurrent = (pluginKey: string, entry: Entry): boolean =>
    !disposed && entries.get(pluginKey) === entry;

  const announce = (): void => {
    if (disposed) {
      return;
    }

    for (const listener of [...listeners]) {
      if (disposed) {
        return;
      }
      listener();
    }
  };

  const settle = (pluginKey: string, entry: Entry, load: PluginModuleLoad): void => {
    // Та же revision может вернуться после исчезновения плагина, поэтому сравнивается
    // сама попытка загрузки, а не только её content revision.
    if (!isCurrent(pluginKey, entry)) {
      return;
    }

    entry.load = load;
    announce();
  };

  const begin = (pluginKey: string, assets: NonNullable<PluginStatus["browser"]>): Entry => {
    const entry: Entry = { revision: assets.revision, load: pendingModule };

    entries.set(pluginKey, entry);

    const stylesheet =
      assets.styles === undefined
        ? undefined
        : attachStylesheet(pluginKey, assets.revision, assets.styles);

    void (async () => {
      try {
        // Стили ждут вместе с модулем: без этого первый кадр чужого компонента едет без оформления.
        await stylesheet?.loaded;

        if (!isCurrent(pluginKey, entry)) {
          if (stylesheet !== undefined) {
            removeStylesheet(stylesheet.link);
          }
          return;
        }

        if (stylesheet !== undefined) {
          removeStylesheets(pluginKey, stylesheet.link);
        }

        const module = await importModule(assets.entry);

        if (!isCurrent(pluginKey, entry)) {
          if (stylesheet !== undefined) {
            removeStylesheet(stylesheet.link);
          }
          return;
        }

        settle(pluginKey, entry, { kind: "loaded", module });
      } catch (cause: unknown) {
        if (stylesheet !== undefined) {
          removeStylesheet(stylesheet.link);
        }
        settle(pluginKey, entry, {
          kind: "failed",
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      }
    })();

    return entry;
  };

  /**
   * Лист стилей прошлой ревизии снимается ровно тогда, когда своя ревизия загрузилась, а не раньше:
   * убери его до загрузки — и место мигнёт неоформленным. Ссылка принадлежит этому кешу:
   * позднее событие не вправе искать и снимать стили нового экземпляра кеша.
   */
  const attachStylesheet = (
    pluginKey: string,
    revision: string,
    address: string,
  ): { link: HTMLLinkElement; loaded: Promise<void> } => {
    const link = target.createElement("link");

    link.rel = "stylesheet";
    link.href = address;
    link.setAttribute(stylesheetAttribute, stylesheetKey(pluginKey, revision));

    const loaded = new Promise<void>((resolve, reject) => {
      link.addEventListener("load", () => {
        if (disposed) {
          removeStylesheet(link);
        }
        resolve();
      });
      link.addEventListener("error", () => {
        if (disposed) {
          removeStylesheet(link);
        }
        reject(new Error(`the stylesheet ${address} could not be loaded`));
      });
    });

    ownedStylesheets.add(link);
    target.head.append(link);

    return { link, loaded };
  };

  return {
    moduleOf: (status) => {
      if (disposed) {
        return pendingModule;
      }

      const assets = status.browser;

      if (assets === undefined) {
        // Бандла нет временно: плагин пересобирается после правки исходников или ещё поднимается.
        // Это не отказ — отказ сборки виден во вью плагинов состоянием самого плагина, а место на
        // это время держит встроенного провайдера, вместо того чтобы мигать жалобой и обратно.
        return pendingModule;
      }

      const known = entries.get(status.key);

      return (known?.revision === assets.revision ? known : begin(status.key, assets)).load;
    },
    retain: (statuses) => {
      if (disposed) {
        return;
      }

      const alive = new Set(
        statuses
          .filter((status) => status.browser !== undefined)
          .map((status) => stylesheetKey(status.key, status.browser?.revision ?? "")),
      );

      for (const [pluginKey, entry] of [...entries]) {
        if (!alive.has(stylesheetKey(pluginKey, entry.revision))) {
          entries.delete(pluginKey);
          removeStylesheets(pluginKey);
        }
      }
    },
    subscribe: (listener) => {
      if (disposed) {
        return () => {};
      }

      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      entries.clear();
      listeners.clear();
      for (const link of [...ownedStylesheets]) {
        removeStylesheet(link);
      }
    },
  };
}
