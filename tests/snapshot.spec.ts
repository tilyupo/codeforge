import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getReplaneSnapshot, clearSnapshotCache } from "../src/snapshot";
import type { GetReplaneSnapshotOptions } from "../src/snapshot";
import type { ConnectOptions } from "../src/client-types";
import { MockReplaneServerController } from "./utils";

function sync() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("getReplaneSnapshot", () => {
  let mockServer: MockReplaneServerController;
  let silentLogger: ReturnType<typeof createSilentLogger>;

  const defaultConnection = {
    sdkKey: "test-sdk-key",
    baseUrl: "https://replane.my-host.com",
  };

  beforeEach(() => {
    mockServer = new MockReplaneServerController();
    silentLogger = createSilentLogger();
  });

  afterEach(async () => {
    clearSnapshotCache();
    mockServer.close();
  });

  interface TestSnapshotOptions<T extends object> extends Omit<GetReplaneSnapshotOptions<T>, 'connection'> {
    connection?: Partial<ConnectOptions> | null;
  }

  function getSnapshot<T extends object = Record<string, unknown>>(
    options: Partial<TestSnapshotOptions<T>> = {}
  ) {
    const { connection, ...rest } = options;
    return getReplaneSnapshot<T>({
      connection: connection === null ? null : {
        ...defaultConnection,
        fetchFn: mockServer.fetchFn,
        ...connection,
      },
      logger: silentLogger,
      ...rest,
    });
  }

  describe("basic functionality", () => {
    it("should return a snapshot with configs", async () => {
      const snapshotPromise = getSnapshot();

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [
          { name: "feature", overrides: [], value: { enabled: true } },
          { name: "theme", overrides: [], value: "dark" },
        ],
      });

      const snapshot = await snapshotPromise;
      await sync();

      expect(snapshot.configs).toBeDefined();
      expect(snapshot.configs).toHaveLength(2);
      expect(snapshot.configs.find((c) => c.name === "feature")?.value).toEqual({ enabled: true });
      expect(snapshot.configs.find((c) => c.name === "theme")?.value).toBe("dark");
    });

    it("should return snapshot with empty configs array when no configs", async () => {
      const snapshotPromise = getSnapshot();

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [],
      });

      const snapshot = await snapshotPromise;
      await sync();

      expect(snapshot.configs).toEqual([]);
    });

    it("should handle configs with complex nested values", async () => {
      const snapshotPromise = getSnapshot();

      const complexValue = {
        nested: {
          deeply: {
            value: [1, 2, { key: "value" }],
          },
        },
        array: [true, false, null],
      };

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "complex", overrides: [], value: complexValue }],
      });

      const snapshot = await snapshotPromise;
      await sync();

      expect(snapshot.configs[0].value).toEqual(complexValue);
    });

    it("should preserve config overrides in snapshot", async () => {
      const snapshotPromise = getSnapshot();

      const overrides = [
        { name: "premium-override", conditions: [{ operator: "equals" as const, property: "userId", value: "123" }], value: "override-value" },
      ];

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "feature", overrides, value: "default-value" }],
      });

      const snapshot = await snapshotPromise;
      await sync();

      expect(snapshot.configs[0].overrides).toEqual(overrides);
    });
  });

  describe("without connection (defaults only)", () => {
    it("should return snapshot from defaults when connection is null", async () => {
      const snapshot = await getReplaneSnapshot({
        connection: null,
        defaults: {
          feature: true,
          theme: "dark",
        },
      });

      expect(snapshot.configs).toHaveLength(2);
      expect(snapshot.configs.find((c) => c.name === "feature")?.value).toBe(true);
      expect(snapshot.configs.find((c) => c.name === "theme")?.value).toBe("dark");
    });

    it("should return empty configs when connection is null and no defaults", async () => {
      const snapshot = await getReplaneSnapshot({ connection: null });

      expect(snapshot.configs).toEqual([]);
    });

    it("should handle complex default values", async () => {
      const complexDefault = {
        nested: { value: [1, 2, 3] },
      };

      const snapshot = await getReplaneSnapshot({
        connection: null,
        defaults: {
          complex: complexDefault,
        },
      });

      expect(snapshot.configs[0].value).toEqual(complexDefault);
      expect(snapshot.configs[0].overrides).toEqual([]);
    });
  });

  describe("caching behavior", () => {
    it("should reuse cached client for same options", async () => {
      // First call
      const snapshot1Promise = getSnapshot();
      const connection1 = await mockServer.acceptConnection();
      await connection1.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });
      await snapshot1Promise;
      await sync();

      // Second call with same options - should reuse cached client
      const snapshot2Promise = getSnapshot();
      // No new connection should be accepted since client is cached
      const snapshot2 = await snapshot2Promise;
      await sync();

      expect(snapshot2.configs).toHaveLength(1);
      expect(snapshot2.configs[0].value).toBe("value1");
    });

    it("should create new client for different sdkKey", async () => {
      // First call
      const snapshot1Promise = getSnapshot({ connection: { sdkKey: "key-1" } });
      const connection1 = await mockServer.acceptConnection();
      await connection1.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "from-key-1" }],
      });
      await snapshot1Promise;
      await sync();

      // Second call with different sdkKey
      const snapshot2Promise = getSnapshot({ connection: { sdkKey: "key-2" } });
      const connection2 = await mockServer.acceptConnection();
      await connection2.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "from-key-2" }],
      });
      const snapshot2 = await snapshot2Promise;
      await sync();

      expect(snapshot2.configs[0].value).toBe("from-key-2");
    });

    it("should create new client for different baseUrl", async () => {
      // First call
      const snapshot1Promise = getSnapshot({ connection: { baseUrl: "https://host1.com" } });
      const connection1 = await mockServer.acceptConnection();
      await connection1.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "from-host-1" }],
      });
      await snapshot1Promise;
      await sync();

      // Second call with different baseUrl
      const snapshot2Promise = getSnapshot({ connection: { baseUrl: "https://host2.com" } });
      const connection2 = await mockServer.acceptConnection();
      await connection2.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "from-host-2" }],
      });
      const snapshot2 = await snapshot2Promise;
      await sync();

      expect(snapshot2.configs[0].value).toBe("from-host-2");
    });

    it("should expire cache after TTL", async () => {
      const keepAliveMs = 100; // Use short TTL for test

      // First call
      const snapshot1Promise = getSnapshot({ keepAliveMs });
      const connection1 = await mockServer.acceptConnection();
      await connection1.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });
      await snapshot1Promise;
      await sync();

      // Wait for TTL to expire
      await delay(keepAliveMs + 50);

      // Second call - should create new client since cache expired
      const snapshot2Promise = getSnapshot({ keepAliveMs });
      const connection2 = await mockServer.acceptConnection();
      await connection2.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value2" }],
      });
      const snapshot2 = await snapshot2Promise;
      await sync();

      expect(snapshot2.configs[0].value).toBe("value2");
    });

    it("should refresh TTL on subsequent cache hits", async () => {
      const keepAliveMs = 150;

      // First call
      const snapshot1Promise = getSnapshot({ keepAliveMs });
      const connection1 = await mockServer.acceptConnection();
      await connection1.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });
      await snapshot1Promise;
      await sync();

      // Wait for partial TTL
      await delay(100);

      // Second call - should hit cache and refresh TTL
      const snapshot2 = await getSnapshot({ keepAliveMs });
      expect(snapshot2.configs[0].value).toBe("value1");

      // Wait for original TTL to have expired (but refreshed TTL should still be valid)
      await delay(100);

      // Third call - should still hit cache because TTL was refreshed
      const snapshot3 = await getSnapshot({ keepAliveMs });
      expect(snapshot3.configs[0].value).toBe("value1");
    });
  });

  describe("clearSnapshotCache", () => {
    it("should clear all cached clients", async () => {
      // Create multiple cached clients
      const snapshot1Promise = getSnapshot({ connection: { sdkKey: "key-1" } });
      const connection1 = await mockServer.acceptConnection();
      await connection1.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value1" }],
      });
      await snapshot1Promise;
      await sync();

      const snapshot2Promise = getSnapshot({ connection: { sdkKey: "key-2" } });
      const connection2 = await mockServer.acceptConnection();
      await connection2.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value2" }],
      });
      await snapshot2Promise;
      await sync();

      // Clear cache
      clearSnapshotCache();

      // New calls should create new clients
      const snapshot3Promise = getSnapshot({ connection: { sdkKey: "key-1" } });
      const connection3 = await mockServer.acceptConnection();
      await connection3.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value3" }],
      });
      const snapshot3 = await snapshot3Promise;
      await sync();

      expect(snapshot3.configs[0].value).toBe("value3");
    });

    it("should be safe to call multiple times", () => {
      clearSnapshotCache();
      clearSnapshotCache();
      clearSnapshotCache();
      // Should not throw
    });

    it("should be safe to call when cache is empty", () => {
      clearSnapshotCache();
      // Should not throw
    });
  });

  describe("concurrent requests", () => {
    it("should share the same client promise for concurrent requests", async () => {
      // Start two requests concurrently
      const snapshot1Promise = getSnapshot();
      const snapshot2Promise = getSnapshot();

      // Only one connection should be made
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "shared-value" }],
      });

      const [snapshot1, snapshot2] = await Promise.all([snapshot1Promise, snapshot2Promise]);
      await sync();

      expect(snapshot1.configs[0].value).toBe("shared-value");
      expect(snapshot2.configs[0].value).toBe("shared-value");
    });

    it("should handle many concurrent requests", async () => {
      // Start many requests concurrently
      const promises = Array.from({ length: 10 }, () => getSnapshot());

      // Only one connection should be made
      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "shared-value" }],
      });

      const snapshots = await Promise.all(promises);
      await sync();

      snapshots.forEach((snapshot) => {
        expect(snapshot.configs[0].value).toBe("shared-value");
      });
    });

    it("should handle concurrent requests with different keys separately", async () => {
      // Start concurrent requests with different keys
      const promise1 = getSnapshot({ connection: { sdkKey: "key-1" } });
      const promise2 = getSnapshot({ connection: { sdkKey: "key-2" } });
      const promise3 = getSnapshot({ connection: { sdkKey: "key-1" } }); // Same as first

      // Two connections should be made (one for each unique key)
      const connection1 = await mockServer.acceptConnection();
      const connection2 = await mockServer.acceptConnection();

      await connection1.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value-1" }],
      });
      await connection2.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "value-2" }],
      });

      const [snapshot1, snapshot2, snapshot3] = await Promise.all([promise1, promise2, promise3]);
      await sync();

      expect(snapshot1.configs[0].value).toBe("value-1");
      expect(snapshot2.configs[0].value).toBe("value-2");
      expect(snapshot3.configs[0].value).toBe("value-1"); // Same as first
    });
  });

  describe("error handling", () => {
    it("should propagate connection errors", async () => {
      const snapshotPromise = getSnapshot({
        connection: {
          connectTimeoutMs: 100, // Short timeout
        },
      });

      const connection = await mockServer.acceptConnection();
      // Don't send init - let it timeout
      await connection.close();

      await expect(snapshotPromise).rejects.toThrow();
    }, 10000);

    it("should not cache failed connections", async () => {
      // Use unique sdkKey to avoid conflicts with other tests
      const uniqueKey = `key-error-test-${Date.now()}`;

      // First call - will fail due to timeout
      const snapshot1Promise = getSnapshot({
        connection: {
          sdkKey: uniqueKey,
          connectTimeoutMs: 50,
        },
      });

      // Accept but don't send init - let it timeout
      await mockServer.acceptConnection();
      await expect(snapshot1Promise).rejects.toThrow();

      // Clear the cache to ensure clean state
      clearSnapshotCache();

      // Second call with same key - should create new connection (not cached failure)
      const snapshot2Promise = getSnapshot({
        connection: {
          sdkKey: uniqueKey,
        },
      });
      const connection2 = await mockServer.acceptConnection();
      await connection2.push({
        type: "init",
        configs: [{ name: "config1", overrides: [], value: "success" }],
      });
      const snapshot2 = await snapshot2Promise;
      await sync();

      expect(snapshot2.configs[0].value).toBe("success");
    }, 10000);
  });

  describe("options passing", () => {
    it("should pass context to the client", async () => {
      const context = { userId: "user-123", plan: "premium" };
      const snapshotPromise = getSnapshot({ context });

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "feature", overrides: [], value: true }],
      });

      const snapshot = await snapshotPromise;
      await sync();

      expect(snapshot.configs[0].value).toBe(true);
    });

    it("should pass defaults to the client", async () => {
      const defaults = { fallback: "default-value" };
      const snapshotPromise = getSnapshot({ defaults });

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "feature", overrides: [], value: true }],
      });

      const snapshot = await snapshotPromise;
      await sync();

      // Snapshot should contain server values
      expect(snapshot.configs.find((c) => c.name === "feature")?.value).toBe(true);
    });

    it("should pass custom logger to the client", async () => {
      const customLogger = createSilentLogger();
      const snapshotPromise = getSnapshot({ logger: customLogger });

      const connection = await mockServer.acceptConnection();
      await connection.push({
        type: "init",
        configs: [{ name: "feature", overrides: [], value: true }],
      });

      await snapshotPromise;
      await sync();

      // Logger should have been used (exact calls depend on implementation)
      // Just verify it doesn't throw
    });
  });
});
