import YAML from 'yaml';
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
/**
 * Extract YAML frontmatter and body from a raw markdown string.
 * Returns parsed metadata and the remaining body text.
 */
export function parseFrontmatter(raw) {
    const match = raw.match(FRONTMATTER_RE);
    if (!match) {
        return { metadata: {}, body: raw };
    }
    let parsed = {};
    try {
        parsed = YAML.parse(match[1]) ?? {};
    }
    catch {
        return { metadata: {}, body: raw.replace(FRONTMATTER_RE, '') };
    }
    const metadata = {};
    if (typeof parsed.Category === 'string')
        metadata.category = parsed.Category.toLowerCase();
    if (typeof parsed.Tags === 'string') {
        metadata.tags = parsed.Tags.split(',')
            .map((t) => t.trim())
            .filter(Boolean);
    }
    if (typeof parsed.Durability === 'string')
        metadata.durability = parsed.Durability.toLowerCase();
    if (typeof parsed.Agent === 'string')
        metadata.agent = parsed.Agent;
    if (typeof parsed.Date === 'string')
        metadata.date = parsed.Date;
    if (typeof parsed.Source === 'string')
        metadata.source = parsed.Source;
    if (typeof parsed.Trigger === 'string')
        metadata.trigger = parsed.Trigger;
    if (typeof parsed['Anti-trigger'] === 'string')
        metadata.antiTrigger = parsed['Anti-trigger'];
    if (typeof parsed.Supersedes === 'string' && parsed.Supersedes !== 'None') {
        metadata.supersedes = parsed.Supersedes;
    }
    const body = raw.replace(FRONTMATTER_RE, '');
    return { metadata, body };
}
/**
 * Render a complete engram markdown document from structured parameters.
 */
export function renderEngram(params) {
    const date = new Date().toISOString().split('T')[0];
    const supersedes = params.supersedes || 'None';
    return `---
Category: ${params.category}
Tags: ${params.tags.join(', ')}
Durability: ${params.durability}
Agent: ${params.agent}
Date: ${date}
Source: ${params.source}
---

# ${params.title}

## Context

${params.context}

## Insight

${params.insight}

## Application

**Trigger:** ${params.trigger}
**Anti-trigger:** ${params.anti_trigger}

## Supersedes

${supersedes}
`;
}
/**
 * Convert a title string into a filename-safe slug.
 */
export function slugify(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);
}
//# sourceMappingURL=frontmatter.js.map