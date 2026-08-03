import { access } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import { contribute, log, type PluginModule } from "@sovereign/sdk";

const release = join(import.meta.dirname, "release");

export const activate: PluginModule["activate"] = async () => {
  await contribute.custom({ id: "programmatic", title: "Programmatic" });
  await log.info("late activation is waiting");

  while (true) {
    try {
      await access(release);
      return;
    } catch {
      await wait(5);
    }
  }
};
