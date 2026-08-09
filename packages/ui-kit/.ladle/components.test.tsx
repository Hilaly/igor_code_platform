// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { GlobalState } from "@ladle/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Provider } from "./components.tsx";

beforeEach(() => {
  const values = new Map<string, string>();

  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    clear: () => values.clear(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("catalogue appearance controls", () => {
  it("renders named scheme and scale controls in the catalogue appearance group", () => {
    render(
      <Provider
        globalState={{ theme: "dark" } as GlobalState}
        dispatch={() => {}}
        config={{} as never}
      >
        <p>story</p>
      </Provider>,
    );

    const appearance = screen.getByRole("group", { name: "Catalogue appearance" });
    expect(within(appearance).getByRole("combobox", { name: "scheme" })).toBeTruthy();
    expect(within(appearance).getByRole("combobox", { name: "scale" })).toBeTruthy();
  });

  it("persists valid appearance choices through the native controls", () => {
    render(
      <Provider
        globalState={{ theme: "dark" } as GlobalState}
        dispatch={() => {}}
        config={{} as never}
      >
        <p>story</p>
      </Provider>,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "scale" }), {
      target: { value: "larger" },
    });

    expect(globalThis.localStorage.getItem("sovereign.catalogue.scale")).toBe("larger");
  });

  it("uses semantic surfaces, text, border, and focus roles", () => {
    const source = readFileSync(join(import.meta.dirname, "components.module.css"), "utf8");

    expect(source).toMatch(/background:\s*var\(--sovereign-control-surface\)/);
    expect(source).toMatch(/color:\s*var\(--sovereign-text\)/);
    expect(source).toMatch(/border:[^;]*var\(--sovereign-border\)/);
    expect(source).toMatch(/:focus-visible[\s\S]*var\(--sovereign-focus-ring\)/);
  });
});
