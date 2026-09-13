import { describe, expect, it, vi } from "vitest";

// `next/headers` is only available inside a request; the password functions
// under test don't touch it.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { hashPassword, verifyPassword } = await import("@/lib/auth");

describe("passwords", () => {
  it("accepts the correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("analytical-engine");
    expect(await verifyPassword("analytical-engine", stored)).toBe(true);
    expect(await verifyPassword("analytical-engin", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts, so the same password never produces the same hash", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("never stores the password itself", async () => {
    const stored = await hashPassword("hunter2");
    expect(stored).not.toContain("hunter2");
  });

  it("rejects a malformed stored hash instead of throwing", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    // A truncated hash must not crash the length-sensitive comparison.
    expect(await verifyPassword("x", "abcd:ff")).toBe(false);
  });
});
