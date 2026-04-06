export interface EngramMetadata {
    category?: string;
    tags?: string[];
    durability?: string;
    agent?: string;
    date?: string;
    source?: string;
    trigger?: string;
    antiTrigger?: string;
    supersedes?: string;
}
export interface EngramWriteParams {
    title: string;
    category: string;
    tags: string[];
    durability: string;
    agent: string;
    source: string;
    context: string;
    insight: string;
    trigger: string;
    anti_trigger: string;
    supersedes?: string;
}
/**
 * Extract YAML frontmatter and body from a raw markdown string.
 * Returns parsed metadata and the remaining body text.
 */
export declare function parseFrontmatter(raw: string): {
    metadata: EngramMetadata;
    body: string;
};
/**
 * Render a complete engram markdown document from structured parameters.
 */
export declare function renderEngram(params: EngramWriteParams): string;
/**
 * Convert a title string into a filename-safe slug.
 */
export declare function slugify(title: string): string;
//# sourceMappingURL=frontmatter.d.ts.map