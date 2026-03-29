import { describe, it, expect, vi } from "vitest";
import {
  evaluateOverrides,
  evaluateCondition,
  castToContextType,
} from "../src/evaluation";
import type { Condition, Override } from "../src/types";
import type { ReplaneLogger } from "../src/client-types";

function createSilentLogger(): ReplaneLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("evaluateCondition", () => {
  const logger = createSilentLogger();

  describe("equals operator", () => {
    it("should match when values are equal", () => {
      const condition: Condition = {
        operator: "equals",
        property: "env",
        value: "production",
      };
      expect(evaluateCondition(condition, { env: "production" }, logger)).toBe("matched");
    });

    it("should not match when values differ", () => {
      const condition: Condition = {
        operator: "equals",
        property: "env",
        value: "production",
      };
      expect(evaluateCondition(condition, { env: "staging" }, logger)).toBe("not_matched");
    });

    it("should return unknown when property is missing", () => {
      const condition: Condition = {
        operator: "equals",
        property: "env",
        value: "production",
      };
      expect(evaluateCondition(condition, {}, logger)).toBe("unknown");
    });
  });

  describe("in operator", () => {
    it("should match when value is in array", () => {
      const condition: Condition = {
        operator: "in",
        property: "country",
        value: ["US", "CA", "MX"],
      };
      expect(evaluateCondition(condition, { country: "US" }, logger)).toBe("matched");
    });

    it("should not match when value is not in array", () => {
      const condition: Condition = {
        operator: "in",
        property: "country",
        value: ["US", "CA", "MX"],
      };
      expect(evaluateCondition(condition, { country: "UK" }, logger)).toBe("not_matched");
    });
  });

  describe("not_in operator", () => {
    it("should match when value is not in array", () => {
      const condition: Condition = {
        operator: "not_in",
        property: "country",
        value: ["US", "CA"],
      };
      expect(evaluateCondition(condition, { country: "UK" }, logger)).toBe("matched");
    });

    it("should not match when value is in array", () => {
      const condition: Condition = {
        operator: "not_in",
        property: "country",
        value: ["US", "CA"],
      };
      expect(evaluateCondition(condition, { country: "US" }, logger)).toBe("not_matched");
    });
  });

  describe("comparison operators", () => {
    it("should evaluate less_than correctly", () => {
      const condition: Condition = {
        operator: "less_than",
        property: "age",
        value: 18,
      };
      expect(evaluateCondition(condition, { age: 16 }, logger)).toBe("matched");
      expect(evaluateCondition(condition, { age: 18 }, logger)).toBe("not_matched");
      expect(evaluateCondition(condition, { age: 20 }, logger)).toBe("not_matched");
    });

    it("should evaluate less_than_or_equal correctly", () => {
      const condition: Condition = {
        operator: "less_than_or_equal",
        property: "age",
        value: 18,
      };
      expect(evaluateCondition(condition, { age: 16 }, logger)).toBe("matched");
      expect(evaluateCondition(condition, { age: 18 }, logger)).toBe("matched");
      expect(evaluateCondition(condition, { age: 20 }, logger)).toBe("not_matched");
    });

    it("should evaluate greater_than correctly", () => {
      const condition: Condition = {
        operator: "greater_than",
        property: "score",
        value: 100,
      };
      expect(evaluateCondition(condition, { score: 150 }, logger)).toBe("matched");
      expect(evaluateCondition(condition, { score: 100 }, logger)).toBe("not_matched");
      expect(evaluateCondition(condition, { score: 50 }, logger)).toBe("not_matched");
    });

    it("should evaluate greater_than_or_equal correctly", () => {
      const condition: Condition = {
        operator: "greater_than_or_equal",
        property: "score",
        value: 100,
      };
      expect(evaluateCondition(condition, { score: 150 }, logger)).toBe("matched");
      expect(evaluateCondition(condition, { score: 100 }, logger)).toBe("matched");
      expect(evaluateCondition(condition, { score: 50 }, logger)).toBe("not_matched");
    });

    it("should compare strings lexicographically", () => {
      const condition: Condition = {
        operator: "less_than",
        property: "version",
        value: "2.0.0",
      };
      expect(evaluateCondition(condition, { version: "1.9.0" }, logger)).toBe("matched");
      expect(evaluateCondition(condition, { version: "2.0.0" }, logger)).toBe("not_matched");
      expect(evaluateCondition(condition, { version: "3.0.0" }, logger)).toBe("not_matched");
    });
  });

  describe("composite conditions", () => {
    it("should evaluate and condition correctly", () => {
      const condition: Condition = {
        operator: "and",
        conditions: [
          { operator: "equals", property: "env", value: "production" },
          { operator: "equals", property: "role", value: "admin" },
        ],
      };
      expect(evaluateCondition(condition, { env: "production", role: "admin" }, logger)).toBe(
        "matched"
      );
      expect(evaluateCondition(condition, { env: "production", role: "user" }, logger)).toBe(
        "not_matched"
      );
      expect(evaluateCondition(condition, { env: "staging", role: "admin" }, logger)).toBe(
        "not_matched"
      );
    });

    it("should return unknown for and when any condition is unknown", () => {
      const condition: Condition = {
        operator: "and",
        conditions: [
          { operator: "equals", property: "env", value: "production" },
          { operator: "equals", property: "missing", value: "value" },
        ],
      };
      expect(evaluateCondition(condition, { env: "production" }, logger)).toBe("unknown");
    });

    it("should return not_matched for and when any condition fails (even with unknown)", () => {
      const condition: Condition = {
        operator: "and",
        conditions: [
          { operator: "equals", property: "env", value: "production" },
          { operator: "equals", property: "missing", value: "value" },
        ],
      };
      expect(evaluateCondition(condition, { env: "staging" }, logger)).toBe("not_matched");
    });

    it("should evaluate or condition correctly", () => {
      const condition: Condition = {
        operator: "or",
        conditions: [
          { operator: "equals", property: "env", value: "production" },
          { operator: "equals", property: "env", value: "staging" },
        ],
      };
      expect(evaluateCondition(condition, { env: "production" }, logger)).toBe("matched");
      expect(evaluateCondition(condition, { env: "staging" }, logger)).toBe("matched");
      expect(evaluateCondition(condition, { env: "development" }, logger)).toBe("not_matched");
    });

    it("should return matched for or when any condition matches (even with unknown)", () => {
      const condition: Condition = {
        operator: "or",
        conditions: [
          { operator: "equals", property: "env", value: "production" },
          { operator: "equals", property: "missing", value: "value" },
        ],
      };
      expect(evaluateCondition(condition, { env: "production" }, logger)).toBe("matched");
    });

    it("should evaluate not condition correctly", () => {
      const condition: Condition = {
        operator: "not",
        condition: { operator: "equals", property: "env", value: "production" },
      };
      expect(evaluateCondition(condition, { env: "production" }, logger)).toBe("not_matched");
      expect(evaluateCondition(condition, { env: "staging" }, logger)).toBe("matched");
    });

    it("should return unknown for not when inner condition is unknown", () => {
      const condition: Condition = {
        operator: "not",
        condition: { operator: "equals", property: "missing", value: "value" },
      };
      expect(evaluateCondition(condition, {}, logger)).toBe("unknown");
    });
  });

  describe("segmentation operator", () => {
    it("should match when user is in 100% segment", () => {
      const condition: Condition = {
        operator: "segmentation",
        property: "userId",
        fromPercentage: 0,
        toPercentage: 100,
        seed: "test-seed",
      };
      expect(evaluateCondition(condition, { userId: "user-123" }, logger)).toBe("matched");
    });

    it("should not match when user is in 0% segment", () => {
      const condition: Condition = {
        operator: "segmentation",
        property: "userId",
        fromPercentage: 0,
        toPercentage: 0,
        seed: "test-seed",
      };
      expect(evaluateCondition(condition, { userId: "user-123" }, logger)).toBe("not_matched");
    });

    it("should return unknown when property is missing", () => {
      const condition: Condition = {
        operator: "segmentation",
        property: "userId",
        fromPercentage: 0,
        toPercentage: 50,
        seed: "test-seed",
      };
      expect(evaluateCondition(condition, {}, logger)).toBe("unknown");
    });

    it("should return unknown when property is null", () => {
      const condition: Condition = {
        operator: "segmentation",
        property: "userId",
        fromPercentage: 0,
        toPercentage: 50,
        seed: "test-seed",
      };
      expect(evaluateCondition(condition, { userId: null }, logger)).toBe("unknown");
    });

    it("should be deterministic for same user and seed", () => {
      const condition: Condition = {
        operator: "segmentation",
        property: "userId",
        fromPercentage: 0,
        toPercentage: 50,
        seed: "consistent-seed",
      };
      const result1 = evaluateCondition(condition, { userId: "user-abc" }, logger);
      const result2 = evaluateCondition(condition, { userId: "user-abc" }, logger);
      expect(result1).toBe(result2);
    });

    it("should distribute users across segments", () => {
      const condition50: Condition = {
        operator: "segmentation",
        property: "userId",
        fromPercentage: 0,
        toPercentage: 50,
        seed: "distribution-test",
      };

      let matchedCount = 0;
      const totalUsers = 1000;

      for (let i = 0; i < totalUsers; i++) {
        const result = evaluateCondition(condition50, { userId: `user-${i}` }, logger);
        if (result === "matched") matchedCount++;
      }

      // Should be approximately 50% (with some variance)
      const matchedPercentage = matchedCount / totalUsers;
      expect(matchedPercentage).toBeGreaterThan(0.4);
      expect(matchedPercentage).toBeLessThan(0.6);
    });
  });
});

describe("evaluateOverrides", () => {
  const logger = createSilentLogger();

  it("should return base value when no overrides exist", () => {
    expect(evaluateOverrides("default", [], {}, logger)).toBe("default");
  });

  it("should return base value when no override matches", () => {
    const overrides: Override[] = [
      {
        name: "prod-override",
        conditions: [{ operator: "equals", property: "env", value: "production" }],
        value: "prod-value",
      },
    ];
    expect(evaluateOverrides("default", overrides, { env: "staging" }, logger)).toBe("default");
  });

  it("should return override value when conditions match", () => {
    const overrides: Override[] = [
      {
        name: "prod-override",
        conditions: [{ operator: "equals", property: "env", value: "production" }],
        value: "prod-value",
      },
    ];
    expect(evaluateOverrides("default", overrides, { env: "production" }, logger)).toBe(
      "prod-value"
    );
  });

  it("should return first matching override", () => {
    const overrides: Override[] = [
      {
        name: "first-override",
        conditions: [{ operator: "equals", property: "env", value: "production" }],
        value: "first-value",
      },
      {
        name: "second-override",
        conditions: [{ operator: "equals", property: "env", value: "production" }],
        value: "second-value",
      },
    ];
    expect(evaluateOverrides("default", overrides, { env: "production" }, logger)).toBe(
      "first-value"
    );
  });

  it("should skip override when any condition is unknown", () => {
    const overrides: Override[] = [
      {
        name: "override-with-unknown",
        conditions: [
          { operator: "equals", property: "env", value: "production" },
          { operator: "equals", property: "missing", value: "value" },
        ],
        value: "unknown-override",
      },
      {
        name: "fallback-override",
        conditions: [{ operator: "equals", property: "env", value: "production" }],
        value: "fallback-value",
      },
    ];
    expect(evaluateOverrides("default", overrides, { env: "production" }, logger)).toBe(
      "fallback-value"
    );
  });

  it("should handle complex nested conditions", () => {
    const overrides: Override[] = [
      {
        name: "complex-override",
        conditions: [
          {
            operator: "and",
            conditions: [
              { operator: "equals", property: "env", value: "production" },
              {
                operator: "or",
                conditions: [
                  { operator: "equals", property: "role", value: "admin" },
                  { operator: "equals", property: "role", value: "superuser" },
                ],
              },
            ],
          },
        ],
        value: "admin-prod-value",
      },
    ];

    expect(
      evaluateOverrides("default", overrides, { env: "production", role: "admin" }, logger)
    ).toBe("admin-prod-value");
    expect(
      evaluateOverrides("default", overrides, { env: "production", role: "superuser" }, logger)
    ).toBe("admin-prod-value");
    expect(
      evaluateOverrides("default", overrides, { env: "production", role: "user" }, logger)
    ).toBe("default");
  });
});

describe("castToContextType", () => {
  it("should cast string to number when context is number", () => {
    expect(castToContextType("42", 10)).toBe(42);
    expect(castToContextType("3.14", 10.5)).toBe(3.14);
  });

  it("should return original string if not a valid number", () => {
    expect(castToContextType("not-a-number", 10)).toBe("not-a-number");
  });

  it("should cast string to boolean when context is boolean", () => {
    expect(castToContextType("true", true)).toBe(true);
    expect(castToContextType("false", false)).toBe(false);
  });

  it("should cast number to boolean when context is boolean", () => {
    expect(castToContextType(1, true)).toBe(true);
    expect(castToContextType(0, false)).toBe(false);
  });

  it("should cast number/boolean to string when context is string", () => {
    expect(castToContextType(42, "test")).toBe("42");
    expect(castToContextType(true, "test")).toBe("true");
  });

  it("should return original value for non-primitive context types", () => {
    expect(castToContextType("value", null)).toBe("value");
    expect(castToContextType(42, undefined)).toBe(42);
  });

  it("should handle array values (for in/not_in operators)", () => {
    // Arrays should pass through unchanged
    const arr = ["a", "b", "c"];
    expect(castToContextType(arr, "test")).toBe(arr);
  });
});
