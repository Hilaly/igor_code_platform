// @vitest-environment jsdom

import type { SessionMessage, ThinkingLevel, TurnRequest } from "@sovereign/protocol";
import {
  coreEnglish,
  coreNamespace,
  coreRussian,
  createTranslator,
  type ModelPickerGroup,
} from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const modelGroups: ModelPickerGroup[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    options: [
      {
        value: "anthropic/claude-opus-4-5",
        label: "anthropic/claude-opus-4-5",
        description: "Claude Opus 4.5",
      },
    ],
  },
  {
    id: "google",
    label: "Google",
    options: [
      {
        value: "google/gemini-2.5-pro",
        label: "google/gemini-2.5-pro",
        description: "Gemini 2.5 Pro",
      },
    ],
  },
];

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};

type ComposerHarnessProps = {
  busy?: boolean;
  reasoningSupported?: boolean;
  onSubmit?: (request: TurnRequest) => Promise<string | undefined>;
  onSendMessage?: (message: SessionMessage) => Promise<string | undefined>;
  onInterrupt?: () => void;
};

function ComposerHarness({
  busy = false,
  reasoningSupported = true,
  onSubmit = vi.fn(() => Promise.resolve(undefined)),
  onSendMessage = vi.fn(() => Promise.resolve(undefined)),
  onInterrupt = vi.fn(),
}: ComposerHarnessProps) {
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("anthropic/claude-opus-4-5");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");

  return (
    <>
      <MessageComposer
        draft={draft}
        onDraftChange={setDraft}
        busy={busy}
        model={model}
        modelGroups={modelGroups}
        onModelChange={setModel}
        onExpandModelGroup={vi.fn()}
        thinkingLevel={thinkingLevel}
        reasoningSupported={reasoningSupported}
        onThinkingLevelChange={setThinkingLevel}
        onSubmit={onSubmit}
        onSendMessage={onSendMessage}
        onInterrupt={onInterrupt}
        translator={translator}
      />
      <output aria-label="Черновик">{draft}</output>
      <output aria-label="Выбранная модель">{model}</output>
      <output aria-label="Выбранный уровень">{thinkingLevel}</output>
    </>
  );
}

describe("the session message composer", () => {
  it("uses the UI Kit raised surface as the composer boundary", () => {
    const { container } = render(<ComposerHarness />);
    const composer = container.querySelector(".sessions-composer");

    expect(composer).not.toBeNull();
    expect(composer?.parentElement?.className).toMatch(/surface/);
    expect(
      composer?.parentElement?.parentElement?.classList.contains("sessions-composer-surface"),
    ).toBe(true);
  });

  it("opens the model catalogue above the contained bottom zone", () => {
    render(<ComposerHarness />);

    fireEvent.click(screen.getByRole("combobox", { name: "Модель" }));

    expect(screen.getByRole("tree").getAttribute("data-side")).toBe("top");
  });

  it("reports draft changes through its controlled interface", () => {
    render(<ComposerHarness />);

    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "новая ветка" },
    });

    expect(screen.getByRole("status", { name: "Черновик" }).textContent).toBe("новая ветка");
  });

  it("keeps next-turn controls editable while the session is busy", () => {
    render(<ComposerHarness busy />);

    expect(screen.getByRole("combobox", { name: "Модель" }).getAttribute("aria-disabled")).toBe(
      "false",
    );
    expect(
      screen.getByRole("combobox", { name: "Уровень рассуждений" }).getAttribute("aria-disabled"),
    ).toBe("false");
  });

  it("submits an idle draft with the selected model and thinking level", async () => {
    const onSubmit = vi.fn(() => Promise.resolve(undefined));

    render(<ComposerHarness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Модель" }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Google" }).querySelector("div")!);
    fireEvent.click(screen.getByRole("treeitem", { name: /google\/gemini-2\.5-pro/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Уровень рассуждений" }));
    fireEvent.click(screen.getByRole("option", { name: "Высокий" }));

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });
    fireEvent.change(field, { target: { value: "привет" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(onSubmit).toHaveBeenCalledWith({
      text: "привет",
      model: "google/gemini-2.5-pro",
      thinkingLevel: "high",
    });
    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe(""));
  });

  it("keeps next-turn overrides out of follow-up messages", async () => {
    const onSendMessage = vi.fn(() => Promise.resolve(undefined));

    render(<ComposerHarness busy onSendMessage={onSendMessage} />);

    fireEvent.click(screen.getByRole("radio", { name: "После турна" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "продолжай" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить после турна" }));

    expect(onSendMessage).toHaveBeenCalledWith({ text: "продолжай", mode: "follow-up" });
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
      ).toBe(""),
    );
  });

  it("keeps next-turn overrides out of append messages", async () => {
    const onSendMessage = vi.fn(() => Promise.resolve(undefined));
    render(<ComposerHarness onSendMessage={onSendMessage} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "добавь" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Дописать без запуска" }));
    expect(onSendMessage).toHaveBeenCalledWith({ text: "добавь", mode: "append" });
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
      ).toBe(""),
    );
  });

  it("offers append only while idle and interrupt only while busy", () => {
    const onSendMessage = vi.fn(() => Promise.resolve(undefined));
    const onInterrupt = vi.fn();
    const view = render(<ComposerHarness onInterrupt={onInterrupt} />);

    expect(screen.queryByRole("button", { name: "Остановить" })).toBeNull();
    view.rerender(<ComposerHarness busy onSendMessage={onSendMessage} onInterrupt={onInterrupt} />);

    expect(screen.queryByRole("button", { name: "Дописать без запуска" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Остановить" }));
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft and blocks repeated sends until an ordinary turn is accepted", async () => {
    const acceptance = deferred<string | undefined>();
    const onSubmit = vi.fn(() => acceptance.promise);
    render(<ComposerHarness onSubmit={onSubmit} />);

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });
    const send = screen.getByRole("button", { name: "Отправить" });
    fireEvent.change(field, { target: { value: "не теряй" } });
    fireEvent.click(send);

    expect((field as HTMLTextAreaElement).value).toBe("не теряй");
    expect(send.hasAttribute("disabled")).toBe(true);
    fireEvent.click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    acceptance.resolve(undefined);
    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe(""));
  });

  it("keeps the draft when an ordinary turn is refused", async () => {
    const acceptance = deferred<string | undefined>();
    render(<ComposerHarness onSubmit={() => acceptance.promise} />);

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });
    fireEvent.change(field, { target: { value: "исправь модель" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    acceptance.resolve("unknown model");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Отправить" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
    expect((field as HTMLTextAreaElement).value).toBe("исправь модель");
  });

  it("changes thinking to off only for an explicitly unsupported model", async () => {
    const view = render(<ComposerHarness reasoningSupported={false} />);

    const thinking = screen.getByRole("combobox", { name: "Уровень рассуждений" });
    expect(thinking.textContent).toContain("Выключены");
    expect(thinking.getAttribute("aria-disabled")).toBe("true");
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Выбранный уровень" }).textContent).toBe("off"),
    );

    view.rerender(<ComposerHarness reasoningSupported />);
    expect(
      screen.getByRole("combobox", { name: "Уровень рассуждений" }).getAttribute("aria-disabled"),
    ).toBe("false");
    expect(screen.getByRole("combobox", { name: "Уровень рассуждений" }).textContent).toContain(
      "Выключены",
    );
  });
});
