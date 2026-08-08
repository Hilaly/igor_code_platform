// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppearancePreview } from "./appearance-preview.tsx";

afterEach(cleanup);

describe("AppearancePreview", () => {
  it("names the live preview and exposes every semantic swatch as text", () => {
    render(
      <AppearancePreview
        title="Preview"
        label="Preview: Imperium, Dark, Normal"
        scheme="Imperium"
        variant="Dark"
        scale="Normal"
        swatches={[
          { role: "surface", label: "Surface" },
          { role: "accent", label: "Accent" },
          { role: "secondary", label: "Secondary" },
          { role: "text", label: "Text" },
        ]}
      />,
    );

    const preview = screen.getByRole("region", {
      name: "Preview: Imperium, Dark, Normal",
    });

    expect(preview.getAttribute("aria-live")).toBe("polite");
    expect(within(preview).getByRole("heading", { name: "Imperium", level: 3 })).toBeDefined();
    expect(within(preview).getByText("Dark · Normal")).toBeDefined();
    expect(within(preview).getAllByRole("listitem")).toHaveLength(4);
    for (const label of ["Surface", "Accent", "Secondary", "Text"]) {
      expect(within(preview).getByText(label)).toBeDefined();
    }
  });
});
