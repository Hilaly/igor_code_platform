import { contributionKinds } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import { shippedSchemes } from "../tokens/schemes/shipped.ts";
import { coreNamespace, type CatalogRegistration } from "./catalog.ts";
import { coreEnglish } from "./messages/en.ts";
import { coreRussian } from "./messages/ru.ts";
import { createTranslator, type CreateTranslatorOptions } from "./translator.ts";

const shipped = [coreEnglish, coreRussian];

function translator(locale: string, extra: CatalogRegistration[] = []) {
  const diagnostics: string[] = [];
  const options: CreateTranslatorOptions = {
    locale,
    namespace: coreNamespace,
    catalogs: [...shipped, ...extra],
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  };

  return { ...createTranslator(options), diagnostics };
}

describe("createTranslator", () => {
  it("translates a key in the chosen locale", () => {
    expect(translator("ru").t("appearance.variant.dark")).toBe("Тёмная");
    expect(translator("en").t("appearance.variant.dark")).toBe("Dark");
  });

  it("shows the base string and says the translation is missing", () => {
    const russian = translator("ru", [{ namespace: coreNamespace, locale: "ru", messages: {} }]);
    const incomplete = translator("pt-BR");

    expect(incomplete.t("state.loading")).toBe("Loading…");
    expect(incomplete.diagnostics.join("\n")).toMatch(/core:pt-BR has no translation/);
    expect(russian.t("state.loading")).toBe("Загрузка…");
  });

  it("says nothing twice about the same hole", () => {
    const incomplete = translator("pt-BR");

    incomplete.t("state.loading");
    incomplete.t("state.loading");

    expect(incomplete.diagnostics).toHaveLength(1);
  });

  it("gives back the key when no locale has the message", () => {
    const kit = translator("en");

    expect(kit.t("shell.nothing")).toBe("shell.nothing");
    expect(kit.diagnostics.join("\n")).toMatch(/no message shell.nothing in any locale/);
  });

  it("lets a plugin catalog replace our string without taking the rest", () => {
    const kit = translator("ru", [
      {
        namespace: coreNamespace,
        locale: "ru",
        messages: { "appearance.variant.dark": "Ночная" },
      },
    ]);

    expect(kit.t("appearance.variant.dark")).toBe("Ночная");
    expect(kit.t("appearance.variant.light")).toBe("Светлая");
  });

  it("keeps the namespaces apart", () => {
    const kit = translator("en", [
      { namespace: "tracker", locale: "en", messages: { title: "Tasks" } },
    ]);

    expect(kit.scope("tracker").t("title")).toBe("Tasks");
    expect(kit.t("title")).toBe("title");
  });

  it("substitutes parameters and formats numbers with Intl", () => {
    const kit = translator("ru", [
      {
        namespace: coreNamespace,
        locale: "ru",
        messages: { "plugins.running": "Работает {count} из {total}" },
      },
    ]);

    // Разряды по-русски разделяет неразрывный пробел: это и есть работа `Intl`, а не наша.
    expect(kit.t("plugins.running", { count: 2, total: 1234 })).toBe("Работает 2 из 1\u00a0234");
  });

  it("names the selected project in the empty agent catalogue message", () => {
    expect(translator("ru").t("sessions.new.agents.empty", { project: "Платформа" })).toBe(
      "В проекте «Платформа» нет доступных агентов.",
    );
    expect(translator("en").t("sessions.new.agents.empty", { project: "Platform" })).toBe(
      "No agents are available in the project “Platform”.",
    );
  });

  it("names the unavailable saved agent in both shipped locales", () => {
    expect(translator("ru").t("chat.agent.missing", { agent: "base-agent.agent" })).toContain(
      "base-agent.agent",
    );
    expect(translator("en").t("chat.agent.missing", { agent: "base-agent.agent" })).toContain(
      "base-agent.agent",
    );
  });

  it("reports a placeholder nobody filled instead of printing it as text", () => {
    const kit = translator("en", [
      { namespace: coreNamespace, locale: "en", messages: { greeting: "Hello, {name}" } },
    ]);

    expect(kit.t("greeting")).toBe("Hello, {name}");
    expect(kit.diagnostics.join("\n")).toMatch(/needs the parameter name/);
  });

  it("picks the plural category the language actually has", () => {
    const messages = {
      "plugins.count.one": "{count} плагин",
      "plugins.count.few": "{count} плагина",
      "plugins.count.many": "{count} плагинов",
    };
    const kit = translator("ru", [{ namespace: coreNamespace, locale: "ru", messages }]);

    expect(kit.t("plugins.count", { count: 1 })).toBe("1 плагин");
    expect(kit.t("plugins.count", { count: 3 })).toBe("3 плагина");
    expect(kit.t("plugins.count", { count: 11 })).toBe("11 плагинов");
  });

  it("says nothing about an optional key no locale has", () => {
    const kit = translator("en");

    // Название схемы плагин вправе не переводить (docs/plugins.md): `t` вернул бы сам ключ и написал
    // ложную диагностику о дырке в переводе.
    expect(kit.scope("themed").optional("appearance.scheme.midnight")).toBeUndefined();
    expect(kit.diagnostics).toEqual([]);
  });

  it("still reports an optional key that one locale has and another does not", () => {
    const kit = translator("ru", [
      { namespace: "themed", locale: "en", messages: { "appearance.scheme.midnight": "Midnight" } },
    ]);

    expect(kit.scope("themed").optional("appearance.scheme.midnight")).toBe("Midnight");
    expect(kit.diagnostics.join("\n")).toMatch(/themed:ru has no translation/);
  });

  it("formats numbers and dates in the chosen locale", () => {
    const russian = translator("ru");
    const english = translator("en");
    const moment = new Date("2026-07-27T08:12:08.713Z");
    const options: Intl.DateTimeFormatOptions = { timeZone: "UTC", dateStyle: "short" };

    expect(russian.formatNumber(1234.5)).toBe("1\u00a0234,5");
    expect(english.formatNumber(1234.5)).toBe("1,234.5");
    expect(russian.formatDate(moment, options)).toBe("27.07.2026");
    expect(english.formatDate(moment, options)).toBe("7/27/26");
  });
});

/**
 * Множественное число ломает сравнение ключей один в один: в английском категорий две, в русском
 * три, и это не дырка в переводе, а свойство языка. Поэтому сравниваются семьи сообщений — ключ без
 * категории, — а сами категории проверяются по `Intl`.
 */
const pluralCategories = new Set(["zero", "one", "two", "few", "many", "other"]);

const family = (key: string): string => {
  const lastDot = key.lastIndexOf(".");
  const suffix = key.slice(lastDot + 1);

  return lastDot > 0 && pluralCategories.has(suffix) ? key.slice(0, lastDot) : key;
};

const families = (catalog: CatalogRegistration): string[] =>
  [...new Set(Object.keys(catalog.messages).map(family))].sort();

describe("the shipped catalogs", () => {
  it("say the same messages in both locales", () => {
    expect(families(coreRussian)).toEqual(families(coreEnglish));
  });

  it("name every scheme the platform ships", () => {
    // Схема без имени доезжает до выпадающего списка ключом вместо названия, а диагностика о ней
    // записывается во время отрисовки. Проверять это глазами значит открыть панель внешнего вида на
    // каждой добавленной схеме — двух схем как раз и не хватило.
    for (const catalog of [coreEnglish, coreRussian]) {
      const missing = shippedSchemes
        .map((scheme) => `appearance.scheme.${scheme.id}`)
        .filter((key) => catalog.messages[key] === undefined);

      expect(missing, catalog.locale).toEqual([]);
    }
  });

  it("name every kind of contribution the platform knows", () => {
    // Новый вид вклада добавляется в четырёх местах, и подпись во вью — последнее из них: без неё
    // человек видит в карточке плагина `plugins.kind.color-scheme` вместо слова.
    for (const catalog of [coreEnglish, coreRussian]) {
      const missing = contributionKinds
        .map((kind) => `plugins.kind.${kind}`)
        .filter((key) => catalog.messages[key] === undefined);

      expect(missing, catalog.locale).toEqual([]);
    }
  });

  it("name only the plural categories the language has", () => {
    for (const catalog of [coreEnglish, coreRussian]) {
      const known: string[] = new Intl.PluralRules(catalog.locale).resolvedOptions()
        .pluralCategories;
      const used = Object.keys(catalog.messages)
        .filter((key) => family(key) !== key)
        .map((key) => key.slice(key.lastIndexOf(".") + 1));

      expect(used.length, catalog.locale).toBeGreaterThan(0);
      expect(
        used.filter((category) => !known.includes(category)),
        catalog.locale,
      ).toEqual([]);
    }
  });
});
