// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { FloatingLayer } from "./floating-layer.tsx";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function rect(values: Partial<DOMRect>): DOMRect {
  return {
    bottom: 240,
    height: 40,
    left: 100,
    right: 300,
    top: 200,
    width: 200,
    x: 100,
    y: 200,
    toJSON: () => ({}),
    ...values,
  } as DOMRect;
}

it("renders open content in document.body and aligns it to the anchor", () => {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(rect({}));
  const anchorRef = createRef<HTMLElement>();
  anchorRef.current = anchor;

  render(
    <FloatingLayer open anchorRef={anchorRef} matchAnchorWidth>
      <div role="listbox">items</div>
    </FloatingLayer>,
  );

  const popup = screen.getByRole("listbox").parentElement;
  expect(popup?.parentElement).toBe(document.body);
  expect(popup?.getAttribute("data-side")).toBe("bottom");
  expect(popup?.style.minWidth).toBe("200px");
});

it("flips above the anchor when there is no room below", () => {
  vi.stubGlobal("innerHeight", 300);
  vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
    rect({ left: 0, right: 200, top: 0, bottom: 100, width: 200, height: 100 }),
  );
  const anchor = document.createElement("button");
  document.body.append(anchor);
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
    rect({ top: 220, bottom: 260, height: 40 }),
  );
  const anchorRef = createRef<HTMLElement>();
  anchorRef.current = anchor;

  render(
    <FloatingLayer open anchorRef={anchorRef} side="bottom">
      <div role="listbox" style={{ height: 100 }}>
        items
      </div>
    </FloatingLayer>,
  );

  expect(screen.getByRole("listbox").parentElement?.getAttribute("data-side")).toBe("top");
});

it("recomputes coordinates on resize and scroll", () => {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  const getRect = vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(rect({ left: 100 }));
  const anchorRef = createRef<HTMLElement>();
  anchorRef.current = anchor;

  render(
    <FloatingLayer open anchorRef={anchorRef}>
      <div role="listbox">items</div>
    </FloatingLayer>,
  );
  getRect.mockReturnValue(rect({ left: 180, right: 380 }));

  act(() => {
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("scroll"));
  });

  expect(getRect).toHaveBeenCalledTimes(3);
});
