// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dialog } from "./dialog.tsx";
import { Notice } from "./notice.tsx";
import { Tabs } from "./tabs.tsx";
import { Tooltip } from "./tooltip.tsx";

afterEach(cleanup);

describe("surface semantics", () => {
  it("traps dialog focus, closes on Escape, and restores its opener", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<button type="button">Opener</button>);
    const opener = screen.getByRole("button", { name: "Opener" });
    opener.focus();
    rerender(
      <>
        <button type="button">Opener</button>
        <Dialog open onClose={onClose} title="Confirm">
          <button type="button">First</button>
          <button type="button">Last</button>
        </Dialog>
      </>,
    );
    const dialog = screen.getByRole("dialog", { name: "Confirm" });
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    expect(dialog).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(first));
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves tab focus without selecting and skips disabled tabs", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="Sections"
        value="one"
        onChange={onChange}
        tabs={[
          { id: "one", label: "One", content: "One content" },
          { id: "disabled", label: "Disabled", disabled: true, content: "Nope" },
          { id: "two", label: "Two", content: "Two content" },
        ]}
      />,
    );

    const one = screen.getByRole("tab", { name: "One" });
    const two = screen.getByRole("tab", { name: "Two" });
    one.focus();
    fireEvent.keyDown(one, { key: "ArrowRight" });
    expect(document.activeElement).toBe(two);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(two);
    expect(onChange).toHaveBeenCalledWith("two");
    expect(one.getAttribute("aria-selected")).toBe("true");
    expect(two.getAttribute("aria-selected")).toBe("false");
  });

  it("keeps notice tones mapped to status and alert roles", () => {
    render(
      <>
        <Notice tone="info" title="Info" />
        <Notice tone="warning" title="Warning" />
        <Notice tone="danger" title="Danger" />
      </>,
    );

    expect(screen.getByRole("status").textContent).toContain("Info");
    expect(screen.getAllByRole("alert").map((element) => element.textContent)).toEqual([
      "Warning",
      "Danger",
    ]);
  });

  it("merges an existing description and uses keyboard modality for tooltip focus", () => {
    render(
      <Tooltip content="Details" id="details-tip">
        <button type="button" aria-describedby="existing-tip">
          Help
        </button>
      </Tooltip>,
    );

    const button = screen.getByRole("button", { name: "Help" });
    expect(button.getAttribute("aria-describedby")).toBe("existing-tip details-tip");
    expect(screen.getByRole("tooltip", { name: "Details" })).toBeTruthy();
  });
});
