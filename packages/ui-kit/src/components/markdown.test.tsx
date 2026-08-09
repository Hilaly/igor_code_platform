// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const parserRenderCount = vi.hoisted(() => ({ value: 0 }));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => {
    parserRenderCount.value += 1;
    return createElement("div", undefined, children);
  },
}));

import { Markdown } from "./markdown.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  cleanup();
  parserRenderCount.value = 0;
});

describe("Markdown", () => {
  it("does not rerender when a parent changes unrelated state", () => {
    function Harness(): React.JSX.Element {
      const [, setTick] = useState(0);

      return (
        <>
          <button type="button" onClick={() => setTick((current) => current + 1)}>
            Обновить родителя
          </button>
          <Markdown text="неизменившийся текст" />
        </>
      );
    }

    render(<Harness />);
    expect(parserRenderCount.value).toBe(1);
    parserRenderCount.value = 0;
    fireEvent.click(screen.getByRole("button", { name: "Обновить родителя" }));

    expect(parserRenderCount.value).toBe(0);
    expect(screen.getByText("неизменившийся текст")).toBeDefined();
  });
});
