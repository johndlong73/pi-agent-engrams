import type { ProviderConfig } from './config';
import { resolveOpenAiEmbeddingsUrl } from './openai-embeddings-url';

/**
 * Unified embedding interface. Implementations for OpenAI, Bedrock, and Ollama.
 */
export interface Embedder {
  embed(text: string, signal?: AbortSignal): Promise<number[]>;
  embedBatch(
    texts: string[],
    signal?: AbortSignal,
    concurrency?: number
  ): Promise<(number[] | null)[]>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEmbedder(config: ProviderConfig, dimensions: number): Embedder {
  switch (config.type) {
    case 'openai':
      return new OpenAIEmbedder(config.apiKey, config.model, dimensions, config.baseUrl);
    case 'bedrock':
      return new BedrockEmbedder(config.profile, config.region, config.model, dimensions);
    case 'ollama':
      return new OllamaEmbedder(config.url, config.model);
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Truncate to stay within token limits. Conservative: ~10K chars ≈ 4-6K tokens. */
function truncate(text: string, maxChars = 10000): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

/** Run an async function over an array with bounded concurrency. */
async function parallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
  signal?: AbortSignal
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < items.length) {
      if (signal?.aborted) throw new Error('Aborted');
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

/** Format error body for logs; pretty-print JSON when possible. */
function formatEmbeddingsErrorBody(bodyText: string, maxLen = 200): string {
  let display = bodyText;
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    display = JSON.stringify(parsed, null, 2);
  } catch {
    // keep original text
  }
  return display.slice(0, maxLen);
}

class OpenAIEmbedder implements Embedder {
  private apiKey: string;
  private model: string;
  private dimensions: number;
  private embeddingsUrl: string;

  constructor(apiKey: string, model: string, dimensions: number, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions;
    this.embeddingsUrl = resolveOpenAiEmbeddingsUrl(baseUrl);
  }

  async embed(text: string, signal?: AbortSignal): Promise<number[]> {
    const results = await this.embedBatch([text], signal);
    if (!results[0]) throw new Error('Embedding failed — provider returned no vector');
    return results[0];
  }

  async embedBatch(texts: string[], signal?: AbortSignal): Promise<(number[] | null)[]> {
    // OpenAI supports batch embedding natively (up to 2048 inputs).
    // Chunk into groups of 100 to stay safe on payload size.
    const BATCH = 100;
    const results: (number[] | null)[] = new Array(texts.length);

    for (let i = 0; i < texts.length; i += BATCH) {
      if (signal?.aborted) throw new Error('Aborted');
      const batch = texts.slice(i, i + BATCH).map(t => truncate(t));

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (this.apiKey) {
          headers.Authorization = `Bearer ${this.apiKey}`;
        }

        const res = await fetch(this.embeddingsUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            input: batch,
            model: this.model,
            dimensions: this.dimensions,
          }),
          signal,
        });

        if (!res.ok) {
          const bodyText = await res.text();
          throw new Error(`Embeddings API ${res.status}: ${formatEmbeddingsErrorBody(bodyText)}`);
        }

        const json: unknown = await res.json();
        if (
          !json ||
          typeof json !== 'object' ||
          !('data' in json) ||
          !Array.isArray((json as { data: unknown }).data)
        ) {
          throw new Error('Embeddings API: invalid response (expected JSON with data array)');
        }

        const rows = (json as { data: { embedding: number[]; index: number }[] }).data;
        for (const item of rows) {
          if (item && typeof item.index === 'number' && Array.isArray(item.embedding)) {
            results[i + item.index] = item.embedding;
          }
        }
      } catch (err: unknown) {
        // Mark the whole batch as failed
        for (let j = 0; j < batch.length; j++) {
          results[i + j] = null;
        }
        console.error(`OpenAI batch embedding failed: ${errorMessage(err)}`);
      }
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Bedrock (Titan)
// ---------------------------------------------------------------------------

/** Structural type for optional Bedrock client (lazy-loaded SDK). */
interface BedrockInvokeClient {
  send(command: unknown): Promise<{ body: Uint8Array }>;
}

class BedrockEmbedder implements Embedder {
  private model: string;
  private dimensions: number;
  private clientPromise: Promise<BedrockInvokeClient>;

  constructor(profile: string, region: string, model: string, dimensions: number) {
    this.model = model;
    this.dimensions = dimensions;

    // Lazy-load the AWS SDK — it's an optional dependency
    this.clientPromise = (async () => {
      const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
      const { fromIni } = await import('@aws-sdk/credential-providers');
      return new BedrockRuntimeClient({
        region,
        credentials: fromIni({ profile }),
      });
    })();
  }

  async embed(text: string, signal?: AbortSignal): Promise<number[]> {
    const results = await this.embedBatch([text], signal);
    if (!results[0]) throw new Error('Embedding failed — provider returned no vector');
    return results[0];
  }

  async embedBatch(
    texts: string[],
    signal?: AbortSignal,
    concurrency = 10
  ): Promise<(number[] | null)[]> {
    const client = await this.clientPromise;

    return parallelMap(
      texts,
      async text => {
        try {
          return await this.callBedrock(client, text);
        } catch (err: unknown) {
          console.error(`Bedrock embedding failed (${text.slice(0, 50)}...): ${errorMessage(err)}`);
          return null;
        }
      },
      concurrency,
      signal
    );
  }

  private async callBedrock(client: BedrockInvokeClient, text: string): Promise<number[]> {
    const { InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');

    const body = JSON.stringify({
      inputText: truncate(text),
      dimensions: this.dimensions,
      normalize: true,
    });

    const command = new InvokeModelCommand({
      modelId: this.model,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(body),
    });

    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (!responseBody.embedding) {
      throw new Error('Unexpected Bedrock response: ' + JSON.stringify(responseBody).slice(0, 200));
    }
    return responseBody.embedding;
  }
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

class OllamaEmbedder implements Embedder {
  private url: string;
  private model: string;

  constructor(url: string, model: string) {
    this.url = url.replace(/\/$/, '');
    this.model = model;
  }

  async embed(text: string, signal?: AbortSignal): Promise<number[]> {
    const res = await fetch(`${this.url}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: truncate(text) }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama API ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { embeddings: number[][] };
    return json.embeddings[0];
  }

  async embedBatch(
    texts: string[],
    signal?: AbortSignal,
    concurrency = 4
  ): Promise<(number[] | null)[]> {
    // Ollama /api/embed supports batch via `input` array
    // but some models/versions don't. Fall back to parallel single calls.
    return parallelMap(
      texts,
      async text => {
        try {
          return await this.embed(text, signal);
        } catch (err: unknown) {
          console.error(`Ollama embedding failed (${text.slice(0, 50)}...): ${errorMessage(err)}`);
          return null;
        }
      },
      concurrency,
      signal
    );
  }
}
