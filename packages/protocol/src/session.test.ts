import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSessionId,
  parseSessionDraft,
  parseSessionForkRequest,
  parseSessionMessage,
  parseSessionOutboxAction,
  parseSessionOutboxRequest,
  parseSessionOutboxUpdate,
  parseSessionUpdate,
  parseTurnRequest,
  sessionEntriesPath,
  sessionForkPath,
  sessionImageBytes,
  sessionMessagesPath,
  sessionPath,
  sessionQueuedMessagePath,
  sessionQueuePath,
  sessionStatsPath,
  sessionTurnsPath,
  type AgentSummary,
  type Session,
  type SessionImage,
} from "./session.ts";

/** Байты, с которых начинается каждый из четырёх поддержанных форматов. */
const pngBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01];
const jpegBytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const gifBytes = [...Buffer.from("GIF89a", "ascii"), 0x01, 0x02];
const webpBytes = [...Buffer.from("RIFF", "ascii"), 0, 0, 0, 0, ...Buffer.from("WEBP", "ascii")];

function base64Of(bytes: number[]): string {
  return Buffer.from(bytes).toString("base64");
}

const png: SessionImage = { mimeType: "image/png", data: base64Of(pngBytes) };

describe("AgentSummary", () => {
  it("keeps normalized skills and distinguishes plugin from standalone ownership", () => {
    const pluginAgent: AgentSummary = {
      id: "github.review",
      ownership: "plugin",
      pluginKey: "builtin:github",
      source: "builtin",
      skills: { include: ["github.*"], exclude: ["*-unsafe"] },
    };
    const standaloneAgent: AgentSummary = {
      id: "review",
      ownership: "standalone",
      source: "native:user-agents",
      scope: "user",
      skills: { include: [], exclude: [] },
    };

    assert.equal(
      pluginAgent.ownership === "plugin" ? pluginAgent.pluginKey : undefined,
      "builtin:github",
    );
    assert.equal(
      standaloneAgent.ownership === "standalone" ? standaloneAgent.scope : undefined,
      "user",
    );

    // @ts-expect-error — plugin-owned summaries always identify their plugin instance.
    const pluginWithoutKey: AgentSummary = {
      id: "github.review",
      ownership: "plugin",
      source: "builtin",
      skills: { include: [], exclude: [] },
    };
    // @ts-expect-error — standalone summaries do not fabricate a plugin owner.
    const standaloneWithKey: AgentSummary = {
      id: "review",
      ownership: "standalone",
      pluginKey: "builtin:fake",
      source: "native:user-agents",
      scope: "user",
      skills: { include: [], exclude: [] },
    };
    const skillsWithoutExclude: AgentSummary = {
      id: "github.review",
      ownership: "plugin",
      pluginKey: "builtin:github",
      source: "builtin",
      // @ts-expect-error — summaries carry normalized selectors, including an explicit exclude list.
      skills: { include: ["github.*"] },
    };

    assert.ok(pluginWithoutKey);
    assert.ok(standaloneWithKey);
    assert.ok(skillsWithoutExclude);
  });
});

describe("Session", () => {
  it("reports whether its current project agent is available", () => {
    const session: Session = {
      id: "0199",
      projectId: "p1",
      folder: "/tmp/demo",
      agentId: "starter.generic",
      agentAvailable: false,
      model: "scripted/one",
      thinkingLevel: "off",
      phase: "idle",
      archived: false,
      hidden: false,
      createdAt: "2026-08-02T09:00:00.000Z",
    };

    assert.equal(session.agentAvailable, false);
  });
});

describe("parseSessionDraft", () => {
  it("reads a project and an agent", () => {
    const result = parseSessionDraft({ projectId: "work", agentId: "starter.generic" });

    assert.equal(result.kind, "parsed");
    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      projectId: "work",
      agentId: "starter.generic",
    });
  });

  it("keeps the model and the reasoning level when they are named", () => {
    const result = parseSessionDraft({
      projectId: "work",
      agentId: "starter.generic",
      model: "anthropic/claude",
      thinkingLevel: "high",
    });

    assert.deepEqual(result.kind === "parsed" ? result.value.thinkingLevel : undefined, "high");
    assert.deepEqual(result.kind === "parsed" ? result.value.model : undefined, "anthropic/claude");
  });

  it("keeps the hidden mark only when it is asked for", () => {
    const asked = parseSessionDraft({ projectId: "work", agentId: "a", hidden: true });
    const declined = parseSessionDraft({ projectId: "work", agentId: "a", hidden: false });

    assert.deepEqual(asked.kind === "parsed" ? asked.value.hidden : undefined, true);
    // Явное `false` — то же самое, что не сказать ничего: сессия обычная.
    assert.deepEqual(declined.kind === "parsed" ? declined.value.hidden : undefined, undefined);
  });

  it("refuses a hidden mark that is not a boolean", () => {
    assert.equal(
      parseSessionDraft({ projectId: "work", agentId: "a", hidden: "yes" }).kind,
      "rejected",
    );
  });

  it("refuses a draft that names no project or no agent", () => {
    for (const body of [
      {},
      { projectId: "work" },
      { agentId: "a" },
      { projectId: "", agentId: "a" },
    ]) {
      assert.equal(parseSessionDraft(body).kind, "rejected", JSON.stringify(body));
    }
  });

  it("refuses a reasoning level the runtime does not know", () => {
    const result = parseSessionDraft({
      projectId: "work",
      agentId: "a",
      thinkingLevel: "выше крыши",
    });

    assert.equal(result.kind, "rejected");
  });

  it("takes an unknown key as a diagnostic, not a refusal", () => {
    // Понижение версии платформы обязано читать тело, написанное более новой (docs/data-directory.md).
    const result = parseSessionDraft({ projectId: "work", agentId: "a", title: "будущее поле" });

    assert.equal(result.kind, "parsed");
    assert.match(result.diagnostics.join(" "), /title/);
  });
});

describe("parseTurnRequest", () => {
  it("reads the text and the per-turn overrides", () => {
    const result = parseTurnRequest({ text: "сделай", model: "m", thinkingLevel: "off" });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      text: "сделай",
      model: "m",
      thinkingLevel: "off",
    });
  });

  it("refuses a turn without text", () => {
    for (const body of [{}, { text: "" }, { text: "   " }, { text: 5 }]) {
      assert.equal(parseTurnRequest(body).kind, "rejected", JSON.stringify(body));
    }
  });

  it("reads images beside the text", () => {
    const result = parseTurnRequest({ text: "что тут не так", images: [png] });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      text: "что тут не так",
      images: [png],
    });
  });

  it("accepts a turn made only of images", () => {
    // Скриншот без единого слова — обычная просьба «посмотри», и требовать к нему текст незачем.
    const result = parseTurnRequest({ text: "  ", images: [png] });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      text: "",
      images: [png],
    });
  });

  it("refuses an empty images list instead of taking it as a text-only turn", () => {
    assert.equal(parseTurnRequest({ text: "", images: [] }).kind, "rejected");
  });

  it("reads a skill turn with the instructions written after it", () => {
    const result = parseTurnRequest({ skill: "review", instructions: "начни с тестов" });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      skill: "review",
      instructions: "начни с тестов",
    });
  });

  it("reads a skill turn with the per-turn overrides", () => {
    const result = parseTurnRequest({ skill: "review", thinkingLevel: "high" });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      skill: "review",
      thinkingLevel: "high",
    });
  });

  it("refuses a body that names both a message and a skill", () => {
    const result = parseTurnRequest({ text: "сделай", skill: "review" });

    assert.equal(result.kind, "rejected");
    assert.match(result.diagnostics.join(" "), /skill/);
  });

  it("refuses images beside a skill instead of dropping them silently", () => {
    const result = parseTurnRequest({ skill: "review", images: [png] });

    assert.equal(result.kind, "rejected");
    assert.match(result.diagnostics.join(" "), /images/);
  });

  it("refuses instructions without a skill", () => {
    const result = parseTurnRequest({ text: "сделай", instructions: "начни с тестов" });

    assert.equal(result.kind, "rejected");
    assert.match(result.diagnostics.join(" "), /instructions/);
  });

  it("reads a template turn with the arguments as one string", () => {
    const result = parseTurnRequest({ template: "review", arguments: "срез 15" });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      template: "review",
      arguments: "срез 15",
    });
  });

  it("refuses arguments without a template", () => {
    const result = parseTurnRequest({ text: "сделай", arguments: "срез 15" });

    assert.equal(result.kind, "rejected");
    assert.match(result.diagnostics.join(" "), /arguments/);
  });

  it("refuses a body that names a template beside a skill", () => {
    const result = parseTurnRequest({ template: "review", skill: "starter.review" });

    assert.equal(result.kind, "rejected");
    assert.match(result.diagnostics.join(" "), /more than one operation/);
  });

  it("refuses a nameless skill", () => {
    for (const skill of ["", "   ", 5, null]) {
      assert.equal(parseTurnRequest({ skill }).kind, "rejected", JSON.stringify(skill));
    }
  });
});

describe("parseSessionImages", () => {
  const withImage = (image: unknown): unknown => ({ text: "смотри", images: [image] });

  it("takes all four supported formats", () => {
    const images: SessionImage[] = [
      { mimeType: "image/png", data: base64Of(pngBytes) },
      { mimeType: "image/jpeg", data: base64Of(jpegBytes) },
      { mimeType: "image/gif", data: base64Of(gifBytes) },
      { mimeType: "image/webp", data: base64Of(webpBytes) },
    ];
    const result = parseTurnRequest({ text: "смотри", images });

    assert.deepEqual(result.kind === "parsed" ? result.value.images : undefined, images);
  });

  it("refuses a type no model of ours is promised to read", () => {
    for (const mimeType of ["image/svg+xml", "image/bmp", "application/pdf", "image/PNG", 5]) {
      assert.equal(
        parseTurnRequest(withImage({ mimeType, data: base64Of(pngBytes) })).kind,
        "rejected",
        JSON.stringify(mimeType),
      );
    }
  });

  it("refuses anything that is not clean canonical base64", () => {
    for (const data of [
      "",
      "   ",
      `data:image/png;base64,${base64Of(pngBytes)}`,
      `${base64Of(pngBytes).slice(0, 4)} ${base64Of(pngBytes).slice(4)}`,
      "iVBORw0KGgo",
      "не base64",
      5,
    ]) {
      assert.equal(
        parseTurnRequest(withImage({ mimeType: "image/png", data })).kind,
        "rejected",
        JSON.stringify(data),
      );
    }
  });

  it("refuses bytes that do not start the way the declared type must", () => {
    // Иначе `image/png` с содержимым zip уезжает провайдеру и возвращается его невнятной ошибкой.
    assert.equal(
      parseTurnRequest(withImage({ mimeType: "image/png", data: base64Of(jpegBytes) })).kind,
      "rejected",
    );
    assert.equal(
      parseTurnRequest(
        withImage({ mimeType: "image/webp", data: base64Of([0x50, 0x4b, 0x03, 0x04]) }),
      ).kind,
      "rejected",
    );
  });

  it("refuses an image that is not an object and an unknown key inside one", () => {
    assert.equal(parseTurnRequest(withImage("картинка")).kind, "rejected");
    assert.equal(parseTurnRequest(withImage(null)).kind, "rejected");
    assert.equal(parseTurnRequest({ text: "смотри", images: png }).kind, "rejected");
    assert.equal(
      parseTurnRequest(withImage({ ...png, name: "снимок.png" })).kind,
      "parsed",
      "неизвестный ключ внутри картинки — диагностика, как и везде",
    );
  });
});

describe("sessionImageBytes", () => {
  it("counts the decoded payload, not the length of its base64", () => {
    assert.equal(sessionImageBytes(png), pngBytes.length);
    assert.equal(sessionImageBytes({ mimeType: "image/webp", data: base64Of(webpBytes) }), 12);
    assert.equal(sessionImageBytes({ mimeType: "image/jpeg", data: base64Of(jpegBytes) }), 6);
  });
});

describe("isSessionId", () => {
  it("accepts what the runtime creates", () => {
    assert.ok(isSessionId("01998c2f-8a1e-7c3b-9f00-1b2c3d4e5f60"));
    assert.ok(isSessionId("a1b2c3d4"));
  });

  it("refuses anything that could leave the sessions folder", () => {
    // Идентификатор едет в имя файла, поэтому форма проверяется до всякого join.
    for (const value of ["", ".", "..", "a/b", "a\\b", "a b", "../../etc/passwd", 5, null]) {
      assert.equal(isSessionId(value), false, JSON.stringify(value));
    }
  });
});

describe("parseSessionUpdate", () => {
  it("reads a rename together with the archive flag", () => {
    const result = parseSessionUpdate({ title: "  разбор бага  ", archived: false });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      title: "разбор бага",
      archived: false,
    });
  });

  it("takes a body without a title as a session with no name", () => {
    const result = parseSessionUpdate({ archived: true });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, { archived: true });
  });

  it("refuses a body without the archive flag", () => {
    // Тело заменяет запись целиком: молчаливое умолчание разархивировало бы сессию при переименовании.
    assert.equal(parseSessionUpdate({ title: "имя" }).kind, "rejected");
    assert.equal(parseSessionUpdate({ title: "имя", archived: "да" }).kind, "rejected");
  });

  it("refuses a title made of spaces instead of silently clearing it", () => {
    assert.equal(parseSessionUpdate({ title: "   ", archived: false }).kind, "rejected");
  });
});

describe("parseSessionForkRequest", () => {
  it("takes an empty body as a fork of the whole session", () => {
    for (const body of [{}, undefined, null]) {
      const result = parseSessionForkRequest(body);

      assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {}, String(body));
    }
  });

  it("reads the entry to cut at and where to cut", () => {
    const result = parseSessionForkRequest({ entryId: "e7", position: "at" });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      entryId: "e7",
      position: "at",
    });
  });

  it("refuses a position with nothing to cut at", () => {
    assert.equal(parseSessionForkRequest({ position: "before" }).kind, "rejected");
  });

  it("refuses a position the runtime does not know", () => {
    assert.equal(parseSessionForkRequest({ entryId: "e7", position: "after" }).kind, "rejected");
  });
});

describe("parseSessionMessage", () => {
  it("reads the text and the mode", () => {
    const result = parseSessionMessage({ text: "  левее  ", mode: "steer" });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      text: "левее",
      mode: "steer",
    });
  });

  it("refuses a message without a mode", () => {
    // Умолчания нет намеренно: у трёх режимов разные предусловия по занятости сессии.
    assert.equal(parseSessionMessage({ text: "левее" }).kind, "rejected");
    assert.equal(parseSessionMessage({ text: "левее", mode: "steering" }).kind, "rejected");
  });

  it("no longer knows the next-turn mode", () => {
    // Сообщение, ждущее нового турна, идёт в очередь сессии: она этот турн ещё и запускает.
    assert.equal(parseSessionMessage({ text: "потом", mode: "next-turn" }).kind, "rejected");
  });

  it("refuses a message without text", () => {
    for (const body of [{ mode: "steer" }, { text: "  ", mode: "steer" }]) {
      assert.equal(parseSessionMessage(body).kind, "rejected", JSON.stringify(body));
    }
  });

  it("carries images in every mode, including a message made only of them", () => {
    for (const mode of ["steer", "follow-up", "append"]) {
      const result = parseSessionMessage({ text: "", images: [png], mode });

      assert.deepEqual(
        result.kind === "parsed" ? result.value : undefined,
        { text: "", images: [png], mode },
        mode,
      );
    }
  });

  it("checks images the same way a turn does", () => {
    assert.equal(
      parseSessionMessage({
        text: "левее",
        images: [{ mimeType: "image/png", data: "нет" }],
        mode: "steer",
      }).kind,
      "rejected",
    );
  });
});

describe("parseSessionOutboxRequest", () => {
  it("reads the text, the images and the chosen model without asking for a mode", () => {
    const result = parseSessionOutboxRequest({
      text: "  потом  ",
      images: [png],
      model: "anthropic/claude",
      thinkingLevel: "high",
    });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, {
      text: "потом",
      images: [png],
      model: "anthropic/claude",
      thinkingLevel: "high",
    });
  });

  it("refuses an override the runtime does not know", () => {
    assert.equal(
      parseSessionOutboxRequest({ text: "потом", thinkingLevel: "выше некуда" }).kind,
      "rejected",
    );
  });

  it("refuses an empty message and reports a named mode as unknown", () => {
    assert.equal(parseSessionOutboxRequest({ text: "  " }).kind, "rejected");

    const withMode = parseSessionOutboxRequest({ text: "потом", mode: "steer" });

    assert.equal(withMode.kind, "parsed");
    assert.match(withMode.diagnostics.join("\n"), /mode/);
  });
});

describe("parseSessionOutboxUpdate", () => {
  it("reads the removal of a stop", () => {
    const result = parseSessionOutboxUpdate({ stopped: false });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, { stopped: false });
  });

  it("refuses stopping the queue from outside", () => {
    // Останавливает очередь упавший турн: «остановлено» — его след, а не переключатель.
    assert.equal(parseSessionOutboxUpdate({ stopped: true }).kind, "rejected");
    assert.equal(parseSessionOutboxUpdate({}).kind, "rejected");
  });
});

describe("parseSessionOutboxAction", () => {
  it("reads steering and refuses everything else", () => {
    const result = parseSessionOutboxAction({ mode: "steer" });

    assert.deepEqual(result.kind === "parsed" ? result.value : undefined, { mode: "steer" });
    assert.equal(parseSessionOutboxAction({ mode: "append" }).kind, "rejected");
    assert.equal(parseSessionOutboxAction({}).kind, "rejected");
  });
});

describe("session paths", () => {
  it("builds the paths of one session", () => {
    assert.equal(sessionPath("abc"), "/api/sessions/abc");
    assert.equal(sessionEntriesPath("abc"), "/api/sessions/abc/entries");
    assert.equal(sessionTurnsPath("abc"), "/api/sessions/abc/turns");
    assert.equal(sessionForkPath("abc"), "/api/sessions/abc/fork");
    assert.equal(sessionMessagesPath("abc"), "/api/sessions/abc/messages");
    assert.equal(sessionStatsPath("abc"), "/api/sessions/abc/stats");
    assert.equal(sessionQueuePath("abc"), "/api/sessions/abc/queue");
    assert.equal(sessionQueuedMessagePath("abc", "m 1"), "/api/sessions/abc/queue/m%201");
  });
});
