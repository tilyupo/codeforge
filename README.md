<h1 align="center">Replane JavaScript SDK</h1>
<p align="center">Dynamic configuration for Node.js, Deno, Bun, and browsers.</p>

<p align="center">
  <a href="https://cloud.replane.dev"><img src="https://img.shields.io/badge/Try-Replane%20Cloud-blue" alt="Replane Cloud"></a>
  <a href="https://www.npmjs.com/package/@replanejs/sdk"><img src="https://img.shields.io/npm/v/@replanejs/sdk" alt="npm"></a>
  <a href="https://github.com/replane-dev/replane-javascript/blob/main/LICENSE"><img src="https://img.shields.io/github/license/replane-dev/replane-javascript" alt="License"></a>
  <a href="https://github.com/orgs/replane-dev/discussions"><img src="https://img.shields.io/badge/discussions-join-blue?logo=github" alt="Community"></a>
</p>

<picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/replane-dev/replane/main/public/replane-window-screenshot-dark-v1.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/replane-dev/replane/main/public/replane-window-screenshot-light-with-border-v2.jpg">
    <img alt="Replane Screenshot" src="https://raw.githubusercontent.com/replane-dev/replane/main/public/replane-window-screenshot-light-with-border-v2.jpg">
</picture>

[Replane](https://github.com/replane-dev/replane) is a dynamic configuration manager that lets you tweak your software without running scripts or building your own admin panel. Store feature flags, rate limits, UI text, log level, rollout percentage, and more. Delegate editing to teammates and share config across services. No redeploys needed.

## Why Dynamic Configuration?

- **Feature flags** – toggle features, run A/B tests, roll out to user segments
- **Operational tuning** – adjust limits, TTLs, and timeouts without redeploying
- **Per-environment settings** – different values for production, staging, dev
- **Incident response** – instantly revert to a known-good version
- **Cross-service configuration** – share settings with realtime sync
- **Non-engineer access** – safe editing with schema validation

## Features

- Works in ESM and CJS (dual build)
- Zero runtime deps (uses native `fetch` — bring a polyfill if your runtime lacks it)
- Realtime updates via Server-Sent Events (SSE)
- Context-based override evaluation (feature flags, A/B testing, gradual rollouts)
- Tiny bundle footprint
- Strong TypeScript types

## Installation

```bash
npm install @replanejs/sdk
# or
pnpm add @replanejs/sdk
# or
yarn add @replanejs/sdk
```

## Quick start

```ts
import { Replane } from "@replanejs/sdk";

// Define your config types
interface Configs {
  "new-onboarding": boolean;
  "password-requirements": PasswordRequirements;
  "billing-enabled": boolean;
}

interface PasswordRequirements {
  minLength: number;
  requireSymbol: boolean;
}

// Create the client with optional constructor options
const replane = new Replane<Configs>({
  context: {
    // example context
    userId: "user-123",
    plan: "premium",
    region: "us-east",
  },
});

// Connect to the server
await replane.connect({
  sdkKey: process.env.REPLANE_SDK_KEY!,
  baseUrl: "https://cloud.replane.dev", // or your self-hosted URL
});

// Get a config value (knows about latest updates via SSE)
const featureFlag = replane.get("new-onboarding"); // Typed as boolean

if (featureFlag) {
  console.log("New onboarding enabled!");
}

// Typed config - no need to specify type again
const passwordReqs = replane.get("password-requirements");

// Use the value directly
const { minLength } = passwordReqs; // TypeScript knows this is PasswordRequirements

// With context for override evaluation
const enabled = replane.get("billing-enabled", {
  context: {
    plan: "free",
    deviceType: "mobile",
  },
});

if (enabled) {
  console.log("Billing enabled for this user!");
}

// When done, clean up resources
replane.disconnect();
```

## API

### `new Replane<T>(options?)`

Creates a new Replane client instance.

Type parameter `T` defines the shape of your configs (a mapping of config names to their value types).

The client is usable immediately after construction if you provide `defaults` or a `snapshot`. Call `connect()` to establish a server connection for real-time updates.

#### Constructor Options

- `context` (object) – default context for all config evaluations. Can be overridden per-request in `get()`. Optional.
- `defaults` (object) – default values to use before connecting or if the connection fails. These values are available immediately. Optional.
- `snapshot` (object) – restore from a previous `getSnapshot()` call. Useful for SSR/hydration scenarios. Optional.
- `logger` (object) – custom logger with `debug`, `info`, `warn`, `error` methods. Default: `console`.

### `replane.connect(options)`

Connects to the Replane server and starts receiving real-time updates via SSE.

Returns a Promise that resolves when the connection is established and initial configs are loaded.

#### Connect Options

- `baseUrl` (string) – Replane origin (no trailing slash needed). Required.
- `sdkKey` (string) – SDK key for authorization. Required. **Note:** Each SDK key is tied to a specific project and can only access configs from that project. To access configs from multiple projects, create multiple SDK keys and initialize separate client instances.
- `fetchFn` (function) – custom fetch (e.g. `undici.fetch` or mocked fetch in tests). Optional.
- `requestTimeoutMs` (number) – timeout for SSE requests in ms. Default: 2000.
- `connectTimeoutMs` (number) – timeout for initial connection in ms. Default: 5000.
- `retryDelayMs` (number) – base delay between retries in ms. Default: 200.
- `inactivityTimeoutMs` (number) – timeout for SSE inactivity before reconnecting in ms. Default: 30000.
- `agent` (string) – agent identifier sent in User-Agent header.

### `replane.get<K>(name, options?)`

Gets the current config value. The configs client maintains an up-to-date cache that receives realtime updates via Server-Sent Events (SSE) in the background.

Parameters:

- `name` (K extends keyof T) – config name to fetch. TypeScript will enforce that this is a valid config name from your `Configs` interface.
- `options` (object) – optional configuration:
  - `context` (object) – context merged with client-level context for override evaluation.
  - `default` (T[K]) – default value to return if the config is not found. When provided, the method will not throw.

Returns the config value of type `T[K]` (synchronous). The return type is automatically inferred from your `Configs` interface.

Notes:

- The Replane client receives realtime updates via SSE in the background.
- If the config is not found and no default is provided, throws a `ReplaneError` with code `not_found`.
- If the config is not found and a default is provided, returns the default value without throwing.
- Context-based overrides are evaluated automatically based on context.

Example:

```ts
interface Configs {
  "billing-enabled": boolean;
  "max-connections": number;
}

const replane = new Replane<Configs>();
await replane.connect({
  sdkKey: "your-sdk-key",
  baseUrl: "https://cloud.replane.dev", // or your self-hosted URL
});

// Get value without context - TypeScript knows this is boolean
const enabled = replane.get("billing-enabled");

// Get value with context for override evaluation
const userEnabled = replane.get("billing-enabled", {
  context: { userId: "user-123", plan: "premium" },
});

// Get value with default - won't throw if config doesn't exist
const maxConnections = replane.get("max-connections", { default: 10 });

// Clean up when done
replane.disconnect();
```

### `replane.subscribe(configName, callback)`

Subscribe to a specific config's changes and receive real-time updates when it is modified.

Parameters:

- `configName` (K extends keyof T) – The config to watch for changes.
- `callback` (function) – Function called when the config changes. Receives an object with `{ name, value }`.

Returns a function to unsubscribe from the config changes.

Example:

```ts
interface Configs {
  "feature-flag": boolean;
  "max-connections": number;
}

const replane = new Replane<Configs>();
await replane.connect({
  sdkKey: "your-sdk-key",
  baseUrl: "https://cloud.replane.dev", // or your self-hosted URL
});

// Subscribe to a specific config
const unsubscribeFeature = replane.subscribe("feature-flag", (config) => {
  console.log("Feature flag changed:", config.value);
  // config.value is typed as boolean
});

// Later: unsubscribe when done
unsubscribeFeature();

// Clean up when done
replane.disconnect();
```

### In-memory client (testing)

For unit tests or local development where you want deterministic config values without a server, create a `Replane` instance with `defaults` and don't call `connect()`:

```ts
import { Replane } from "@replanejs/sdk";

interface Configs {
  "feature-a": boolean;
  "max-items": { value: number; ttl: number };
}

const replane = new Replane<Configs>({
  defaults: {
    "feature-a": true,
    "max-items": { value: 10, ttl: 3600 },
  },
});

// No connect() call - works purely from defaults

const featureA = replane.get("feature-a"); // TypeScript knows this is boolean
console.log(featureA); // true

const maxItems = replane.get("max-items"); // TypeScript knows the type
console.log(maxItems); // { value: 10, ttl: 3600 }
```

Notes:

- `get(name)` returns the value from `defaults`.
- If a name is missing, it throws a `ReplaneError` (`Config not found: <name>`).
- The client works as usual but doesn't receive SSE updates (values remain whatever is in-memory).

### `replane.disconnect()`

Gracefully shuts down the Replane client and cleans up resources. Safe to call multiple times. Use this in environments where you manage resource lifecycles explicitly (e.g. shutting down a server or worker).

```ts
// During shutdown
replane.disconnect();
```

### Errors

`replane.connect()` throws if the initial request to fetch configs fails with non‑2xx HTTP responses and network errors. A `ReplaneError` is thrown for HTTP failures; other errors may be thrown for network/parse issues.

The Replane client receives realtime updates via SSE in the background. SSE connection errors are logged and automatically retried, but don't affect `get` calls (which return the last known value).

## Environment notes

- Node 18+ has global `fetch`; for older Node versions supply `fetchFn`.
- Edge runtimes / Workers: provide a compatible `fetch` + `AbortController` if not built‑in.

## Common patterns

### Typed config

```ts
interface LayoutConfig {
  variant: "a" | "b";
  ttl: number;
}

interface Configs {
  layout: LayoutConfig;
}

const replane = new Replane<Configs>();
await replane.connect({
  sdkKey: process.env.REPLANE_SDK_KEY!,
  baseUrl: "https://replane.my-host.com",
});

const layout = replane.get("layout"); // TypeScript knows this is LayoutConfig
console.log(layout); // { variant: "a", ttl: 3600 }
```

### Context-based overrides

```ts
interface Configs {
  "advanced-features": boolean;
}

const replane = new Replane<Configs>();
await replane.connect({
  sdkKey: process.env.REPLANE_SDK_KEY!,
  baseUrl: "https://replane.my-host.com",
});

// Config has base value `false` but override: if `plan === "premium"` then `true`

// Free user
const freeUserEnabled = replane.get("advanced-features", {
  context: { plan: "free" },
}); // false

// Premium user
const premiumUserEnabled = replane.get("advanced-features", {
  context: { plan: "premium" },
}); // true
```

### Client-level context

```ts
interface Configs {
  "feature-flag": boolean;
}

const replane = new Replane<Configs>({
  context: {
    userId: "user-123",
    region: "us-east",
  },
});
await replane.connect({
  sdkKey: process.env.REPLANE_SDK_KEY!,
  baseUrl: "https://replane.my-host.com",
});

// This context is used for all configs unless overridden
const value1 = replane.get("feature-flag"); // Uses client-level context
const value2 = replane.get("feature-flag", {
  context: { userId: "user-321" },
}); // Merges with client context
```

### Custom fetch (tests)

```ts
const replane = new Replane();
await replane.connect({
  sdkKey: "TKN",
  baseUrl: "https://api",
  fetchFn: mockFetch,
});
```

### Default configs

```ts
interface Configs {
  "feature-flag": boolean;
  "max-connections": number;
  "timeout-ms": number;
}

const replane = new Replane<Configs>({
  defaults: {
    "feature-flag": false, // Use false if fetch fails
    "max-connections": 10, // Use 10 if fetch fails
    "timeout-ms": 5000, // Use 5s if fetch fails
  },
});
await replane.connect({
  sdkKey: process.env.REPLANE_SDK_KEY!,
  baseUrl: "https://replane.my-host.com",
});

// If the initial fetch fails or times out, default values are used
// Once the client connects, it will receive realtime updates
const maxConnections = replane.get("max-connections"); // 10 (or real value)
```

### Multiple projects

```ts
interface ProjectAConfigs {
  "feature-flag": boolean;
  "max-users": number;
}

interface ProjectBConfigs {
  "feature-flag": boolean;
  "api-rate-limit": number;
}

// Each project needs its own SDK key and Replane client instance
const projectAConfigs = new Replane<ProjectAConfigs>();
await projectAConfigs.connect({
  sdkKey: process.env.PROJECT_A_SDK_KEY!,
  baseUrl: "https://replane.my-host.com",
});

const projectBConfigs = new Replane<ProjectBConfigs>();
await projectBConfigs.connect({
  sdkKey: process.env.PROJECT_B_SDK_KEY!,
  baseUrl: "https://replane.my-host.com",
});

// Each Replane client only accesses configs from its respective project
const featureA = projectAConfigs.get("feature-flag"); // boolean
const featureB = projectBConfigs.get("feature-flag"); // boolean
```

### Subscriptions

```ts
interface Configs {
  "feature-flag": boolean;
  "max-users": number;
}

const replane = new Replane<Configs>();
await replane.connect({
  sdkKey: process.env.REPLANE_SDK_KEY!,
  baseUrl: "https://replane.my-host.com",
});

// Subscribe to specific configs
const unsubscribeFeature = replane.subscribe("feature-flag", (config) => {
  console.log("Feature flag changed:", config.value);
  // config.value is automatically typed as boolean
});

const unsubscribeMaxUsers = replane.subscribe("max-users", (config) => {
  console.log("Max users changed:", config.value);
  // config.value is automatically typed as number
});

// Cleanup
unsubscribeFeature();
unsubscribeMaxUsers();
replane.disconnect();
```

## Framework SDKs

For React, Next.js, and Svelte applications, use the dedicated framework SDKs which provide hooks, context providers, and SSR support:

| Framework   | Package             | Description                              |
| ----------- | ------------------- | ---------------------------------------- |
| **React**   | `@replanejs/react`  | Hooks and context for React apps         |
| **Next.js** | `@replanejs/next`   | SSR/SSG support for Next.js              |
| **Svelte**  | `@replanejs/svelte` | Reactive stores for Svelte and SvelteKit |

See the [examples directory](./examples/) for runtime-specific examples (Node.js, Bun, Deno, Browser).

## Community

Have questions or want to discuss Replane? Join the conversation in [GitHub Discussions](https://github.com/orgs/replane-dev/discussions).

## License

MIT
