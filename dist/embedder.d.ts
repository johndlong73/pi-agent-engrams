import type { ProviderConfig } from './config';
/**
 * Unified embedding interface. Implementations for OpenAI, Bedrock, and Ollama.
 */
export interface Embedder {
    embed(text: string, signal?: AbortSignal): Promise<number[]>;
    embedBatch(texts: string[], signal?: AbortSignal, concurrency?: number): Promise<(number[] | null)[]>;
}
export declare function createEmbedder(config: ProviderConfig, dimensions: number): Embedder;
//# sourceMappingURL=embedder.d.ts.map