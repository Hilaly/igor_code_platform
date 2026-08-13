import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createMessageOutbox } from "./message-outbox.ts";

describe("createMessageOutbox", () => {
  it("keeps the order of one session and does not mix two", () => {
    const outbox = createMessageOutbox();

    outbox.enqueue("a", { text: "первое" });
    outbox.enqueue("b", { text: "чужое" });
    outbox.enqueue("a", { text: "второе" });

    assert.deepEqual(
      outbox.list("a").messages.map((message) => message.text),
      ["первое", "второе"],
    );
    assert.equal(outbox.takeHead("a")?.text, "первое");
    assert.deepEqual(
      outbox.list("a").messages.map((message) => message.text),
      ["второе"],
    );
    assert.deepEqual(
      outbox.list("b").messages.map((message) => message.text),
      ["чужое"],
    );
  });

  it("gives every waiting message an identifier of its own", () => {
    const outbox = createMessageOutbox();
    const first = outbox.enqueue("a", { text: "одно и то же" });
    const second = outbox.enqueue("a", { text: "одно и то же" });

    // Два одинаковых текста — разные сообщения: без идентификатора снять одно из них было бы нечем.
    assert.notEqual(first.id, second.id);
    assert.equal(outbox.remove("a", first.id)?.id, first.id);
    assert.deepEqual(
      outbox.list("a").messages.map((message) => message.id),
      [second.id],
    );
    assert.equal(outbox.remove("a", first.id), undefined);
  });

  it("returns a message to the head instead of to the tail", () => {
    const outbox = createMessageOutbox();

    outbox.enqueue("a", { text: "первое" });
    outbox.enqueue("a", { text: "второе" });

    const head = outbox.takeHead("a");

    assert.ok(head);
    outbox.returnHead("a", head);

    // Порядок написанного не меняется от того, что запустить его не вышло.
    assert.deepEqual(
      outbox.list("a").messages.map((message) => message.text),
      ["первое", "второе"],
    );
  });

  it("keeps the messages while the queue is stopped and forgets them when cleared", () => {
    const outbox = createMessageOutbox();

    outbox.enqueue("a", { text: "ждёт" });
    outbox.halt("a", "турн упал");

    assert.deepEqual(outbox.list("a").stopped, { reason: "турн упал" });
    assert.equal(outbox.list("a").messages.length, 1);

    outbox.resume("a");

    assert.equal(outbox.list("a").stopped, undefined);

    outbox.clear("a");

    assert.deepEqual(outbox.list("a"), { messages: [] });
  });

  it("remembers a stop even with nothing left to run", () => {
    const outbox = createMessageOutbox();

    // Упасть может и последнее сообщение очереди: причина остановки нужна человеку и тогда.
    outbox.halt("a", "модель пропала");

    assert.deepEqual(outbox.list("a"), { messages: [], stopped: { reason: "модель пропала" } });
  });

  it("carries the images and the chosen model of a waiting message", () => {
    const outbox = createMessageOutbox();
    const image = { mimeType: "image/png" as const, data: "iVBORw==" };

    outbox.enqueue("a", {
      text: "посмотри",
      images: [image],
      model: "anthropic/claude",
      thinkingLevel: "high",
    });

    assert.deepEqual(outbox.list("a").messages[0], {
      id: outbox.list("a").messages[0]?.id ?? "",
      text: "посмотри",
      images: [image],
      model: "anthropic/claude",
      thinkingLevel: "high",
    });
  });
});
