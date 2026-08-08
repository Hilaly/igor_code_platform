/**
 * Сторож контракта CSS Modules со стороны хоста (docs/ui-extension-model.md). Стили кита собирает
 * Vite, а стили браузерной части плагина — esbuild в демоне; общим объявлено подмножество, которое
 * оба конвейера обрабатывают одинаково. Здесь проверяется половина Vite, у демона — половина
 * esbuild, и расхождение умолчаний при обновлении любого из двух падает проверкой, а не всплывает
 * компонентом без оформления.
 *
 * Настоящая сборка, а не импорт из vitest: обработку CSS vitest по умолчанию выключает, и импорт
 * стиля отдал бы пустой объект — то есть проверял бы себя, а не конвейер.
 */

import { join } from "node:path";

import { build, type Rollup } from "vite";
import { describe, expect, it } from "vitest";

const fixtureRoot = join(import.meta.dirname, "css-modules-contract");

type BuiltFixture = {
  classNames: Record<string, string>;
  script: string;
  styles: string;
};

async function buildFixture(): Promise<BuiltFixture> {
  const result = (await build({
    root: fixtureRoot,
    logLevel: "silent",
    // Умолчания Vite намеренно не трогаются: контракт описывает то, чем собирается приложение.
    build: {
      write: false,
      lib: { entry: join(fixtureRoot, "entry.ts"), formats: ["es"], fileName: "entry" },
    },
  })) as Rollup.RollupOutput[];

  const output: (Rollup.OutputChunk | Rollup.OutputAsset)[] = [...(result[0]?.output ?? [])];
  const script = output.find(
    (chunk): chunk is Rollup.OutputChunk => chunk.type === "chunk" && chunk.isEntry,
  );
  const styles = output.find(
    (asset): asset is Rollup.OutputAsset =>
      asset.type === "asset" && asset.fileName.endsWith(".css"),
  );

  if (script === undefined || styles === undefined) {
    throw new Error("the fixture build produced no script or no stylesheet");
  }

  const loaded = (await importBuiltChunk(script.code)) as { classNames: Record<string, string> };

  return {
    classNames: loaded.classNames,
    script: script.code,
    styles: String(styles.source),
  };
}

/**
 * Собранный чанк исполняется, а не разбирается регэкспом: минификатор волен писать ключ объекта и с
 * кавычками, и без, а проверять надо то, что получит плагин, а не форму записи.
 */
function importBuiltChunk(code: string): Promise<unknown> {
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

describe("the CSS Modules contract of the Vite pipeline", () => {
  it("keeps the local names as they are written, without camelCase aliases", async () => {
    const { classNames } = await buildFixture();

    expect(Object.keys(classNames).sort()).toEqual(["badge", "badge-tail", "loud"]);
    // `badgeTail` не появляется: обещать плагину camelCase нельзя, потому что esbuild его не делает.
    expect(classNames).not.toHaveProperty("badgeTail");
  });

  it("gives a generated name that nobody is allowed to guess", async () => {
    const { classNames, styles } = await buildFixture();

    for (const local of ["badge", "badge-tail", "loud"]) {
      const generated = classNames[local];

      expect(generated, `${local} has no generated name`).toBeTruthy();

      // Значение — список имён, а не одно имя: `composes` приводит к двум классам сразу.
      for (const name of String(generated).split(/\s+/)) {
        expect(styles).toContain(`.${name}`);
      }
    }

    // Форма имени у хоста своя (`_<локальное>_<хеш>_<строка>`) и с формой у плагина не совпадает;
    // проверяется именно то, что имя не равно написанному, а не то, из чего оно составлено.
    expect(classNames["badge"]).not.toBe("badge");
  });

  it("resolves composes into a second class instead of copying the rules", async () => {
    const { classNames } = await buildFixture();

    const loud = String(classNames["loud"]).split(/\s+/);
    const badge = String(classNames["badge"]);

    expect(loud).toContain(badge);
    expect(loud.length).toBe(2);
  });

  it("leaves a :global selector alone", async () => {
    const { styles } = await buildFixture();

    expect(styles).toContain(".sovereign-plugin-anchor");
    expect(styles).not.toContain(":global");
  });

  it("puts the styles into a file of their own, without a link from the script", async () => {
    const { script, styles } = await buildFixture();

    // Ни Vite, ни esbuild не вшивают ссылку на стили в модуль — подключает их хост.
    expect(script).not.toContain(".css");
    expect(styles).toContain("inline-flex");
  });
});
