import { resolveOpenAiEmbeddingsUrl } from './openai-embeddings-url';
// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createEmbedder(config, dimensions) {
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
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
/** Truncate to stay within token limits. Conservative: ~10K chars ≈ 4-6K tokens. */
function truncate(text, maxChars = 10000) {
    return text.length > maxChars ? text.slice(0, maxChars) : text;
}
/** Run an async function over an array with bounded concurrency. */
async function parallelMap(items, fn, concurrency, signal) {
    const results = new Array(items.length);
    let cursor = 0;
    const worker = async () => {
        while (cursor < items.length) {
            if (signal?.aborted)
                throw new Error('Aborted');
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
function formatEmbeddingsErrorBody(bodyText, maxLen = 200) {
    let display = bodyText;
    try {
        const parsed = JSON.parse(bodyText);
        display = JSON.stringify(parsed, null, 2);
    }
    catch {
        // keep original text
    }
    return display.slice(0, maxLen);
}
class OpenAIEmbedder {
    apiKey;
    model;
    dimensions;
    embeddingsUrl;
    constructor(apiKey, model, dimensions, baseUrl) {
        this.apiKey = apiKey;
        this.model = model;
        this.dimensions = dimensions;
        this.embeddingsUrl = resolveOpenAiEmbeddingsUrl(baseUrl);
    }
    async embed(text, signal) {
        const results = await this.embedBatch([text], signal);
        if (!results[0])
            throw new Error('Embedding failed — provider returned no vector');
        return results[0];
    }
    async embedBatch(texts, signal) {
        // OpenAI supports batch embedding natively (up to 2048 inputs).
        // Chunk into groups of 100 to stay safe on payload size.
        const BATCH = 100;
        const results = new Array(texts.length);
        for (let i = 0; i < texts.length; i += BATCH) {
            if (signal?.aborted)
                throw new Error('Aborted');
            const batch = texts.slice(i, i + BATCH).map(t => truncate(t));
            try {
                const headers = {
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
                const json = await res.json();
                if (!json ||
                    typeof json !== 'object' ||
                    !('data' in json) ||
                    !Array.isArray(json.data)) {
                    throw new Error('Embeddings API: invalid response (expected JSON with data array)');
                }
                const rows = json.data;
                for (const item of rows) {
                    if (item && typeof item.index === 'number' && Array.isArray(item.embedding)) {
                        results[i + item.index] = item.embedding;
                    }
                }
            }
            catch (err) {
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
class BedrockEmbedder {
    model;
    dimensions;
    clientPromise;
    constructor(profile, region, model, dimensions) {
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
    async embed(text, signal) {
        const results = await this.embedBatch([text], signal);
        if (!results[0])
            throw new Error('Embedding failed — provider returned no vector');
        return results[0];
    }
    async embedBatch(texts, signal, concurrency = 10) {
        const client = await this.clientPromise;
        return parallelMap(texts, async (text) => {
            try {
                return await this.callBedrock(client, text);
            }
            catch (err) {
                console.error(`Bedrock embedding failed (${text.slice(0, 50)}...): ${errorMessage(err)}`);
                return null;
            }
        }, concurrency, signal);
    }
    async callBedrock(client, text) {
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
class OllamaEmbedder {
    url;
    model;
    constructor(url, model) {
        this.url = url.replace(/\/$/, '');
        this.model = model;
    }
    async embed(text, signal) {
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
        const json = (await res.json());
        return json.embeddings[0];
    }
    async embedBatch(texts, signal, concurrency = 4) {
        // Ollama /api/embed supports batch via `input` array
        // but some models/versions don't. Fall back to parallel single calls.
        return parallelMap(texts, async (text) => {
            try {
                return await this.embed(text, signal);
            }
            catch (err) {
                console.error(`Ollama embedding failed (${text.slice(0, 50)}...): ${errorMessage(err)}`);
                return null;
            }
        }, concurrency, signal);
    }
}
//# sourceMappingURL=embedder.js.map