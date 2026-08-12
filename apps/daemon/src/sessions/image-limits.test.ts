import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionEntry, SessionImage } from "@sovereign/protocol";

import {
  bodyLimitFor,
  entriesImageBytes,
  imagesBytes,
  refuseMessageImages,
  refuseSessionImageBudget,
  type ImageLimits,
} from "./image-limits.ts";

const limits: ImageLimits = {
  maxImageBytes: 90,
  maxImagesPerMessage: 2,
  maxMessageImageBytes: 150,
  maxSessionImageBytes: 300,
};

/** Картинка ровно на столько декодированных байт, сколько просят. */
function sized(bytes: number): SessionImage {
  const payload = Buffer.alloc(bytes);

  payload.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return { mimeType: "image/png", data: payload.toString("base64") };
}

describe("counting image payload", () => {
  it("counts decoded bytes, not the length of base64", () => {
    assert.equal(imagesBytes([sized(30), sized(45)]), 75);
    assert.equal(imagesBytes(undefined), 0);
  });

  it("counts what the whole session file holds, abandoned branches included", () => {
    const entries: SessionEntry[] = [
      {
        id: "e1",
        time: "2026-08-13T09:00:00.000Z",
        kind: "message",
        role: "user",
        content: [
          { kind: "text", text: "смотри" },
          { kind: "image", ...sized(40) },
        ],
      },
      {
        id: "e2",
        time: "2026-08-13T09:00:01.000Z",
        kind: "message",
        role: "agent",
        content: [{ kind: "text", text: "вижу" }],
      },
      { id: "e3", time: "2026-08-13T09:00:02.000Z", kind: "model-change", model: "a/b" },
    ];

    assert.equal(entriesImageBytes(entries), 40);
  });
});

describe("refuseMessageImages", () => {
  it("lets a message without images and a message inside every limit through", () => {
    assert.equal(refuseMessageImages(undefined, limits), undefined);
    assert.equal(refuseMessageImages([], limits), undefined);
    assert.equal(refuseMessageImages([sized(70), sized(70)], limits), undefined);
  });

  it("names the image that is too big and the limit it broke", () => {
    const refusal = refuseMessageImages([sized(30), sized(120)], limits);

    assert.equal(refusal?.status, 413);
    assert.match(refusal?.reason ?? "", /image 2/);
    assert.match(refusal?.reason ?? "", /maxImageBytes/);
  });

  it("refuses too many images and too much of them together", () => {
    assert.equal(refuseMessageImages([sized(10), sized(10), sized(10)], limits)?.status, 413);
    assert.match(
      refuseMessageImages([sized(80), sized(80)], limits)?.reason ?? "",
      /maxMessageImageBytes/,
    );
  });
});

describe("refuseSessionImageBudget", () => {
  it("takes a message that still fits and refuses the one that does not", () => {
    assert.equal(refuseSessionImageBudget(250, 50, limits), undefined);

    const refusal = refuseSessionImageBudget(250, 51, limits);

    // Нагрузка законна сама по себе — места под неё нет именно в этой сессии, а это её состояние.
    assert.equal(refusal?.status, 409);
    assert.match(refusal?.reason ?? "", /maxSessionImageBytes/);
  });

  it("never refuses a message that carries no images at all", () => {
    assert.equal(refuseSessionImageBudget(1_000_000, 0, limits), undefined);
  });
});

describe("bodyLimitFor", () => {
  it("leaves room for base64 expansion and the json around it", () => {
    const limit = bodyLimitFor(limits);

    assert.ok(limit > limits.maxMessageImageBytes * (4 / 3));
    // Тело, в которое сообщение по пределу не влезает, отвергалось бы раньше собственной проверки —
    // и человек получал бы отказ, не относящийся к тому, что он сделал.
    assert.ok(limit > limits.maxMessageImageBytes);
  });
});
