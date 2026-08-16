import type { BrowserEventBridge, BrowserRecoveryListener } from "@sovereign/browser-sdk";

import type { FrontendBus } from "./bus.ts";

export type HostBrowserEventBridge = {
  events: BrowserEventBridge;
  recover(): void;
};

export function createBrowserEventBridge(bus: FrontendBus): HostBrowserEventBridge {
  const recoveryListeners = new Set<BrowserRecoveryListener>();

  return {
    events: {
      subscribe: bus.subscribe,
      subscribeRecovery: (listener) => {
        recoveryListeners.add(listener);
        return () => recoveryListeners.delete(listener);
      },
    },
    recover: () => {
      for (const listener of [...recoveryListeners]) listener();
    },
  };
}
