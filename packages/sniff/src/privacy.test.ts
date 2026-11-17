import { describe, expect, it } from "vitest";
import { isBlacklistedKey, summarizeProps } from "./privacy.js";

describe("privacy", () => {
  it("flags sensitive keys", () => {
    expect(isBlacklistedKey("password")).toBe(true);
    expect(isBlacklistedKey("accessToken")).toBe(true);
    expect(isBlacklistedKey("Authorization")).toBe(true);
    expect(isBlacklistedKey("userName")).toBe(false);
  });

  it("redacts blacklisted props and skips children", () => {
    const summary = summarizeProps({
      title: "Hello",
      password: "s3cret",
      token: "abc",
      children: { type: "span" },
      onClick: function handleClick() {},
      nested: { a: 1 },
    });
    expect(summary.title).toBe("Hello");
    expect(summary.password).toBe("[redacted]");
    expect(summary.token).toBe("[redacted]");
    expect(summary.children).toBeUndefined();
    expect(summary.onClick).toMatch(/^\[fn /);
    expect(summary.nested).toBe("[object]");
  });
});
