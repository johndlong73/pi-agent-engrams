/* eslint-disable */
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { loadConfig, saveConfig, getConfigPath, } from "./config";
import { createEmbedder } from "./embedder";
import { renderEngram, slugify } from "./frontmatter";
import { EngramIndex } from "./index-store";
import { FileWatcher } from "./watcher";
function errorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
const engramsWriteParametersSchema = Type.Object({
    title: Type.String({ description: "Short descriptive title for the engram" }),
    category: Type.Union([
        Type.Literal("debugging"),
        Type.Literal("api"),
        Type.Literal("architecture"),
        Type.Literal("tooling"),
        Type.Literal("domain"),
        Type.Literal("performance"),
        Type.Literal("testing"),
    ], { description: "Primary knowledge category" }),
    tags: Type.Array(Type.String(), {
        description: "Comma-separated keywords for discoverability",
    }),
    durability: Type.Union([
        Type.Literal("permanent"),
        Type.Literal("workaround"),
        Type.Literal("hypothesis"),
    ], {
        description: "How stable is this knowledge? permanent = verified and stable, workaround = temporary fix, hypothesis = unverified",
    }),
    agent: Type.String({
        description: "Name of the agent authoring this engram",
    }),
    source: Type.String({
        description: "Ticket key, PR URL, or task description that triggered this learning",
    }),
    context: Type.String({
        description: "What situation triggered this learning? Include specific details.",
    }),
    insight: Type.String({
        description: "What was learned? What is the non-obvious part? Be specific.",
    }),
    trigger: Type.String({
        description: "Specific conditions when this engram is relevant (for future retrieval). Include concrete examples.",
    }),
    anti_trigger: Type.String({
        description: "Conditions when this engram should NOT be applied. What would make it wrong to apply this knowledge?",
    }),
    supersedes: Type.Optional(Type.String({
        description: "Relative path to an older engram this replaces (creates an invalidation chain), or omit if none",
    })),
});
const engramsSearchParametersSchema = Type.Object({
    query: Type.String({ description: "Natural language search query" }),
    limit: Type.Optional(Type.Number({
        description: "Max results to return (default 8, max 20)",
    })),
    category: Type.Optional(Type.String({
        description: "Filter by category: debugging, api, architecture, tooling, domain, performance, testing",
    })),
    agent: Type.Optional(Type.String({ description: "Filter by authoring agent name" })),
    durability: Type.Optional(Type.String({
        description: "Filter by durability: permanent, workaround, hypothesis",
    })),
    tags: Type.Optional(Type.Array(Type.String(), {
        description: "Filter by tags (match any)",
    })),
});
export default function (pi) {
    let index = null;
    let watcher = null;
    let currentConfig = null;
    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------
    pi.on("session_start", async (_event, ctx) => {
        try {
            const cfg = loadConfig();
            if (!cfg) {
                ctx.ui.notify("agent-engrams: not configured. Set AGENT_ENGRAMS_DIR or run /engrams-setup.", "warning");
                return;
            }
            currentConfig = cfg;
            fs.mkdirSync(currentConfig.dir, { recursive: true });
            void startIndex(currentConfig, ctx);
        }
        catch (err) {
            ctx.ui.notify(`agent-engrams: ${errorMessage(err)}`, "warning");
        }
    });
    pi.on("session_shutdown", async () => {
        watcher?.stop();
    });
    // ------------------------------------------------------------------
    // System prompt injection for self-improvement flywheel
    // ------------------------------------------------------------------
    pi.on("before_agent_start", async (event, ctx) => {
        // Only inject if we have a working index
        if (!index || index.size() === 0) {
            return;
        }
        const flywheelPrompt = `
## Self-Improvement Flywheel

You are part of a self-improving agent team. The team learns and improves through a flywheel effect:

1. **WRITE** - When you learn something valuable during a task (debugging breakthrough, API quirk, domain pattern, architectural insight), write it as a structured engram using \`engrams_write\`. Each engram compounds the team's collective intelligence.

2. **RECALL** - At the START of any new task, search the engram store using \`engrams_search\` to recall relevant prior knowledge. This helps you avoid rediscovering what others have already learned.

3. **IMPROVE** - Incorporate relevant engrams into your reasoning before proceeding with the task.

**When to write engrams:**
- Debugging breakthroughs (non-obvious fixes, error patterns)
- API quirks (unexpected behavior, edge cases)
- Domain constraints (business rules, edge cases)
- Architectural decisions (patterns, anti-patterns)
- Performance findings (optimizations, bottlenecks)
- Testing patterns (test strategies, mocking techniques)
- Integration patterns (API integrations, data flows)
- Deployment gotchas (environment issues, configuration)

**When NOT to write engrams:**
- Trivial facts (already in documentation)
- One-time configuration values
- Obvious best practices

**Durability guidance:**
- \`permanent\` - Stable knowledge (architectural constraints, stable APIs)
- \`workaround\` - Temporary fixes (likely to be superseded)
- \`hypothesis\` - Unverified insights (needs confirmation)

**Recall strategy:**
- Search at the START of every task
- Use specific queries: "how did we debug X", "what patterns work for Y"
- Filter by durability to avoid outdated workarounds
- Check the \`supersedes\` field to follow invalidation chains
- Incorporate relevant insights into your reasoning

The more engrams that have been written, the better-informed your decisions will be. This is how the team learns and improves over time.
`.trim();
        return {
            systemPrompt: event.systemPrompt + "\n\n" + flywheelPrompt,
        };
    });
    async function startIndex(config, ctx) {
        try {
            const embedder = createEmbedder(config.provider, config.dimensions);
            index = new EngramIndex(config, embedder);
            await index.load();
            const SYNC_TIMEOUT_MS = 60_000;
            const syncResult = await Promise.race([
                index.sync(),
                new Promise((resolve) => setTimeout(() => resolve(null), SYNC_TIMEOUT_MS)),
            ]);
            if (syncResult === null) {
                ctx.ui.notify("agent-engrams: sync timed out (index may be stale)", "warning");
            }
            else {
                const { added, updated, removed } = syncResult;
                const changes = added + updated + removed;
                if (changes > 0) {
                    ctx.ui.setStatus("agent-engrams", `Index: +${added} ~${updated} -${removed} (${index.size()} engrams)`);
                    setTimeout(() => ctx.ui.setStatus("agent-engrams", ""), 5000);
                }
            }
            watcher = new FileWatcher(config, index);
            watcher.start();
        }
        catch (err) {
            ctx.ui.notify(`agent-engrams init failed: ${errorMessage(err)}`, "error");
        }
    }
    // ------------------------------------------------------------------
    // Setup command
    // ------------------------------------------------------------------
    pi.registerCommand("engrams-setup", {
        description: "Configure agent engrams embedding provider",
        handler: async (_args, ctx) => {
            const providerType = await ctx.ui.select("Embedding provider:", [
                "openai",
                "bedrock",
                "ollama",
            ]);
            if (!providerType) {
                ctx.ui.notify("engrams-setup cancelled.", "info");
                return;
            }
            let config = {
                provider: providerType === "openai"
                    ? { type: "openai" }
                    : providerType === "bedrock"
                        ? { type: "bedrock" }
                        : { type: "ollama" },
            };
            // Ask for engram directory (required field)
            const engramDir = await ctx.ui.input("Engram documents directory:", "~/.pi/agent/engrams/docs");
            config.dir = engramDir || "~/.pi/agent/engrams/docs";
            if (providerType === "openai") {
                const url = await ctx.ui.input("OpenAI-compatible API URL:", "http://localhost:11434/v1");
                const model = await ctx.ui.input("Embedding model:", "Qwen3-Embedding-0.6B-4bit-DWQ");
                const apiKey = await ctx.ui.input("API key (optional for local servers):", "");
                config.provider = {
                    type: "openai",
                    baseUrl: url || "http://localhost:11434/v1",
                    model: model || "Qwen3-Embedding-0.6B-4bit-DWQ",
                    apiKey: apiKey?.trim() || "",
                };
            }
            else if (providerType === "bedrock") {
                const profile = await ctx.ui.input("AWS profile:", "default");
                const region = await ctx.ui.input("AWS region:", "us-east-1");
                const model = await ctx.ui.input("Embedding model:", "amazon.titan-embed-text-v2:0");
                config.provider = {
                    type: "bedrock",
                    profile: profile || "default",
                    region: region || "us-east-1",
                    model: model || "amazon.titan-embed-text-v2:0",
                };
            }
            else if (providerType === "ollama") {
                const url = await ctx.ui.input("Ollama URL:", "http://localhost:11434");
                const model = await ctx.ui.input("Embedding model:", "nomic-embed-text");
                config.provider = {
                    type: "ollama",
                    url: url || "http://localhost:11434",
                    model: model || "nomic-embed-text",
                };
            }
            const dims = await ctx.ui.input("Embedding dimensions (vector size):", "512");
            config.dimensions = dims ? parseInt(dims, 10) : 512;
            saveConfig(config);
            ctx.ui.notify(`Config saved to ${getConfigPath()}. Run /reload to activate.`, "info");
        },
    });
    // ------------------------------------------------------------------
    // Reindex command
    // ------------------------------------------------------------------
    pi.registerCommand("engrams-reindex", {
        description: "Force full re-index of all engram documents",
        handler: async (_args, ctx) => {
            if (!index) {
                ctx.ui.notify("agent-engrams: index not initialized. Check embedding provider connection.", "warning");
                return;
            }
            ctx.ui.notify("Re-indexing engrams...", "info");
            try {
                await index.rebuild();
                ctx.ui.notify(`Re-indexed: ${index.size()} engrams`, "info");
            }
            catch (err) {
                ctx.ui.notify(`Re-index failed: ${errorMessage(err)}`, "error");
            }
        },
    });
    // ------------------------------------------------------------------
    // engrams_write tool
    // ------------------------------------------------------------------
    pi.registerTool({
        name: "engrams_write",
        label: "Write Engram",
        description: "Write a structured engram document to the agent memory store. This is the WRITE phase of the self-improvement flywheel: when you learn something valuable during a task — a debugging technique, an API quirk, a domain pattern, an architectural insight — write it down so future agents (including your future self) can recall it. Each engram compounds the team's collective intelligence.",
        promptGuidelines: [
            "Call engrams_write when you discover something non-obvious during a task that future agents (or your future self) should know. This is how the team learns and improves over time.",
            "Good engram candidates: debugging breakthroughs, API quirks, domain constraints, architectural decisions, performance findings, testing patterns, integration patterns, deployment gotchas.",
            "Bad engram candidates: trivial facts, information already in documentation, one-time configuration values, obvious best practices.",
            "Set durability to 'permanent' for stable knowledge (architectural constraints, stable APIs), 'workaround' for temporary fixes (likely to be superseded), 'hypothesis' for unverified insights (needs confirmation).",
            "Be specific in trigger and anti_trigger — vague conditions reduce retrieval quality. Include concrete examples when possible.",
            "If this engram replaces an older one, set the supersedes field to point to the old engram (creates an invalidation chain).",
        ],
        // Cast: pi-coding-agent's TSchema can resolve to a different TypeBox build than this package (CJS/ESM).
        parameters: engramsWriteParametersSchema,
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            const p = params;
            if (!currentConfig) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "agent-engrams is not configured. Run /engrams-setup first.",
                        },
                    ],
                    details: {},
                };
            }
            const markdown = renderEngram(p);
            const date = new Date().toISOString().split("T")[0];
            let filename = `${date}-${slugify(p.title)}.md`;
            let filePath = path.join(currentConfig.dir, filename);
            let suffix = 1;
            while (fs.existsSync(filePath)) {
                filename = `${date}-${slugify(p.title)}-${suffix}.md`;
                filePath = path.join(currentConfig.dir, filename);
                suffix++;
            }
            fs.mkdirSync(currentConfig.dir, { recursive: true });
            fs.writeFileSync(filePath, markdown, "utf-8");
            const home = process.env.HOME || "";
            const displayPath = filePath.replace(home, "~");
            return {
                content: [
                    {
                        type: "text",
                        text: `Engram written: ${displayPath}\n\nTitle: ${p.title}\nCategory: ${p.category}\nDurability: ${p.durability}\nTags: ${p.tags.join(", ")}`,
                    },
                ],
                details: { path: filePath, filename },
            };
        },
    });
    // ------------------------------------------------------------------
    // engrams_search tool
    // ------------------------------------------------------------------
    pi.registerTool({
        name: "engrams_search",
        label: "Search Engrams",
        description: "Semantic search over the agent engram memory store. Returns the most relevant engrams for a natural language query, with optional metadata filtering. Use this at the START of a task to recall relevant prior knowledge from the team's collective memory — this is the RECALL phase of the self-improvement flywheel. The more engrams that have been written, the better-informed your decisions will be.",
        promptGuidelines: [
            "Call engrams_search at the START of a task to recall relevant prior knowledge from the team's collective memory. This helps you avoid rediscovering what others have already learned.",
            'Use for conceptual queries: "how did we debug X", "what patterns work for Y", "known issues with Z", "best practices for W".',
            "Use metadata filters to narrow results: category, agent, durability, tags. Filter by durability to avoid outdated workarounds or unverified hypotheses.",
            "Pay attention to the durability field in results: hypothesis engrams may be unreliable, workaround engrams may be outdated.",
            "Check the supersedes field — if an engram supersedes another, prefer the newer one (invalidation chain).",
            "If you find relevant engrams, incorporate their insights into your reasoning before proceeding with the task.",
        ],
        parameters: engramsSearchParametersSchema,
        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
            const p = params;
            if (!index || index.size() === 0) {
                const msg = !index
                    ? "agent-engrams: index not initialized. Check embedding provider connection."
                    : "Engram index is empty — no engrams have been written yet.";
                return { content: [{ type: "text", text: msg }], details: {} };
            }
            const limit = Math.min(p.limit ?? 8, 20);
            const filters = {};
            if (p.category)
                filters.category = p.category;
            if (p.agent)
                filters.agent = p.agent;
            if (p.durability)
                filters.durability = p.durability;
            if (p.tags && p.tags.length > 0)
                filters.tags = p.tags;
            const hasFilters = Object.keys(filters).length > 0;
            try {
                const results = await index.search(p.query, limit, hasFilters ? filters : undefined, signal);
                if (results.length === 0) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `No relevant engrams found for: "${p.query}"`,
                            },
                        ],
                        details: {},
                    };
                }
                const home = process.env.HOME || "";
                const output = results
                    .map((r, i) => {
                    const displayPath = r.path.replace(home, "~");
                    const score = (r.score * 100).toFixed(1);
                    const m = r.metadata;
                    const metaLine = [
                        m.category && `Category: ${m.category}`,
                        m.durability && `Durability: ${m.durability}`,
                        m.agent && `Agent: ${m.agent}`,
                        m.tags?.length && `Tags: ${m.tags.join(", ")}`,
                        m.supersedes && `Supersedes: ${m.supersedes}`,
                    ]
                        .filter(Boolean)
                        .join(" | ");
                    return `### ${i + 1}. ${displayPath} (${score}% match)\n${metaLine}\n\n${r.excerpt}`;
                })
                    .join("\n\n---\n\n");
                const header = `Found ${results.length} engrams for "${p.query}" (${index.size()} total indexed):\n\n`;
                return {
                    content: [{ type: "text", text: header + output }],
                    details: { resultCount: results.length, indexSize: index.size() },
                };
            }
            catch (err) {
                throw new Error(`engrams_search failed: ${errorMessage(err)}`);
            }
        },
    });
}
//# sourceMappingURL=index.js.map