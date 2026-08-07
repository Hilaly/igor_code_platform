import type { ContributionRegistration } from "@sovereign/protocol";
import { coreNamespace, createTranslator } from "@sovereign/ui-kit";
import { describe, expect, it } from "vitest";

import { availableLocales, pluginCatalogs, shippedCatalogs } from "./catalogs.ts";

const catalog = (
  declaredId: string,
  namespace: string,
  locale: string,
  messages: Record<string, string>,
): Extract<ContributionRegistration, { kind: "locale-catalog" }> => ({
  ownership: "plugin",
  kind: "locale-catalog",
  id: `themed.${declaredId}`,
  declaredId,
  pluginKey: "data:themed",
  pluginId: "themed",
  source: "data",
  namespace,
  locale,
  messages,
});

const esperanto = catalog("core-eo", coreNamespace, "eo", { "state.loading": "Ŝargado…" });
const own = catalog("own-ru", "themed", "ru", { "appearance.scheme.midnight": "Полночь" });

const translator = (locale: string, contributions: ContributionRegistration[]) => {
  const diagnostics: string[] = [];
  const kit = createTranslator({
    locale,
    namespace: coreNamespace,
    catalogs: [...shippedCatalogs, ...pluginCatalogs(contributions)],
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  return { ...kit, diagnostics };
};

describe("pluginCatalogs", () => {
  it("takes the catalogues out of the snapshot and leaves the other contributions alone", () => {
    const notACatalog: ContributionRegistration = {
      ownership: "plugin",
      kind: "custom",
      id: "themed.other",
      declaredId: "other",
      pluginKey: "data:themed",
      pluginId: "themed",
      source: "data",
    };

    expect(pluginCatalogs([esperanto, notACatalog, own])).toEqual([
      { namespace: coreNamespace, locale: "eo", messages: esperanto.messages },
      { namespace: "themed", locale: "ru", messages: own.messages },
    ]);
  });

  it("gives the plugin the last word about a message of ours", () => {
    const louder = catalog("core-ru", coreNamespace, "ru", { "state.loading": "Ждём…" });

    expect(translator("ru", [louder]).t("state.loading")).toBe("Ждём…");
    // Побеждает одно сообщение, а не весь каталог: соседние строки остаются нашими.
    expect(translator("ru", [louder]).t("appearance.variant.dark")).toBe("Тёмная");
  });

  it("shows the base string of an untranslated key and says the hole is there", () => {
    const partial = translator("eo", [esperanto]);

    expect(partial.t("state.loading")).toBe("Ŝargado…");
    expect(partial.t("appearance.variant.dark")).toBe("Dark");
    expect(partial.diagnostics.join("\n")).toMatch(/core:eo has no translation/);
  });
});

describe("availableLocales", () => {
  it("names the shipped languages when no plugin brought a catalogue", () => {
    expect(availableLocales(shippedCatalogs)).toEqual(["en", "ru"]);
  });

  it("adds the language of a catalogue for our namespace", () => {
    expect(availableLocales([...shippedCatalogs, ...pluginCatalogs([esperanto])])).toEqual([
      "en",
      "ru",
      "eo",
    ]);
  });

  it("does not add a language for a catalogue in the namespace of the plugin", () => {
    // Такой каталог переводит строки самого плагина: выбрав его язык, человек получил бы английский
    // интерфейс с парой переведённых строк в одной карточке.
    const french = catalog("own-fr", "themed", "fr", { "appearance.scheme.midnight": "Minuit" });

    expect(availableLocales([...shippedCatalogs, ...pluginCatalogs([french])])).toEqual([
      "en",
      "ru",
    ]);
  });

  it("names a language once even when several plugins bring it", () => {
    const second = catalog("core-eo", coreNamespace, "eo", { "state.empty": "Malplena" });

    expect(availableLocales([...shippedCatalogs, ...pluginCatalogs([esperanto, second])])).toEqual([
      "en",
      "ru",
      "eo",
    ]);
  });
});
