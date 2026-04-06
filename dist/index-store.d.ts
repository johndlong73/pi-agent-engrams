import type { Config } from './config';
import type { Embedder } from './embedder';
import { type EngramMetadata } from './frontmatter';
export interface SearchFilters {
    category?: string;
    agent?: string;
    durability?: string;
    tags?: string[];
}
export interface SearchResult {
    path: string;
    score: number;
    excerpt: string;
    metadata: EngramMetadata;
}
export declare class EngramIndex {
    private config;
    private embedder;
    private data;
    private dirty;
    private saveTimer;
    constructor(config: Config, embedder: Embedder);
    size(): number;
    load(): Promise<void>;
    private save;
    scheduleSave(): void;
    sync(): Promise<{
        added: number;
        updated: number;
        removed: number;
    }>;
    rebuild(): Promise<void>;
    search(query: string, limit: number, filters?: SearchFilters, signal?: AbortSignal): Promise<SearchResult[]>;
    updateFile(absPath: string, sourceDir: string): Promise<void>;
    removeFile(absPath: string): void;
    private scanAllFiles;
    private walkDir;
    private shouldSkip;
    /**
     * Read a file and parse its frontmatter. Returns the full raw content
     * (frontmatter included) for embedding, plus the parsed metadata.
     */
    private readAndParseFile;
}
//# sourceMappingURL=index-store.d.ts.map