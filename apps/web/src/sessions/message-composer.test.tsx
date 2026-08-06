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
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
};

type ComposerHarnessProps = {
  sessionId?: string;
  busy?: boolean;
  reasoningSupported?: boolean;
  onSubmit?: (request: TurnRequest) => Promise<string | undefined>;
  onSendMessage?: (message: SessionMessage) => Promise<string | undefined>;
  onInterrupt?: () => void;
  onError?: (error: unknown) => void;
};

function SwitchingComposerHarness({
  onSubmit,
  onError = vi.fn(),
}: {
  onSubmit: (request: TurnRequest) => Promise<string | undefined>;
  onError?: (error: unknown) => void;
}) {
  const [sessionId, setSessionId] = useState("session-a");
  const [draft, setDraft] = useState("");

  return (
    <>
      <MessageComposer
        sessionId={sessionId}
        draft={draft}
        onDraftChange={setDraft}
        busy={false}
        model="anthropic/claude-opus-4-5"
        modelGroups={modelGroups}
        onModelChange={vi.fn()}
        onExpandModelGroup={vi.fn()}
        thinkingLevel="medium"
        reasoningSupported
        onThinkingLevelChange={vi.fn()}
        onSubmit={onSubmit}
        onSendMessage={vi.fn(() => Promise.resolve(undefined))}
        onInterrupt={vi.fn()}
        onError={onError}
        translator={translator}
      />
      <button
        type="button"
        onClick={() => {
          setSessionId("session-b");
          setDraft("");
        }}
      >
        Переключить сессию
      </button>
      <output aria-label="Черновик">{draft}</output>
    </>
  );
}

function ComposerHarness({
  sessionId = "session-a",
  busy = false,
  reasoningSupported = true,
  onSubmit = vi.fn(() => Promise.resolve(undefined)),
  onSendMessage = vi.fn(() => Promise.resolve(undefined)),
  onInterrupt = vi.fn(),
  onError,
}: ComposerHarnessProps) {
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("anthropic/claude-opus-4-5");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");

  return (
    <>
      <MessageComposer
        sessionId={sessionId}
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
        onError={onError ?? vi.fn()}
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

  it("renders one textarea row and one toolbar row inside the raised surface", () => {
    const { container } = render(<ComposerHarness />);
    const composer = container.querySelector(".sessions-composer");
    expect(composer?.querySelector("textarea")).not.toBeNull();
    expect(composer?.querySelector(".sessions-composer-toolbar")).not.toBeNull();
    expect(composer?.querySelectorAll(".sessions-composer-options")).toHaveLength(0);
    expect(composer?.querySelectorAll("button")).toHaveLength(3);
  });

  it("shows the compact combined trigger instead of two visible comboboxes", () => {
    render(<ComposerHarness />);
    expect(screen.getByRole("button", { name: /anthropic\/claude.*средний/i })).not.toBeNull();
    expect(screen.queryByRole("combobox", { name: "Модель" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Уровень рассуждений" })).toBeNull();
  });

  it("opens the model catalogue from the contained bottom zone", () => {
    render(<ComposerHarness />);

    fireEvent.click(screen.getByRole("button", { name: /anthropic\/claude.*средний/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));

    expect(screen.getByRole("tree")).not.toBeNull();
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

    expect(
      screen
        .getByRole("button", { name: /anthropic\/claude.*средний/i })
        .getAttribute("aria-disabled"),
    ).toBe("false");
  });

  it("submits an idle draft with the selected model and thinking level", async () => {
    const onSubmit = vi.fn(() => Promise.resolve(undefined));

    render(<ComposerHarness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /anthropic\/claude.*средний/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Модель/ }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Google" }).querySelector("div")!);
    fireEvent.click(screen.getByRole("treeitem", { name: /google\/gemini-2\.5-pro/ }));
    fireEvent.click(screen.getByRole("button", { name: /google\/gemini-2\.5-pro.*средний/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Уровень рассуждений/ }));
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

  it("does not let a stale session completion clear the new session draft or keep it blocked", async () => {
    const acceptance = deferred<string | undefined>();
    const onSubmit = vi.fn(() => acceptance.promise);
    render(<SwitchingComposerHarness onSubmit={onSubmit} />);

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });
    fireEvent.change(field, { target: { value: "сообщение A" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    fireEvent.click(screen.getByRole("button", { name: "Переключить сессию" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "сообщение B" },
    });

    acceptance.resolve(undefined);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Отправить" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
    expect(
      (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
    ).toBe("сообщение B");
  });

  it("unblocks and reports unexpected submission rejection while preserving the draft", async () => {
    const error = new Error("network unavailable");
    const onError = vi.fn();
    render(<ComposerHarness onSubmit={() => Promise.reject(error)} onError={onError} />);

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });
    fireEvent.change(field, { target: { value: "не теряй при ошибке" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Отправить" }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
    expect((field as HTMLTextAreaElement).value).toBe("не теряй при ошибке");
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("reports a stale rejection without touching the new session draft", async () => {
    const acceptance = deferred<string | undefined>();
    const error = new Error("session A failed");
    const onError = vi.fn();
    render(<SwitchingComposerHarness onSubmit={() => acceptance.promise} onError={onError} />);

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });
    fireEvent.change(field, { target: { value: "сообщение A" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    // The harness owns the draft reset, while this callback proves the error remains observable.
    fireEvent.click(screen.getByRole("button", { name: "Переключить сессию" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "сообщение B" },
    });
    acceptance.reject(error);

    await waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    expect(
      (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
    ).toBe("сообщение B");
  });

  it.each([
    ["busy queued message", true, "Вклинить", "steer"],
    ["idle append message", false, "Дописать без запуска", "append"],
  ] as const)(
    "ignores a stale completion for an in-flight %s after switching sessions",
    async (_name, busy, buttonName, mode) => {
      const acceptance = deferred<string | undefined>();
      const onSendMessage = vi.fn(() => acceptance.promise);
      const onSubmit = vi.fn(() => Promise.resolve(undefined));
      const view = render(
        <ComposerHarness busy={busy} onSubmit={onSubmit} onSendMessage={onSendMessage} />,
      );

      const field = screen.getByRole("textbox", { name: "Сообщение агенту" });
      fireEvent.change(field, { target: { value: "сообщение A" } });
      if (busy) {
        fireEvent.click(screen.getByRole("button", { name: buttonName }));
      } else {
        fireEvent.click(screen.getByRole("button", { name: buttonName }));
      }
      expect(onSendMessage).toHaveBeenCalledWith({ text: "сообщение A", mode });

      view.rerender(
        <ComposerHarness
          busy={busy}
          onSubmit={onSubmit}
          onSendMessage={onSendMessage}
          sessionId="session-b"
        />,
      );
      fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
        target: { value: "сообщение B" },
      });
      acceptance.resolve(undefined);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: buttonName }).hasAttribute("disabled")).toBe(
          false,
        ),
      );
      expect(
        (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
      ).toBe("сообщение B");
    },
  );

  it("changes thinking to off only for an explicitly unsupported model", async () => {
    const view = render(<ComposerHarness reasoningSupported={false} />);

    const thinking = screen.getByRole("button", { name: /anthropic\/claude.*выключены/i });
    expect(thinking.getAttribute("aria-disabled")).toBe("true");
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Выбранный уровень" }).textContent).toBe("off"),
    );

    view.rerender(<ComposerHarness reasoningSupported />);
    expect(
      screen
        .getByRole("button", { name: /anthropic\/claude.*выключены/i })
        .getAttribute("aria-disabled"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: /anthropic\/claude.*выключены/i })).not.toBeNull();
  });
});
