/**
 * Прилипание ленты к низу проверяется на чистой функции, а не на прокрутке: в `jsdom` у элементов
 * нет раскладки, `scrollHeight` и `clientHeight` там всегда нули, и тест на настоящем скролле
 * проверял бы только то, что нули равны нулям.
 */

import { describe, expect, it } from "vitest";

import { shouldStickToBottom, stickToBottomSlack } from "./message-feed.tsx";

describe("shouldStickToBottom", () => {
  it("sticks while the reader is at the bottom", () => {
    expect(shouldStickToBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(
      true,
    );
  });

  it("lets go as soon as the reader scrolled up to the history", () => {
    // Каждая дельта дописывает строку; сорвать чтение прошлого ответа она не имеет права.
    expect(shouldStickToBottom({ scrollTop: 200, scrollHeight: 1000, clientHeight: 100 })).toBe(
      false,
    );
  });

  it("counts a near miss as the bottom", () => {
    // Мышь и трекпад редко останавливаются ровно на границе, а «почти внизу» для читающего — это низ.
    const almost = 1000 - 100 - stickToBottomSlack;

    expect(shouldStickToBottom({ scrollTop: almost, scrollHeight: 1000, clientHeight: 100 })).toBe(
      true,
    );
    expect(
      shouldStickToBottom({ scrollTop: almost - 1, scrollHeight: 1000, clientHeight: 100 }),
    ).toBe(false);
  });

  it("sticks when the content is shorter than the feed", () => {
    // Первая реплика в новой сессии: прокручивать нечего, и «мы не внизу» здесь было бы враньём.
    expect(shouldStickToBottom({ scrollTop: 0, scrollHeight: 100, clientHeight: 400 })).toBe(true);
  });
});
