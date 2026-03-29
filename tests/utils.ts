import { Channel } from "async-channel";
import type { ReplicationStreamRecord, StartReplicationStreamBody } from "../src/types";

export function createFetchMock(
  handler: (req: Request, signal?: AbortSignal) => Response | Promise<Response>
) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal ?? undefined;

    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const req = input instanceof Request ? input : new Request(input.toString(), init);
    return handler(req, signal);
  };
}

export interface ReplaneServerMockHandler {
  startReplicationStream: (
    body: StartReplicationStreamBody,
    signal?: AbortSignal
  ) => AsyncIterable<MockConnectionEvent>;
}

export function createReplaneServerMock(handler: ReplaneServerMockHandler) {
  return createFetchMock(async (req, signal) => {
    const url = new URL(req.url);

    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname !== "/api/sdk/v1/replication/stream") {
      return new Response("Not found", { status: 404 });
    }

    if (req.headers.get("Content-Type") !== "application/json") {
      return new Response("Invalid content type: " + req.headers.get("Content-Type"), {
        status: 400,
      });
    }

    const body = (await req.json()) as StartReplicationStreamBody;

    if (!Array.isArray(body.currentConfigs) || !Array.isArray(body.requiredConfigs)) {
      return new Response("Invalid request", { status: 400 });
    }

    const replicationStream = handler.startReplicationStream(body, signal);

    const sseStream = new ReadableStream<SseEvent>({
      async start(controller) {
        let closed = false;
        const safeClose = () => {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // Controller may already be closed by the pipeline
            }
          }
        };
        signal?.addEventListener("abort", safeClose, { once: true });

        try {
          controller.enqueue({ type: "connected" });
          controller.enqueue({ type: "ping" });

          for await (const event of replicationStream) {
            if (signal?.aborted) break;
            if (event.type === "ping") {
              controller.enqueue({ type: "ping" });
            } else {
              controller.enqueue({ type: "data", data: JSON.stringify(event.record) });
            }
          }

          safeClose();
        } catch (error) {
          if (!closed) {
            controller.error(error);
          }
        }
      },
    }).pipeThrough(new SseEncoderStream());

    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  });
}

type SseEvent = { type: "data"; data: string } | { type: "ping" } | { type: "connected" };

class SseEncoderStream extends TransformStream<SseEvent, Uint8Array> {
  constructor() {
    const encoder = new TextEncoder();

    super({
      transform(chunk, controller) {
        if (chunk.type === "data") {
          controller.enqueue(encoder.encode(`data: ${chunk.data}\n\n`));
        } else if (chunk.type === "ping") {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } else if (chunk.type === "connected") {
          controller.enqueue(encoder.encode(": connected\n\n"));
        } else {
          const exhaustiveCheck: never = chunk;
          throw new Error(`Unknown SSE event type: ${JSON.stringify(exhaustiveCheck)}`);
        }
      },
    });
  }
}

export class MockReplaneServerController {
  private readonly knownConnections = new Set<MockReplaneServerConnection>();
  private readonly connections = new Channel<MockReplaneServerConnection>();
  public readonly fetchFn: ReturnType<typeof createReplaneServerMock>;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    this.fetchFn = createReplaneServerMock({
      startReplicationStream: async function* (body, signal) {
        const connection = new MockReplaneServerConnection(body, signal);
        self.knownConnections.add(connection);
        await self.connections.push(connection);
        for await (const event of connection.events) {
          yield event;
        }
      },
    });
  }

  async acceptConnection(): Promise<MockReplaneServerConnection> {
    return this.connections.get();
  }

  close() {
    for (const connection of this.knownConnections) {
      connection.close();
    }
    this.connections.close();
    this.knownConnections.clear();
  }
}

type MockConnectionEvent = { type: "data"; record: ReplicationStreamRecord } | { type: "ping" };

export class MockReplaneServerConnection {
  private readonly _events = new Channel<MockConnectionEvent>();
  private _closed = false;

  constructor(
    private readonly _body: StartReplicationStreamBody,
    private readonly _signal?: AbortSignal
  ) {
    if (_signal?.aborted) {
      this.close();
    } else {
      _signal?.addEventListener("abort", () => this.close(), { once: true });
    }
  }

  get signal(): AbortSignal | undefined {
    return this._signal;
  }

  get hasSignal(): boolean {
    return this._signal !== undefined;
  }

  get aborted(): boolean {
    return this._closed;
  }

  get closed(): boolean {
    return this._closed;
  }

  get events(): AsyncIterable<MockConnectionEvent> {
    return this._events;
  }

  get requestBody(): StartReplicationStreamBody {
    return this._body;
  }

  async push(event: ReplicationStreamRecord) {
    if (this._closed) return;
    await this._events.push({ type: "data", record: event });
  }

  async ping() {
    if (this._closed) return;
    await this._events.push({ type: "ping" });
  }

  async throw(error: Error) {
    if (this._closed) return;
    await this._events.throw(error);
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._events.close();
  }
}
