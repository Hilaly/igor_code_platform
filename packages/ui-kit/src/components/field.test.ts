import { describe, expect, it } from "vitest";

import { mergeDescribedBy } from "./field.tsx";

describe("mergeDescribedBy", () => {
  it("joins what the caller brought with the hint and the error", () => {
    expect(mergeDescribedBy("outside", "field-hint", "field-error")).toBe(
      "outside field-hint field-error",
    );
  });

  it("keeps the identifiers a missing hint or error leaves behind", () => {
    expect(mergeDescribedBy(undefined, "field-hint", undefined)).toBe("field-hint");
    expect(mergeDescribedBy("outside", undefined, undefined)).toBe("outside");
  });

  it("says nothing at all when there is nothing to describe", () => {
    expect(mergeDescribedBy(undefined, undefined, undefined)).toBeUndefined();
    expect(mergeDescribedBy("   ")).toBeUndefined();
  });

  it("drops a repeated identifier so the description is not read twice", () => {
    expect(mergeDescribedBy("field-hint outside", "field-hint")).toBe("field-hint outside");
  });

  it("reads a caller list separated by any run of whitespace", () => {
    expect(mergeDescribedBy("  first \n second   third ", "fourth")).toBe(
      "first second third fourth",
    );
  });
});
