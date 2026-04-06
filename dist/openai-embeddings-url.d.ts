/**
 * Embeddings requests must use HTTP or HTTPS only (no javascript:, file:, etc.).
 */
export declare function assertHttpOrHttpsEmbeddingsUrl(urlStr: string): void;
/**
 * Build the full URL for OpenAI-compatible POST /v1/embeddings.
 * @param baseUrl - Optional origin (or origin + /v1). Empty/undefined uses https://api.openai.com
 */
export declare function resolveOpenAiEmbeddingsUrl(baseUrl?: string): string;
/**
 * OpenAI's official API requires a key. Local OpenAI-compatible servers (e.g. omlx) may not.
 */
export declare function openAiEmbeddingsRequiresApiKey(embeddingsUrl: string): boolean;
//# sourceMappingURL=openai-embeddings-url.d.ts.map