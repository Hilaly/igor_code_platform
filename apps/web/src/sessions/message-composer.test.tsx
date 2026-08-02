// @vitest-environment jsdom

import type { SessionMessage } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageComposer } from "./message-composer.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(cleanup);

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

type ComposerHarnessProps = {
  busy?: boolean;
  onSubmit?: (text: string) => void;
  onSendMessage?: (message: SessionMessage) => Promise<string | undefined>;
  onInterrupt?: () => void;
};

function ComposerHarness({
  busy = false,
  onSubmit = vi.fn(),
  onSendMessage = vi.fn(() => Promise.resolve(undefined)),
  onInterrupt = vi.fn(),
}: ComposerHarnessProps) {
  const [draft, setDraft] = useState("");

  return (
    <>
      <MessageComposer
        draft={draft}
        onDraftChange={setDraft}
        busy={busy}
        onSubmit={onSubmit}
        onSendMessage={onSendMessage}
        onInterrupt={onInterrupt}
        translator={translator}
      />
      <output aria-label="Черновик">{draft}</output>
    </>
  );
}

describe("the session message composer", () => {
  it("reports draft changes through its controlled interface", () => {
    render(<ComposerHarness />);

    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "новая ветка" },
    });

    expect(screen.getByRole("status", { name: "Черновик" }).textContent).toBe("новая ветка");
  });

  it("submits an idle draft and asks its owner to clear it", () => {
    const onSubmit = vi.fn();

    render(<ComposerHarness onSubmit={onSubmit} />);

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });
    fireEvent.change(field, { target: { value: "привет" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(onSubmit).toHaveBeenCalledWith("привет");
    expect((field as HTMLTextAreaElement).value).toBe("");
  });

  it("owns the delivery mode while the session is busy", () => {
    const onSendMessage = vi.fn(() => Promise.resolve(undefined));

    render(<ComposerHarness busy onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByRole("radio", { name: "После турна" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "продолжай" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить после турна" }));

    expect(onSendMessage).toHaveBeenCalledWith({ text: "продолжай", mode: "follow-up" });
  });

  it("offers append only while idle and interrupt only while busy", () => {
    const onSendMessage = vi.fn(() => Promise.resolve(undefined));
    const onInterrupt = vi.fn();
    const view = render(
      <ComposerHarness onSendMessage={onSendMessage} onInterrupt={onInterrupt} />,
    );

    expect(screen.queryByRole("button", { name: "Остановить" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "добавь" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Дописать без запуска" }));
    expect(onSendMessage).toHaveBeenCalledWith({ text: "добавь", mode: "append" });

    view.rerender(<ComposerHarness busy onSendMessage={onSendMessage} onInterrupt={onInterrupt} />);

    expect(screen.queryByRole("button", { name: "Дописать без запуска" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Остановить" }));
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });
});
