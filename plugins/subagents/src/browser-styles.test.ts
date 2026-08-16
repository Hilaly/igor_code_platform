import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Разметка панели и её таблица стилей обязаны совпадать по именам. Панель уже жила с классами, для
 * которых стилей не существовало вовсе: контейнеры оставались строчными `span`, и строка списка
 * склеивалась в один поток без единого пробела. Ошибка молчаливая — ни линтер, ни типы имени класса
 * не проверяют, — поэтому её ловит тест.
 *
 * Читаются файлы, а не рендер: проверяется соответствие двух исходников, для которого DOM не нужен.
 */

const source = (name: string): string => readFileSync(join(import.meta.dirname, name), "utf8");

const markup = source("browser.tsx");
const styles = source("subagents-panel.css").replaceAll(/\/\*[\s\S]*?\*\//g, "");

describe("the style sheet of the subagents panel", () => {
  it("is loaded by the panel module", () => {
    assert.match(markup, /^import "\.\/subagents-panel\.css";$/m);
  });

  it("styles every class name the panel marks up", () => {
    const marked = new Set(
      [...markup.matchAll(/className="([^"{]+)"/g)]
        .flatMap(([, list]) => (list ?? "").split(/\s+/))
        .filter((name) => name !== ""),
    );
    const styled = new Set(
      [...styles.matchAll(/\.([a-z][a-z0-9-]*)/g)].map(([, name]) => name ?? ""),
    );

    assert.deepEqual(
      [...marked].filter((name) => !styled.has(name)),
      [],
    );
    // Пустой список имён означал бы, что тест ничего не проверяет и молчит об этом.
    assert.ok(marked.size > 0);
  });

  it("takes every colour and measure from the kit instead of naming its own", () => {
    // Цвет и кегль панели принадлежат киту и оболочке, плагин назначает только геометрию
    // (docs/ui-extension-model.md).
    assert.deepEqual(styles.match(/#[0-9a-fA-F]{3,8}\b/g), null);
    assert.doesNotMatch(styles, /\bfont-(?:size|family)\s*:/);

    const gaps = [...styles.matchAll(/gap:\s*([^;]+);/g)].map(([, value]) => value ?? "");

    assert.ok(gaps.length > 0);
    assert.deepEqual(
      gaps.filter((value) => !value.startsWith("var(--sovereign-space-")),
      [],
    );
  });
});
