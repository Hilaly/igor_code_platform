import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  minimumPasswordLength,
  parsePasswordSubmission,
  sessionCookieName,
} from "./authentication.ts";

describe("parsePasswordSubmission", () => {
  it("takes a password of the minimum length", () => {
    const password = "x".repeat(minimumPasswordLength);
    const parsed = parsePasswordSubmission({ password });

    assert.deepEqual(parsed, { kind: "parsed", value: { password } });
  });

  it("refuses a body that is not an object", () => {
    for (const raw of [undefined, null, "password", 7, ["password"]]) {
      assert.equal(parsePasswordSubmission(raw).kind, "rejected");
    }
  });

  it("refuses a password that is not a string", () => {
    const parsed = parsePasswordSubmission({ password: 12345678 });

    assert.equal(parsed.kind, "rejected");
    assert.match(parsed.kind === "rejected" ? parsed.reason : "", /string/);
  });

  it("names the minimum length in the refusal", () => {
    const parsed = parsePasswordSubmission({ password: "x".repeat(minimumPasswordLength - 1) });

    assert.equal(parsed.kind, "rejected");
    assert.match(
      parsed.kind === "rejected" ? parsed.reason : "",
      new RegExp(String(minimumPasswordLength)),
    );
  });

  it("keeps the password as it was typed", () => {
    // Обрезка пробелов сделала бы часть паролей невводимыми обратно: человек, поставивший пробел
    // концом пароля, при регистрации и при входе получил бы разные строки.
    const password = ` ${"x".repeat(minimumPasswordLength)} `;

    assert.deepEqual(parsePasswordSubmission({ password }), {
      kind: "parsed",
      value: { password },
    });
  });

  it("ignores unknown fields instead of refusing the body", () => {
    const password = "x".repeat(minimumPasswordLength);

    assert.deepEqual(parsePasswordSubmission({ password, remember: true }), {
      kind: "parsed",
      value: { password },
    });
  });
});

describe("sessionCookieName", () => {
  it("is a name a browser accepts without quoting", () => {
    assert.match(sessionCookieName, /^[A-Za-z0-9_-]+$/);
  });
});
