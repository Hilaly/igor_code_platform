import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./settings.css", import.meta.url), "utf8");

describe("settings and plugin layout styles", () => {
  it("keeps Appearance responsive while UI Kit owns its preview surface", () => {
    expect(styles).toMatch(
      /\.settings-appearance\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-width:\s*0;[^}]*container-type:\s*inline-size;/s,
    );
    expect(styles).not.toMatch(/\.settings-appearance-buttons/);
    expect(styles).not.toMatch(/\.settings-appearance-preview/);
  });

  it("keeps exact usage metrics, chart and table responsive without card frames", () => {
    expect(styles).toMatch(
      /\.usage-totals\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s,
    );
    expect(styles).toMatch(
      /@container\s*\(width\s*<\s*36rem\)[\s\S]*\.usage-totals\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s,
    );
    expect(styles).toMatch(
      /@container\s*\(width\s*<\s*22rem\)[\s\S]*\.usage-totals\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    );
    expect(styles).toMatch(/\.usage-table-scroll\s*\{[^}]*overflow-x:\s*auto;/s);
    expect(styles).not.toMatch(
      /\.usage-(?:view|totals|section|chart|table-scroll)\s*\{[^}]*(?:box-shadow|border-radius|background)\s*:/s,
    );
  });

  it("uses clean plugin containers without historical selector compensation", () => {
    expect(styles).toMatch(
      /\.plugins,\s*\.plugin-detail\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;[^}]*container-type:\s*inline-size;/s,
    );
    // Карточки-шапки над заголовком «Плагин» больше нет: переключатель стоит в самих фактах плагина.
    expect(styles).not.toMatch(/\.plugin-detail-header-card|\.plugin-detail-back/);
    expect(styles).toMatch(
      /@container\s*\(width\s*<\s*40rem\)[\s\S]*\.plugin-detail-contribution-controls\s*\{[^}]*align-items:\s*flex-start;/s,
    );
    expect(styles).not.toMatch(/\.project-detail-surface|\.plugin-detail-(?:surface|hero|facts)/);
    // Поверхность группы и её ярлык принадлежат киту (`Card`): прикладной CSS их не рисует.
    expect(styles).not.toMatch(/\.plugin-detail-kind/);
    // Длинный id вклада держится одной строкой и дорезается многоточием, а не гибкой вёрткой,
    // которая ломала его на два ряда.
    expect(styles).toMatch(/\.plugin-detail-contribution-id[\s\S]*?\{[^}]*min-width:\s*0;[^}]*}/s);
    expect(styles).toMatch(
      /\.plugin-detail-contribution-id\s+code\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;[^}]*}/s,
    );
    expect(styles).not.toMatch(
      /\[role="listitem"\]\s*\+\s*\[role="listitem"\][^{]*border-block-start:\s*0/s,
    );
  });
});
