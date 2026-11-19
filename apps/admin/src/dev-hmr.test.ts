import { describe, expect, it } from "vitest";
import { HMR_STALE_MS, hmrSocketExpired } from "./dev-hmr";

describe("hmrSocketExpired", () => {
  const beat = 10_000;

  it("waits until a heartbeat has been seen", () => {
    expect(hmrSocketExpired(0, beat + HMR_STALE_MS + 1, true)).toBe(false);
  });

  it("keeps a visible tab that is still receiving frames", () => {
    expect(hmrSocketExpired(beat, beat + HMR_STALE_MS, true)).toBe(false);
  });

  it("reloads a visible tab whose socket stopped delivering", () => {
    expect(hmrSocketExpired(beat, beat + HMR_STALE_MS + 1, true)).toBe(true);
  });

  it("does not reload a hidden tab, even when the last beat is old", () => {
    expect(hmrSocketExpired(beat, beat + HMR_STALE_MS + 60_000, false)).toBe(false);
  });
});
