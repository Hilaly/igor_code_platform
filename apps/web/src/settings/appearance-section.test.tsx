// @vitest-environment jsdom

import { coreEnglish, coreNamespace, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppearanceSection } from "./appearance-section.tsx";

afterEach(cleanup);

const translator = createTranslator({
  locale: "en",
  namespace: coreNamespace,
  catalogs: [coreEnglish],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

const preferences = {
  appearance: { colorScheme: "imperium", variant: "dark", scale: "default" },
  locale: "en",
} as const;

describe("AppearanceSection", () => {
  it("renders a live UI Kit preview of the controlled appearance", () => {
    render(
      <AppearanceSection
        preferences={preferences}
        schemes={[
          { id: "imperium", label: "Imperium (purple and gold)" },
          { id: "nord", label: "Nord (arctic)" },
        ]}
        locales={["en", "ru"]}
        onChange={vi.fn()}
        refusal={undefined}
        translator={translator}
      />,
    );

    const preview = screen.getByRole("region", {
      name: "Preview: Imperium (purple and gold), Dark, Normal",
    });

    expect(within(preview).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radiogroup", { name: "Interface scale" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Normal" }).getAttribute("aria-checked")).toBe("true");
  });

  it("preserves the four immediate controlled preference updates", () => {
    const onChange = vi.fn();
    render(
      <AppearanceSection
        preferences={preferences}
        schemes={[
          { id: "imperium", label: "Imperium (purple and gold)" },
          { id: "nord", label: "Nord (arctic)" },
        ]}
        locales={["en", "ru"]}
        onChange={onChange}
        refusal={undefined}
        translator={translator}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...preferences,
      appearance: { ...preferences.appearance, variant: "light" },
    });

    fireEvent.click(screen.getByRole("radio", { name: "Smaller" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...preferences,
      appearance: { ...preferences.appearance, scale: "smaller" },
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Colour scheme" }));
    fireEvent.click(screen.getByRole("option", { name: "Nord (arctic)" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...preferences,
      appearance: { ...preferences.appearance, colorScheme: "nord" },
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Language" }));
    fireEvent.click(screen.getByRole("option", { name: /русский/i }));
    expect(onChange).toHaveBeenLastCalledWith({ ...preferences, locale: "ru" });
  });
});
