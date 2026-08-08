// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAppearancePreferences } from "./appearance.ts";
import { App } from "./App.tsx";

vi.mock("./session.ts", () => ({
  logIn: vi.fn(),
  logOut: vi.fn(),
  probeSession: vi.fn(async () => ({ kind: "state", state: "authenticated" })),
  register: vi.fn(),
}));

vi.mock("./events/stream.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./events/stream.ts")>();

  return {
    ...original,
    connectEventStream: vi.fn(() => ({ status: () => "connecting", close: vi.fn() })),
  };
});

vi.mock("./appearance.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./appearance.ts")>();

  return {
    ...original,
    fetchAppearance: vi.fn(async () => defaultAppearancePreferences),
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

describe("App shell composition", () => {
  it("wires the localized product brand and real new-session action into authenticated navigation", async () => {
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "Navigation" });

    const productName = within(navigation).getByText("Sovereign");

    expect(productName.parentElement?.querySelector("svg")).not.toBeNull();
    expect(within(navigation).getByRole("button", { name: "+ New session" })).toBeDefined();
  });
});
