// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "./toast.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function ToastActions() {
  const { dismiss, toast } = useToast();
  const [ids, setIds] = useState<string[]>([]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          const id = toast({ title: "Сохранено", tone: "success" });
          setIds((current) => [...current, id]);
        }}
      >
        Показать успех
      </button>
      <button
        type="button"
        onClick={() => {
          const id = toast({ title: "Скоро исчезнет", durationMs: 500 });
          setIds((current) => [...current, id]);
        }}
      >
        Показать временное
      </button>
      <button type="button" onClick={() => ids[0] && dismiss(ids[0])}>
        Закрыть первый
      </button>
      <output data-testid="toast-ids">{ids.join(",")}</output>
    </>
  );
}

describe("ToastProvider", () => {
  it("adds a toast through the public hook API and returns distinct stable ids", () => {
    render(
      <ToastProvider>
        <ToastActions />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Показать успех" }));
    fireEvent.click(screen.getByRole("button", { name: "Показать успех" }));

    expect(screen.getAllByText("Сохранено")).toHaveLength(2);
    expect(screen.getAllByText("Сохранено").at(0)?.parentElement?.className).toContain("success");

    const ids = screen.getByTestId("toast-ids").textContent?.split(",") ?? [];
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("removes a toast after its requested duration", async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastActions />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Показать временное" }));
    expect(screen.getByText("Скоро исчезнет")).not.toBeNull();

    await act(async () => vi.advanceTimersByTime(500));

    expect(screen.queryByText("Скоро исчезнет")).toBeNull();
  });

  it("dismisses a toast through the hook API", () => {
    render(
      <ToastProvider>
        <ToastActions />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Показать успех" }));
    fireEvent.click(screen.getByRole("button", { name: "Закрыть первый" }));

    expect(screen.queryByText("Сохранено")).toBeNull();
  });
});
