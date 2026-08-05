import { describe, expect, it } from "vitest";

import { shortenPath } from "./path-shorten.ts";

describe("shortenPath", () => {
  it("returns a short path untouched", () => {
    expect(shortenPath("/code/alpha")).toBe("/code/alpha");
  });

  it("returns the path as-is when it fits the limit exactly", () => {
    const folder = "/exactly-forty-chars-long-path-here";

    expect(shortenPath(folder, folder.length)).toBe(folder);
  });

  it("uses spare room for the tail before the head", () => {
    // В лимит помещается ещё один родитель из хвоста; он важнее далёкой головы `/Users`.
    const long = "/Users/me/repos/sovereign_platform_node/apps/daemon";

    expect(shortenPath(long)).toBe("/…/sovereign_platform_node/apps/daemon");
  });

  it("drops the head when the limit is tight, keeping parent and last", () => {
    // Голова не влезает — отбрасываем её; родитель с последней компонентой остаются, хвост важнее.
    const long = "/Users/me/repos/sovereign_platform_node/apps/daemon";

    expect(shortenPath(long, 18)).toBe("/…/apps/daemon");
  });

  it("keeps the parent of the last segment when the head does not fit", () => {
    // Короткие имена, но лимит ещё меньше: минимум `…/e/f` остаётся, голову и средние отбросили.
    const long = "/a/b/c/d/e/f";

    expect(shortenPath(long, 6)).toBe("/…/e/f");
  });

  it("handles a path without a leading slash", () => {
    const long = "workspace/some/deep/nested/folder";

    // `…/nested/folder` (14) не влезает в 12 — остаётся только последний сегмент.
    expect(shortenPath(long, 12)).toBe("…/folder");
  });

  it("handles the root without breaking", () => {
    expect(shortenPath("/")).toBe("/");
  });

  it("shows only the last segment when there are just two", () => {
    // Сокращать середину не из чего: компонентов всего два. Голову не добавляем — она удлинила бы
    // строку, а единственная польза здесь — имя последней компоненты.
    const long = "/very-long-first-segment-name/alpha";

    expect(shortenPath(long, 16)).toBe("/…/alpha");
  });

  it("returns the last segment even when it alone exceeds the limit", () => {
    // Имя папки длиннее лимита: лучше показать его целиком, чем резать `…` посередине.
    const long = "/home/very-long-project-name-here";

    expect(shortenPath(long, 10)).toBe("/…/very-long-project-name-here");
  });

  it("preserves a Windows drive root and backslash separators", () => {
    const long = "C:\\Users\\me\\repos\\product";

    expect(shortenPath(long, 19)).toBe("C:\\…\\repos\\product");
  });

  it("returns Windows roots untouched", () => {
    expect(shortenPath("C:\\")).toBe("C:\\");
    expect(shortenPath("\\\\server\\share\\")).toBe("\\\\server\\share\\");
  });

  it("shortens a relative backslash path without inventing a root", () => {
    const long = "workspace\\team\\module\\product";

    expect(shortenPath(long, 21)).toBe("…\\team\\module\\product");
  });

  it("preserves the server and share of a UNC path", () => {
    const long = "\\\\server\\share\\archive\\team\\product";

    expect(shortenPath(long, 29)).toBe("\\\\server\\share\\…\\team\\product");
  });

  it("keeps every parent that fits before considering the head", () => {
    const long = "/a/b/c/d/e/f";

    expect(shortenPath(long, 10)).toBe("/…/c/d/e/f");
  });

  it("keeps Unicode path components whole", () => {
    const long = "workspace/команда/модуль/проект";

    expect(shortenPath(long, 15)).toBe("…/модуль/проект");
  });
});
