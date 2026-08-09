// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appearanceCacheKey,
  cacheAppearance,
  defaultAppearancePreferences,
  fetchAppearance,
} from "./appearance.ts";
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
  vi.mocked(fetchAppearance).mockResolvedValue(defaultAppearancePreferences);
});

describe("App shell composition", () => {
  it("wires the localized product brand and real new-session action into authenticated navigation", async () => {
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "Navigation" });

    const productName = within(navigation).getByText("Sovereign");

    expect(productName.parentElement?.querySelector("svg")).not.toBeNull();
    expect(within(navigation).getByRole("button", { name: "+ New session" })).toBeDefined();
  });

  it("previews Imperium while preserving a disappeared saved plugin scheme", async () => {
    const missing = {
      ...defaultAppearancePreferences,
      appearance: {
        ...defaultAppearancePreferences.appearance,
        colorScheme: "themed.missing",
        variant: "dark" as const,
      },
    };
    cacheAppearance(localStorage, missing);
    vi.mocked(fetchAppearance).mockResolvedValue(missing);
    history.replaceState(null, "", "/settings/appearance");

    render(<App />);

    expect(
      await screen.findByRole("region", {
        name: "Preview: Imperium (purple and gold), Dark, Normal",
      }),
    ).toBeTruthy();
    await waitFor(() => {
      const cached = JSON.parse(localStorage.getItem(appearanceCacheKey) ?? "{}") as {
        appearance?: { colorScheme?: string };
      };
      expect(cached.appearance?.colorScheme).toBe("themed.missing");
    });
  });

  it("wires the canonical usage route into Settings without requesting before the stream opens", async () => {
    history.replaceState(null, "", "/settings/usage");

    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Usage" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Usage" }).getAttribute("aria-current")).toBe("page");
    expect(
      within(screen.getByRole("region", { name: "Usage" })).getByRole("status").textContent,
    ).toBe("Loading usage…");
  });
});
