export interface Config {
    /** Directory to index (engrams) */
    dir: string;
    /** Embedding dimensions */
    dimensions: number;
    /** Embedding provider config */
    provider: ProviderConfig;
    /** Where to store the index */
    indexDir: string;
}
export type ProviderConfig = {
    type: 'openai';
    apiKey: string;
    model: string;
    baseUrl?: string;
} | {
    type: 'bedrock';
    profile: string;
    region: string;
    model: string;
} | {
    type: 'ollama';
    url: string;
    model: string;
};
/** Raw shape stored in the config file. */
export interface ConfigFile {
    dir?: string;
    dimensions?: number;
    provider: {
        type: 'openai';
        apiKey?: string;
        model?: string;
        baseUrl?: string;
    } | {
        type: 'bedrock';
        profile?: string;
        region?: string;
        model?: string;
    } | {
        type: 'ollama';
        url?: string;
        model?: string;
    };
}
/** Default when no model is set (suited to local OpenAI-compatible servers such as omlx). */
export declare const DEFAULT_OPENAI_EMBEDDING_MODEL = "Qwen3-Embedding-0.6B-4bit-DWQ";
export declare function getConfigPath(): string;
/**
 * Load config from file, with env var overrides.
 * Returns null if no config file exists (needs setup).
 */
export declare function loadConfig(): Config | null;
/**
 * Save config to file.
 */
export declare function saveConfig(config: ConfigFile): void;
//# sourceMappingURL=config.d.ts.map