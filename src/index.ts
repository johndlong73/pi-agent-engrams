import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { loadConfig, saveConfig, getConfigPath, type Config } from "./config";
import { createEmbedder } from "./embedder";
import { renderEngram, slugify } from "./frontmatter";
import { EngramIndex } from "./index-store";
import { FileWatcher } from "./watcher";

export default function (pi: ExtensionAPI) {
  let index: EngramIndex | null = null;
  let watcher: FileWatcher | null = null;
  let currentConfig: Config | null = null;

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    try {
      currentConfig = loadConfig();
    } catch (err: any) {
      ctx.ui.notify(`agent-engrams: ${err.message}`, "warning");
      return;
    }

    fs.mkdirSync(currentConfig.engramsDir, { recursive: true });

    void startIndex(currentConfig, ctx);
  });

  pi.on("session_shutdown", async () => {
    watcher?.stop();
  });

  async function startIndex(config: Config, ctx: any) {
    try {
      const embedder = createEmbedder(config.ollama);
      index = new EngramIndex(config, embedder);
      await index.load();

      const SYNC_TIMEOUT_MS = 60_000;
      const syncResult = await Promise.race([
        index.sync(),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), SYNC_TIMEOUT_MS)
        ),
      ]);

      if (syncResult === null) {
        ctx.ui.notify(
          "agent-engrams: sync timed out (index may be stale)",
          "warning"
        );
      } else {
        const { added, updated, removed } = syncResult;
        const changes = added + updated + removed;
        if (changes > 0) {
          ctx.ui.setStatus(
            "agent-engrams",
            `Index: +${added} ~${updated} -${removed} (${index.size()} engrams)`
          );
          setTimeout(() => ctx.ui.setStatus("agent-engrams", ""), 5000);
        }
      }

      watcher = new FileWatcher(config, index);
      watcher.start();
    } catch (err: any) {
      ctx.ui.notify(`agent-engrams init failed: ${err.message}`, "error");
    }
  }

  // ------------------------------------------------------------------
  // Setup command
  // ------------------------------------------------------------------

  pi.registerCommand("engrams-setup", {
    description: "Configure agent engrams Ollama connection",
    handler: async (_args, ctx) => {
      const url = await ctx.ui.input(
        "Ollama URL:",
        "http://localhost:11434"
      );
      const model = await ctx.ui.input("Embedding model:", "nomic-embed-text");
      const dims = await ctx.ui.input("Embedding dimensions:", "512");

      saveConfig({
        ollama: {
          url: url || "http://localhost:11434",
          model: model || "nomic-embed-text",
        },
        dimensions: dims ? parseInt(dims, 10) : 512,
      });

      ctx.ui.notify(
        `Config saved to ${getConfigPath()}. Run /reload to activate.`,
        "success"
      );
    },
  });

  // ------------------------------------------------------------------
  // Reindex command
  // ------------------------------------------------------------------

  pi.registerCommand("engrams-reindex", {
    description: "Force full re-index of all engram documents",
    handler: async (_args, ctx) => {
      if (!index) {
        ctx.ui.notify(
          "agent-engrams: index not initialized. Check Ollama connection.",
          "warning"
        );
        return;
      }
      ctx.ui.notify("Re-indexing engrams...", "info");
      try {
        await index.rebuild();
        ctx.ui.notify(`Re-indexed: ${index.size()} engrams`, "success");
      } catch (err: any) {
        ctx.ui.notify(`Re-index failed: ${err.message}`, "error");
      }
    },
  });

  // ------------------------------------------------------------------
  // engrams_write tool
  // ------------------------------------------------------------------

  pi.registerTool({
    name: "engrams_write",
    label: "Write Engram",
    description:
      "Write a structured engram document to the agent memory store. Use this when you learn something non-obvious during a task — a debugging technique, an API quirk, a domain pattern, an architectural insight — that would be valuable to recall in future sessions.",
    promptGuidelines: [
      "Call engrams_write when you discover something non-obvious during a task that future agents (or your future self) should know.",
      "Good engram candidates: debugging breakthroughs, API quirks, domain constraints, architectural decisions, performance findings, testing patterns.",
      "Bad engram candidates: trivial facts, information already in documentation, one-time configuration values.",
      "Set durability to 'permanent' for stable knowledge, 'workaround' for temporary fixes, 'hypothesis' for unverified insights.",
      "Be specific in trigger and anti_trigger — vague conditions reduce retrieval quality.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Short descriptive title for the engram" }),
      category: Type.Union(
        [
          Type.Literal("debugging"),
          Type.Literal("api"),
          Type.Literal("architecture"),
          Type.Literal("tooling"),
          Type.Literal("domain"),
          Type.Literal("performance"),
          Type.Literal("testing"),
        ],
        { description: "Primary knowledge category" }
      ),
      tags: Type.Array(Type.String(), {
        description: "Comma-separated keywords for discoverability",
      }),
      durability: Type.Union(
        [
          Type.Literal("permanent"),
          Type.Literal("workaround"),
          Type.Literal("hypothesis"),
        ],
        {
          description:
            "How stable is this knowledge? permanent = verified and stable, workaround = temporary fix, hypothesis = unverified",
        }
      ),
      agent: Type.String({
        description: "Name of the agent authoring this engram",
      }),
      source: Type.String({
        description:
          "Ticket key, PR URL, or task description that triggered this learning",
      }),
      context: Type.String({
        description: "What situation triggered this learning?",
      }),
      insight: Type.String({
        description: "What was learned? What is the non-obvious part?",
      }),
      trigger: Type.String({
        description:
          "Specific conditions when this engram is relevant (for future retrieval)",
      }),
      anti_trigger: Type.String({
        description:
          "Conditions when this engram should NOT be applied",
      }),
      supersedes: Type.Optional(
        Type.String({
          description:
            "Relative path to an older engram this replaces, or omit if none",
        })
      ),
    }),
    async execute(_toolCallId, params) {
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

      const markdown = renderEngram(params);
      const date = new Date().toISOString().split("T")[0];
      let filename = `${date}-${slugify(params.title)}.md`;
      let filePath = path.join(currentConfig.engramsDir, filename);

      let suffix = 1;
      while (fs.existsSync(filePath)) {
        filename = `${date}-${slugify(params.title)}-${suffix}.md`;
        filePath = path.join(currentConfig.engramsDir, filename);
        suffix++;
      }

      fs.mkdirSync(currentConfig.engramsDir, { recursive: true });
      fs.writeFileSync(filePath, markdown, "utf-8");

      const home = process.env.HOME || "";
      const displayPath = filePath.replace(home, "~");

      return {
        content: [
          {
            type: "text",
            text: `Engram written: ${displayPath}\n\nTitle: ${params.title}\nCategory: ${params.category}\nDurability: ${params.durability}\nTags: ${params.tags.join(", ")}`,
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
    description:
      "Semantic search over the agent engram memory store. Returns the most relevant engrams for a natural language query, with optional metadata filtering. Use to recall prior knowledge before starting a task.",
    promptGuidelines: [
      "Call engrams_search at the start of a task to recall relevant prior knowledge from the team's collective memory.",
      'Use for conceptual queries: "how did we debug X", "what patterns work for Y", "known issues with Z".',
      "Use metadata filters to narrow results: category, agent, durability, tags.",
      "Pay attention to the durability field in results: hypothesis engrams may be unreliable, workaround engrams may be outdated.",
      "Check the supersedes field — if an engram supersedes another, prefer the newer one.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Natural language search query" }),
      limit: Type.Optional(
        Type.Number({
          description: "Max results to return (default 8, max 20)",
        })
      ),
      category: Type.Optional(
        Type.String({
          description:
            "Filter by category: debugging, api, architecture, tooling, domain, performance, testing",
        })
      ),
      agent: Type.Optional(
        Type.String({ description: "Filter by authoring agent name" })
      ),
      durability: Type.Optional(
        Type.String({
          description:
            "Filter by durability: permanent, workaround, hypothesis",
        })
      ),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: "Filter by tags (match any)",
        })
      ),
    }),
    async execute(_toolCallId, params, signal) {
      if (!index || index.size() === 0) {
        const msg = !index
          ? "agent-engrams: index not initialized. Check Ollama connection."
          : "Engram index is empty — no engrams have been written yet.";
        return { content: [{ type: "text", text: msg }], details: {} };
      }

      const limit = Math.min(params.limit ?? 8, 20);
      const filters: Record<string, unknown> = {};
      if (params.category) filters.category = params.category;
      if (params.agent) filters.agent = params.agent;
      if (params.durability) filters.durability = params.durability;
      if (params.tags && params.tags.length > 0) filters.tags = params.tags;

      const hasFilters = Object.keys(filters).length > 0;

      try {
        const results = await index.search(
          params.query,
          limit,
          hasFilters ? (filters as any) : undefined,
          signal
        );

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No relevant engrams found for: "${params.query}"`,
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

        const header = `Found ${results.length} engrams for "${params.query}" (${index.size()} total indexed):\n\n`;

        return {
          content: [{ type: "text", text: header + output }],
          details: { resultCount: results.length, indexSize: index.size() },
        };
      } catch (err: any) {
        throw new Error(`engrams_search failed: ${err.message}`);
      }
    },
  });
}
