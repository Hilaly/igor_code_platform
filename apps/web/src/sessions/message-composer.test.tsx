// @vitest-environment jsdom

import type {
  ProjectFilesSnapshot,
  SessionCommands,
  SessionContextUsage,
  SessionMessage,
  SessionStats,
  ThinkingLevel,
  TurnRequest,
} from "@sovereign/protocol";
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

import { MessageComposer, type ComposerDraftReplacement } from "./message-composer.tsx";
import type { SlashEntry, SlashInvocation } from "./slash-command.ts";

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

const contextUsage: SessionContextUsage = {
  sessionId: "session-a",
  tokens: 190,
  contextWindow: 1000,
  threshold: 0.8,
};

const sessionStats: SessionStats = {
  sessionId: "session-a",
  messageCount: 3,
  cachedTokens: 120,
  uncachedTokens: 580,
  totalTokens: 700,
  costTotal: 0.1234,
};

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
  draftReplacement?: ComposerDraftReplacement;
  onDropTarget?: (drop: (transfer: DataTransfer) => void) => void;
  onSearchFiles?: (query: string, signal: AbortSignal) => Promise<ProjectFilesSnapshot>;
  commands?: SessionCommands;
  pluginCommands?: SlashEntry[];
  onRunCommand?: (invocation: SlashInvocation) => Promise<string | undefined>;
};

function SwitchingComposerHarness({
  onSubmit,
  onError = vi.fn(),
}: {
  onSubmit: (request: TurnRequest) => Promise<string | undefined>;
  onError?: (error: unknown) => void;
}) {
  const [sessionId, setSessionId] = useState("session-a");

  return (
    <>
      <MessageComposer
        sessionId={sessionId}
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
        onRunCommand={vi.fn(() => Promise.resolve(undefined))}
        onError={onError}
        context={contextUsage}
        stats={sessionStats}
        translator={translator}
      />
      <button
        type="button"
        onClick={() => {
          setSessionId("session-b");
        }}
      >
        Переключить сессию
      </button>
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
  draftReplacement,
  onDropTarget,
  onSearchFiles,
  commands,
  pluginCommands,
  onRunCommand = vi.fn(() => Promise.resolve(undefined)),
}: ComposerHarnessProps) {
  const [model, setModel] = useState("anthropic/claude-opus-4-5");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("medium");

  return (
    <>
      <MessageComposer
        sessionId={sessionId}
        {...(draftReplacement === undefined ? {} : { draftReplacement })}
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
        {...(onDropTarget === undefined ? {} : { onDropTarget })}
        {...(onSearchFiles === undefined ? {} : { onSearchFiles })}
        {...(commands === undefined ? {} : { commands })}
        {...(pluginCommands === undefined ? {} : { pluginCommands })}
        onRunCommand={onRunCommand}
        onError={onError ?? vi.fn()}
        context={contextUsage}
        stats={sessionStats}
        translator={translator}
      />
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
    // Пять: приложить, метрики, next-turn, стоп и отправка с её меню вариантов.
    expect(composer?.querySelectorAll("button")).toHaveLength(5);
    expect(composer?.querySelector(".sessions-composer-attach button")).not.toBeNull();
  });

  it("keeps the circular context indicator inside the composer action row", () => {
    const { container } = render(<ComposerHarness />);
    const actions = container.querySelector(".sessions-composer-actions");
    const progress = screen.getByRole("progressbar", { name: "Заполнение контекста" });

    expect(actions?.contains(progress)).toBe(true);
    expect(progress.tagName).toBe("svg");
  });

  it("orders context, next-turn settings, stop, and send options from left to right", () => {
    render(<ComposerHarness />);

    const progress = screen.getByRole("progressbar", { name: "Заполнение контекста" });
    const model = screen.getByRole("button", { name: /anthropic\/claude.*средний/i });
    const stop = screen.getByRole("button", { name: "Остановить" });
    const send = screen.getByRole("button", { name: "Отправить" });

    expect(progress.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(model.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(stop.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("keeps the idle action set named and leaves planning controls out of the composer", () => {
    render(<ComposerHarness />);

    expect(screen.getByRole("button", { name: "Отправить" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Варианты отправки" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Остановить" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: /anthropic\/claude.*средний/i })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /plan|tools/i })).toBeNull();
  });

  it("keeps the busy action set named and exposes stop without planning controls", () => {
    render(<ComposerHarness busy />);

    expect(screen.getByRole("button", { name: "Вклинить" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Варианты отправки" })).not.toBeNull();
    expect(screen.getByRole("button", { name: /anthropic\/claude.*средний/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Остановить" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Остановить" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("button", { name: /plan|tools/i })).toBeNull();
  });

  it("offers only append while idle and adds queued delivery options while busy", () => {
    const view = render(<ComposerHarness />);
    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });

    fireEvent.change(field, { target: { value: "вариант" } });
    fireEvent.click(screen.getByRole("button", { name: "Варианты отправки" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Дописать без запуска",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Варианты отправки" }));

    view.rerender(<ComposerHarness busy />);
    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "вариант" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Варианты отправки" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Дописать без запуска",
      "Отправить после турна",
    ]);
    expect(screen.queryByRole("radiogroup")).toBeNull();
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

  it("updates its local draft while typing", () => {
    render(<ComposerHarness />);

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });
    fireEvent.change(field, {
      target: { value: "новая ветка" },
    });

    expect((field as HTMLTextAreaElement).value).toBe("новая ветка");
  });

  it("accepts current-session draft replacements and ignores another session", () => {
    const view = render(<ComposerHarness />);
    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });

    fireEvent.change(field, { target: { value: "старый текст" } });
    view.rerender(
      <ComposerHarness
        draftReplacement={{ sessionId: "session-a", sequence: 1, text: "из дерева" }}
      />,
    );
    expect((field as HTMLTextAreaElement).value).toBe("из дерева");

    view.rerender(
      <ComposerHarness
        draftReplacement={{ sessionId: "session-a", sequence: 2, text: "из дерева" }}
      />,
    );
    expect((field as HTMLTextAreaElement).value).toBe("из дерева");

    view.rerender(
      <ComposerHarness
        draftReplacement={{ sessionId: "session-b", sequence: 3, text: "чужая сессия" }}
      />,
    );
    expect((field as HTMLTextAreaElement).value).toBe("из дерева");
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

    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "продолжай" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Варианты отправки" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Отправить после турна" }));

    expect(onSendMessage).toHaveBeenCalledWith({ text: "продолжай", mode: "follow-up" });
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
      ).toBe(""),
    );
  });

  it("does not persist a queued alternative as the next Enter action", async () => {
    const onSendMessage = vi.fn(() => Promise.resolve(undefined));
    render(<ComposerHarness busy onSendMessage={onSendMessage} />);

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });
    fireEvent.change(field, { target: { value: "после турна" } });
    fireEvent.click(screen.getByRole("button", { name: "Варианты отправки" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Отправить после турна" }));
    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe(""));

    fireEvent.change(field, { target: { value: "сейчас" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onSendMessage).toHaveBeenLastCalledWith({ text: "сейчас", mode: "steer" });
    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe(""));
  });

  it("keeps next-turn overrides out of append messages", async () => {
    const onSendMessage = vi.fn(() => Promise.resolve(undefined));
    render(<ComposerHarness onSendMessage={onSendMessage} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "добавь" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Варианты отправки" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Дописать без запуска" }));
    expect(onSendMessage).toHaveBeenCalledWith({ text: "добавь", mode: "append" });
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
      ).toBe(""),
    );
  });

  it("keeps append in the menu and keeps stop stable across turn status", () => {
    const onSendMessage = vi.fn(() => Promise.resolve(undefined));
    const onInterrupt = vi.fn();
    const view = render(<ComposerHarness onInterrupt={onInterrupt} />);

    expect(screen.getByRole("button", { name: "Варианты отправки" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Остановить" }).hasAttribute("disabled")).toBe(true);
    view.rerender(<ComposerHarness busy onSendMessage={onSendMessage} onInterrupt={onInterrupt} />);

    expect(screen.getByRole("button", { name: "Варианты отправки" })).not.toBeNull();
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
        fireEvent.click(screen.getByRole("button", { name: "Варианты отправки" }));
        fireEvent.click(screen.getByRole("menuitem", { name: buttonName }));
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
        expect(
          screen
            .getByRole("button", { name: busy ? buttonName : "Отправить" })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
      expect(
        (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
      ).toBe("сообщение B");
    },
  );

  it("changes thinking to off only for an explicitly unsupported model", async () => {
    const view = render(<ComposerHarness reasoningSupported={false} />);

    const thinking = screen.getByRole("button", { name: /anthropic\/claude.*выключены/i });
    expect(thinking.getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(thinking);
    expect(
      screen.getByRole("menuitem", { name: /Уровень рассуждений/ }).getAttribute("aria-disabled"),
    ).toBe("true");
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

describe("attaching images to a message", () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x07]);
  const pngBase64 = btoa(String.fromCharCode(...pngBytes));

  const pngFile = (name = "снимок.png"): File => new File([pngBytes], name, { type: "image/png" });

  /** Файл в jsdom без `arrayBuffer` бесполезен: чтение идёт именно через него. */
  const readable = (file: File): File => {
    Object.defineProperty(file, "arrayBuffer", {
      value: () => Promise.resolve(pngBytes.buffer.slice(0)),
    });

    return file;
  };

  const transferOf = (files: File[]): DataTransfer =>
    ({
      items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
    }) as unknown as DataTransfer;

  const attach = async (files: File[]): Promise<void> => {
    const input = screen.getByLabelText("Изображение", { selector: "input" });

    fireEvent.change(input, { target: { files } });
    await waitFor(() => expect(screen.queryByLabelText("Приложенные изображения")).not.toBeNull());
  };

  it("sends the attached image with the text and clears the draft once accepted", async () => {
    const onSubmit = vi.fn(() => Promise.resolve(undefined));

    render(<ComposerHarness onSubmit={onSubmit} />);
    await attach([readable(pngFile())]);

    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "что тут" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "что тут",
          images: [{ mimeType: "image/png", data: pngBase64 }],
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByLabelText("Приложенные изображения")).toBeNull());
  });

  it("sends a message made only of the image", async () => {
    const onSubmit = vi.fn(() => Promise.resolve(undefined));

    render(<ComposerHarness onSubmit={onSubmit} />);

    // До картинки отправлять нечего, после — есть.
    expect(
      screen.getByRole("button", { name: "Отправить" }).getAttribute("aria-disabled"),
    ).not.toBe("false");

    await attach([readable(pngFile())]);
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ text: "", images: [{ mimeType: "image/png", data: pngBase64 }] }),
      ),
    );
  });

  it("keeps the draft when the daemon refuses the message", async () => {
    const onSubmit = vi.fn(() => Promise.resolve("image 1 exceeds maxImageBytes"));

    render(<ComposerHarness onSubmit={onSubmit} />);
    await attach([readable(pngFile())]);

    fireEvent.change(screen.getByRole("textbox", { name: "Сообщение агенту" }), {
      target: { value: "что тут" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // Ни картинка, ни текст не пропали: переписывать заново уже написанное человек не должен.
    await waitFor(() => expect(screen.queryByLabelText("Приложенные изображения")).not.toBeNull());
    expect(
      screen.getByRole("textbox", { name: "Сообщение агенту" }).getAttribute("value") ??
        (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
    ).toBe("что тут");
  });

  it("refuses a whole batch that holds an unsupported file, keeping the draft untouched", async () => {
    render(<ComposerHarness />);

    const input = screen.getByLabelText("Изображение", { selector: "input" });

    fireEvent.change(input, {
      target: {
        files: [readable(pngFile()), new File(["x"], "заметка.txt", { type: "text/plain" })],
      },
    });

    await waitFor(() => expect(screen.getByText(/заметка\.txt/)).not.toBeNull());
    // Пачка не принята целиком: годный файл из неё тоже не приложился.
    expect(screen.queryByLabelText("Приложенные изображения")).toBeNull();
  });

  it("takes an image out of the draft again", async () => {
    render(<ComposerHarness />);
    await attach([readable(pngFile())]);

    fireEvent.click(screen.getByRole("button", { name: "Убрать изображение 1" }));

    await waitFor(() => expect(screen.queryByLabelText("Приложенные изображения")).toBeNull());
  });

  it("takes an image pasted into the field and leaves plain text paste alone", async () => {
    render(<ComposerHarness />);

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });

    fireEvent.paste(field, { clipboardData: transferOf([readable(pngFile())]) });
    await waitFor(() => expect(screen.queryByLabelText("Приложенные изображения")).not.toBeNull());

    // Обычная вставка текста ничего не прикладывает и остаётся нативной.
    const pasted = new Event("paste", { bubbles: true, cancelable: true });

    Object.defineProperty(pasted, "clipboardData", { value: transferOf([]) });
    field.dispatchEvent(pasted);
    expect(pasted.defaultPrevented).toBe(false);
  });

  it("takes an image dropped anywhere on the panel through the handler it hands upward", async () => {
    let accept: ((transfer: DataTransfer) => void) | undefined;

    render(
      <ComposerHarness
        onDropTarget={(drop) => {
          accept = drop;
        }}
      />,
    );

    await waitFor(() => expect(accept).not.toBeUndefined());
    accept?.(transferOf([readable(pngFile())]));

    await waitFor(() => expect(screen.queryByLabelText("Приложенные изображения")).not.toBeNull());
  });

  it("forgets the attachments when the session changes", async () => {
    const view = render(<ComposerHarness sessionId="session-a" />);

    await attach([readable(pngFile())]);
    view.rerender(<ComposerHarness sessionId="session-b" />);

    await waitFor(() => expect(screen.queryByLabelText("Приложенные изображения")).toBeNull());
  });
});

describe("mentioning a project file", () => {
  const searching = (paths: string[], truncated = false) =>
    vi.fn(() => Promise.resolve({ paths, truncated }) as Promise<ProjectFilesSnapshot>);

  const type = (value: string): void => {
    const field = screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement;

    fireEvent.change(field, { target: { value } });
    field.setSelectionRange(value.length, value.length);
  };

  it("opens the list on an at-sign and asks the daemon for what was typed", async () => {
    const onSearchFiles = searching(["README.md", "src/reader.ts"]);

    render(<ComposerHarness onSearchFiles={onSearchFiles} />);
    type("посмотри @rea");

    await waitFor(() =>
      expect(screen.queryByRole("listbox", { name: "Файлы проекта" })).not.toBeNull(),
    );
    expect(onSearchFiles).toHaveBeenCalledWith("rea", expect.anything());
    expect(screen.getAllByRole("option").map((one) => one.textContent)).toEqual([
      "README.md",
      "src/reader.ts",
    ]);
  });

  it("puts the chosen path into the message as ordinary text", async () => {
    render(<ComposerHarness onSearchFiles={searching(["src/reader.ts"])} />);
    type("посмотри @rea");

    await waitFor(() => expect(screen.queryByRole("option")).not.toBeNull());
    fireEvent.click(screen.getByRole("option", { name: "src/reader.ts" }));

    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
      ).toBe("посмотри @src/reader.ts "),
    );
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("walks the list with arrows and takes the active one on Enter, without sending", async () => {
    const onSubmit = vi.fn(() => Promise.resolve(undefined));

    render(<ComposerHarness onSearchFiles={searching(["a.ts", "b.ts"])} onSubmit={onSubmit} />);
    type("@");

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });

    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "b.ts" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe("@b.ts "));
    // Одно нажатие — одно действие: недописанную ссылку человек отправлять не собирался.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("closes on Escape and leaves the at-sign as plain text", async () => {
    render(<ComposerHarness onSearchFiles={searching(["a.ts"])} />);
    type("@a");

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeNull());
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Сообщение агенту" }), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(
      (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
    ).toBe("@a");
  });

  it("stays out of the way when nothing was found or nobody can search", async () => {
    const view = render(<ComposerHarness onSearchFiles={searching([])} />);

    type("@нет");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());

    view.rerender(<ComposerHarness />);
    type("@rea");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("says the list was cut instead of quietly showing a part of it", async () => {
    render(<ComposerHarness onSearchFiles={searching(["a.ts"], true)} />);
    type("@a");

    await waitFor(() =>
      expect(screen.queryByText("Найдено больше — уточните запрос")).not.toBeNull(),
    );
  });
});

describe("the slash catalogue of session commands", () => {
  const commands: SessionCommands = {
    skills: [
      { name: "starter.review", description: "Разбор изменения", hidden: false },
      { name: "starter.secret", description: "Только вручную", hidden: true },
    ],
    templates: [{ name: "review-branch", description: "Разбор ветки", scope: "user" }],
  };

  const type = (value: string): void => {
    const field = screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement;

    fireEvent.change(field, { target: { value } });
    field.setSelectionRange(value.length, value.length);
  };

  it("opens on a slash at the start of the draft and shows the core commands with the skills", async () => {
    const { container } = render(<ComposerHarness commands={commands} />);

    type("/");

    await waitFor(() =>
      expect(screen.queryByRole("listbox", { name: "Команды сессии" })).not.toBeNull(),
    );
    expect(
      [...container.querySelectorAll(".sessions-slash-name")].map((one) => one.textContent),
    ).toEqual([
      "/compact",
      "/fork",
      "/rename",
      "/archive",
      "/review-branch",
      "/skill:starter.review",
      "/skill:starter.secret",
    ]);
    // Скрытый от модели скил помечен, обычный — нет.
    expect(container.querySelectorAll(".sessions-slash-hidden")).toHaveLength(1);
  });

  it("leaves a slash inside the text alone", async () => {
    render(<ComposerHarness commands={commands} />);
    type("посмотри src/main.ts");

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("walks the list with arrows and inserts the active name on Enter, without running it", async () => {
    const onRunCommand = vi.fn(() => Promise.resolve(undefined));

    render(<ComposerHarness commands={commands} onRunCommand={onRunCommand} />);
    type("/f");

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });

    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe("/fork "));
    // Одно нажатие — одно действие: после подстановки человек ещё дописывает аргументы.
    expect(onRunCommand).not.toHaveBeenCalled();
  });

  it("runs the typed command on Enter instead of sending it as a message", async () => {
    const onRunCommand = vi.fn(() => Promise.resolve(undefined));
    const onSubmit = vi.fn(() => Promise.resolve(undefined));

    render(<ComposerHarness commands={commands} onRunCommand={onRunCommand} onSubmit={onSubmit} />);
    type("/rename срез 15");

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });

    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(onRunCommand).toHaveBeenCalledWith({ name: "rename", arguments: "срез 15" }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("starts a turn from an explicitly named skill", async () => {
    const onSubmit = vi.fn(() => Promise.resolve(undefined));
    const onRunCommand = vi.fn(() => Promise.resolve(undefined));

    render(<ComposerHarness commands={commands} onRunCommand={onRunCommand} onSubmit={onSubmit} />);
    type("/skill:starter.secret начни с тестов");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Сообщение агенту" }), { key: "Enter" });

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        skill: "starter.secret",
        instructions: "начни с тестов",
        model: "anthropic/claude-opus-4-5",
        thinkingLevel: "medium",
      }),
    );
    expect(onRunCommand).not.toHaveBeenCalled();
  });

  it("starts a turn from a prompt template with everything written after it", async () => {
    const onSubmit = vi.fn(() => Promise.resolve(undefined));
    const onRunCommand = vi.fn(() => Promise.resolve(undefined));

    render(<ComposerHarness commands={commands} onRunCommand={onRunCommand} onSubmit={onSubmit} />);
    type("/review-branch срез 15");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Сообщение агенту" }), { key: "Enter" });

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        template: "review-branch",
        arguments: "срез 15",
        model: "anthropic/claude-opus-4-5",
        thinkingLevel: "medium",
      }),
    );
    expect(onRunCommand).not.toHaveBeenCalled();
  });

  it("hands an unknown name to the view instead of guessing", async () => {
    const onRunCommand = vi.fn(() => Promise.resolve(undefined));
    const onSubmit = vi.fn(() => Promise.resolve(undefined));

    render(<ComposerHarness commands={commands} onRunCommand={onRunCommand} onSubmit={onSubmit} />);
    type("/placed.log это команда плагина");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Сообщение агенту" }), { key: "Enter" });

    await waitFor(() =>
      expect(onRunCommand).toHaveBeenCalledWith({
        name: "placed.log",
        arguments: "это команда плагина",
      }),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the commands a plugin put into the slash place", async () => {
    const { container } = render(
      <ComposerHarness
        commands={commands}
        pluginCommands={[{ name: "placed.log", description: "Записать в журнал" }]}
      />,
    );

    type("/placed");

    await waitFor(() =>
      expect(
        [...container.querySelectorAll(".sessions-slash-name")].map((one) => one.textContent),
      ).toEqual(["/placed.log"]),
    );
  });

  it("keeps the draft when the command was refused", async () => {
    render(<ComposerHarness commands={commands} onRunCommand={() => Promise.resolve("занято")} />);
    type("/fork");

    const field = screen.getByRole("textbox", { name: "Сообщение агенту" });

    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe("/fork"));
  });

  it("closes on Escape and leaves the slash as plain text", async () => {
    render(<ComposerHarness commands={commands} />);
    type("/comp");

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeNull());
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Сообщение агенту" }), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(
      (screen.getByRole("textbox", { name: "Сообщение агенту" }) as HTMLTextAreaElement).value,
    ).toBe("/comp");
  });

  it("gives the command the field while a file mention would also be live", async () => {
    render(
      <ComposerHarness
        commands={commands}
        onSearchFiles={vi.fn(() => Promise.resolve({ paths: ["a.ts"], truncated: false }))}
      />,
    );
    // Оба триггера живы: `/` в начале строки и `@` перед курсором. Побеждает команда.
    type("/@a");

    await waitFor(() =>
      expect(screen.queryByRole("listbox", { name: "Файлы проекта" })).toBeNull(),
    );
  });

  it("offers the core commands even when the catalogue has not arrived", async () => {
    render(<ComposerHarness />);
    type("/");

    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(4));
  });
});
