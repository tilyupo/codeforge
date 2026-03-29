import { describe, it, expect } from "vitest";
import { fnv1a32, fnv1a32ToUnit } from "../src/hash";

describe("fnv1a32", () => {
  it("should return consistent hash for same input", () => {
    const input = "test-string";
    expect(fnv1a32(input)).toBe(fnv1a32(input));
  });

  it("should return different hashes for different inputs", () => {
    expect(fnv1a32("test1")).not.toBe(fnv1a32("test2"));
  });

  it("should return a 32-bit unsigned integer", () => {
    const hash = fnv1a32("test");
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(hash)).toBe(true);
  });

  it("should handle empty string", () => {
    const hash = fnv1a32("");
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hash)).toBe(true);
  });

  it("should handle unicode characters", () => {
    const hash1 = fnv1a32("日本語");
    const hash2 = fnv1a32("emoji 🎉");
    expect(hash1).toBeGreaterThanOrEqual(0);
    expect(hash2).toBeGreaterThanOrEqual(0);
    expect(hash1).not.toBe(hash2);
  });

  it("should handle long strings", () => {
    const longString = "a".repeat(10000);
    const hash = fnv1a32(longString);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });

  it("should produce known FNV-1a values", () => {
    // Known test vectors for FNV-1a 32-bit
    // Empty string: FNV offset basis
    expect(fnv1a32("")).toBe(0x811c9dc5);
  });

  it("should have good avalanche property - small input changes produce different hashes", () => {
    const hash1 = fnv1a32("test");
    const hash2 = fnv1a32("test1");
    const hash3 = fnv1a32("test2");

    // All should be different
    expect(new Set([hash1, hash2, hash3]).size).toBe(3);
  });
});

describe("fnv1a32ToUnit", () => {
  it("should return value in range [0, 1)", () => {
    const testCases = [
      "test",
      "hello",
      "world",
      "user-123",
      "🎉",
      "",
      "a".repeat(1000),
    ];

    for (const input of testCases) {
      const unit = fnv1a32ToUnit(input);
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThan(1);
    }
  });

  it("should return consistent values for same input", () => {
    const input = "user-456";
    expect(fnv1a32ToUnit(input)).toBe(fnv1a32ToUnit(input));
  });

  it("should distribute values reasonably across range", () => {
    // Test that different inputs produce different unit values
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      values.add(fnv1a32ToUnit(`user-${i}`));
    }
    // Should have 100 unique values (extremely unlikely to have collisions)
    expect(values.size).toBe(100);
  });

  it("should work correctly for segmentation buckets", () => {
    const input = "user-123seed";
    const unit = fnv1a32ToUnit(input);

    // Verify unit value can be used for percentage bucketing
    const percentage = unit * 100;
    expect(percentage).toBeGreaterThanOrEqual(0);
    expect(percentage).toBeLessThan(100);
  });

  it("should handle edge case inputs", () => {
    expect(fnv1a32ToUnit("")).toBeGreaterThanOrEqual(0);
    expect(fnv1a32ToUnit("")).toBeLessThan(1);

    expect(fnv1a32ToUnit("0")).toBeGreaterThanOrEqual(0);
    expect(fnv1a32ToUnit("0")).toBeLessThan(1);
  });
});
