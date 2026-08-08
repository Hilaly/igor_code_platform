import type { ContributionRegistration, PluginSource } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import { windowWideContributions } from "./window-wide.ts";

const scheme = (source: PluginSource, pluginKey: string): ContributionRegistration => ({
  ownership: "plugin",
  kind: "color-scheme",
  id: "themed.midnight",
  declaredId: "midnight",
  pluginKey,
  pluginId: "themed",
  source,
  scheme: { tokenContract: 2, variants: {} },
});

describe("windowWideContributions", () => {
  it("drops the copy from a project folder and keeps the one of the node", () => {
    // Иначе тот же `themed.midnight` приезжает в список схем дважды, и выбор перестаёт быть выбором.
    const kept = windowWideContributions([
      scheme("data", "data:themed"),
      scheme("project:work", "project:work:themed"),
    ]);

    expect(kept.map((registration) => registration.source)).toEqual(["data"]);
  });

  it("keeps built-in and data alike: belonging to a project is the only reason to drop one", () => {
    const kept = windowWideContributions([
      scheme("builtin", "builtin:themed"),
      scheme("data", "data:themed"),
    ]);

    expect(kept).toHaveLength(2);
  });
});
