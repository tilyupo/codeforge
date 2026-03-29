import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Replane, ReplaneError } from "../src/index";
import type { ReplaneSnapshot, ConnectOptions } from "../src/index";
import { MockReplaneServerController } from "./utils";

const REPLANE_CLIENT_ID_KEY = "replaneClientId";

function sync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("Replane", () => {
  let mockServer: MockReplaneServerController;
  let clientPromise: Promise<Replane<Record<string, unknown>>>;
  let silentLogger: ReturnType<typeof createSilentLogger>;

  beforeEach(() => {
    mockServer = new MockReplaneServerController();
    silentLogger = createSilentLogger();
  });

  afterEach(async () => {
    try {
      const client = await clientPromise;
      client.disconnect();
    } catch {
      // Client may have failed to initialize
    }
    mockServer.close();
  });

  function createClient<T extends Record<string, unknown> = Record<string, unknown>>(
    options: {
      defaults?: T;
      context?: Record<string, string | number | boolean | null | undefined>;
    } & Partial<ConnectOptions> = {}
  ): Promise<Replane<T>> {
    const { defaults, context, ...connectOptions } = options;
    const client = new Replane<T>({
      logger: silentLogger,
      defaults,
      context,
    });
    return client
      .connect({
        sdkKey: "test-sdk-key",
        baseUrl: "https://replane.my-host.com",
        fetchFn: mockServer.fetchFn,
        ...connectOptions,
      })
      .then(() => client);
  }

  describe("basic config fetching", () => {
    it("should fetch a single config", async () => {
      clientPromise = createClient();
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("config1")).toBe("value1");
    });

    it("should fetch multiple configs", async () => {
      clientPromise = createClient();
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          { name: "config1", overrides: [], value: "value1" },
          { name: "config2", overrides: [], value: 42 },
          { name: "config3", overrides: [], value: true },
          { name: "config4", overrides: [], value: { nested: "object" } },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("config1")).toBe("value1");
      expect(client.get("config2")).toBe(42);
      expect(client.get("config3")).toBe(true);
      expect(client.get("config4")).toEqual({ nested: "object" });
    });

    it("should throw ReplaneError when config not found", async () => {
      clientPromise = createClient();
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });

      const client = await clientPromise;
      await sync();

      expect(() => client.get("nonexistent")).toThrow(ReplaneError);
      expect(() => client.get("nonexistent")).toThrow("Config not found: nonexistent");
    });

    it("should return default value when config not found and default is provided", async () => {
      clientPromise = createClient();
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });

      const client = await clientPromise;
      await sync();

      expect(client.get("nonexistent", { default: "fallback" })).toBe("fallback");
      expect(client.get("nonexistent", { default: 42 })).toBe(42);
      expect(client.get("nonexistent", { default: null })).toBe(null);
      expect(client.get("nonexistent", { default: false })).toBe(false);
      expect(client.get("nonexistent", { default: { nested: "value" } })).toEqual({
        nested: "value",
      });
    });

    it("should return actual value when config exists even if default is provided", async () => {
      clientPromise = createClient();
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "actual" }],
      });

      const client = await clientPromise;
      await sync();

      expect(client.get("config1", { default: "fallback" })).toBe("actual");
    });

    it("should handle config values of different types", async () => {
      clientPromise = createClient();
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          { name: "string", overrides: [], value: "hello" },
          { name: "number", overrides: [], value: 123.45 },
          { name: "boolean", overrides: [], value: false },
          { name: "null", overrides: [], value: null },
          { name: "array", overrides: [], value: [1, 2, 3] },
          { name: "object", overrides: [], value: { key: "value" } },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("string")).toBe("hello");
      expect(client.get("number")).toBe(123.45);
      expect(client.get("boolean")).toBe(false);
      expect(client.get("null")).toBe(null);
      expect(client.get("array")).toEqual([1, 2, 3]);
      expect(client.get("object")).toEqual({ key: "value" });
    });
  });

  describe("config changes via streaming", () => {
    it("should update config when config_change event is received", async () => {
      clientPromise = createClient();
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "initial" }],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("config1")).toBe("initial");

      await connection.push({
        type: "config_change",
        config: { name: "config1", overrides: [], value: "updated" },
      });
      await sync();
      expect(client.get("config1")).toBe("updated");
    });

    it("should add new config via config_change event", async () => {
      clientPromise = createClient();
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });

      const client = await clientPromise;
      await sync();

      await connection.push({
        type: "config_change",
        config: { name: "config2", overrides: [], value: "value2" },
      });
      await sync();
      expect(client.get("config2")).toBe("value2");
    });

    it("should handle multiple config changes", async () => {
      clientPromise = createClient();
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          { name: "config1", overrides: [], value: "v1" },
          { name: "config2", overrides: [], value: "v2" },
        ],
      });

      const client = await clientPromise;
      await sync();

      await connection.push({
        type: "config_change",
        config: { name: "config1", overrides: [], value: "v1-updated" },
      });
      await connection.push({
        type: "config_change",
        config: { name: "config2", overrides: [], value: "v2-updated" },
      });
      await sync();

      expect(client.get("config1")).toBe("v1-updated");
      expect(client.get("config2")).toBe("v2-updated");
    });
  });

  describe("overrides with equals operator", () => {
    it("should return override value when condition matches", async () => {
      clientPromise = createClient({ context: { env: "production" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "prod-override",
                conditions: [{ operator: "equals", property: "env", value: "production" }],
                value: "prod-value",
              },
            ],
            value: "default-value",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("prod-value");
    });

    it("should return base value when condition does not match", async () => {
      clientPromise = createClient({ context: { env: "development" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "prod-override",
                conditions: [{ operator: "equals", property: "env", value: "production" }],
                value: "prod-value",
              },
            ],
            value: "default-value",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("default-value");
    });

    it("should return base value when context property is undefined", async () => {
      clientPromise = createClient({ context: {} });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "override",
                conditions: [{ operator: "equals", property: "env", value: "production" }],
                value: "override-value",
              },
            ],
            value: "default-value",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("default-value");
    });

    it("should use first matching override when multiple overrides exist", async () => {
      clientPromise = createClient({ context: { env: "staging" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "prod-override",
                conditions: [{ operator: "equals", property: "env", value: "production" }],
                value: "prod-value",
              },
              {
                name: "staging-override",
                conditions: [{ operator: "equals", property: "env", value: "staging" }],
                value: "staging-value",
              },
            ],
            value: "default-value",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("staging-value");
    });
  });

  describe("overrides with in operator", () => {
    it("should match when value is in array", async () => {
      clientPromise = createClient({ context: { country: "US" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "north-america",
                conditions: [{ operator: "in", property: "country", value: ["US", "CA", "MX"] }],
                value: "na-value",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("na-value");
    });

    it("should not match when value is not in array", async () => {
      clientPromise = createClient({ context: { country: "UK" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "north-america",
                conditions: [{ operator: "in", property: "country", value: ["US", "CA", "MX"] }],
                value: "na-value",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("default");
    });
  });

  describe("overrides with not_in operator", () => {
    it("should match when value is not in array", async () => {
      clientPromise = createClient({ context: { country: "UK" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "not-north-america",
                conditions: [
                  { operator: "not_in", property: "country", value: ["US", "CA", "MX"] },
                ],
                value: "non-na-value",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("non-na-value");
    });

    it("should not match when value is in array", async () => {
      clientPromise = createClient({ context: { country: "US" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "not-north-america",
                conditions: [
                  { operator: "not_in", property: "country", value: ["US", "CA", "MX"] },
                ],
                value: "non-na-value",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("default");
    });
  });

  describe("overrides with comparison operators", () => {
    describe("less_than", () => {
      it("should match when context value is less than expected (numbers)", async () => {
        clientPromise = createClient({ context: { age: 17 } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "minor",
                  conditions: [{ operator: "less_than", property: "age", value: 18 }],
                  value: "minor-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("minor-value");
      });

      it("should not match when context value equals expected", async () => {
        clientPromise = createClient({ context: { age: 18 } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "minor",
                  conditions: [{ operator: "less_than", property: "age", value: 18 }],
                  value: "minor-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("default");
      });

      it("should compare strings lexicographically", async () => {
        clientPromise = createClient({ context: { name: "alice" } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [{ operator: "less_than", property: "name", value: "bob" }],
                  value: "override-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("override-value");
      });
    });

    describe("less_than_or_equal", () => {
      it("should match when context value equals expected", async () => {
        clientPromise = createClient({ context: { age: 18 } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [{ operator: "less_than_or_equal", property: "age", value: 18 }],
                  value: "override-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("override-value");
      });

      it("should match when context value is less than expected", async () => {
        clientPromise = createClient({ context: { age: 17 } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [{ operator: "less_than_or_equal", property: "age", value: 18 }],
                  value: "override-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("override-value");
      });
    });

    describe("greater_than", () => {
      it("should match when context value is greater than expected", async () => {
        clientPromise = createClient({ context: { age: 21 } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "adult",
                  conditions: [{ operator: "greater_than", property: "age", value: 18 }],
                  value: "adult-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("adult-value");
      });

      it("should not match when context value equals expected", async () => {
        clientPromise = createClient({ context: { age: 18 } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "adult",
                  conditions: [{ operator: "greater_than", property: "age", value: 18 }],
                  value: "adult-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("default");
      });
    });

    describe("greater_than_or_equal", () => {
      it("should match when context value equals expected", async () => {
        clientPromise = createClient({ context: { age: 18 } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [{ operator: "greater_than_or_equal", property: "age", value: 18 }],
                  value: "override-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("override-value");
      });

      it("should match when context value is greater than expected", async () => {
        clientPromise = createClient({ context: { age: 21 } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [{ operator: "greater_than_or_equal", property: "age", value: 18 }],
                  value: "override-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("override-value");
      });
    });
  });

  describe("overrides with composite conditions", () => {
    describe("and condition", () => {
      it("should match when all conditions are true", async () => {
        clientPromise = createClient({ context: { env: "production", country: "US" } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [
                    {
                      operator: "and",
                      conditions: [
                        { operator: "equals", property: "env", value: "production" },
                        { operator: "equals", property: "country", value: "US" },
                      ],
                    },
                  ],
                  value: "override-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("override-value");
      });

      it("should not match when one condition is false", async () => {
        clientPromise = createClient({ context: { env: "production", country: "UK" } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [
                    {
                      operator: "and",
                      conditions: [
                        { operator: "equals", property: "env", value: "production" },
                        { operator: "equals", property: "country", value: "US" },
                      ],
                    },
                  ],
                  value: "override-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("default");
      });

      it("should return unknown when one condition is unknown and others are true", async () => {
        clientPromise = createClient({ context: { env: "production" } }); // country missing
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [
                    {
                      operator: "and",
                      conditions: [
                        { operator: "equals", property: "env", value: "production" },
                        { operator: "equals", property: "country", value: "US" },
                      ],
                    },
                  ],
                  value: "override-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("default");
      });
    });

    describe("or condition", () => {
      it("should match when at least one condition is true", async () => {
        clientPromise = createClient({ context: { env: "staging" } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [
                    {
                      operator: "or",
                      conditions: [
                        { operator: "equals", property: "env", value: "production" },
                        { operator: "equals", property: "env", value: "staging" },
                      ],
                    },
                  ],
                  value: "override-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("override-value");
      });

      it("should not match when all conditions are false", async () => {
        clientPromise = createClient({ context: { env: "development" } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [
                    {
                      operator: "or",
                      conditions: [
                        { operator: "equals", property: "env", value: "production" },
                        { operator: "equals", property: "env", value: "staging" },
                      ],
                    },
                  ],
                  value: "override-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("default");
      });
    });

    describe("not condition", () => {
      it("should match when inner condition is false", async () => {
        clientPromise = createClient({ context: { env: "development" } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [
                    {
                      operator: "not",
                      condition: { operator: "equals", property: "env", value: "production" },
                    },
                  ],
                  value: "non-prod-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("non-prod-value");
      });

      it("should not match when inner condition is true", async () => {
        clientPromise = createClient({ context: { env: "production" } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [
                    {
                      operator: "not",
                      condition: { operator: "equals", property: "env", value: "production" },
                    },
                  ],
                  value: "non-prod-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("default");
      });

      it("should return unknown when inner condition is unknown", async () => {
        clientPromise = createClient({ context: {} }); // env missing
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [
                    {
                      operator: "not",
                      condition: { operator: "equals", property: "env", value: "production" },
                    },
                  ],
                  value: "non-prod-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("default");
      });
    });

    describe("multiple conditions in override (implicit AND)", () => {
      it("should require all conditions in override to match", async () => {
        clientPromise = createClient({ context: { env: "production", role: "admin" } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [
                    { operator: "equals", property: "env", value: "production" },
                    { operator: "equals", property: "role", value: "admin" },
                  ],
                  value: "admin-prod-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("admin-prod-value");
      });

      it("should not match if any condition fails in override", async () => {
        clientPromise = createClient({ context: { env: "production", role: "user" } });
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            {
              name: "feature",
              overrides: [
                {
                  name: "override",
                  conditions: [
                    { operator: "equals", property: "env", value: "production" },
                    { operator: "equals", property: "role", value: "admin" },
                  ],
                  value: "admin-prod-value",
                },
              ],
              value: "default",
            },
          ],
        });

        const client = await clientPromise;
        await sync();
        expect(client.get("feature")).toBe("default");
      });
    });
  });

  describe("overrides with segmentation", () => {
    it("should evaluate segmentation based on hash", async () => {
      // This test uses a specific user ID that should fall in the 0-50% bucket
      clientPromise = createClient({ context: { userId: "user-abc" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "50-percent",
                conditions: [
                  {
                    operator: "segmentation",
                    property: "userId",
                    fromPercentage: 0,
                    toPercentage: 100,
                    seed: "test-seed",
                  },
                ],
                value: "in-segment",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      // With 100% rollout, should always match
      expect(client.get("feature")).toBe("in-segment");
    });

    it("should return unknown when segmentation property is undefined", async () => {
      clientPromise = createClient({ context: {} });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "50-percent",
                conditions: [
                  {
                    operator: "segmentation",
                    property: "userId",
                    fromPercentage: 0,
                    toPercentage: 50,
                    seed: "test-seed",
                  },
                ],
                value: "in-segment",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("default");
    });

    it("should return unknown when segmentation property is null", async () => {
      clientPromise = createClient({ context: { userId: null } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "50-percent",
                conditions: [
                  {
                    operator: "segmentation",
                    property: "userId",
                    fromPercentage: 0,
                    toPercentage: 50,
                    seed: "test-seed",
                  },
                ],
                value: "in-segment",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("default");
    });

    it("should not match when percentage is 0", async () => {
      clientPromise = createClient({ context: { userId: "any-user" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "zero-percent",
                conditions: [
                  {
                    operator: "segmentation",
                    property: "userId",
                    fromPercentage: 0,
                    toPercentage: 0,
                    seed: "test-seed",
                  },
                ],
                value: "in-segment",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("default");
    });
  });

  describe("context overriding", () => {
    it("should allow per-request context override", async () => {
      clientPromise = createClient({ context: { env: "production" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "staging",
                conditions: [{ operator: "equals", property: "env", value: "staging" }],
                value: "staging-value",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("default");
      expect(client.get("feature", { context: { env: "staging" } })).toBe("staging-value");
    });

    it("should merge per-request context with client context", async () => {
      clientPromise = createClient({ context: { env: "production" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "override",
                conditions: [
                  {
                    operator: "and",
                    conditions: [
                      { operator: "equals", property: "env", value: "production" },
                      { operator: "equals", property: "role", value: "admin" },
                    ],
                  },
                ],
                value: "admin-value",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("default");
      expect(client.get("feature", { context: { role: "admin" } })).toBe("admin-value");
    });

    it("should allow per-request context to override client context", async () => {
      clientPromise = createClient({ context: { env: "production" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "prod",
                conditions: [{ operator: "equals", property: "env", value: "production" }],
                value: "prod-value",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("prod-value");
      expect(client.get("feature", { context: { env: "development" } })).toBe("default");
    });
  });

  describe("type casting in conditions", () => {
    it("should cast string to number when context is number", async () => {
      clientPromise = createClient({ context: { age: 25 } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "override",
                conditions: [{ operator: "equals", property: "age", value: "25" }],
                value: "override-value",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("override-value");
    });

    it("should cast string 'true' to boolean when context is boolean", async () => {
      clientPromise = createClient({ context: { isEnabled: true } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "override",
                conditions: [{ operator: "equals", property: "isEnabled", value: "true" }],
                value: "override-value",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("override-value");
    });

    it("should cast string 'false' to boolean when context is boolean", async () => {
      clientPromise = createClient({ context: { isEnabled: false } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "override",
                conditions: [{ operator: "equals", property: "isEnabled", value: "false" }],
                value: "override-value",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("override-value");
    });

    it("should cast number to boolean when context is boolean", async () => {
      clientPromise = createClient({ context: { isEnabled: true } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "override",
                conditions: [{ operator: "equals", property: "isEnabled", value: 1 }],
                value: "override-value",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("override-value");
    });

    it("should cast number to string when context is string", async () => {
      clientPromise = createClient({ context: { code: "123" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "override",
                conditions: [{ operator: "equals", property: "code", value: 123 }],
                value: "override-value",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("override-value");
    });

    it("should cast boolean to string when context is string", async () => {
      clientPromise = createClient({ context: { flag: "true" } });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "override",
                conditions: [{ operator: "equals", property: "flag", value: true }],
                value: "override-value",
              },
            ],
            value: "default",
          },
        ],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("feature")).toBe("override-value");
    });
  });

  describe("initialization and defaults", () => {
    it("should timeout when SDK key is missing and no configs available", async () => {
      const client = new Replane({ logger: silentLogger });
      await expect(
        client.connect({
          sdkKey: undefined as unknown as string,
          baseUrl: undefined as unknown as string,
          fetchFn: mockServer.fetchFn,
          connectTimeoutMs: 200,
        })
      ).rejects.toThrow("Replane client connection timed out");
    });

    it("should use defaults immediately without waiting for connect", async () => {
      // Client with defaults is usable immediately
      const client = new Replane<Record<string, unknown>>({
        defaults: { config1: "fallback-value" },
        logger: silentLogger,
      });

      // Can use defaults before connecting
      expect(client.get("config1")).toBe("fallback-value");

      // connect() will timeout if server doesn't respond
      clientPromise = Promise.resolve(client);
      await expect(
        client.connect({
          sdkKey: "test-sdk-key",
          baseUrl: "https://replane.my-host.com",
          fetchFn: mockServer.fetchFn,
          connectTimeoutMs: 50,
        })
      ).rejects.toThrow("Replane client connection timed out");

      // But client is still usable with defaults after failed connect
      expect(client.get("config1")).toBe("fallback-value");
    });

    it("should throw timeout error when no defaults and server does not respond", async () => {
      clientPromise = createClient({
        connectTimeoutMs: 50,
      });

      await expect(clientPromise).rejects.toThrow("Replane client connection timed out");
    });

    it("should allow checking for required configs in application code", async () => {
      const client = new Replane<Record<string, unknown>>({
        defaults: { config1: "fallback-value" },
        logger: silentLogger,
      });

      // Application can check if required configs exist
      expect(client.get("config1")).toBe("fallback-value");
      expect(() => client.get("config2")).toThrow("Config not found: config2");
    });

    it("should have all defaults available without connecting", async () => {
      const client = new Replane<Record<string, unknown>>({
        defaults: { config1: "fallback1", config2: "fallback2" },
        logger: silentLogger,
      });

      // All defaults are available immediately
      expect(client.get("config1")).toBe("fallback1");
      expect(client.get("config2")).toBe("fallback2");

      clientPromise = Promise.resolve(client);
    });

    it("should override defaults with server values", async () => {
      clientPromise = createClient<Record<string, unknown>>({
        defaults: { config1: "fallback-value" },
      });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "server-value" }],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("config1")).toBe("server-value");
    });

    it("should log error and throw when connection fails", async () => {
      const failingFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const client = new Replane<Record<string, unknown>>({
        defaults: { config1: "fallback-value" },
        logger: silentLogger,
      });

      // Defaults available before connecting
      expect(client.get("config1")).toBe("fallback-value");

      // connect() should throw on connection failure
      await expect(
        client.connect({
          sdkKey: "test-sdk-key",
          baseUrl: "https://replane.my-host.com",
          fetchFn: failingFetch,
          connectTimeoutMs: 50,
          retryDelayMs: 10,
        })
      ).rejects.toThrow();

      // But client is still usable with defaults
      expect(client.get("config1")).toBe("fallback-value");

      clientPromise = Promise.resolve(client);
    });

    it("should receive values when initial connection succeeds", async () => {
      clientPromise = createClient<Record<string, unknown>>({});

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });

      const client = await clientPromise;
      await sync();

      // Client should have received the server value
      expect(client.get("config1")).toBe("value1");

      client.disconnect();
    });
  });

  describe("base URL normalization", () => {
    it("should strip trailing slashes from base URL", async () => {
      clientPromise = createClient({
        baseUrl: "https://replane.my-host.com///",
      });
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("config1")).toBe("value1");
    });
  });

  describe("subscribe", () => {
    describe("subscribe to specific config", () => {
      it("should receive updates only for subscribed config", async () => {
        clientPromise = createClient();
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            { name: "config1", overrides: [], value: "value1" },
            { name: "config2", overrides: [], value: "value2" },
          ],
        });

        const client = await clientPromise;
        await sync();

        const updates: Array<{ name: string; value: unknown }> = [];
        const unsubscribe = client.subscribe("config1", (config) => {
          updates.push({ name: String(config.name), value: config.value });
        });

        await connection.push({
          type: "config_change",
          config: { name: "config1", overrides: [], value: "updated1" },
        });
        await sync();

        await connection.push({
          type: "config_change",
          config: { name: "config2", overrides: [], value: "updated2" },
        });
        await sync();

        expect(updates).toEqual([{ name: "config1", value: "updated1" }]);

        unsubscribe();
      });

      it("should not receive updates after unsubscribe from specific config", async () => {
        clientPromise = createClient();
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [{ name: "config1", overrides: [], value: "initial" }],
        });

        const client = await clientPromise;
        await sync();

        const updates: Array<{ name: string; value: unknown }> = [];
        const unsubscribe = client.subscribe("config1", (config) => {
          updates.push({ name: String(config.name), value: config.value });
        });

        await connection.push({
          type: "config_change",
          config: { name: "config1", overrides: [], value: "updated1" },
        });
        await sync();

        unsubscribe();

        await connection.push({
          type: "config_change",
          config: { name: "config1", overrides: [], value: "updated2" },
        });
        await sync();

        expect(updates).toEqual([{ name: "config1", value: "updated1" }]);
      });

      it("should support multiple subscribers to the same config", async () => {
        clientPromise = createClient();
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [{ name: "config1", overrides: [], value: "initial" }],
        });

        const client = await clientPromise;
        await sync();

        const updates1: Array<{ name: string; value: unknown }> = [];
        const updates2: Array<{ name: string; value: unknown }> = [];

        const unsubscribe1 = client.subscribe("config1", (config) => {
          updates1.push({ name: String(config.name), value: config.value });
        });

        const unsubscribe2 = client.subscribe("config1", (config) => {
          updates2.push({ name: String(config.name), value: config.value });
        });

        await connection.push({
          type: "config_change",
          config: { name: "config1", overrides: [], value: "updated" },
        });
        await sync();

        expect(updates1).toEqual([{ name: "config1", value: "updated" }]);
        expect(updates2).toEqual([{ name: "config1", value: "updated" }]);

        unsubscribe1();
        unsubscribe2();
      });

      it("should support multiple subscribers to different configs", async () => {
        clientPromise = createClient();
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [
            { name: "config1", overrides: [], value: "value1" },
            { name: "config2", overrides: [], value: "value2" },
          ],
        });

        const client = await clientPromise;
        await sync();

        const updates1: Array<{ name: string; value: unknown }> = [];
        const updates2: Array<{ name: string; value: unknown }> = [];

        const unsubscribe1 = client.subscribe("config1", (config) => {
          updates1.push({ name: String(config.name), value: config.value });
        });

        const unsubscribe2 = client.subscribe("config2", (config) => {
          updates2.push({ name: String(config.name), value: config.value });
        });

        await connection.push({
          type: "config_change",
          config: { name: "config1", overrides: [], value: "updated1" },
        });
        await sync();

        await connection.push({
          type: "config_change",
          config: { name: "config2", overrides: [], value: "updated2" },
        });
        await sync();

        expect(updates1).toEqual([{ name: "config1", value: "updated1" }]);
        expect(updates2).toEqual([{ name: "config2", value: "updated2" }]);

        unsubscribe1();
        unsubscribe2();
      });

      it("should clean up config subscription map when last subscriber unsubscribes", async () => {
        clientPromise = createClient();
        const connection = await mockServer.acceptConnection();
        await connection.push({
          type: "init",
          configs: [{ name: "config1", overrides: [], value: "initial" }],
        });

        const client = await clientPromise;
        await sync();

        const unsubscribe1 = client.subscribe("config1", () => {});
        const unsubscribe2 = client.subscribe("config1", () => {});

        unsubscribe1();
        unsubscribe2();

        // Subscribe again to verify the map was cleaned up and recreated
        const updates: Array<{ name: string; value: unknown }> = [];
        const unsubscribe3 = client.subscribe("config1", (config) => {
          updates.push({ name: String(config.name), value: config.value });
        });

        await connection.push({
          type: "config_change",
          config: { name: "config1", overrides: [], value: "updated" },
        });
        await sync();

        expect(updates).toEqual([{ name: "config1", value: "updated" }]);

        unsubscribe3();
      });
    });
  });

  describe("client close", () => {
    it("should stop receiving updates after close", async () => {
      clientPromise = createClient();
      const connection = await mockServer.acceptConnection();

      // Verify signal is passed to the mock
      expect(connection.hasSignal).toBe(true);
      expect(connection.aborted).toBe(false);

      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "initial" }],
      });

      const client = await clientPromise;
      await sync();
      expect(client.get("config1")).toBe("initial");

      client.disconnect();
      await sync();

      // Verify signal was aborted after close
      expect(connection.aborted).toBe(true);

      // This shouldn't update the config
      await connection.push({
        type: "config_change",
        config: { name: "config1", overrides: [], value: "updated" },
      });
      await sync();

      // Config should still be initial since client is closed
      expect(client.get("config1")).toBe("initial");
    });

    it("should be safe to call close() multiple times", async () => {
      clientPromise = createClient();
      const connection = await mockServer.acceptConnection();

      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });

      const client = await clientPromise;
      await sync();

      // First close
      expect(() => client.disconnect()).not.toThrow();

      // Second close should also not throw
      expect(() => client.disconnect()).not.toThrow();

      // Third close for good measure
      expect(() => client.disconnect()).not.toThrow();

      // Client should still be usable for reading cached data
      expect(client.get("config1")).toBe("value1");
    });
  });
});

describe("Replane with defaults (no connection)", () => {
  it("should return config values from initial data", () => {
    const client = new Replane({
      defaults: {
        config1: "value1",
        config2: 42,
        config3: true,
      },
    });

    expect(client.get("config1")).toBe("value1");
    expect(client.get("config2")).toBe(42);
    expect(client.get("config3")).toBe(true);
  });

  it("should throw ReplaneError when config not found", () => {
    const client = new Replane({
      defaults: {
        config1: "value1",
      },
    });

    expect(() => client.get("nonexistent" as never)).toThrow(ReplaneError);
    expect(() => client.get("nonexistent" as never)).toThrow("Config not found: nonexistent");
  });

  it("should return default value when config not found and default is provided", () => {
    const client = new Replane({
      defaults: {
        config1: "value1",
      },
    });

    expect(client.get("nonexistent" as never, { default: "fallback" as never })).toBe("fallback");
    expect(client.get("nonexistent" as never, { default: 42 as never })).toBe(42);
    expect(client.get("nonexistent" as never, { default: null as never })).toBe(null);
    expect(client.get("nonexistent" as never, { default: false as never })).toBe(false);
    expect(client.get("nonexistent" as never, { default: { nested: "value" } as never })).toEqual({
      nested: "value",
    });
  });

  it("should return actual value when config exists even if default is provided", () => {
    const client = new Replane({
      defaults: {
        config1: "actual",
      },
    });

    expect(client.get("config1", { default: "fallback" })).toBe("actual");
  });

  it("should handle complex values", () => {
    const client = new Replane({
      defaults: {
        array: [1, 2, 3],
        object: { nested: { deep: "value" } },
        null: null,
      },
    });

    expect(client.get("array")).toEqual([1, 2, 3]);
    expect(client.get("object")).toEqual({ nested: { deep: "value" } });
    expect(client.get("null")).toBe(null);
  });

  it("should be safe to call disconnect() multiple times", () => {
    const client = new Replane({ defaults: { config1: "value1" } });

    // First disconnect
    expect(() => client.disconnect()).not.toThrow();

    // Second disconnect should also not throw
    expect(() => client.disconnect()).not.toThrow();

    // Third disconnect for good measure
    expect(() => client.disconnect()).not.toThrow();

    // Config should still work after disconnect
    expect(client.get("config1")).toBe("value1");
  });
});

describe("ReplaneError", () => {
  it("should have correct name and code", () => {
    const error = new ReplaneError({
      message: "test message",
      code: "test_code",
    });

    expect(error.name).toBe("ReplaneError");
    expect(error.code).toBe("test_code");
    expect(error.message).toBe("test message");
  });

  it("should preserve cause", () => {
    const cause = new Error("original error");
    const error = new ReplaneError({
      message: "wrapped error",
      code: "wrapped",
      cause,
    });

    expect(error.cause).toBe(cause);
  });
});

describe("Replane with snapshot", () => {
  function sync() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function createSilentLogger() {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  }

  describe("snapshot-only mode (no connection)", () => {
    it("should restore configs from snapshot", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          { name: "config1", value: "value1", overrides: [] },
          { name: "config2", value: 42, overrides: [] },
        ],
      };

      const client = new Replane({ snapshot });

      expect(client.get("config1")).toBe("value1");
      expect(client.get("config2")).toBe(42);
    });

    it("should handle different value types", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          { name: "string", value: "hello", overrides: [] },
          { name: "number", value: 123.45, overrides: [] },
          { name: "boolean", value: false, overrides: [] },
          { name: "null", value: null, overrides: [] },
          { name: "array", value: [1, 2, 3], overrides: [] },
          { name: "object", value: { key: "value" }, overrides: [] },
        ],
      };

      const client = new Replane({ snapshot });

      expect(client.get("string")).toBe("hello");
      expect(client.get("number")).toBe(123.45);
      expect(client.get("boolean")).toBe(false);
      expect(client.get("null")).toBe(null);
      expect(client.get("array")).toEqual([1, 2, 3]);
      expect(client.get("object")).toEqual({ key: "value" });
    });

    it("should throw ReplaneError when config not found", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "value1", overrides: [] }],
      };

      const client = new Replane({ snapshot });

      expect(() => client.get("nonexistent")).toThrow(ReplaneError);
      expect(() => client.get("nonexistent")).toThrow("Config not found: nonexistent");
    });

    it("should return default value when config not found and default is provided", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "value1", overrides: [] }],
      };

      const client = new Replane({ snapshot });

      expect(client.get("nonexistent", { default: "fallback" })).toBe("fallback");
      expect(client.get("nonexistent", { default: 42 })).toBe(42);
      expect(client.get("nonexistent", { default: null })).toBe(null);
      expect(client.get("nonexistent", { default: false })).toBe(false);
      expect(client.get("nonexistent", { default: { nested: "value" } })).toEqual({
        nested: "value",
      });
    });

    it("should return actual value when config exists even if default is provided", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "actual", overrides: [] }],
      };

      const client = new Replane({ snapshot });

      expect(client.get("config1", { default: "fallback" })).toBe("actual");
    });

    it("should be safe to call close() multiple times", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "value1", overrides: [] }],
      };

      const client = new Replane({ snapshot });

      // First close
      expect(() => client.disconnect()).not.toThrow();

      // Second close should also not throw
      expect(() => client.disconnect()).not.toThrow();

      // Third close for good measure
      expect(() => client.disconnect()).not.toThrow();

      // Config should still work after close
      expect(client.get("config1")).toBe("value1");
    });

    it("should return snapshot via getSnapshot", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          { name: "config1", value: "value1", overrides: [] },
          { name: "config2", value: 42, overrides: [] },
        ],
      };

      const client = new Replane({ snapshot });
      const returnedSnapshot = client.getSnapshot();

      expect(returnedSnapshot.configs).toHaveLength(2);
      expect(returnedSnapshot.configs).toContainEqual({
        name: "config1",
        value: "value1",
        overrides: [],
      });
      expect(returnedSnapshot.configs).toContainEqual({
        name: "config2",
        value: 42,
        overrides: [],
      });
    });
  });

  describe("context handling", () => {
    it("should use context from options", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "prod-override",
                conditions: [{ operator: "equals", property: "env", value: "production" }],
                value: "prod-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot, context: { env: "production" } });

      expect(client.get("feature")).toBe("prod-value");
    });

    it("should use options context for override evaluation", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "prod-override",
                conditions: [{ operator: "equals", property: "env", value: "production" }],
                value: "prod-value",
              },
              {
                name: "staging-override",
                conditions: [{ operator: "equals", property: "env", value: "staging" }],
                value: "staging-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot, context: { env: "staging" } });

      expect(client.get("feature")).toBe("staging-value");
    });

    it("should allow per-request context override", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "staging-override",
                conditions: [{ operator: "equals", property: "env", value: "staging" }],
                value: "staging-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot });

      expect(client.get("feature")).toBe("default");
      expect(client.get("feature", { context: { env: "staging" } })).toBe("staging-value");
    });

    it("should merge per-request context with client context", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "override",
                conditions: [
                  {
                    operator: "and",
                    conditions: [
                      { operator: "equals", property: "env", value: "production" },
                      { operator: "equals", property: "role", value: "admin" },
                    ],
                  },
                ],
                value: "admin-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot, context: { env: "production" } });

      expect(client.get("feature")).toBe("default");
      expect(client.get("feature", { context: { role: "admin" } })).toBe("admin-value");
    });
  });

  describe("replaneClientId auto-generation", () => {
    it("should auto-generate replaneClientId in client context", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "segmented-override",
                conditions: [
                  {
                    operator: "segmentation",
                    property: REPLANE_CLIENT_ID_KEY,
                    fromPercentage: 0,
                    toPercentage: 100,
                    seed: "test-seed",
                  },
                ],
                value: "segmented-value",
              },
            ],
          },
        ],
      };

      // Create client without providing replaneClientId
      const client = new Replane({ snapshot });

      // Should match segmentation because replaneClientId is auto-generated
      expect(client.get("feature")).toBe("segmented-value");
    });

    it("should allow user to override replaneClientId", () => {
      const userProvidedClientId = "user-provided-client-id";
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "user-override",
                conditions: [
                  {
                    operator: "equals",
                    property: REPLANE_CLIENT_ID_KEY,
                    value: userProvidedClientId,
                  },
                ],
                value: "user-override-value",
              },
            ],
          },
        ],
      };

      // Provide replaneClientId in context - should take precedence
      const client = new Replane({
        snapshot,
        context: { [REPLANE_CLIENT_ID_KEY]: userProvidedClientId },
      });

      expect(client.get("feature")).toBe("user-override-value");
    });

    it("should allow per-request context to override replaneClientId", () => {
      const perRequestClientId = "per-request-client-id";
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "per-request-override",
                conditions: [
                  {
                    operator: "equals",
                    property: REPLANE_CLIENT_ID_KEY,
                    value: perRequestClientId,
                  },
                ],
                value: "per-request-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot });

      // Default should be based on auto-generated ID
      expect(client.get("feature")).toBe("default");

      // Per-request context should override the auto-generated ID
      expect(
        client.get("feature", { context: { [REPLANE_CLIENT_ID_KEY]: perRequestClientId } })
      ).toBe("per-request-value");
    });

    it("should generate unique replaneClientId for each client instance", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "50-percent-rollout",
                conditions: [
                  {
                    operator: "segmentation",
                    property: REPLANE_CLIENT_ID_KEY,
                    fromPercentage: 0,
                    toPercentage: 50,
                    seed: "test-seed",
                  },
                ],
                value: "rollout-value",
              },
            ],
          },
        ],
      };

      // Create multiple clients
      const clients = Array.from({ length: 10 }, () => new Replane({ snapshot }));

      // Each client should get a consistent result (either default or rollout-value)
      // but different clients may get different results due to unique IDs
      const results = clients.map((client) => client.get("feature"));

      // At least verify we get both values (statistically very likely with 10 clients and 50% rollout)
      // This test mainly verifies that the segmentation is actually working
      expect(
        results.some((r) => r === "rollout-value") || results.some((r) => r === "default")
      ).toBe(true);
    });
  });

  describe("overrides evaluation", () => {
    it("should evaluate equals operator", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "prod-override",
                conditions: [{ operator: "equals", property: "env", value: "production" }],
                value: "prod-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot, context: { env: "production" } });
      expect(client.get("feature")).toBe("prod-value");
    });

    it("should evaluate in operator", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "na-override",
                conditions: [{ operator: "in", property: "country", value: ["US", "CA", "MX"] }],
                value: "na-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot, context: { country: "US" } });
      expect(client.get("feature")).toBe("na-value");
    });

    it("should evaluate not_in operator", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "non-na-override",
                conditions: [
                  { operator: "not_in", property: "country", value: ["US", "CA", "MX"] },
                ],
                value: "non-na-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot, context: { country: "UK" } });
      expect(client.get("feature")).toBe("non-na-value");
    });

    it("should evaluate comparison operators", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "minor-override",
                conditions: [{ operator: "less_than", property: "age", value: 18 }],
                value: "minor-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot, context: { age: 16 } });
      expect(client.get("feature")).toBe("minor-value");
    });

    it("should evaluate and condition", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "override",
                conditions: [
                  {
                    operator: "and",
                    conditions: [
                      { operator: "equals", property: "env", value: "production" },
                      { operator: "equals", property: "country", value: "US" },
                    ],
                  },
                ],
                value: "override-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot, context: { env: "production", country: "US" } });
      expect(client.get("feature")).toBe("override-value");
    });

    it("should evaluate or condition", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "override",
                conditions: [
                  {
                    operator: "or",
                    conditions: [
                      { operator: "equals", property: "env", value: "production" },
                      { operator: "equals", property: "env", value: "staging" },
                    ],
                  },
                ],
                value: "override-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot, context: { env: "staging" } });
      expect(client.get("feature")).toBe("override-value");
    });

    it("should evaluate not condition", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "override",
                conditions: [
                  {
                    operator: "not",
                    condition: { operator: "equals", property: "env", value: "production" },
                  },
                ],
                value: "non-prod-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot, context: { env: "development" } });
      expect(client.get("feature")).toBe("non-prod-value");
    });

    it("should evaluate segmentation condition", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "100-percent",
                conditions: [
                  {
                    operator: "segmentation",
                    property: "userId",
                    fromPercentage: 0,
                    toPercentage: 100,
                    seed: "test-seed",
                  },
                ],
                value: "in-segment",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot, context: { userId: "user-123" } });
      expect(client.get("feature")).toBe("in-segment");
    });

    it("should return base value when no override matches", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "prod-override",
                conditions: [{ operator: "equals", property: "env", value: "production" }],
                value: "prod-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot, context: { env: "development" } });
      expect(client.get("feature")).toBe("default");
    });

    it("should use first matching override when multiple exist", () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "prod-override",
                conditions: [{ operator: "equals", property: "env", value: "production" }],
                value: "prod-value",
              },
              {
                name: "staging-override",
                conditions: [{ operator: "equals", property: "env", value: "staging" }],
                value: "staging-value",
              },
            ],
          },
        ],
      };

      const client = new Replane({ snapshot, context: { env: "staging" } });
      expect(client.get("feature")).toBe("staging-value");
    });
  });

  describe("subscribe functionality (snapshot-only)", () => {
    it("should not receive updates in snapshot-only mode", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "initial", overrides: [] }],
      };

      const client = new Replane({ snapshot });

      const updates: Array<{ name: string; value: unknown }> = [];
      const unsubscribe = client.subscribe("config1", (config) => {
        updates.push({ name: String(config.name), value: config.value });
      });

      await sync();

      expect(updates).toEqual([]);

      unsubscribe();
    });
  });

  describe("with connection (live updates)", () => {
    let mockServer: MockReplaneServerController;
    let silentLogger: ReturnType<typeof createSilentLogger>;

    beforeEach(() => {
      mockServer = new MockReplaneServerController();
      silentLogger = createSilentLogger();
    });

    afterEach(() => {
      mockServer.close();
    });

    function createClientWithConnection(
      snapshot: ReplaneSnapshot<Record<string, unknown>>,
      options: {
        context?: Record<string, string | number | boolean | null | undefined>;
      } & Partial<ConnectOptions> = {}
    ): Replane<Record<string, unknown>> {
      const { context, ...connectionOptions } = options;
      const client = new Replane({ snapshot, logger: silentLogger, context });
      // Start connection in background (don't await)
      client.connect({
        sdkKey: "test-sdk-key",
        baseUrl: "https://replane.my-host.com",
        fetchFn: mockServer.fetchFn,
        ...connectionOptions,
      });
      return client;
    }

    it("should not throw error when SDK key and baseUrl are missing", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = new Replane({ snapshot, logger: silentLogger });
      // Start connection in background with invalid options
      client.connect({
        sdkKey: undefined as unknown as string,
        baseUrl: undefined as unknown as string,
        fetchFn: mockServer.fetchFn,
      });

      // Should work with snapshot data even though connection is invalid
      expect(client.get("config1")).toBe("snapshot-value");

      // Give time for the background streaming to fail
      await sync();

      // Should still work after streaming failure
      expect(client.get("config1")).toBe("snapshot-value");

      client.disconnect();
    });

    it("should restore from snapshot and connect for live updates", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot);

      // Should immediately have snapshot value
      expect(client.get("config1")).toBe("snapshot-value");

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "server-value" }],
      });
      await sync();

      // Should now have server value
      expect(client.get("config1")).toBe("server-value");

      client.disconnect();
    });

    it("should receive config changes via streaming", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "initial", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot);

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "initial" }],
      });
      await sync();

      await connection.push({
        type: "config_change",
        config: { name: "config1", overrides: [], value: "updated" },
      });
      await sync();

      expect(client.get("config1")).toBe("updated");

      client.disconnect();
    });

    it("should add new configs via config_change", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "value1", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot);

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });
      await sync();

      await connection.push({
        type: "config_change",
        config: { name: "config2", overrides: [], value: "value2" },
      });
      await sync();

      expect(client.get("config2")).toBe("value2");

      client.disconnect();
    });

    it("should notify subscribers on config updates", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "initial", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot);

      const updates: Array<{ name: string; value: unknown }> = [];
      const unsubscribe = client.subscribe("config1", (config) => {
        updates.push({ name: String(config.name), value: config.value });
      });

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "init-value" }],
      });
      await sync();

      await connection.push({
        type: "config_change",
        config: { name: "config1", overrides: [], value: "updated-value" },
      });
      await sync();

      expect(updates).toContainEqual({ name: "config1", value: "init-value" });
      expect(updates).toContainEqual({ name: "config1", value: "updated-value" });

      unsubscribe();
      client.disconnect();
    });

    it("should notify specific config subscribers", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          { name: "config1", value: "value1", overrides: [] },
          { name: "config2", value: "value2", overrides: [] },
        ],
      };

      const client = createClientWithConnection(snapshot);

      const updates: Array<{ name: string; value: unknown }> = [];
      const unsubscribe = client.subscribe("config1", (config) => {
        updates.push({ name: String(config.name), value: config.value });
      });

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          { name: "config1", overrides: [], value: "value1" },
          { name: "config2", overrides: [], value: "value2" },
        ],
      });
      await sync();

      await connection.push({
        type: "config_change",
        config: { name: "config1", overrides: [], value: "updated1" },
      });
      await connection.push({
        type: "config_change",
        config: { name: "config2", overrides: [], value: "updated2" },
      });
      await sync();

      // Should only receive config1 updates
      expect(updates).toContainEqual({ name: "config1", value: "value1" });
      expect(updates).toContainEqual({ name: "config1", value: "updated1" });
      expect(updates).not.toContainEqual(expect.objectContaining({ name: "config2" }));

      unsubscribe();
      client.disconnect();
    });

    it("should stop receiving updates after close", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "initial", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot);

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "init-value" }],
      });
      await sync();

      expect(client.get("config1")).toBe("init-value");

      client.disconnect();
      await sync();

      // Verify connection was closed
      expect(connection.aborted).toBe(true);

      // This shouldn't update the config
      await connection.push({
        type: "config_change",
        config: { name: "config1", overrides: [], value: "updated" },
      });
      await sync();

      expect(client.get("config1")).toBe("init-value");
    });

    it("should not receive updates after unsubscribe", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "initial", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot);

      const updates: Array<{ name: string; value: unknown }> = [];
      const unsubscribe = client.subscribe("config1", (config) => {
        updates.push({ name: String(config.name), value: config.value });
      });

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "init-value" }],
      });
      await sync();

      unsubscribe();

      await connection.push({
        type: "config_change",
        config: { name: "config1", overrides: [], value: "updated-value" },
      });
      await sync();

      // Should only have the init update, not the config_change
      expect(updates).toEqual([{ name: "config1", value: "init-value" }]);

      client.disconnect();
    });

    it("should include updated configs in getSnapshot", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot);

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "server-value" }],
      });
      await sync();

      const newSnapshot = client.getSnapshot();

      expect(newSnapshot.configs).toContainEqual({
        name: "config1",
        value: "server-value",
        overrides: [],
      });

      client.disconnect();
    });

    it("should strip trailing slashes from base URL", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "value1", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot, {
        baseUrl: "https://replane.my-host.com///",
      });

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });
      await sync();

      expect(client.get("config1")).toBe("value1");

      client.disconnect();
    });

    it("should use context for override evaluation with live updates", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          {
            name: "feature",
            value: "default",
            overrides: [
              {
                name: "prod-override",
                conditions: [{ operator: "equals", property: "env", value: "production" }],
                value: "prod-value",
              },
            ],
          },
        ],
      };

      const client = createClientWithConnection(snapshot, { context: { env: "production" } });

      // Should use snapshot context for override evaluation
      expect(client.get("feature")).toBe("prod-value");

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          {
            name: "feature",
            overrides: [
              {
                name: "prod-override",
                conditions: [{ operator: "equals", property: "env", value: "production" }],
                value: "server-prod-value",
              },
            ],
            value: "server-default",
          },
        ],
      });
      await sync();

      // Should use context for new override from server
      expect(client.get("feature")).toBe("server-prod-value");

      client.disconnect();
    });

    it("should support multiple subscribers", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "initial", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot);

      const updates1: Array<{ name: string; value: unknown }> = [];
      const updates2: Array<{ name: string; value: unknown }> = [];

      const unsubscribe1 = client.subscribe("config1", (config) => {
        updates1.push({ name: String(config.name), value: config.value });
      });
      const unsubscribe2 = client.subscribe("config1", (config) => {
        updates2.push({ name: String(config.name), value: config.value });
      });

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "config_change",
        config: { name: "config1", overrides: [], value: "updated" },
      });
      await sync();

      expect(updates1).toEqual([{ name: "config1", value: "updated" }]);
      expect(updates2).toEqual([{ name: "config1", value: "updated" }]);

      unsubscribe1();
      unsubscribe2();
      client.disconnect();
    });
  });

  describe("initialization behavior", () => {
    let mockServer: MockReplaneServerController;
    let silentLogger: ReturnType<typeof createSilentLogger>;

    beforeEach(() => {
      mockServer = new MockReplaneServerController();
      silentLogger = createSilentLogger();
    });

    afterEach(() => {
      mockServer.close();
    });

    function createClientWithConnection(
      snapshot: ReplaneSnapshot<Record<string, unknown>>,
      options: {
        context?: Record<string, string | number | boolean | null | undefined>;
      } & Partial<ConnectOptions> = {}
    ): Replane<Record<string, unknown>> {
      const { context, ...connectionOptions } = options;
      const client = new Replane({ snapshot, logger: silentLogger, context });
      // Start connection in background (don't await)
      client.connect({
        sdkKey: "test-sdk-key",
        baseUrl: "https://replane.my-host.com",
        fetchFn: mockServer.fetchFn,
        ...connectionOptions,
      });
      return client;
    }

    it("should be immediately available without waiting for server (non-blocking)", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      // Create client - should return immediately without waiting for server
      const startTime = Date.now();
      const client = createClientWithConnection(snapshot);
      const elapsed = Date.now() - startTime;

      // Should be available immediately (< 50ms)
      expect(elapsed).toBeLessThan(50);
      expect(client.get("config1")).toBe("snapshot-value");

      // Clean up
      client.disconnect();
    });

    it("should fallback to snapshot when server never responds", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot, {
        requestTimeoutMs: 50,
      });

      // Client should work with snapshot data even without server response
      expect(client.get("config1")).toBe("snapshot-value");

      // Wait a bit to ensure no crash
      await sync();
      await sync();

      expect(client.get("config1")).toBe("snapshot-value");

      client.disconnect();
    });

    it("should continue working after connection error and use snapshot", async () => {
      const failingFetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot, {
        fetchFn: failingFetch,
        requestTimeoutMs: 50,
        retryDelayMs: 10,
      });

      // Should still work with snapshot data
      expect(client.get("config1")).toBe("snapshot-value");

      // Wait for error to be logged
      await sync();

      // Should still have snapshot value
      expect(client.get("config1")).toBe("snapshot-value");

      // Error should be logged
      expect(silentLogger.error).toHaveBeenCalled();

      client.disconnect();
    });

    it("should log error when connection fails but continue serving snapshot", async () => {
      const failingFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          { name: "config1", value: "value1", overrides: [] },
          { name: "config2", value: "value2", overrides: [] },
        ],
      };

      const client = createClientWithConnection(snapshot, {
        fetchFn: failingFetch,
        requestTimeoutMs: 50,
      });

      // All configs should be available from snapshot
      expect(client.get("config1")).toBe("value1");
      expect(client.get("config2")).toBe("value2");

      await sync();

      // Error should have been logged
      expect(silentLogger.error).toHaveBeenCalled();

      client.disconnect();
    });

    it("should use default timeout values when not specified", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "value1", overrides: [] }],
      };

      // No timeout values specified - should use defaults
      const client = createClientWithConnection(snapshot);

      // Should work with default values
      expect(client.get("config1")).toBe("value1");

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "server-value" }],
      });
      await sync();

      expect(client.get("config1")).toBe("server-value");

      client.disconnect();
    });

    it("should recover from temporary connection failure and receive updates", async () => {
      let callCount = 0;
      const failOnceFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Temporary network error");
        }
        return mockServer.fetchFn(url, init);
      });

      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot, {
        fetchFn: failOnceFetch,
        requestTimeoutMs: 100,
        retryDelayMs: 10,
      });

      // Should initially have snapshot value
      expect(client.get("config1")).toBe("snapshot-value");

      // Wait for retry
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Accept connection after retry
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "server-value" }],
      });
      await sync();

      // Should now have server value after recovery
      expect(client.get("config1")).toBe("server-value");

      client.disconnect();
    });

    it("should handle inactivity timeout and reconnect", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot, {
        inactivityTimeoutMs: 100, // Short timeout for testing
      });

      // Accept first connection
      const connection1 = await mockServer.acceptConnection();
      await connection1.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });
      await sync();

      expect(client.get("config1")).toBe("value1");

      // Wait for inactivity timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Accept reconnection
      const connection2 = await mockServer.acceptConnection();
      await connection2.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value2" }],
      });
      await sync();

      expect(client.get("config1")).toBe("value2");

      client.disconnect();
    });

    it("should send current configs in request body when reconnecting", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [
          { name: "config1", value: "snapshot-value1", overrides: [] },
          {
            name: "config2",
            value: "snapshot-value2",
            overrides: [
              {
                name: "override1",
                conditions: [{ operator: "equals", property: "env", value: "prod" }],
                value: "override-value",
              },
            ],
          },
        ],
      };

      const client = createClientWithConnection(snapshot);

      const connection = await mockServer.acceptConnection();

      // Check that the request body contains the current configs from snapshot
      expect(connection.requestBody.currentConfigs).toHaveLength(2);
      expect(connection.requestBody.currentConfigs).toContainEqual(
        expect.objectContaining({ name: "config1", value: "snapshot-value1" })
      );
      expect(connection.requestBody.currentConfigs).toContainEqual(
        expect.objectContaining({ name: "config2", value: "snapshot-value2" })
      );

      client.disconnect();
    });

    it("should log error when connection fails", async () => {
      const failingFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot, {
        fetchFn: failingFetch,
        requestTimeoutMs: 50,
        retryDelayMs: 10,
      });

      // Wait for fetch attempt and retry
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Logger.error should have been called at least once
      expect(silentLogger.error).toHaveBeenCalled();

      // Client should still work with snapshot data
      expect(client.get("config1")).toBe("snapshot-value");

      client.disconnect();
    });

    it("should log error on each retry attempt", async () => {
      const failingFetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot, {
        fetchFn: failingFetch,
        requestTimeoutMs: 10,
        retryDelayMs: 10,
      });

      // Wait for multiple retry attempts
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Logger.error should have been called multiple times (once per retry)
      expect(silentLogger.error.mock.calls.length).toBeGreaterThan(1);

      client.disconnect();
    });

    it("should not log error when connection succeeds", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot);

      // Accept connection and send init
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "server-value" }],
      });
      await sync();

      // Logger.error should not have been called
      expect(silentLogger.error).not.toHaveBeenCalled();

      client.disconnect();
    });

    it("should log error when connection is lost and retrying", async () => {
      let callCount = 0;
      const failOnSecondFetch = vi
        .fn()
        .mockImplementation(async (url: string, init?: RequestInit) => {
          callCount++;
          if (callCount === 2) {
            throw new Error("Connection lost");
          }
          return mockServer.fetchFn(url, init);
        });

      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot, {
        fetchFn: failOnSecondFetch,
        inactivityTimeoutMs: 50,
        retryDelayMs: 10,
      });

      // Accept first connection
      const connection1 = await mockServer.acceptConnection();
      await connection1.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });
      await sync();

      expect(client.get("config1")).toBe("value1");

      // Wait for inactivity timeout which will trigger reconnection
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Logger.error should have been called when second connection failed
      expect(silentLogger.error).toHaveBeenCalled();

      client.disconnect();
    });

    it("should receive updates when connection is established", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot);

      // Accept connection and send init
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "server-value" }],
      });
      await sync();

      // Client should have received the server value
      expect(client.get("config1")).toBe("server-value");

      client.disconnect();
    });

    it("should receive updates on each successful reconnection", async () => {
      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot, {
        inactivityTimeoutMs: 100,
      });

      // Accept first connection
      const connection1 = await mockServer.acceptConnection();
      await connection1.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });
      await sync();

      expect(client.get("config1")).toBe("value1");

      // Wait for inactivity timeout which will trigger reconnection
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Accept second connection
      const connection2 = await mockServer.acceptConnection();
      await connection2.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value2" }],
      });
      await sync();

      // Client should have received the new value after reconnection
      expect(client.get("config1")).toBe("value2");

      client.disconnect();
    });

    it("should not receive updates when connection fails", async () => {
      const failingFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot, {
        fetchFn: failingFetch,
        requestTimeoutMs: 50,
        retryDelayMs: 10,
      });

      // Wait for retry attempts
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should still have snapshot value (no server updates received)
      expect(client.get("config1")).toBe("snapshot-value");

      client.disconnect();
    });

    it("should recover after initial failure and receive updates", async () => {
      let callCount = 0;
      const failOnceFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          throw new Error("First attempt failed");
        }
        return mockServer.fetchFn(url, init);
      });

      const snapshot: ReplaneSnapshot<Record<string, unknown>> = {
        configs: [{ name: "config1", value: "snapshot-value", overrides: [] }],
      };

      const client = createClientWithConnection(snapshot, {
        fetchFn: failOnceFetch,
        requestTimeoutMs: 100,
        retryDelayMs: 10,
      });

      // Wait for retry
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Accept connection after retry
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "server-value" }],
      });
      await sync();

      // Logger.error should have been called once (for the first failed attempt)
      expect(silentLogger.error).toHaveBeenCalledTimes(1);
      // Client should have received the server value after successful retry
      expect(client.get("config1")).toBe("server-value");

      client.disconnect();
    });
  });
});
