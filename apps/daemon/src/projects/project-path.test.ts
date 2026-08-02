import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { normalizeProjectPath } from "./project-path.ts";

const workspace = mkdtempSync(join(tmpdir(), "sovereign-project-path-"));

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** Файловая система в стороне: проверяются шаги до неё и складка после. */
function normalize(
  raw: string,
  options: { home?: string; platform?: NodeJS.Platform; realpath?: (path: string) => string } = {},
) {
  return normalizeProjectPath(raw, {
    home: options.home ?? "/home/owner",
    platform: options.platform ?? "linux",
    realpath: options.realpath ?? ((path) => path),
  });
}

function normalized(raw: string, options?: Parameters<typeof normalize>[1]) {
  const result = normalize(raw, options);

  assert.ok(result.kind === "normalized", `${raw} must normalize`);

  return result.value;
}

function fails(code: string): (path: string) => string {
  return () => {
    throw Object.assign(new Error(`${code}: injected`), { code });
  };
}

describe("normalizeProjectPath: the human-readable folder", () => {
  it("expands a leading tilde", () => {
    assert.equal(normalized("~/code/platform").folder, "/home/owner/code/platform");
    assert.equal(normalized("~").folder, "/home/owner");
  });

  it("refuses another user's home: resolving it means guessing where homes live", () => {
    const result = normalize("~other/code");

    assert.ok(result.kind === "rejected");
    assert.match(result.reason, /~/);
  });

  it("leaves a tilde inside the path alone", () => {
    assert.equal(normalized("/srv/~backup").folder, "/srv/~backup");
  });

  it("refuses a relative path instead of resolving it against the daemon's cwd", () => {
    // Демон запускается из произвольной директории, и «code» значило бы разные папки при разных
    // запусках. Развернуть его обязан тот, кто знает, относительно чего.
    for (const raw of ["code/platform", "./code", "../code", ""]) {
      assert.equal(normalize(raw).kind, "rejected", `${JSON.stringify(raw)} must be refused`);
    }
  });

  it("drops dot segments, doubled separators and a trailing slash", () => {
    assert.equal(normalized("/code/./platform/../platform//src/").folder, "/code/platform/src");
  });

  it("trims the surrounding spaces but keeps the inner ones", () => {
    assert.equal(normalized("  /code/my project  ").folder, "/code/my project");
  });

  it("keeps the root as it is", () => {
    assert.equal(normalized("/").folder, "/");
  });
});

describe("normalizeProjectPath: the comparison key", () => {
  it("folds the case on macOS and leaves it alone on linux", () => {
    assert.equal(normalized("/Code/Platform", { platform: "darwin" }).folderKey, "/code/platform");
    assert.equal(normalized("/Code/Platform", { platform: "linux" }).folderKey, "/Code/Platform");
    assert.equal(normalized("/Code/Platform", { platform: "win32" }).folderKey, "/code/platform");
  });

  it("folds the unicode composition on macOS: the same name typed twice must collide", () => {
    // «й» приходит из Finder разложенной, а с клавиатуры — составленной. На linux это два разных
    // файла, и складывать их нельзя.
    // Разложенная форма считается, а не пишется в исходнике: два литерала выглядели бы одинаково,
    // и любой инструмент, нормализующий файл, тихо превратил бы этот тест в сравнение строки с
    // собой.
    const composed = "/code/\u0439";
    const decomposed = composed.normalize("NFD");

    assert.notEqual(composed, decomposed);
    assert.equal(
      normalized(composed, { platform: "darwin" }).folderKey,
      normalized(decomposed, { platform: "darwin" }).folderKey,
    );
    assert.notEqual(
      normalized(composed, { platform: "linux" }).folderKey,
      normalized(decomposed, { platform: "linux" }).folderKey,
    );
  });

  it("shows the folder as it was typed even when the key was folded", () => {
    const value = normalized("/Code/Platform", { platform: "darwin" });

    assert.equal(value.folder, "/Code/Platform");
    assert.equal(value.folderKey, "/code/platform");
  });
});

describe("normalizeProjectPath: symlinks", () => {
  it("resolves a link on an existing path", () => {
    const value = normalized("/link/inside", {
      realpath: (path) => (path === "/link/inside" ? "/real/inside" : path),
    });

    assert.equal(value.folder, "/link/inside");
    assert.equal(value.folderKey, "/real/inside");
  });

  it("resolves the existing prefix of a path whose tail is not there yet", () => {
    // Папка проекта не обязана существовать (docs/sessions-and-projects.md), а `realpath` целиком
    // на такой путь бросает ENOENT. Без частичного разбора проект, созданный до появления папки, и
    // проект, созданный после, получили бы разные ключи на одну папку.
    const value = normalized("/link/not/there/yet", {
      realpath: (path) => {
        if (path === "/link") {
          return "/real";
        }

        throw Object.assign(new Error("ENOENT: injected"), { code: "ENOENT" });
      },
    });

    assert.equal(value.folder, "/link/not/there/yet");
    assert.equal(value.folderKey, "/real/not/there/yet");
  });

  it("walks up past a file standing where a directory was expected", () => {
    const value = normalized("/data/file.txt/inside", {
      realpath: (path) => {
        if (path === "/data") {
          return "/data";
        }

        throw Object.assign(new Error("ENOTDIR: injected"), { code: "ENOTDIR" });
      },
    });

    assert.equal(value.folderKey, "/data/file.txt/inside");
  });

  it("falls back to the lexical path when the link cannot be read at all", () => {
    // Отказ в правах или петля симлинков — не повод отказать в создании проекта: папка может стать
    // читаемой позже, а ключ обязан получиться сейчас.
    for (const code of ["EACCES", "ELOOP", "EIO"]) {
      assert.equal(
        normalized("/code/platform", { realpath: fails(code) }).folderKey,
        "/code/platform",
      );
    }
  });

  it("takes a real link on the real file system", () => {
    const target = join(workspace, "target");
    const link = join(workspace, "link");

    mkdirSync(target);
    symlinkSync(target, link);

    const viaLink = normalizeProjectPath(join(link, "nested"), { platform: "linux" });
    const viaTarget = normalizeProjectPath(join(target, "nested"), { platform: "linux" });

    assert.ok(viaLink.kind === "normalized" && viaTarget.kind === "normalized");
    assert.equal(viaLink.value.folderKey, viaTarget.value.folderKey);
    assert.notEqual(viaLink.value.folder, viaTarget.value.folder);
  });

  it("makes /tmp and /private/tmp one and the same project on macOS", () => {
    // `/tmp` — симлинк на `/private/tmp` (docs/runtime-checks.md). Без частичного realpath один и
    // тот же путь, написанный двумя способами, дал бы два проекта.
    if (process.platform !== "darwin") {
      return;
    }

    const viaShort = normalizeProjectPath("/tmp/sovereign-collision");
    const viaLong = normalizeProjectPath("/private/tmp/sovereign-collision");

    assert.ok(viaShort.kind === "normalized" && viaLong.kind === "normalized");
    assert.equal(viaShort.value.folderKey, viaLong.value.folderKey);
    assert.notEqual(viaShort.value.folder, viaLong.value.folder);
  });
});
