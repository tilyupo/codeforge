import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { delay, retryDelay, combineAbortSignals, Deferred, generateClientId } from "../src/utils";

describe("delay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should resolve after specified delay", async () => {
    const promise = delay(1000);

    vi.advanceTimersByTime(999);
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("should resolve immediately with 0 delay", async () => {
    const promise = delay(0);
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe("retryDelay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should resolve after delay with jitter", async () => {
    // With Math.random() = 0.5, jitter = 200/5 = 40
    // delay = 200 + 0.5 * 40 - 20 = 200
    const promise = retryDelay(200);

    vi.advanceTimersByTime(199);
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
  });

  it("should use different delays based on random value", async () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(1);

    // jitter = 200/5 = 40
    // random = 0: delay = 200 + 0 * 40 - 20 = 180
    // random = 1: delay = 200 + 1 * 40 - 20 = 220

    const promise1 = retryDelay(200);
    vi.advanceTimersByTime(180);
    await vi.advanceTimersByTimeAsync(0);

    const promise2 = retryDelay(200);
    vi.advanceTimersByTime(220);
    await vi.advanceTimersByTimeAsync(0);

    await expect(promise1).resolves.toBeUndefined();
    await expect(promise2).resolves.toBeUndefined();
  });
});

describe("combineAbortSignals", () => {
  it("should create a combined signal from multiple signals", () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    const { signal } = combineAbortSignals([controller1.signal, controller2.signal]);

    expect(signal.aborted).toBe(false);
  });

  it("should abort combined signal when first signal aborts", () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    const { signal } = combineAbortSignals([controller1.signal, controller2.signal]);

    controller1.abort();

    expect(signal.aborted).toBe(true);
  });

  it("should abort combined signal when second signal aborts", () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    const { signal } = combineAbortSignals([controller1.signal, controller2.signal]);

    controller2.abort();

    expect(signal.aborted).toBe(true);
  });

  it("should handle undefined/null signals", () => {
    const controller = new AbortController();

    const { signal } = combineAbortSignals([undefined, controller.signal, null]);

    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it("should be already aborted if any input signal is aborted", () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    controller1.abort();

    const { signal } = combineAbortSignals([controller1.signal, controller2.signal]);

    expect(signal.aborted).toBe(true);
  });

  it("should clean up event listeners when cleanUpSignals is called", () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    const removeListener1 = vi.spyOn(controller1.signal, "removeEventListener");
    const removeListener2 = vi.spyOn(controller2.signal, "removeEventListener");

    const { cleanUpSignals } = combineAbortSignals([controller1.signal, controller2.signal]);

    cleanUpSignals();

    expect(removeListener1).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(removeListener2).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("should work with empty array", () => {
    const { signal } = combineAbortSignals([]);
    expect(signal.aborted).toBe(false);
  });

  it("should work with single signal", () => {
    const controller = new AbortController();
    const { signal } = combineAbortSignals([controller.signal]);

    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});

describe("Deferred", () => {
  it("should create a pending promise", () => {
    const deferred = new Deferred<string>();
    let status = "pending";

    deferred.promise.then(() => {
      status = "resolved";
    });

    expect(status).toBe("pending");
  });

  it("should resolve when resolve is called", async () => {
    const deferred = new Deferred<string>();

    deferred.resolve("test-value");

    await expect(deferred.promise).resolves.toBe("test-value");
  });

  it("should reject when reject is called", async () => {
    const deferred = new Deferred<string>();
    const error = new Error("test-error");

    deferred.reject(error);

    await expect(deferred.promise).rejects.toBe(error);
  });

  it("should only resolve once", async () => {
    const deferred = new Deferred<string>();

    deferred.resolve("first");
    deferred.resolve("second");

    await expect(deferred.promise).resolves.toBe("first");
  });

  it("should work with different types", async () => {
    const deferredNumber = new Deferred<number>();
    const deferredObject = new Deferred<{ key: string }>();
    const deferredVoid = new Deferred<void>();

    deferredNumber.resolve(42);
    deferredObject.resolve({ key: "value" });
    deferredVoid.resolve();

    await expect(deferredNumber.promise).resolves.toBe(42);
    await expect(deferredObject.promise).resolves.toEqual({ key: "value" });
    await expect(deferredVoid.promise).resolves.toBeUndefined();
  });

  it("should allow chaining on the promise", async () => {
    const deferred = new Deferred<number>();

    const chainedPromise = deferred.promise.then((value) => value * 2);

    deferred.resolve(21);

    await expect(chainedPromise).resolves.toBe(42);
  });
});

describe("generateClientId", () => {
  it("should generate a valid UUID string", () => {
    const clientId = generateClientId();

    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(clientId).toMatch(uuidRegex);
  });

  it("should generate unique IDs on each call", () => {
    const id1 = generateClientId();
    const id2 = generateClientId();
    const id3 = generateClientId();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });
});
