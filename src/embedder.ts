import type { OllamaConfig } from "./config";

export interface Embedder {
  embed(text: string, signal?: AbortSignal): Promise<number[]>;
  embedBatch(
    texts: string[],
    signal?: AbortSignal,
    concurrency?: number
  ): Promise<(number[] | null)[]>;
}

export function createEmbedder(config: OllamaConfig): Embedder {
  return new OllamaEmbedder(config.url, config.model);
}

/** Truncate to stay within token limits. Conservative: ~10K chars ≈ 4-6K tokens. */
function truncate(text: string, maxChars = 10000): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

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
      if (signal?.aborted) throw new Error("Aborted");
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

class OllamaEmbedder implements Embedder {
  private url: string;
  private model: string;

  constructor(url: string, model: string) {
    this.url = url.replace(/\/$/, "");
    this.model = model;
  }

  async embed(text: string, signal?: AbortSignal): Promise<number[]> {
    const res = await fetch(`${this.url}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    return parallelMap(
      texts,
      async (text) => {
        try {
          return await this.embed(text, signal);
        } catch (err: any) {
          console.error(
            `agent-engrams: embedding failed (${text.slice(0, 50)}...): ${err.message}`
          );
          return null;
        }
      },
      concurrency,
      signal
    );
  }
}
