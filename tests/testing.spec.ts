import { describe, it, expect, vi } from "vitest";
import { InMemoryReplane } from "../src/in-memory";

describe("InMemoryReplane", () => {
  describe("constructor and defaults", () => {
    it("creates empty client", () => {
      const client = new InMemoryReplane();
      expect(client.keys()).toEqual([]);
    });

    it("creates client with defaults", () => {
      const client = new InMemoryReplane({
        defaults: { feature: true, limit: 100 },
      });
      expect(client.get("feature")).toBe(true);
      expect(client.get("limit")).toBe(100);
    });

    it("ignores undefined defaults", () => {
      const client = new InMemoryReplane({
        defaults: { feature: true, other: undefined },
      });
      expect(client.has("feature")).toBe(true);
      expect(client.has("other")).toBe(false);
    });
  });

  describe("get", () => {
    it("throws for missing config without default", () => {
      const client = new InMemoryReplane();
      expect(() => client.get("missing")).toThrow("Config not found: missing");
    });

    it("returns inline default for missing config", () => {
      const client = new InMemoryReplane();
      expect(client.get("missing", { default: "fallback" })).toBe("fallback");
    });

    it("returns config value over inline default", () => {
      const client = new InMemoryReplane({
        defaults: { feature: true },
      });
      expect(client.get("feature", { default: false })).toBe(true);
    });
  });

  describe("set", () => {
    it("sets simple value", () => {
      const client = new InMemoryReplane();
      client.set("feature", true);
      expect(client.get("feature")).toBe(true);
    });

    it("overwrites existing value", () => {
      const client = new InMemoryReplane({
        defaults: { value: 1 },
      });
      expect(client.get("value")).toBe(1);
      client.set("value", 2);
      expect(client.get("value")).toBe(2);
    });
  });

  describe("set with overrides", () => {
    it("evaluates equals condition", () => {
      const client = new InMemoryReplane<{ feature: boolean }>();
      client.set("feature", false, {
        overrides: [
          {
            name: "beta-override",
            conditions: [{ operator: "equals", property: "plan", value: "beta" }],
            value: true,
          },
        ],
      });

      expect(client.get("feature")).toBe(false);
      expect(client.get("feature", { context: { plan: "free" } })).toBe(false);
      expect(client.get("feature", { context: { plan: "beta" } })).toBe(true);
    });

    it("evaluates in condition", () => {
      const client = new InMemoryReplane<{ limit: number }>();
      client.set("limit", 100, {
        overrides: [
          {
            name: "premium-override",
            conditions: [{ operator: "in", property: "plan", value: ["pro", "enterprise"] }],
            value: 1000,
          },
        ],
      });

      expect(client.get("limit")).toBe(100);
      expect(client.get("limit", { context: { plan: "free" } })).toBe(100);
      expect(client.get("limit", { context: { plan: "pro" } })).toBe(1000);
      expect(client.get("limit", { context: { plan: "enterprise" } })).toBe(1000);
    });

    it("uses client-level context for evaluation", () => {
      const client = new InMemoryReplane<{ feature: boolean }>({
        context: { env: "prod" },
      });
      client.set("feature", false, {
        overrides: [
          {
            name: "prod-override",
            conditions: [{ operator: "equals", property: "env", value: "prod" }],
            value: true,
          },
        ],
      });

      expect(client.get("feature")).toBe(true);
    });

    it("merges per-call context with client context", () => {
      const client = new InMemoryReplane<{ feature: boolean }>({
        context: { env: "prod" },
      });
      client.set("feature", false, {
        overrides: [
          {
            name: "beta-prod-override",
            conditions: [
              { operator: "equals", property: "env", value: "prod" },
              { operator: "equals", property: "beta", value: true },
            ],
            value: true,
          },
        ],
      });

      expect(client.get("feature")).toBe(false);
      expect(client.get("feature", { context: { beta: true } })).toBe(true);
    });
  });

  describe("delete", () => {
    it("deletes existing config", () => {
      const client = new InMemoryReplane({
        defaults: { feature: true },
      });
      expect(client.has("feature")).toBe(true);
      const deleted = client.delete("feature");
      expect(deleted).toBe(true);
      expect(client.has("feature")).toBe(false);
    });

    it("returns false for non-existent config", () => {
      const client = new InMemoryReplane();
      const deleted = client.delete("missing");
      expect(deleted).toBe(false);
    });
  });

  describe("clear", () => {
    it("removes all configs", () => {
      const client = new InMemoryReplane({
        defaults: { a: 1, b: 2, c: 3 },
      });
      expect(client.keys().length).toBe(3);
      client.clear();
      expect(client.keys().length).toBe(0);
    });
  });

  describe("has", () => {
    it("returns true for existing config", () => {
      const client = new InMemoryReplane({
        defaults: { feature: true },
      });
      expect(client.has("feature")).toBe(true);
    });

    it("returns false for missing config", () => {
      const client = new InMemoryReplane();
      expect(client.has("missing")).toBe(false);
    });
  });

  describe("keys", () => {
    it("returns all config names", () => {
      const client = new InMemoryReplane({
        defaults: { a: 1, b: 2, c: 3 },
      });
      expect(client.keys().sort()).toEqual(["a", "b", "c"]);
    });
  });

  describe("subscribe", () => {
    it("calls callback when config is set", () => {
      const client = new InMemoryReplane<{ feature: boolean }>();
      const callback = vi.fn();

      client.subscribe("feature", callback);
      client.set("feature", true);

      expect(callback).toHaveBeenCalledWith({ name: "feature", value: true });
    });

    it("calls callback on each update", () => {
      const client = new InMemoryReplane<{ count: number }>();
      const callback = vi.fn();

      client.subscribe("count", callback);
      client.set("count", 1);
      client.set("count", 2);
      client.set("count", 3);

      expect(callback).toHaveBeenCalledTimes(3);
      expect(callback).toHaveBeenLastCalledWith({ name: "count", value: 3 });
    });

    it("unsubscribes correctly", () => {
      const client = new InMemoryReplane<{ feature: boolean }>();
      const callback = vi.fn();

      const unsubscribe = client.subscribe("feature", callback);
      client.set("feature", true);
      unsubscribe();
      client.set("feature", false);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("handles multiple subscribers", () => {
      const client = new InMemoryReplane<{ feature: boolean }>();
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      client.subscribe("feature", callback1);
      client.subscribe("feature", callback2);
      client.set("feature", true);

      expect(callback1).toHaveBeenCalledWith({ name: "feature", value: true });
      expect(callback2).toHaveBeenCalledWith({ name: "feature", value: true });
    });
  });

  describe("getSnapshot", () => {
    it("returns snapshot of current state", () => {
      const client = new InMemoryReplane({
        defaults: { feature: true, limit: 100 },
      });

      const snapshot = client.getSnapshot();

      expect(snapshot.configs).toHaveLength(2);
      expect(snapshot.configs.find((c) => c.name === "feature")?.value).toBe(true);
      expect(snapshot.configs.find((c) => c.name === "limit")?.value).toBe(100);
    });

    it("includes overrides in snapshot", () => {
      const client = new InMemoryReplane<{ feature: boolean }>();
      client.set("feature", false, {
        overrides: [
          {
            name: "beta",
            conditions: [{ operator: "equals", property: "plan", value: "beta" }],
            value: true,
          },
        ],
      });

      const snapshot = client.getSnapshot();
      const config = snapshot.configs.find((c) => c.name === "feature");

      expect(config?.overrides).toHaveLength(1);
      expect(config?.overrides[0].name).toBe("beta");
      expect(config?.overrides[0].value).toBe(true);
    });
  });
});

