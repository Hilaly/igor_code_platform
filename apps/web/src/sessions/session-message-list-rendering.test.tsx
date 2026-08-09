// @vitest-environment jsdom

import type { SessionEntry } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const markdownRenderCount = vi.hoisted(() => ({ value: 0 }));

vi.mock("@sovereign/ui-kit", async () => {
  const actual = await vi.importActual<typeof import("@sovereign/ui-kit")>("@sovereign/ui-kit");

  return {
    ...actual,
    Markdown: ({ text }: { text: string }) => {
      markdownRenderCount.value += 1;
      return createElement("div", undefined, text);
    },
  };
});

import { SessionMessageList } from "./session-message-list.tsx";
import type { OpenSession } from "./state.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  cleanup();
  markdownRenderCount.value = 0;
});

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

const persisted: SessionEntry = {
  id: "m1",
  time: "2026-07-29T00:00:00.000Z",
  kind: "message",
  role: "agent",
  content: [{ kind: "text", text: "сохранённая реплика" }],
};

const open: OpenSession = {
  id: "0199",
  entries: [persisted],
  seen: 1,
  pending: {},
  labels: new Map(),
  branchEntryIds: new Set([persisted.id]),
  degradations: [],
  loading: false,
};

describe("session message list rendering", () => {
  it("does not render saved Markdown when an unrelated parent draft changes", () => {
    const onFork = vi.fn(() => Promise.resolve());
    const onSetLabel = vi.fn(() => Promise.resolve(undefined));
    const onLabelRefusalChange = vi.fn();

    function Harness(): React.JSX.Element {
      const [, setDraft] = useState("");

      return (
        <>
          <input
            aria-label="Черновик вне ленты"
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <SessionMessageList
            open={open}
            busy={false}
            archived={false}
            onFork={onFork}
            onSetLabel={onSetLabel}
            labelRefusal={undefined}
            onLabelRefusalChange={onLabelRefusalChange}
            translator={translator}
          />
        </>
      );
    }

    render(<Harness />);
    expect(markdownRenderCount.value).toBe(1);

    fireEvent.change(screen.getByRole("textbox", { name: "Черновик вне ленты" }), {
      target: { value: "новый текст" },
    });

    expect(markdownRenderCount.value).toBe(1);
    expect(screen.getByText("сохранённая реплика")).toBeDefined();
  });
});
