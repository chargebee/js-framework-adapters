# @chargebee/usage-meter

Drop-in LLM usage meter for Chargebee. Wrap any LLM client and stream normalized
token usage to Chargebee's [Usage Events API](https://apidocs.chargebee.com/docs/api/usage_events).
Records show up immediately in the customer's existing Chargebee usage view,
pending invoices, reports, exports, and threshold alerts.

New here? Read [`GETTING_STARTED.md`](./GETTING_STARTED.md) for a 5-minute
tour. For an in-depth walkthrough of how the package works internally, see
[`IMPLEMENTATION.md`](./IMPLEMENTATION.md).

```ts
import OpenAI from "openai";
import Chargebee from "chargebee";
import { UsageMeter } from "@chargebee/usage-meter";

const chargebee = new Chargebee({
  site: process.env.CHARGEBEE_SITE!,
  apiKey: process.env.CHARGEBEE_API_KEY!,
});

const meter = new UsageMeter({
  chargebee,
  defaultSubscriptionId: "sub_acme_starter",
  metricMapping: {
    input:  "input_tokens",
    output: "output_tokens",
  },
});

const openai = meter.wrap(new OpenAI());

await openai.chat.completions.create({
  model: "gpt-5",
  messages: [{ role: "user", content: "Hi" }],
});

await meter.flush();
```

## Trust contract

1. The wrapped LLM call **never fails because of instrumentation**. All
   adapter, normalization, queueing, and HTTP work is wrapped in `try`/`catch`;
   errors go to `onError`, never to the caller; the LLM response is returned
   unmodified.
2. The audit story is **Chargebee's existing surfaces**. No shadow database,
   no proprietary dashboard.

## Subscription resolution

Three tiers, evaluated in order:

1. **Per-call** — `meter.withContext({ subscriptionId, properties }, () => ...)`
2. **Context-bound** — `meter.withSubscription(subId, async () => { ... })`
   (uses `AsyncLocalStorage`, safe for concurrent request handlers).
3. **Default** — `defaultSubscriptionId` on `MeterOptions`.

## Built-in adapters

Every adapter supports both **non-streaming and native streaming** calls
through the same `meter.wrap(client)` entry point — no separate
`trackUsageStream*` functions to remember.

| Provider          | Methods covered                                                                       | Streaming notes                                                                 |
| ----------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **OpenAI**        | `chat.completions.create`, `responses.create`, `completions.create`, `embeddings.create` | Auto-injects `stream_options: { include_usage: true }` so usage actually flows. |
| **Anthropic**     | `messages.create`                                                                     | Accumulates `input` + cache fields from `message_start`; final `output_tokens` from `message_delta`. |
| **AWS Bedrock**   | `BedrockRuntimeClient.send` with `ConverseCommand` / `ConverseStreamCommand`          | Stream wrapper preserves `{ stream, $metadata }`; usage from the `metadata` event. |
| **Google Gemini** | `models.generateContent`, `models.generateContentStream`                              | Records the cumulative `usageMetadata` from the final chunk.                    |
| **Vercel AI SDK** | All providers transitively via middleware                                              | Import from `@chargebee/usage-meter/ai-sdk`. Streaming via the `finish` chunk.  |

## Custom adapter

For models we don't natively support, implement the `Adapter` interface and
register it on the meter:

```ts
import { type Adapter, type CanonicalUsage, UsageMeter } from "@chargebee/usage-meter";

const myAdapter: Adapter<MyClient> = {
  name: "my-custom-llm",
  matches: (client): client is MyClient => client instanceof MyClient,
  wrap(client, ctx) {
    return new Proxy(client, {
      get(target, prop, receiver) {
        const original = Reflect.get(target, prop, receiver);
        if (prop !== "complete" || typeof original !== "function") return original;
        return async (...args: unknown[]) => {
          const result = await original.apply(target, args);
          try {
            ctx.record(this.extractUsage(result));
          } catch (err) {
            ctx.onError(err as Error, "extractUsage");
          }
          return result;
        };
      },
    });
  },
  extractUsage(result): Partial<CanonicalUsage> {
    return {
      input:  result.metrics.prompt_count,
      output: result.metrics.completion_count,
    };
  },
};

meter.registerAdapter(myAdapter);
```

## Configuration

| Option                  | Default                | Meaning                                                                |
| ----------------------- | ---------------------- | ---------------------------------------------------------------------- |
| `chargebee`             | required               | Pre-built `Chargebee` client (peer dep).                               |
| `defaultSubscriptionId` | —                      | Subscription to bill when no per-call / context override is present.   |
| `metricMapping`         | identity (see types)   | Canonical field → Chargebee usage-event property key.                  |
| `defaultProperties`     | `{}`                   | Merged into every event's `properties` (e.g. `{ env: "prod" }`).       |
| `flushIntervalMs`       | `1000`                 | Background flush cadence.                                              |
| `maxBatchSize`          | `100`                  | Max events per `batchIngest` request (capped at Chargebee's 500).      |
| `maxBufferSize`         | `10_000`               | Hard cap on buffered events; oldest events dropped on overflow.        |
| `maxRetryMs`            | `60_000`               | Max exponential backoff between retries.                               |
| `flushMode`             | `"background"`         | `"onCall"` for edge runtimes (no `setInterval`).                       |
| `onError`               | `console.error`        | Called for every internal failure: `(err, where) => void`.             |

## Canonical usage shape

| Canonical field   | Default property key      | Meaning                                       |
| ----------------- | ------------------------- | --------------------------------------------- |
| `input`           | `input_tokens`            | Prompt tokens                                 |
| `output`          | `output_tokens`           | Completion tokens                             |
| `cache_read`      | `cache_read_tokens`       | Prompt tokens served from cache               |
| `cache_write`     | `cache_write_tokens`      | Prompt tokens written to cache (default TTL)  |
| `cache_write_5m`  | `cache_write_5m_tokens`   | 5-minute TTL cache write                      |
| `cache_write_1h`  | `cache_write_1h_tokens`   | 1-hour TTL cache write                        |
| `reasoning`       | `reasoning_tokens`        | Reasoning / thinking tokens                   |
| `tool_calls`      | `tool_calls`              | Tool / function invocation count              |
| `image_input`     | `image_input_tokens`      | Image input tokens                            |
| `audio_input`     | `audio_input_tokens`      | Audio input tokens                            |
