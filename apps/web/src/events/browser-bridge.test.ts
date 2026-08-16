import { describe, expect, it, vi } from "vitest";

import { createFrontendBus } from "./bus.ts";
import { createBrowserEventBridge } from "./browser-bridge.ts";

describe("browser event bridge", () => {
  it("forwards recovery from the host and unsubscribes", () => {
    const bridge = createBrowserEventBridge(createFrontendBus({ onListenerError: vi.fn() }));
    const listener = vi.fn();
    const unsubscribe = bridge.events.subscribeRecovery?.(listener);

    expect(unsubscribe).toBeTypeOf("function");

    bridge.recover();
    unsubscribe?.();
    bridge.recover();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
