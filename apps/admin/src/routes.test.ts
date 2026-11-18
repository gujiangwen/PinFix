import { describe, expect, it } from "vitest";
import { pageHash, parseHash, settingsHash } from "./routes";

describe("parseHash", () => {
  it("opens the loop page for an empty hash", () => {
    for (const hash of ["", "#", "#/"]) {
      expect(parseHash(hash)).toEqual({
        kind: "page",
        page: { name: "loop", sessionId: null },
      });
    }
  });

  it("reads a session id", () => {
    expect(parseHash("#/s/abc123")).toEqual({
      kind: "page",
      page: { name: "loop", sessionId: "abc123" },
    });
  });

  it("reads the knowledge page with and without a card", () => {
    expect(parseHash("#/knowledge")).toEqual({
      kind: "page",
      page: { name: "knowledge", cardId: null },
    });
    expect(parseHash("#/knowledge/k1")).toEqual({
      kind: "page",
      page: { name: "knowledge", cardId: "k1" },
    });
  });

  it("reads a settings section", () => {
    expect(parseHash("#/settings/projects")).toEqual({
      kind: "settings",
      section: "projects",
    });
  });

  it("sends an unknown or missing settings section to the first one", () => {
    expect(parseHash("#/settings")).toEqual({ kind: "redirect", to: "#/settings/pi" });
    expect(parseHash("#/settings/nope")).toEqual({ kind: "redirect", to: "#/settings/pi" });
  });

  it("redirects every pre-refactor tab hash", () => {
    expect(parseHash("#sessions")).toEqual({ kind: "redirect", to: "#/" });
    expect(parseHash("#knowledge")).toEqual({ kind: "redirect", to: "#/knowledge" });
    expect(parseHash("#models")).toEqual({ kind: "redirect", to: "#/settings/pi" });
    expect(parseHash("#projects")).toEqual({ kind: "redirect", to: "#/settings/projects" });
    expect(parseHash("#extension")).toEqual({ kind: "redirect", to: "#/settings/extension" });
    expect(parseHash("#audit")).toEqual({ kind: "redirect", to: "#/settings/audit" });
    expect(parseHash("#metrics")).toEqual({ kind: "redirect", to: "#/settings/metrics" });
  });

  it("sends anything else home", () => {
    expect(parseHash("#whatever")).toEqual({ kind: "redirect", to: "#/" });
    expect(parseHash("#/nope")).toEqual({ kind: "redirect", to: "#/" });
    expect(parseHash("#/s")).toEqual({ kind: "redirect", to: "#/" });
    expect(parseHash("#/s/a/b")).toEqual({ kind: "redirect", to: "#/" });
    expect(parseHash("#/s/%E0%A4%A")).toEqual({ kind: "redirect", to: "#/" });
  });
});

describe("hash builders", () => {
  it("round-trips through parseHash", () => {
    const pages = [
      { name: "loop", sessionId: null },
      { name: "loop", sessionId: "id with space/slash" },
      { name: "knowledge", cardId: null },
      { name: "knowledge", cardId: "k/1" },
    ] as const;
    for (const page of pages) {
      expect(parseHash(pageHash(page))).toEqual({ kind: "page", page });
    }
    expect(parseHash(settingsHash("audit"))).toEqual({
      kind: "settings",
      section: "audit",
    });
  });
});
