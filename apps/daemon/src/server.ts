import { createServer, type Server } from "node:http";

import { healthPath } from "@sovereign/protocol";

import { buildHealth } from "./health.ts";

export function createDaemonServer(startedAt: Date): Server {
  return createServer((request, response) => {
    if (request.url === healthPath) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(buildHealth(startedAt, new Date())));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
}
