import { createServer, type Server } from "node:http";

import { createDispatcher, type CreateDispatcherOptions } from "./dispatcher.ts";

export function createDaemonServer(options: CreateDispatcherOptions): Server {
  return createServer(createDispatcher(options));
}
