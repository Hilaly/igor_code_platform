import { contribute } from "@sovereign/sdk";

import { readMission } from "./store.ts";

const json = (value: unknown, status = 200) => ({
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(value),
});

export async function contributeRoutes(): Promise<void> {
  await contribute.route({
    id: "snapshot",
    title: "Mission snapshot",
    description: "Read the mission snapshot for the requested session.",
    method: "GET",
    path: ":sessionId",
    handle: async (request) => {
      const sessionId = request.parameters["sessionId"] ?? "";
      const snapshot = await readMission(sessionId);

      return snapshot === undefined
        ? json({ error: `there is no mission for session ${sessionId}` }, 404)
        : json(snapshot);
    },
  });
}
